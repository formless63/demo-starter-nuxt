---
name: observability-change
description: Changing server logs, request correlation, OpenTelemetry spans/metrics, exporters, exception capture, build metadata, or telemetry shutdown.
---

# Observability change

Read `capabilities/observability/CAPABILITY.md` and `OBSERVABILITY_MODULE_EVALUATION.md`; use `capability-change` for package-contract changes.

- Never send secrets to logs or telemetry. Raw headers, arbitrary query strings, request bodies, job payloads and Better Auth session/user objects are omitted by default. Extend `redactKeys` for application-specific sensitive fields. Free-text messages and manual attributes still require deliberate safe values.
- Preserve guarded Pino child bindings and safe exception serialization; error text, causes and stacks may contain credentials or SQL. Test the actual emitted JSON and OTLP, not just sanitizer helpers.
- Use current semantic conventions. Metric dimensions must use bounded registered route/operation/job names, methods and statuses; IDs and arbitrary URLs are never metric dimensions.
- Request context must remain async-safe across concurrent requests and nested spans. Use supported Nitro/Kit integration rather than patching router internals.
- No backend is valid. OTLP is optional, signals are independently configurable, and absent endpoints must not instantiate localhost exporters.
- Jobs/API integrations remain application-owned and optional; do not introduce capability dependencies for telemetry.
- Flush and bounded exporter shutdown are part of correctness for Nitro and workers. Keep the supported Jobs lifecycle hook generic.
- Telemetry changes require secrecy, concurrency, span/error, metric/cardinality, export/no-backend and shutdown tests. Run `packages:test observability`, affected Jobs/API fixtures, normal checks and production container smoke.

Keep v1 server-only. Do not add browser analytics, replay, or a vendor-specific backend as incidental observability work.
