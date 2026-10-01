# Email

Private `@repo/nuxt-email` provides optional server-only transactional SMTP, with Nodemailer 10.0.13. Requires the Node production runtime, with no database or other capability dependency. Root authentication and telemetry are deliberate consumer integrations; clean consumers opt in. Evaluation: [EMAIL_MODULE_EVALUATION.md](../../EMAIL_MODULE_EVALUATION.md).

## Install and configure

Retain the workspace dependency and add `'@repo/nuxt-email'` to Nuxt `modules`. For external unpublished consumers, build/pack the private package and install its tarball; select a public scope before publication. Import server APIs from `@repo/nuxt-email/server`; only `getEmail` is auto-imported. The module registers cleanup and creates no routes, tables or startup connections. Installation/build/boot requires no SMTP configuration until used.

Required on use: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `EMAIL_FROM_ADDRESS`. Optional `EMAIL_FROM_NAME`, paired `SMTP_USER`/`SMTP_PASSWORD`, `EMAIL_REPLY_TO_ADDRESS`/`EMAIL_REPLY_TO_NAME`, `EMAIL_MAX_RECIPIENTS` (default 50; 1–100). Server overrides may use `createEmail(config)`. All credentials remain server-only.

Security is explicit, independent of port: `tls` → secure=true; `starttls` → secure=false, requireTLS=true; `opportunistic` → secure=false, requireTLS=false. Certificate validation is never disabled. Opportunistic is appropriate for the local sink; production operators should require TLS. Timeouts: connection/greeting/DNS 5 seconds, socket 10 seconds. Transport is not pooled; close manually created instances and the module closes its singleton on Nitro shutdown.

```ts
import { getEmail } from '@repo/nuxt-email/server'
await getEmail().send({ to: [{ address: 'user@example.test', name: 'User' }], subject: 'Welcome', text: 'Welcome.' })
```

From belongs to configuration. To/Cc/Bcc and optional Reply-To are structured addresses. Addresses ≤254 characters, display names ≤128 and subject ≤200 characters, combined UTF-8 body ≤1 MiB, conservative mailbox/name/control validation, bounded recipients. File/URL access is disabled; unknown fields, raw MIME, headers, path/href/content objects and attachments are rejected. No HTML fetching, tracking, template system or provider API.

Each call sends once. Results expose `accepted`/`rejected`/`partial` outcome, counts and generated Message-ID, without address lists or raw SMTP response. Partial acceptance is returned, not retried. `EmailError` exposes bounded `code`/`retryable` (configuration, connection, timeout, tls, authentication, temporary-rejection, permanent-rejection, message, unknown); raw cause is server-only and JSON/inspection are safe. Explicit 4xx rejection is retryable; 5xx is permanent; timeout/reset/unknown acceptance is conservatively non-retryable. Even a retryable error is advice, never automatic retries. Network failure after acceptance can duplicate delivery; consuming applications own idempotency and retry policy.

## Local sink and verification

`bun run email:dev:mailpit` explicitly starts Mailpit 1.31.3 at localhost SMTP1025/UI8025. No persistent volume or relay/forward/release configuration; bounded 100 messages and explicit Host allowlist mitigate DNS rebinding. `email:dev:down` removes the disposable container and its messages. Normal PostgreSQL Compose is unchanged.

```dotenv
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_SECURITY=opportunistic
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM_ADDRESS=starter@example.test
EMAIL_FROM_NAME=Starter
```

When the app shares a Compose network, use `SMTP_HOST=mailpit`, not localhost; add the service/network and server-only app environment deliberately. Mailpit API is used only for assertions/cleanup, never application sending. Chaos is enabled only in disposable fixtures.

`email:check` verifies the transport without sending. `email:smoke [recipient]` sends exactly once; explicit target is required outside the documented localhost1025 unauthenticated opportunistic setup. Output omits identity/content. `/api/health` remains database readiness; provider outage does not take unrelated routes offline.

`bun run packages:test email` verifies tarball install, backendless boot, real SMTP/API/MIME, deterministic Chaos451/550, partial delivery, connection/authentication classification and owned-dependency removal. Normal tests cover limits/security/telemetry and actual root Better Auth SMTP delivery/redemption when migrated `DATABASE_URL` is supplied. Full checks, Playwright and production image remain task/CI responsibilities.

## Root integrations and provider example

Magic links require structural SMTP config only when enabled; same-origin canonical URL validation, text+HTML sending, hashed tokens and awaited delivery replace console links. Production is supported. Never log recipients, subject, body, link/token, credentials, Message-ID or raw SMTP response. Optional application-owned `observed-email.ts` emits bounded operation/outcome/security and numeric duration/count only.

Jobs remains optional: a domain job can call Email and inspect `EmailError.retryable`. Generic queued mail is deferred because payload privacy/retention, idempotency, ambiguous SMTP acceptance and duplicate-delivery policy need application decisions. No arbitrary email bodies or recipients are persisted to pg-boss here.

Purelymail is a documentation example only: `smtp.purelymail.com`, port465/security=tls or port587/security=starttls, full mailbox username and account/app password. SPF, DKIM, DMARC and sender reputation are operator/provider responsibilities. Tests never contact it.

## Removal

Follow [Starting a project](../../docs/STARTING-A-PROJECT.md#remove-email). Disable magic links or deliberately replace their sender; never restore console URLs. Remove module/dependency, wrappers/scripts, SMTP env, local Compose helpers and reference enablement. No DB migration or external account/DNS/credential action. Generic fixture proves removing the package and Nodemailer leaves base Nuxt typecheck/build green. Permanent source pruning requires coordinated catalog/docs updates.
