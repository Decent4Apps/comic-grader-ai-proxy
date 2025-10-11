// app/api/ai/route.ts
/**
 * AI Proxy (Node runtime)
 * - Superagent Firewall (OpenAI-compatible) WITHOUT using Authorization for sa_ key
 * - Headers: send Superagent key via gateway headers (not Authorization)
 * - Adds: idempotency cache, short debounce, per-device concurrency cap (max 2)
 * - Avoids gzip from upstream with Accept-Encoding: identity
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ---------- Env ----------
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gpt-4o-mini';
const SUPERAGENT_PROXY_URL = normalizeBase(process.env.SUPERAGENT_PROXY_URL); // e.g. https://firewall.superagent.sh/<config_id>/v1
const SUPERAGENT_API_KEY = process.env.SUPERAGENT_API_KEY || '';              // e.g. sa_xxx

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
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
};
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS as any });
}

// ---------- In-memory guards (stateless within a single lambda instance) ----------
type CacheEntry = { status: number; body: string; ts: number };
const IDEMPOTENCY_CACHE = new Map<string, CacheEntry>(); // 30s cache
const RECENT_KEYS = new Map<string, number>();           // 400ms debounce
const CONCURRENCY = new Map<string, number>();           // active per device
const IDEMPOTENCY_TTL_MS = 30_000;
const DEBOUNCE_MS = 400;
const MAX_CONCURRENCY_PER_DEVICE = 2;

function withCors(r: Response) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => r.headers.set(k, v));
  return r;
}
function json(res: any, status = 200) {
  return withCors(
    new Response(JSON.stringify(res, null, 2), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  );
}

function now() { return Date.now(); }
function cleanupCaches() {
  const cutoff = now() - IDEMPOTENCY_TTL_MS;
  for (const [k, v] of IDEMPOTENCY_CACHE) if (v.ts < cutoff) IDEMPOTENCY_CACHE.delete(k);
  const recentCutoff = now() - DEBOUNCE_MS;
  for (const [k, t] of RECENT_KEYS) if (t < recentCutoff) RECENT_KEYS.delete(k);
}

function hashish(obj: any) {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  // tiny non-crypto hash
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return `${h >>> 0}`;
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  cleanupCaches();

  // ---------- Headers from client ----------
  const deviceId = (req.headers.get('x-device-id') || 'anon').slice(0, 100);
  const idem = (req.headers.get('x-idempotency-key') || '').slice(0, 200);

  // ---------- Idempotency (return cached result if present) ----------
  if (idem) {
    const cached = IDEMPOTENCY_CACHE.get(idem);
    if (cached && now() - cached.ts < IDEMPOTENCY_TTL_MS) {
      const r = new Response(cached.body, {
        status: cached.status,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'x-idempotent': 'true',
          'cache-control': 'no-store',
        },
      });
      return withCors(r);
    }
  }

  // ---------- Debounce (collapse bursts within 400ms) ----------
  const rawBody = await req.text();
  const key = hashish(rawBody + deviceId);
  const last = RECENT_KEYS.get(key) || 0;
  if (now() - last < DEBOUNCE_MS) {
    return json({ duplicated: true, reason: 'debounced', window_ms: DEBOUNCE_MS }, 202);
  }
  RECENT_KEYS.set(key, now());

  // ---------- Concurrency gate ----------
  const active = CONCURRENCY.get(deviceId) || 0;
  if (active >= MAX_CONCURRENCY_PER_DEVICE) {
    return json({ error: 'Too many concurrent requests', max: MAX_CONCURRENCY_PER_DEVICE }, 429);
  }
  CONCURRENCY.set(deviceId, active + 1);

  // ---------- Main logic ----------
  try {
    const body = safeParse(rawBody) || {};
    const model: string = body.model || DEFAULT_MODEL;
    const stream: boolean = !!body.stream;
    const messages: any[] = Array.isArray(body.messages) ? body.messages : [];

    if (model.startsWith('claude-')) {
      if (!anthropic) return json({ error: 'Anthropic not configured' }, 400);
      const res = await handleAnthropic({ model, messages, temperature: body.temperature, max_tokens: body.max_tokens });
      cacheIdem(idem, res);
      return res;
    }

    // Superagent Firewall (OpenAI-compatible) path
    if (!SUPERAGENT_PROXY_URL || !SUPERAGENT_API_KEY) {
      return json({
        error: 'Missing SUPERAGENT_PROXY_URL or SUPERAGENT_API_KEY',
        expected: ['SUPERAGENT_PROXY_URL', 'SUPERAGENT_API_KEY'],
      }, 500);
    }

    const res = stream
      ? await proxyOpenAIStream({ body, started })
      : await proxyOpenAINonStream({ body, started });

    cacheIdem(idem, res);
    return res;
  } catch (err: any) {
    console.error('[AI API] Uncaught error:', err);
    return json({ error: 'AI proxy error', detail: err?.stack || String(err) }, 500);
  } finally {
    // release one slot
    const curr = CONCURRENCY.get(deviceId) || 1;
    CONCURRENCY.set(deviceId, Math.max(0, curr - 1));
  }
}

// ---------- Superagent (OpenAI-compatible) ----------

async function proxyOpenAINonStream({ body, started }: { body: any; started: number; }) {
  const url = `${SUPERAGENT_PROXY_URL}/chat/completions`;

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      // IMPORTANT: do NOT send Authorization: Bearer sa_...
      // Send Superagent key using gateway headers (support both common names)
      'x-api-key': SUPERAGENT_API_KEY,
      'x-superagent-api-key': SUPERAGENT_API_KEY,
      'content-type': 'application/json',
      'accept': 'application/json',
      'accept-encoding': 'identity', // avoid gzip JSON
    },
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
    // If you still see OpenAI-style error payloads complaining about sa_ key,
    // your firewall is still forwarding Authorization to OpenAI (we’re not sending it here).
    console.error('[OpenAI via Superagent] Non-OK:', upstream.status, text.slice(0, 500));
    return json({ error: 'Upstream (Superagent) error', status: upstream.status, detail: safeParse(text) }, upstream.status);
  }

  try {
    const data = JSON.parse(text);
    const took = Date.now() - started;
    return json({ ...data, _meta: { upstream: 'superagent', took_ms: took } }, 200);
  } catch (e) {
    console.error('[OpenAI via Superagent] JSON parse error. First 40 bytes:', text.slice(0, 40));
    return json({
      error: 'Invalid JSON from upstream (likely compressed)',
      hint: 'We send Accept-Encoding: identity. If this persists, check the gateway config for forced compression.',
      preview: text.slice(0, 120),
    }, 502);
  }
}

async function proxyOpenAIStream({ body, started }: { body: any; started: number; }) {
  const url = `${SUPERAGENT_PROXY_URL}/chat/completions`;

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': SUPERAGENT_API_KEY,
      'x-superagent-api-key': SUPERAGENT_API_KEY,
      'content-type': 'application/json',
      'accept': 'text/event-stream',
      'accept-encoding': 'identity', // avoid gzip’d SSE
    },
    body: JSON.stringify({ ...body, model: body.model || DEFAULT_MODEL, stream: true }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    console.error('[OpenAI via Superagent][stream] Non-OK:', upstream.status, errText.slice(0, 500));
    return json({ error: 'Upstream (Superagent) error', status: upstream.status, detail: safeParse(errText) }, upstream.status);
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
async function handleAnthropic(opts: { model: string; messages: any[]; temperature?: number; max_tokens?: number; }) {
  const { model, messages, temperature, max_tokens } = opts;

  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const chat = messages.filter((m) => m.role !== 'system').map((m) => ({
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
    // Surface Anthropic 429 with retry hints
    const code = e?.status || 500;
    const retryAt = e?.headers?.get?.('retry-after') || e?.headers?.get?.('anthropic-ratelimit-input-tokens-reset');
    return json({ error: 'Anthropic error', status: code, detail: e?.message || String(e), retry_after: retryAt }, code);
  }
}

// ---------- Utils ----------
function safeParse(s: string) { try { return JSON.parse(s); } catch { return undefined; } }

// no GET handler
