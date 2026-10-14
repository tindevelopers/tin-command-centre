# Hosting

**Status:** the address below was stated by the owner on 2026-10-13. It has not been checked from an automated session (the agent sandbox's egress proxy blocks `vercel.app`). Everything marked unconfirmed has no source in this repository.

## Address

| Environment | URL | Source |
|---|---|---|
| Production | https://tin-ops-console.vercel.app | Owner, 2026-10-13 |

This is the company-wide technology register (see `authority-model.md`, decision A-console). It is **not** Konnect's Platform Console (`apps/ops` in `konnect-caas-base`, a separate app) and it is **not** TIN Command (`tin-command`, a separate planned app). No document in this repository or in the programme repositories names `console.tin.info` or `console.tinconnect.com` as this app's address.

## What is known

- The app is a Next.js app that uses Neon Auth for sign-in. Sign-up is closed; access is controlled by the `console_operators` allow-list (`db/001_status.sql`, `docs/evidence.md`).
- Environment variable names it needs: `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `CONSOLE_DATABASE_URL`, `CONSOLE_ADMIN_DATABASE_URL`, and optionally `AGENT_GITHUB_TOKEN`. Without `CONSOLE_DATABASE_URL` nobody passes the operator check. Values are never recorded here.

## Unconfirmed

- Whether there is a custom domain in front of the Vercel address.
- Which Vercel project and team own the deployment, and how deploys are triggered. There is no deploy configuration or CI file in this repository.
- Whether preview deployments are protected.

Record the answers here when the owner confirms them.
