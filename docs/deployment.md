# Deployment

## Vercel (+ managed Postgres: Neon, Supabase, Prisma Postgres, Render Postgres)

1. Create a Postgres database; set `DATABASE_URL`.
2. Set `SESSION_SECRET` (≥32 random chars), `AEGIS_APP_ORIGIN=https://<your-domain>`, `AEGIS_ENVIRONMENT=staging` (or production), and optionally the PayPal / AI variables. Keep the sandbox host.
3. Build command: `prisma migrate deploy && next build` (or run migrations from CI). `postinstall` runs `prisma generate`.
4. Rate limits are DB-backed and work on serverless. The workflow is short and resumable, so a function timeout during `/execute` is safe — the UI calls again and resumes.
5. Register the PayPal webhook URL for this environment and set `PAYPAL_WEBHOOK_ID`.

## Render

- Web service: build `npm ci && npx prisma migrate deploy && npm run build`, start `npm start`.
- Render Postgres; set the same env vars.

## Checklist

- [ ] `SESSION_SECRET` unique (the server refuses to start in production with the dev default)
- [ ] `PAYPAL_BASE_URL` is the sandbox host (the live host is refused without both live flags)
- [ ] `NEXT_PUBLIC_PAYPAL_CLIENT_ID` equals `PAYPAL_CLIENT_ID`
- [ ] Migrations applied (includes triggers and partial unique indexes)
- [ ] `npm run demo:reset` is local-only by default; do not run it against production data
