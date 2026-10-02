# Invoice Ninja

Implementation in progress against frozen Nuxt main `7d2490cd964d0d76be25c300104d3412a3f7cead`. Independent private Nuxt module; hard dependencies Jobs and Webhooks; optional Organizations, Audit Log and Notifications. Clean consumers remain opt-in.

Target: Invoice Ninja v5.13.43, commit `382020072bc79e8c7ede49f7e9ce91b0aeb1a051`. Native bounded fetch, local owned bindings/projections, durable operations and receipts. Callback possession-secret authentication is a reconciliation hint, not a body signature. Draft ambiguity must never automatically repeat POST.

Compatibility is unverified. Actual pinned instance proof of numeric-string draft encoding and supported unsent zero-tax/discount company policy remains required. No external provider calls, accounts, credentials or callback registration are authorized.
