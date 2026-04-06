# Backend Deployment

## Recommended Shape

Deploy the FastAPI backend as a standalone container service and keep the React frontend separate.

The repository root now includes a backend-focused `Dockerfile` that starts:

```bash
uvicorn astramvp.backend.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

The container exposes a lightweight health check endpoint:

```text
GET /healthz
```

Expected response:

```json
{"status":"ok"}
```

## Required Environment Variables

At minimum, configure:

```bash
SUPABASE_DB_URL=postgresql+asyncpg://...
SUPABASE_POOL_MODE=session
ACCOUNT_TOKEN_VAULT_SECRET=replace-with-a-long-random-secret
REDIS_URL=redis://...
OPENAI_MODEL=gpt-4o-mini
XHS_STRICT_AUTH=true
```

## Database Guidance

- Prefer the Supabase session pooler on port `5432` for deployed services.
- Avoid the direct `db.<project-ref>.supabase.co:5432` URL unless the runtime environment supports IPv6.
- Use the transaction pooler on port `6543` only when you explicitly want transaction pooling.

Examples:

```bash
# Recommended for a long-running backend service
SUPABASE_DB_URL=postgresql+asyncpg://postgres.<project-ref>:[PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
SUPABASE_POOL_MODE=session
```

```bash
# Only if your runtime supports IPv6
SUPABASE_DB_URL=postgresql+asyncpg://postgres:[PASSWORD]@db.<project-ref>.supabase.co:5432/postgres
SUPABASE_POOL_MODE=direct
```

## Redis Requirement

`REDIS_URL` must point at a reachable managed Redis instance in production.

The backend uses Redis for:

- Xiaohongshu auth token and cookie cache
- strategy memory / agent state

Do not deploy with `redis://localhost:6379/0` unless Redis runs in the same private network.

## Xiaohongshu Login Sync Caveat

The cloud deployment should not rely on the Playwright QR-login sync flow.

That flow starts a local visible Chromium session from `scripts/xhs_playwright_login_sync.cjs`, which is suitable for local development but not for a typical managed backend service. In a Python-only container, the backend will naturally report that browser sync is unavailable.

## Suggested Platform Checklist

Any platform that can run a Dockerfile-based web service is fine. Before switching traffic, verify:

1. The service boots with `SUPABASE_DB_URL`, `ACCOUNT_TOKEN_VAULT_SECRET`, and `REDIS_URL` configured.
2. `GET /healthz` returns `200`.
3. `GET /api/xhs/auth/status` returns a JSON payload instead of a connection error.
4. The frontend points to the deployed backend base URL.
