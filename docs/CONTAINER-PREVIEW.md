# Full reference app: container preview

Run the same application Dockerfile used by CI, with **all 29 modules enabled**. No local Node/Bun install or app build is needed. This is a private visual preview, not a production deployment recipe.

## Quick start

Requirements: Docker Engine/Desktop with Compose v2 and an **amd64/x86-64** host. ARM images are not published in this first iteration.

Download `compose.preview.yaml` and `.env.preview.example` from this repository (or use a clone), put them in one directory, then:

```sh
cp .env.preview.example .env.preview
# Run twice; paste different values into PREVIEW_AUTH_SECRET and PREVIEW_DB_PASSWORD.
openssl rand -hex 32
docker compose --env-file .env.preview -f compose.preview.yaml pull
docker compose --env-file .env.preview -f compose.preview.yaml up -d --wait
```

Set both secrets before the Compose commands. Use hexadecimal values for the database password so its connection URL needs no escaping. Keep `.env.preview` private and out of Git. The blank example fails closed; there are no shipped reusable auth secrets.

Open **http://127.0.0.1:3001** and **http://127.0.0.1:8026** (Mailpit). Choose magic-link sign-in with a synthetic address such as `you@example.test`, then open its message in Mailpit and follow the link. Messages stay in the local inbox; no external SMTP account or OAuth app is required. There is no seeded administrator or auth bypass. Existing authorization rules still apply.

Compose starts PostgreSQL, runs application and pg-boss migrations/doctor as a one-shot service, then starts the app and worker only after successful migration. All three use the same `PREVIEW_IMAGE`. Database data persists in a named volume; mail is disposable.

## What is available

All reference routes and capability integrations are included, including identity policy and client/UI examples. External-service features still need their providers: S3 for Storage/File UI/Import-Export, Valkey for Cache, model credentials for AI, and configured Invoice Ninja/Stripe/Medusa/ntfy services for their integrations. No real payments, provider accounts or remote services are provisioned. For these, use the existing provider Compose examples and each [capability contract](CAPABILITIES.md), adding configuration to an explicit local Compose override. “All modules enabled” does not mean every external provider has been configured.

Ops access and privileged organization/policy actions remain intentionally guarded; see their contracts for explicit operator configuration. Flags retain their safe defaults. Preview accounts and data should be synthetic.

## Remote Docker hosts

The defaults bind both web ports to loopback. For a private LAN/Tailscale host, keep the inbox private and serve the app through your HTTPS reverse proxy. Set `PREVIEW_BIND` to the intended private interface and `PREVIEW_BASE_URL` to the exact browser-visible HTTPS origin. Production secure cookies require HTTPS away from loopback; simply changing the base URL to a remote HTTP address is insufficient. Alternatively, use an SSH tunnel for both ports and retain the loopback origins. Port changes must also update the base URL. Never expose Mailpit or this mail-capture sign-in configuration to the public Internet: inbox access grants access to login links. Use real authentication/email configuration and HTTPS for a production deployment.

## Images and updates

Image: `ghcr.io/formless63/demo-starter-nuxt`. `latest` follows successful **main** CI; `sha-<full-commit-sha>` identifies a tested source revision. For reproducible deployments, pin a digest. PRs build/test but never publish. Publication uses the repository's ephemeral `GITHUB_TOKEN`, not a personal access token. The initial GHCR package may need its owner to change visibility to Public in package settings before anonymous pulls work; public GitHub source does not automatically make a new container package public.

Publishing is an additional job after all existing root and capability checks succeed. It builds the existing Dockerfile for linux/amd64 with source/revision OCI labels. No application credentials enter the build. The preview Compose/auth-mail path is smoke-tested in CI before publication.

To update a disposable preview, stop the app/worker before applying the new image's migrations:

```sh
docker compose --env-file .env.preview -f compose.preview.yaml stop app worker
docker compose --env-file .env.preview -f compose.preview.yaml pull
docker compose --env-file .env.preview -f compose.preview.yaml run --rm migrate
docker compose --env-file .env.preview -f compose.preview.yaml up -d --wait
```

Do not proceed if migration fails. Retain the database volume by default. Stop everything with `docker compose --env-file .env.preview -f compose.preview.yaml down`; only add `--volumes` when deliberately discarding all preview data. Restoring an old image does not reverse database migrations. Back up before retaining valuable data across upgrades.

## Publication troubleshooting

- `denied` on pull: confirm package visibility and image publication completed. Do not create a PAT just for a public preview.
- Migration failure: inspect `docker compose --env-file .env.preview -f compose.preview.yaml logs migrate`; app/worker should not start.
- Login link points at the wrong host: correct `PREVIEW_BASE_URL`, recreate app/worker, request a fresh link.
- Blank inbox: inspect app and mailpit logs without publishing tokens or message bodies.

The full development [Compose file](../compose.yaml) remains available for source builds and broader provider configuration. This preview file is separate and contains no `build:` directives.
