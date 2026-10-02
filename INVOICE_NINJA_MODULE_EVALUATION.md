# Invoice Ninja v1 evaluation

Target: v5.13.43 / `382020072bc79e8c7ede49f7e9ce91b0aeb1a051`. Native fetch avoids SDK retries and permits operation-local cancellation through body consumption.

The [native sender](https://github.com/invoiceninja/invoiceninja/blob/v5.13.43/app/Jobs/Util/WebhookSingle.php) uses an unwrapped entity transformed by ArraySerializer and configurable headers. Dedicated secret-header receipts are possession-secret hints; SHA256 is body deduplication, not occurrence identity or a signature.

The [create request](https://github.com/invoiceninja/invoiceninja/blob/v5.13.43/app/Http/Requests/Invoice/StoreInvoiceRequest.php) uses a short atomic lock, not durable idempotency. Once dispatch is marked, an ambiguous create needs operator reconciliation and must never automatically repeat POST.

Native invoice transformer omits currency. Applications must resolve an explicitly vetted current client/company currency mapping; no guessed currency from an invoice hint. Exact numeric lexemes prevent additional starter-side float conversion, but cannot undo rounding already performed by the provider transformer.

The actual pinned disposable 5.13.43 official-image fixture passed numeric-string native draft/GET and isolated unsent zero-tax/discount checks, with no configured webhooks, sent invitations or payments. This establishes compatibility for the fixture configuration. Application policy still denies draft creation unless that deployment has explicit currency/company-hook evidence. No live or sandbox requests or callback registration are part of local protocol fixtures.

The pinned StoreInvoiceRequest validates `number`, not `invoice_number`. The native serializer therefore uses `number` for explicit numbering as a source-grounded compatibility correction to the draft contract; no arbitrary property bag is accepted. The pinned local runtime fixture confirms numeric-string compatibility; arbitrary deployment/company policy remains unverified until explicitly vetted.

Completion evidence: the [combined CI run](https://github.com/formless63/demo-starter-nuxt/actions/runs/36978353705) passed all 19 jobs at `4478e41f2835bfe1495dab762756b2fec08bd98e`, including all 17 generic package lifecycles and the full application check, browser suite, explicit migrations, production container/health and worker checks.
