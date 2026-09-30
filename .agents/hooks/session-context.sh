#!/bin/sh
# Node 24 can strip the shared TypeScript when Bun is not on PATH yet.
hook_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if command -v bun >/dev/null 2>&1; then
  exec bun "$hook_root/session-context.ts" "$@"
fi
exec node "$hook_root/session-context.ts" "$@"
