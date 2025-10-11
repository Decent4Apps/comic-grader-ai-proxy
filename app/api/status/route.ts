// app/api/ai/route.ts
/**
 * AI Proxy (Node runtime)
 * - Superagent Firewall (OpenAI-compatible) WITHOUT Authorization: Bearer sa_...
 * - Sends Superagent key via gateway headers only (x-api-key / x-superagent-*)
 * - Forces identity encoding to avoid gzip JSON/SSE issues
 * - Duplicate-call control:
 *    • Auto idempotency (30s) even if client doesn't send x-idempotency-key
 *    • 400ms debounce for burst-clicks
 *    • Per-device concurrency cap: 2
 * - Optional Anthropic direct path for claude-* models
 */

import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ---------- Environment ----------
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gpt-4o-mini';
const SUPERAGENT_PROXY_URL = normalizeBase(process.env.SUPERAGENT_PROXY_URL); // e.g. https://firewall.superagent.sh/<config_id>/v1
const SUPERAGENT_API_KEY = (process.env.SUPERAGENT_API_KEY || '').trim();

const ANTHROPIC_API_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

function normalizeBase(raw?: string) {
  if (!raw) return '';
  let url = raw.trim().replace(/\/+$/, '');
  if (!/\/v1$/i.test(url)) url += '/v1';
  return url;
}

// ---------- CORS ----------
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-idempotency-key, x-device-id',
} as const;

function withCors(r: Response) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => r.headers.set(k, v as string));
  return r;
}

export async function OPTIONS() {
  return withCors(new Response(null, { status: 204 }));
}

// ---------- Duplicate/Concurrency Control (in-memory within instance) ----------
type CacheEntry = { status: number; body: string; ts: number };
const IDEMPOTENCY_CACHE = new Map<string, CacheEntry>(); // 30s
const RECENT_KEYS = new Map<string, number>();           // 400ms debounce
const CONCURRENCY = new Map<string, number>();           // per device

const IDEMPOTENCY_TTL_MS = 30_000;
const DEBOUNCE_MS = 400;
const MAX_CONCURRENCY_PER_DEVICE = 2;

function cleanupCaches() {
  const cutoff = Date.now() - IDEMPOTENCY_TTL_MS;
  for (const [k, v] of IDEMPOTENCY_CACHE) if (v.ts < cutoff) IDEMPOTENCY_CACHE.delete(k);
  const recentCutoff = Date.now() - DEBOUNCE_MS;
  for (const [k, v] of RECENT_KEYS) if (v < recentCutoff) RECENT_KEYS.delete(k);
}

function tinyHash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function json(data: any, status = 200) {
  return withCors(
    new Response(JSON.stringify(data, null, 2), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  );
}

function cacheIdem(idemKey: string | undefined, res: Response) {
  if (!idemKey) return;
  res.clone().text().then((body) => {
    IDEMPOTENCY_CACHE.set(idemKey, { status: res.status, body, ts: Date.now() });
  }).catch(() => {});
}

// ---------- Route ----------
export async function POST(req: NextRequest) {
  cleanupCaches();

  // Entry log (so any hit shows up clearly in logs)
  console.log('[AI API] entry', { t: new Date().toISOString() });

  // Strip incoming Authorization (we never forward it)
  const incomingAuth = req.headers.get('authorization');
  if (incomingAuth) {
    console.warn('[AI API] Stripping incoming Authorization header from client');
  }

  // Read identifiers & body text early
  const deviceId = (req.headers.get('x-device-id') || 'anon').slice(0, 100);
  let idem = (req.headers.get('x-idempotency-key') || '').slice(0, 200);
  const rawBody = await req.text();

  // Auto-idempotency when client doesn't supply one
  if (!idem) idem = `auto:${deviceId}:${tinyHash(rawBody)}`;

  // Serve cached response if within TTL
  const cached = IDEMPOTENCY_CACHE.get(idem);
  if (cached && Date.now() - cached.ts < IDEMPOTENCY_TTL_MS) {
    return withCors(
      new Response(cached.body, {
        status: cached.status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'x-idempotent': 'true' },
      })
    );
  }

  // Debounce burst duplicates within 400ms
  const debounceKey = tinyHash(rawBody + ':' + deviceId);
  const last = RECENT_KEYS.get(debounceKey) || 0;
  if (Date.now() - last < DEBOUNCE_MS) {
    return json({ duplicated: true, reason: 'debounced', window_ms: DEBOUNCE_MS }, 202);
  }
  RECENT_KEYS.set(debounceKey, Date.now());

  // Per-device concurrency cap
  const active = CONCURRENCY.get(deviceId) || 0;
  if (active >= MAX_CONCURRENCY_PER_DEVICE) {
    return json({ error: 'Too many concurrent requests', max: MAX_CONCURRENCY_PER_DEVICE }, 429);
  }
  CONCURRENCY.set(deviceId, active + 1);

  try {
    const body = safeParse(rawBody) || {};
    const model: string = body.model || DEFAULT_MODEL;
    const stream: boolean = !!body.stream;
    const messages: any[] = Array.isArray(body.messages) ? body.messages : [];

    // Anthropic direct path
    if (model.startsWith('claude-')) {
      if (!anthropic) return json({ error: 'Anthropic not configured' }, 400);
      const res = await handleAnthropic({
        model, messages,
        temperature: body.temperature,
        max_tokens: body.max_tokens,
      });
      cacheIdem(idem, res);
      return res;
    }

    // Superagent (OpenAI-compatible) path
    if (!SUPERAGENT_PROXY_URL || !SUPERAGENT_API_KEY) {
      return json({
        error: 'Missing SUPERAGENT_PROXY_URL or SUPERAGENT_API_KEY',
        expected: ['SUPERAGENT_PROXY_URL', 'SUPERAGENT_API_KEY'],
      }, 500);
    }

    const res = stream
      ? await proxyOpenAIStream({ body, started: Date.now() })
      : await proxyOpenAINonStream({ body, started: Date.now() });

    if (!stream) cacheIdem(idem, res);
    return res;
  } catch (err: any) {
    console.error('[AI API] Uncaught error:', err);
    return json({ error: 'AI proxy error', detail: err?.stack || String(err) }, 500);
  } finally {
    const curr = CONCURRENCY.get(deviceId) || 1;
    CONCURRENCY.set(deviceId, Math.max(0, curr - 1));
  }
}

