# LendLoop

**Borrow what you need. Lend what you don't.**

A neighborhood tool-lending board. Neighbors list tools they are willing to lend, request to borrow for a date range, and get automated notifications and overdue reminders handled by n8n.

Stack: Next.js (App Router) + TypeScript, Clerk (auth), Convex (data + backend logic), n8n (self-hosted via Docker).

## Features

- **Public page**: tagline, read-only list of available tools (name and category only, no owner details), and a "Sign in to lend or borrow" button wired to Clerk.
- **Signed-in users**: list a tool (name, category, condition, short description), browse all tools with availability and a category filter, request a tool for a date range, approve or decline requests on their own tools, mark a loan returned. Views: Browse, My listings, My requests, Incoming requests.
- **Roles**: `admin` (remove any listing, see all loans, mark a lender "Trusted Lender") and `user` (own listings and own borrowing only).
- **Automation (n8n)**: request notifications, daily overdue reminders, an error workflow. Recent automation activity is shown on each loan ("Reminder sent 2 days ago").

## Architecture

```
 Browser ──Clerk JWT──▶ Next.js (App Router) ──Convex client──▶ Convex
                                                            │  queries / mutations (RBAC enforced here)
                                                            │
   (1) request created / status changed                     │
   Convex action ──POST + HMAC──▶ n8n Webhook ──▶ verify ▶ notify user (mock log or SMTP)
                                                            │
   (2) daily 09:00                                          │
   n8n Schedule ──GET + HMAC──▶ Convex HTTP /n8n/overdue    │
   n8n ──▶ reminder per borrower ──POST + HMAC──▶ /n8n/reminder-sent  (idempotent)
                                                            │
   (3) any n8n failure ──▶ Error workflow ──POST + HMAC──▶ /n8n/automation-failure ──▶ activity log
```

Repo layout:

```
app/                 Next.js routes (public page, /dashboard)
components/          Convex + Clerk provider
middleware.ts        Clerk: /dashboard requires a session
convex/
  schema.ts          users, tools, borrowRequests, activityLog, reminders
  users.ts tools.ts requests.ts   queries and mutations (all RBAC checks live here)
  notify.ts          Convex -> n8n signed webhook with retry/backoff
  http.ts            n8n -> Convex signed endpoints
  lib/rbac.ts        pure authorization rules (unit tested)
  lib/hmac.ts        HMAC-SHA256 sign/verify (unit tested)
n8n/workflows/       exported workflows (no secrets)
scripts/gen_workflows.py   regenerates the workflow JSON
tests/               RBAC and HMAC unit tests
docker-compose.yml   self-hosted n8n
```

## Local setup

