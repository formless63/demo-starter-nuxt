<?php
define('LARAVEL_START', microtime(true));
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (getenv('APP_ENV') !== 'testing' || getenv('GS_DISPOSABLE_PROVIDER') !== '1') {
    throw new RuntimeException('Disposable fixture marker required');
}
$invoices = App\Models\Invoice::all();
if ($invoices->count() !== 1) throw new RuntimeException('Expected exactly one native draft');
$invoice = $invoices->first();
if ((int) $invoice->status_id !== App\Models\Invoice::STATUS_DRAFT
    || $invoice->last_sent_date || $invoice->auto_bill_enabled
    || $invoice->amount != 25 || $invoice->balance != 0
    || $invoice->discount != 0 || $invoice->total_taxes != 0
    || $invoice->tax_rate1 != 0 || $invoice->tax_rate2 != 0 || $invoice->tax_rate3 != 0) {
    throw new RuntimeException('Native draft policy mismatch');
}
if (App\Models\InvoiceInvitation::whereNotNull('sent_date')->exists()
    || App\Models\Payment::exists() || App\Models\CompanyGateway::exists()
    || Illuminate\Support\Facades\DB::table('webhooks')->exists()) {
    throw new RuntimeException('Unexpected send, payment, gateway or subscription state');
}
echo json_encode(['unsent' => true, 'numericStringsAccepted' => true, 'invoices' => 1, 'payments' => 0]);
