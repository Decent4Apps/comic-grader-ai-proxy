# FIRECRAWL_STATUS

## Health Check
- `GET /api/firecrawl/status`
  - 200 OK → Key present and defaults loaded
  - 500    → Missing `FIRECRAWL_API_KEY`

## Quick Test
```bash
curl -s https://<your-vercel-domain>/api/firecrawl/status | jq .
