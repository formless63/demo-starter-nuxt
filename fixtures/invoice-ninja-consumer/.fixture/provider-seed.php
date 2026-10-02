<?php
// Disposable, network-isolated Invoice Ninja fixture only. Never run on a deployment.
define('LARAVEL_START', microtime(true));
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

if (getenv('APP_ENV') !== 'testing' || getenv('GS_DISPOSABLE_PROVIDER') !== '1') {
    throw new RuntimeException('Disposable fixture marker required');
}

$account = App\Models\Account::factory()->create(['report_errors' => false]);
$settings = App\DataMapper\CompanySettings::defaults();
$settings->name = 'Golden Starters disposable compatibility fixture';
$settings->currency_id = '1';
$settings->language_id = '1';
$settings->auto_bill = 'off';
$settings->auto_bill_standard_invoices = false;
$settings->auto_email_invoice = false;
$settings->send_email_on_mark_paid = false;
$settings->tax_rate1 = $settings->tax_rate2 = $settings->tax_rate3 = 0;
$company = App\Models\Company::factory()->create([
    'account_id' => $account->id, 'settings' => $settings,
    'track_inventory' => false, 'portal_domain' => 'http://127.0.0.1', 'portal_mode' => 'domain',
]);
$company->client_registration_fields = App\DataMapper\ClientRegistrationFields::generate();
$company->save();
$account->default_company_id = $company->id;
$account->save();
$user = App\Models\User::factory()->create([
    'account_id' => $account->id, 'email' => 'fixture@example.test',
    'first_name' => 'Disposable', 'last_name' => 'Fixture', 'phone' => '',
    'email_verified_at' => now(),
]);
$membership = App\Factory\CompanyUserFactory::create($user->id, $company->id, $account->id);
$membership->is_owner = true;
$membership->is_admin = true;
$membership->is_locked = false;
$membership->save();
$token = new App\Models\CompanyToken();
$token->user_id = $user->id;
$token->company_id = $company->id;
$token->account_id = $account->id;
$token->name = 'Disposable fixture token';
$token->token = getenv('GS_FIXTURE_TOKEN');
$token->is_system = true;
$token->save();
$clientSettings = App\DataMapper\ClientSettings::defaults();
$clientSettings->currency_id = '1';
$client = App\Models\Client::factory()->create([
    'user_id' => $user->id, 'company_id' => $company->id,
    'name' => 'Disposable fixture client', 'settings' => $clientSettings,
    'group_settings_id' => null,
]);
App\Models\ClientContact::factory()->create([
    'user_id' => $user->id, 'company_id' => $company->id, 'client_id' => $client->id,
    'email' => 'client@example.test', 'is_primary' => true, 'send_email' => false,
]);
// No create-account command: it performs an external version check. No gateways,
// subscriptions, callback registration, scheduler, queue worker or mail transport.
echo json_encode(['clientId' => $client->hashed_id, 'companyId' => $company->id]);
