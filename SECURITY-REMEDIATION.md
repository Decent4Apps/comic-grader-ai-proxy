# Security remediation — 2026-10-15

These changes require review and staged deployment. No production secrets or live services were used during verification. Dependency locks were regenerated with install scripts disabled. Offline regression tests run with `node --test test/*.test.mjs` (Node 24 for direct TypeScript imports).

## Paid provider access

All provider routes now require `Authorization: Bearer <PAID_PROXY_SECRET>` with a randomly generated secret of at least 32 characters. This credential is for a trusted application backend only. Never place it in a browser bundle, mobile application, public environment variable, query string, or local storage. A legitimate frontend should authenticate to its own backend; that backend must enforce each user's authorization and quota before attaching the proxy credential to the server request.

Configure `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Missing authentication or quota configuration and Redis failures reject requests before provider work. Redis atomically enforces a deployment-wide minute/day request budget (defaults 10/100; configurable using `PAID_MAX_REQUESTS_PER_MINUTE` / `PAID_MAX_REQUESTS_PER_DAY`). This request budget is not a dollar budget; keep provider account spending caps enabled. Model allowlists use `PAID_ALLOWED_MODELS` (default `gpt-4o-mini`). Bodies are streamed with size limits; text completion output is capped. Long-lived jobs and provider-specific billing must also be capped in the provider dashboard.

Old direct browser integrations must move to that trusted backend flow before enabling these routes. Use a new secret and do not reuse a secret previously embedded in a client.

Firecrawl crawl jobs are capped at 25 pages, depth 2 and concurrency 1; caller-supplied webhook/scrape overrides are removed. Search limits are capped at 25. Next 14 routes with dynamic params were adapted for Next 15; Next is pinned to 15.5.28 and React to 19.2.9. Provider staging smoke tests are still required with an authorized backend and sandbox credentials.