Prerequisites: Node 20+, Docker, free accounts at [Clerk](https://clerk.com) and [Convex](https://convex.dev).

1. **Install**: `npm install`
2. **Clerk**: create an application. Copy the publishable and secret keys into `.env.local` (see `.env.example`). In Clerk, Configure > JWT templates > New template > **Convex** (keep the name `convex`). Copy its **Issuer** URL.
3. **Convex**: `npx convex dev` (log in, create a project; it writes `NEXT_PUBLIC_CONVEX_URL` to `.env.local` and generates `convex/_generated`). Then set deployment env vars:
   ```
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-clerk-issuer>
   npx convex env set LENDLOOP_HMAC_SECRET $(openssl rand -hex 32)
   npx convex env set N8N_WEBHOOK_URL https://<public-url-of-n8n>/webhook/lendloop-request
   ```
   Convex runs in the cloud, so it cannot reach `localhost`. Expose local n8n with a tunnel (`cloudflared tunnel --url http://localhost:5678` or ngrok) and use that URL, or use n8n Cloud.
4. **n8n**: copy the same HMAC secret into the Docker env. Create `.env` next to `docker-compose.yml` with `LENDLOOP_HMAC_SECRET`, `CONVEX_SITE_URL` (the `https://<name>.convex.site` URL shown in the Convex dashboard) and `N8N_ENCRYPTION_KEY`, optionally `N8N_PUBLIC_URL` (the tunnel URL). Then:
   ```
   docker compose up -d
   docker compose exec n8n n8n import:workflow --separate --input=/workflows
   ```
   Open http://localhost:5678, then set the **Error workflow** of both main workflows to "LendLoop - Error workflow" (Workflow settings), and activate the first two.
5. **Run the app**: `npm run dev`, open http://localhost:3000.
6. **First admin**: sign in once, then `npx convex run users:promoteToAdmin '{"email":"you@example.com"}'`. Promotion is an internal function: no client can call it.
7. **Tests**: `npm test` (RBAC rules and HMAC helpers), `npm run typecheck`.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | `.env.local` | Clerk |
| `NEXT_PUBLIC_CONVEX_URL` | `.env.local` | Convex client (written by `convex dev`) |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex env | Validates Clerk tokens |
| `LENDLOOP_HMAC_SECRET` | Convex env and n8n container env | Shared HMAC secret |
| `N8N_WEBHOOK_URL` | Convex env | Where Convex posts request events |
| `CONVEX_SITE_URL` | n8n container env | Base URL of Convex HTTP endpoints |
| `N8N_ENCRYPTION_KEY` | n8n container env | Encrypts n8n credentials at rest |

Nothing secret is committed. `.env.example` has placeholders only, and the exported workflows read secrets from `$env` at runtime.

## n8n workflows (`n8n/workflows/`)

1. **Request notification**: Webhook (raw body) > verify HMAC and timestamp > dedupe on `eventId` > build a message from only the needed fields > send (logged mock; swap in an Email Send node with an SMTP credential) > respond 200. Bad signatures get 401 and nothing runs. Convex retries non-2xx responses.
2. **Overdue reminders**: Schedule (daily 09:00) > signed GET `/n8n/overdue` > one item per overdue loan > reminder > signed POST `/n8n/reminder-sent` with `idempotencyKey = requestId:YYYY-MM-DD`. HTTP nodes retry 3 times.
3. **Error workflow**: Error Trigger > signed POST `/n8n/automation-failure`, so failed runs appear in the app's activity log instead of failing silently.

## Security and data-minimization decisions

- **RBAC is server-side.** Every Convex mutation loads the row from the database and checks ownership or role through `convex/lib/rbac.ts`. The client never supplies a role, an owner id, or a lender id. `lenderId` is copied from the tool row at request time.
- **Roles are not self-service.** New users are always `user`. Admin promotion is an internal function run by an operator.
- **Public page exposes name and category of available tools only.** No owner, no description, no ids that point to users.
- **Authenticated lists show the owner's display name only.** Emails never reach the browser. Admin user list omits emails too.
- **HMAC both directions.** SHA-256 over `timestamp.rawBody`, constant-time comparison, 5-minute window against replay. Failures return a generic 401.
- **Minimal payloads to n8n.** Recipient name and email, tool name, actor name, status, dates. Nothing else.
- **Idempotent write-backs.** A `reminders` ledger keyed by `requestId:date` means a retried POST creates no second reminder or counter bump. Notifications carry a stable `eventId` that n8n dedupes.
- **Failures are visible.** Convex retries the webhook with exponential backoff (5 attempts) and logs a final failure on the loan. n8n failures go to the error workflow and the activity log.
- **Secrets** live in env vars (Convex, container env) and n8n's encrypted credential store (SMTP, when used). None are in code or workflow JSON.
- **Input handling.** Text is trimmed and length capped, dates validated, categories are a closed union, deleting a tool is a soft delete to keep history.
- **Healthcare-style consideration (privacy).** For a clinical product I would apply the same pattern: the automation layer receives only the minimum identifiers needed to notify, never clinical content, with an audit trail for every automated action and signed, replay-protected calls between systems.

## What I'd change for production

- Move the shared HMAC secret into per-environment secret storage with rotation (accept two secrets during rotation). Put n8n behind a reverse proxy with TLS and an IP allow-list for the webhook.
- Real email delivery (SMTP or a provider) with templates and bounce handling instead of the logged mock.
- Rate limiting on mutations, pagination on lists, and server-side date handling in the lender's time zone (dates are UTC strings today).
- Persist the n8n dedupe set in Convex or Redis rather than workflow static data, and add alerting (Sentry or Datadog) on the error workflow.
- Postgres for n8n, backups, and queue mode for scale. End-to-end tests (Playwright) and CI.
- A tool image upload, and a reputation signal built on "Trusted Lender".
- **Backend alternative.** I would seriously consider a Go service on SQLite for a small community tool like this: very low RAM, one static binary, single-file backups, and a trivial deploy. The tradeoffs are real: I would give up Convex's realtime sync and shared TypeScript types, and I would write more plumbing myself (auth middleware, subscriptions, migrations). I'm happy to build it that way if you prefer.

## Known limitations

- Reminders and notifications are logged mocks until an SMTP credential is wired in.
- Dates are plain `YYYY-MM-DD` in UTC.
- Realtime updates come from Convex subscriptions; there is no offline mode.

## Tested vs untested

- Tested against live Clerk and Convex dev instances (Playwright, 20 checks): sign-up and sign-in, public list, lend, borrow, approve, return, admin tab, activity log, and server-side RBAC rejections with real JWTs.
- Unit tests (17), `tsc` and `next build` pass.
- NOT tested: the n8n workflows. The build sandbox had no Docker, so the workflow JSON in `n8n/workflows/` was never imported into a running n8n. Expect to fix small import issues.
- Uses `@clerk/nextjs` 7, which replaces `SignedIn`/`SignedOut` with `<Show when="signed-in|signed-out">`.
- For headless testing on a Clerk dev instance, turn off "Challenge suspicious sign-ups" and use `+clerk_test@example.com` emails (code 424242). Turn it back on afterwards.

## Demo data

`npx convex run seed:reset` wipes all tables and inserts 4 placeholder lenders, 10 tools and one active loan. Seed lenders cannot sign in. After you sign in for the first time, make yourself admin with `npx convex run users:promoteToAdmin '{"email":"you@example.com"}'`. The Playwright run in testing creates throwaway users and tools, so reseed after running it.
