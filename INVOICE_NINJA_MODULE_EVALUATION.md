# Invoice Ninja v1 evaluation

Target: v5.13.43 / `382020072bc79e8c7ede49f7e9ce91b0aeb1a051`. Native fetch avoids SDK retries and permits operation-local cancellation through body consumption.

The [native sender](https://github.com/invoiceninja/invoiceninja/blob/v5.13.43/app/Jobs/Util/WebhookSingle.php) uses an unwrapped entity transformed by ArraySerializer and configurable headers. Dedicated secret-header receipts are possession-secret hints; SHA256 is body deduplication, not occurrence identity or a signature.

The [create request](https://github.com/invoiceninja/invoiceninja/blob/v5.13.43/app/Http/Requests/Invoice/StoreInvoiceRequest.php) uses a short atomic lock, not durable idempotency. Once dispatch is marked, an ambiguous create needs operator reconciliation and must never automatically repeat POST.

Native invoice transformer omits currency. Applications must resolve an explicitly vetted current client/company currency mapping; no guessed currency from an invoice hint. Exact numeric lexemes prevent additional starter-side float conversion, but cannot undo rounding already performed by the provider transformer.

Actual pinned-instance numeric-string encoding, unsent draft, zero-tax/discount/company-hooks proof is unverified and blocks compatibility certification. Application policy denies draft creation unless that deployment has explicit evidence. No live or sandbox requests or callback registration are part of local protocol fixtures.