// ---------- Superagent (OpenAI-compatible) ----------

async function proxyOpenAINonStream({ body, started }: { body: any; started: number }) {
  const url = `${SUPERAGENT_PROXY_URL}/chat/completions`;

  // Build upstream headers (IMPORTANT: no Authorization)
  const upstreamHeaders: Record<string, string> = {
    'x-api-key': SUPERAGENT_API_KEY,
    'x-superagent-api-key': SUPERAGENT_API_KEY,
    'x-superagent-token': SUPERAGENT_API_KEY,
    'content-type': 'application/json',
    'accept': 'application/json',
    'accept-encoding': 'identity', // avoid gzip JSON
  };

  const upstream = await fetch(url, {
    method: 'POST',
    headers: upstreamHeaders,
    body: JSON.stringify({
      model: body.model || DEFAULT_MODEL,
      messages: body.messages,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      top_p: body.top_p,
      presence_penalty: body.presence_penalty,
      frequency_penalty: body.frequency_penalty,
      response_format: body.response_format,
      tools: body.tools,
      tool_choice: body.tool_choice,
    }),
  });

  const text = await upstream.text();

  if (!upstream.ok) {
    // If OpenAI-style error mentions sa_ key, some layer is still sending Authorization → verify nothing sets it.
    console.error('[OpenAI via Superagent] Non-OK:', upstream.status, text.slice(0, 500));
    return json({ error: 'Upstream (Superagent) error', status: upstream.status, detail: safeParse(text) ?? text }, upstream.status);
  }

  try {
    const data = JSON.parse(text);
    const took = Date.now() - started;
    return json({ ...data, _meta: { upstream: 'superagent', took_ms: took } }, 200);
  } catch (e) {
    console.error('[OpenAI via Superagent] JSON parse error. First bytes:', text.slice(0, 40));
    return json({
      error: 'Invalid JSON from upstream (likely compressed)',
      hint: 'We send Accept-Encoding: identity. If this persists, check gateway config for forced compression.',
      preview: text.slice(0, 120),
    }, 502);
  }
}

async function proxyOpenAIStream({ body, started }: { body: any; started: number }) {
  const url = `${SUPERAGENT_PROXY_URL}/chat/completions`;

  const upstreamHeaders: Record<string, string> = {
    'x-api-key': SUPERAGENT_API_KEY,
    'x-superagent-api-key': SUPERAGENT_API_KEY,
    'x-superagent-token': SUPERAGENT_API_KEY,
    'content-type': 'application/json',
    'accept': 'text/event-stream',
    'accept-encoding': 'identity', // avoid gzip’d SSE
  };

  const upstream = await fetch(url, {
    method: 'POST',
    headers: upstreamHeaders,
    body: JSON.stringify({ ...body, model: body.model || DEFAULT_MODEL, stream: true }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    console.error('[OpenAI via Superagent][stream] Non-OK:', upstream.status, errText.slice(0, 500));
    return json({ error: 'Upstream (Superagent) error', status: upstream.status, detail: safeParse(errText) ?? errText }, upstream.status);
  }

  const readable = upstream.body;
  if (!readable) return json({ error: 'Upstream returned empty body' }, 502);

  const headers = new Headers({
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    'x-upstream': 'superagent',
    ...CORS_HEADERS,
  });

  const took = Date.now() - started;
  headers.set('x-startup-ms', String(took));
  return new Response(readable, { status: 200, headers });
}

// ---------- Anthropic ----------
async function handleAnthropic(opts: { model: string; messages: any[]; temperature?: number; max_tokens?: number }) {
  const { model, messages, temperature, max_tokens } = opts;

  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const chat = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

  try {
    const r = await anthropic!.messages.create({
      model,
      max_tokens: max_tokens ?? 1024,
      temperature: temperature ?? 0.7,
      system: sys || undefined,
      messages: chat as any,
    });

    const text = r?.content?.map((p: any) => p?.text).filter(Boolean).join('\n') || '';
    return json({
      id: r.id,
      object: 'chat.completion',
      model,
      created: Math.floor(Date.now() / 1000),
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
      _meta: { upstream: 'anthropic' },
    });
  } catch (e: any) {
    const code = e?.status || 500;
    const retryAt =
      e?.headers?.get?.('retry-after') ||
      e?.headers?.get?.('anthropic-ratelimit-input-tokens-reset') ||
      e?.headers?.get?.('anthropic-ratelimit-requests-reset');
    return json({ error: 'Anthropic error', status: code, detail: e?.message || String(e), retry_after: retryAt }, code);
  }
}

// ---------- Utils ----------
function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
