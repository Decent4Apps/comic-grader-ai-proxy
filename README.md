# Comic Grader AI Proxy

Server-side proxy for the Comic Grader app. Provides:
- **Anonymous JWT auth** via `/api/auth/anon`
- **AI** proxy via `/api/ai` (OpenAI / Anthropic)
- **Pricing** via `/api/pricing/firecrawl` (Firecrawl + Neon cache)
- **Analyses** CRUD via `/api/analyses`
- **Client events** via `/api/events`
- **Health** via `/api/health`
- **Vercel Analytics** included

## Environment Variables (Vercel → Settings → Environment Variables)

**Production**
- `AUTH_JWT_SECRET` — 32+ random bytes (required)
- `DATABASE_URL` — Neon Postgres connection (required)
- `FIRECRAWL_API_KEY` — Firecrawl API key (required for pricing)
- `OPENAI_API_KEY` — optional if using OpenAI provider
- `ANTHROPIC_API_KEY` — optional if using Anthropic provider
- `RESEND_API_KEY` — optional if emailing users
- `ALLOWED_ORIGINS` — e.g. `https://yourapp.com` (or `*` while testing)

**Preview / Development (optional)**
- `BYPASS_TOKEN` — convenience only; **do not** set in Production

## One-time DB Setup (Neon)
If you don't use migrations yet, run:
```bash
psql "<DATABASE_URL>" -f sql/create_pricing_cache.sql
