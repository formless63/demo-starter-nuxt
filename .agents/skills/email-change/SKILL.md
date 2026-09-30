---
name: email-change
description: Changing SMTP configuration, transactional mail, safe message/error contracts, Mailpit fixtures, or magic-link delivery.
---
# Email change

Read `capabilities/email/CAPABILITY.md` and `EMAIL_MODULE_EVALUATION.md`; use capability-change for package changes and auth-change for magic links.

- Credentials stay server-only. Require explicit TLS/starttls/opportunistic; never bypass certificate verification.
- Never log recipient, subject, body, Message-ID, magic-link URL/token, credentials or raw SMTP response. Telemetry has bounded operation/outcome/security only.
- Send once; no automatic retries. Partial acceptance requires deliberate caller handling; ambiguous acceptance can duplicate delivery.
- Keep structured addresses and bounded content/recipient validation. Reject raw/path/href, arbitrary headers, attachments and file/URL message sources.
- Mailpit is local/test sink-only infrastructure, with Host allowlist, no relay and no persistent mail volume. Chaos451/550 and partial acceptance must stay covered with real SMTP/API tests.
- Root magic links use awaited SMTP, canonical same-origin validation and hashed tokens; never console links. Disabled magic links require no SMTP.
- Jobs and Observability stay optional application composition, without package dependencies. No generic durable mail queue, provider SDK or DNS management.
- Keep clean package install/runtime/removal, root auth delivery/redemption, prior fixtures and normal verification green.
