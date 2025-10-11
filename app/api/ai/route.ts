// app/api/ai/route.ts
/**
 * Multi-Provider AI API Route (Vercel, Node runtime)
 * - OpenAI-compatible through Superagent Firewall (stateless proxy)
 * - Anthropic direct (optional)
 * - Streaming (SSE) passthrough supported
 * - Forces upstream to return uncompressed JSON to avoid gzip parsing errors
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ---------- Env & Helpers ----------
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gpt-4o-mini';
const SUPERAGENT_PROXY_URL = normalizeBase(process.env.SUPERAGENT_PROXY_URL); // e.g. https://firewall.superagent.sh/<config_id>/v1
const SUPERAGENT_API_KEY = process.env.SUPERAGENT_API_KEY || '';              // e.g. sa_********************************

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

function normalizeBase(raw?: string) {
  if (!raw) return '';
  let url = raw.trim().replace(/\/+$/, '');
  if (!/\/v1$/i.test(url)) url += '/v1';
  return url;
}

function json(res: any, status = 200) {
  return new Response(JSON.stringify(res, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// CORS for RN debug builds (optional; keep if you hit CORS in dev)
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS as any });
}

// ---------- Route Handler ----------
export async function POST(req: NextRequest) {
  const started = Date.now();

  try {
    const body = await safeJson(req);
    const model: string = body.model || DEFAULT_MODEL;
    const stream: boolean = !!body.stream;
    const messages: any[] = Array.isArray(body.messages) ? body.messages : [];

    // Route by model prefix
    if (model.startsWith('claude-')) {
      if (!anthropic) return withCors(json({ error: 'Anthropic not configured' }, 400));
      return withCors(await handleAnthropic({ model, messages, temperature: body.temperature, max_tokens: body.max_tokens }));
    }

    // Default: OpenAI-compatible via Superagent Firewall
    if (!SUPERAGENT_PROXY_URL || !SUPERAGENT_API_KEY) {
      return withCors(json({
        error: 'Missing SUPERAGENT_PROXY_URL or SUPERAGENT_API_KEY',
        expected: ['SUPERAGENT_PROXY_URL', 'SUPERAGENT_API_KEY'],
      }, 500));
    }

    if (stream) {
      return withCors(await proxyOpenAIStream({ body, started }));
    } else {
      return withCors(await proxyOpenAINonStream({ body, started }));
    }
  } catch (err: any) {
    console.error('[AI API] Uncaught error:', err);
    const detail = err?.stack || String(err?.message || err);
    return withCors(json({ error: 'AI proxy error', detail }, 500));
  }
}

// ---------- Implementations ----------

async function proxyOpenAINonStream({ body, started }: { body: any; started: number; }) {
  const url = `${SUPERAGENT_PROXY_URL}/chat/completions`;

  // Force identity encoding so upstream returns plain JSON (no gzip)
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${SUPERAGENT_API_KEY}`,
      'content-type': 'application/json',
      'accept': 'application/json',
      'accept-encoding': 'identity', // ← critical fix for your gzip error
      // (Optional) if your gateway uses per-request model override:
      // 'x-openai-model': body.model || DEFAULT_MODEL,
    },
    // Make sure we send only what OpenAI expects
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
      // DO NOT send stream in non-stream branch
    }),
  });

  const text = await res.text(); // get raw response text first for better diagnostics

  if (!res.ok) {
    console.error('[OpenAI via Superagent] Non-OK:', res.status, text.slice(0, 500));
    return json({ error: 'Upstream (Superagent) error', status: res.status, detail: safeParse(text) }, res.status);
  }

  // Try JSON parse; if it fails we’ll surface a clearer error
  try {
    const data = JSON.parse(text);
    const took = Date.now() - started;
    return json({ ...data, _meta: { upstream: 'superagent', took_ms: took } }, 200);
  } catch (e) {
    // If compression leaked through, you'll see gzip bytes here
    console.error('[OpenAI via Superagent] JSON parse error. First 40 bytes:', text.slice(0, 40));
    return json({
      error: 'Invalid JSON from upstream (likely compressed)',
      hint: 'Upstream sent compressed payload. We now send Accept-Encoding: identity. If this persists, check gateway config.',
      preview: text.slice(0, 120),
    }, 502);
  }
}

async function proxyOpenAIStream({ body, started }: { body: any; started: number; }) {
  const url = `${SUPERAGENT_PROXY_URL}/chat/completions`;

  // Request server-sent events stream
  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${SUPERAGENT_API_KEY}`,
      'content-type': 'application/json',
      'accept': 'text/event-stream',
      'accept-encoding': 'identity', // avoid gzip’d SSE
    },
    body: JSON.stringify({
      ...body,
      stream: true,
      model: body.model || DEFAULT_MODEL,
    }),
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    console.error('[OpenAI via Superagent][stream] Non-OK:', upstream.status, errText.slice(0, 500));
    return json({ error: 'Upstream (Superagent) error', status: upstream.status, detail: safeParse(errText) }, upstream.status);
  }

  // Pipe SSE stream as-is
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

async function handleAnthropic(opts: { model: string; messages: any[]; temperature?: number; max_tokens?: number; }) {
  const { model, messages, temperature, max_tokens } = opts;

  // Convert OpenAI-style messages → Anthropic format
  const sysParts = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
  const chatParts = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }));

  const r = await anthropic!.messages.create({
    model,
    max_tokens: max_tokens ?? 1024,
    temperature: temperature ?? 0.7,
    system: sysParts || undefined,
    messages: chatParts as any,
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
}

// ---------- Utils ----------

async function safeJson(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function safeParse(s: string) {
  try { return JSON.parse(s); } catch { return s; }
}

function withCors(r: Response) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => r.headers.set(k, v));
  return r;
}
