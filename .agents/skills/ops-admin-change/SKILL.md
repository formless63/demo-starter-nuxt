---
name: ops-admin-change
description: Changing Ops access, static inspection adapters, deadlines, privacy, or removal boundaries.
---

# Read-only Ops changes

Read capability-change and [the contract](../../../capabilities/ops-admin/CAPABILITY.md). Keep human baseline sessions plus server-only privileged IDs; API keys/organization ownership never authorize. Default guard narrows; replacement is deliberate and requires a guard. No mutations, probe writes, discovery, readiness dependency, raw details or provider configuration in summaries/logs. Inspect supported provider methods before choosing them: pg-boss getQueueStats may refresh/write; producer lifecycle creates queues. Use reader-role bounded getQueues only, omit unknown counts. Forward cancellation where supported; retain at most one noncancellable invocation per adapter/service, including its actual concurrency slot until settlement. Never recreate the registry per request. Package imports no optional capability; application owns optional imports/cleanup. Removal must keep baseline login/session/health and provider/database state; verify packed removal/rebuild and real local read-only protocol canaries. No sibling repository consultation.
