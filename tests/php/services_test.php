<?php

declare(strict_types=1);

/** Real WordPress/SQLite + PHPMailer/SMTP. Stripe protocol checks below are local, not provider qualification. */
use First\Jobs\Runner;
use First\Services\Storage;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';
require dirname(__DIR__, 2) . '/examples/app-services/fixture.php';

$evidence = getenv('FIRST_SERVICES_EVIDENCE') ?: sys_get_temp_dir() . '/first-framework-services-' . bin2hex(random_bytes(4));
mkdir($evidence, 0777, true);
$artifact = servicesArtifact();
try {
    $wp = wpSite('services', ['wpContent' => $artifact['content']]);
} finally {
    servicesRemoveArtifact($artifact['directory']);
}
require_once dirname(__DIR__, 2) . '/examples/app-services/wordpress/first-app-services.php';
file_put_contents($wp->content . '/mu-plugins/app-services.php', '<?php require_once ' . var_export(dirname(__DIR__, 2) . '/examples/app-services/wordpress/first-app-services.php', true) . ';');
$db = $wp->app()->db;
$_SERVER['REMOTE_ADDR'] = '127.0.0.1';
putenv('FIRST_SERVICES_RATE_SECRET=' . bin2hex(random_bytes(32)));
putenv('FIRST_SERVICES_MAIL_FROM=sender@example.test');
putenv('FIRST_SERVICES_MAIL_TO=inbox@example.test');
// Test-only local protocol keys. They are never used for a request to Stripe.
putenv('FIRST_SERVICES_STRIPE_SECRET=local-protocol-test-not-a-provider-credential');
$signingSecret = bin2hex(random_bytes(32));
putenv('FIRST_SERVICES_STRIPE_WEBHOOK_SECRET=' . $signingSecret);

$servicePost = static fn (string $path, array $body, string $key) => $wp->call('POST', '/services/' . $path, $body, headers: ['Idempotency-Key' => $key]);
$submission = ['website' => '', 'data' => ['email' => 'visitor@example.test', 'message' => 'Hello services from actual SMTP bytes.']];
eq('invalid form input produces the schema validation problem', $servicePost('forms/contact', ['data' => ['email' => 'wrong', 'message' => 'Hi']], 'invalid')[1]['code'], 'invalid_input');
eq('honeypot rejects spam', $servicePost('forms/contact', ['website' => 'spam'] + $submission, 'spam')[1]['code'], 'spam');
eq('validation and spam leave no saved submission or queued mail', [(int) $wp->scalar('SELECT COUNT(*) FROM {prefix}first__services_submissions'), (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}first__jobs')], [0, 0]);

$sinkPipes = [];
$sink = proc_open(['python3', dirname(__DIR__, 2) . '/examples/app-services/smtp-sink.py', '--directory', $evidence . '/mail'], [1 => ['pipe', 'w'], 2 => ['file', $evidence . '/smtp.log', 'a']], $sinkPipes);
$ready = json_decode(fgets($sinkPipes[1]), true, 8, JSON_THROW_ON_ERROR);
$nativePipes = [];
$nativeSink = proc_open(['python3', dirname(__DIR__, 2) . '/examples/app-services/smtp-sink.py', '--directory', $evidence . '/native-mail'], [1 => ['pipe', 'w'], 2 => ['file', $evidence . '/native-smtp.log', 'a']], $nativePipes);
$nativeReady = json_decode(fgets($nativePipes[1]), true, 8, JSON_THROW_ON_ERROR);
putenv('FIRST_SERVICES_SMTP_HOST=127.0.0.1');
putenv('FIRST_SERVICES_SMTP_PORT=' . $ready['port']);
putenv('FIRST_SERVICES_SMTP_ENCRYPTION=');
// The generic WP harness blocks mail by default. Remove that seam for real transport proof.
remove_all_filters('pre_wp_mail');
register_shutdown_function(static function () use (&$sink, &$sinkPipes, &$nativeSink, &$nativePipes): void {
    if (isset($GLOBALS['phpmailer'])) $GLOBALS['phpmailer']->smtpClose();
    if (is_resource($nativeSink)) {
        proc_terminate($nativeSink);
        proc_close($nativeSink);
    }
    if (is_resource($sink)) {
        proc_terminate($sink);
        proc_close($sink);
    }
    foreach ([...$sinkPipes, ...$nativePipes] as $pipe) {
        if (is_resource($pipe)) fclose($pipe);
    }
});

[$status, $receipt] = $servicePost('forms/contact', $submission, 'contact-1');
eq('valid form is durably accepted', [$status, $receipt['delivery']], [201, 'queued']);
$id = $receipt['id'];
$row = Storage::run('SELECT * FROM {submissions} WHERE `id` = ?', [$id])[0];
eq('mail waits for its scheduled job, with real persisted values', [glob($evidence . '/mail/*.eml'), json_decode($row['body'], true)], [[], $submission['data']]);
eq('retry returns the same receipt', $servicePost('forms/contact', $submission, 'contact-1')[1], $receipt);
eq('changed data cannot reuse a receipt', $servicePost('forms/contact', ['data' => ['email' => 'visitor@example.test', 'message' => 'changed']], 'contact-1')[1]['code'], 'idempotency_mismatch');

try {
    $db->transaction(static function () use ($wp, $submission): void {
        $wp->app()->dispatch('POST', '/services/forms/contact', [], json_encode($submission), new \First\Viewer(null), ['idempotency-key' => 'rolled-back']);
        throw new RuntimeException('rollback probe');
    });
} catch (RuntimeException $error) {
    eq('rollback probe reached its intended abort', $error->getMessage(), 'rollback probe');
}
eq('rollback removes the submission, job, outbox and replay receipt together', [
    (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}first__services_submissions'),
    (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}first__jobs'),
    (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}first__outbox'),
    (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}first__receipts WHERE `key` = ?', ['rolled-back']),
], [1, 1, 0, 0]);

// Let Action Scheduler invoke the real First runner after commit.
// WordPress reuses this object across messages; establish a pre-existing site mail integration.
$siteMailer = static function ($mailer) use ($nativeReady): void {
    $mailer->isSMTP();
    $mailer->Host = '127.0.0.1';
    $mailer->Port = $nativeReady['port'];
    $mailer->SMTPSecure = '';
    $mailer->SMTPAutoTLS = false;
    $mailer->SMTPAuth = false;
    $mailer->SMTPKeepAlive = true;
    $mailer->Timeout = 9;
};
add_action('phpmailer_init', $siteMailer);
check('the existing site mailer opens its own persistent SMTP connection', wp_mail('prime@example.test', 'Prime native transport', 'Existing site integration', ['From: separate@example.test']));
$nativeSmtp = $GLOBALS['phpmailer']->getSMTPInstance();
ActionScheduler_QueueRunner::instance()->run('First services transport acceptance');
$mailFiles = glob($evidence . '/mail/*.eml');
eq('Action Scheduler delivers one message via the real SMTP socket', count($mailFiles), 1);
$bytes = count($mailFiles) === 1 ? file_get_contents($mailFiles[0]) : '';
check('the SMTP sink received recipient, sender, stable message identity and submitted text',
    str_contains($bytes, 'To: inbox@example.test') && str_contains($bytes, 'sender@example.test')
    && str_contains($bytes, 'first-' . $id . '@example.test') && str_contains($bytes, $submission['data']['message']), $bytes);
$mailer = $GLOBALS['phpmailer'];
eq('service mail restores the existing transport and message identity', [$mailer->MessageID, $mailer->Port, $mailer->Timeout, $mailer->getSMTPInstance() === $nativeSmtp, $nativeSmtp->connected()], ['', $nativeReady['port'], 9, true, true]);
check('an unrelated WordPress message uses its own identity on the native transport', wp_mail('other@example.test', 'Unrelated WordPress notice', 'Independent notice'));
$other = glob($evidence . '/native-mail/*.eml');
$otherBytes = implode("\n", array_map(file_get_contents(...), $other));
check('the next message uses the original transport and its own Message-ID', count($other) === 2 && str_contains($otherBytes, 'Independent notice') && !str_contains($otherBytes, 'first-' . $id . '@example.test'), $otherBytes);
eq('submissions are private', $wp->call('GET', '/services/submissions/' . $id)[0], 401);
$observed = $wp->call('GET', '/services/submissions/' . $id, as: 'editor')[1];
eq('editors can observe saved data and delivery completion', [$observed['body'], $observed['delivery']['state'], $observed['delivery']['attempts']], [$submission['data'], 'done', 1]);

proc_terminate($sink);
proc_close($sink);
$sink = null;
$retryReceipt = $servicePost('forms/contact', $submission, 'contact-retry')[1];
$retryJob = Storage::run('SELECT `jobId` FROM {submissions} WHERE `id` = ?', [$retryReceipt['id']])[0]['jobId'];
eq('a real SMTP connection failure stays observable and retryable', Runner::run($retryJob)['state'], 'failed');
eq('failed service sends also restore the native mailer', [$mailer->MessageID, $mailer->Timeout], ['', 9]);
$sink = proc_open(['python3', dirname(__DIR__, 2) . '/examples/app-services/smtp-sink.py', '--directory', $evidence . '/mail'], [1 => ['pipe', 'w'], 2 => ['file', $evidence . '/smtp.log', 'a']], $sinkPipes);
$ready = json_decode(fgets($sinkPipes[1]), true, 8, JSON_THROW_ON_ERROR);
putenv('FIRST_SERVICES_SMTP_PORT=' . $ready['port']);
eq('retry uses the same job and succeeds through recovered transport', [Runner::run($retryJob)['state'], count(glob($evidence . '/mail/*.eml'))], ['done', 2]);
remove_action('phpmailer_init', $siteMailer);
$nativeSmtp->quit();
$nativeSmtp->close();
proc_terminate($nativeSink);
proc_close($nativeSink);
$nativeSink = null;

for ($n = 0; $n < 3; $n++) $servicePost('forms/contact', $submission, 'limit-' . $n);
eq('a durable shared rate window rejects the sixth accepted intent', $servicePost('forms/contact', $submission, 'over-limit')[0], 429);
eq('idempotent retry remains available after the rate window fills', $servicePost('forms/contact', $submission, 'contact-1')[1], $receipt);

// One query owner proves published/row/field access plus native removal, without a stale index.
$public = $db->insert('posts', ['title' => 'Public workshop', 'excerpt' => 'A real published article', 'internal' => 'classified', 'status' => 'published'], returning: true)[0];
$db->insert('posts', ['title' => 'Draft workshop', 'status' => 'draft']);
$db->insert('posts', ['title' => 'Internal workshop', 'status' => 'published']);
$search = static fn () => $wp->call('GET', '/services/search', query: ['collection' => 'posts', 'q' => 'workshop']);
eq('search returns only published authorized rows and selected public fields', $search()[1]['results'], [['id' => $public['id'], 'title' => 'Public workshop', 'excerpt' => 'A real published article']]);
$privateSearch = static fn (array $config): array => array_replace($config, ['search' => ['posts' => ['internal']]]);
add_filter('first_services_config', $privateSearch, 20);
eq('a hidden search field cannot be used as a membership oracle', $search()[0], 403);
remove_filter('first_services_config', $privateSearch, 20);
wp_update_post(['ID' => $public['id'], 'post_status' => 'draft']);
eq('native WordPress unpublication removes a result immediately', $search()[1]['results'], []);
wp_update_post(['ID' => $public['id'], 'post_status' => 'publish']);
eq('native republishing restores the current result', count($search()[1]['results']), 1);
wp_delete_post($public['id'], true);
eq('native WordPress deletion leaves no stale result', $search()[1]['results'], []);

eq('client-supplied prices are rejected', $servicePost('checkout', ['product' => 'workshop', 'amount' => 1], 'price-attack')[0], 422);
[$status, $checkout] = $servicePost('checkout', ['product' => 'workshop'], 'checkout-1');
eq('checkout records an intent and a job without doing network IO in the transaction', [$status, $checkout['state']], [202, 'requested']);
eq('checkout retries use their existing intent', $servicePost('checkout', ['product' => 'workshop'], 'checkout-1')[1], $checkout);
$token = $checkout['token'];
$order = Storage::run('SELECT * FROM {orders} WHERE `tokenHash` = ?', [hash('sha256', $token)])[0];
eq('server pricing owns the saved order', [(int) $order['amount'], $order['currency']], [1900, 'usd']);
$serialized = \First\Services\Payments::sessionRequest($order);
parse_str($serialized['body'], $requestBody);
eq('the executed HTTP serializer uses frozen pricing, expiry, order correlation and provider idempotency', [
    $serialized['url'], $requestBody['line_items'][0]['price_data'], $requestBody['metadata'],
    $requestBody['expires_at'], $serialized['headers']['Idempotency-Key'],
], ['https://api.stripe.com/v1/checkout/sessions', ['currency' => 'usd', 'unit_amount' => '1900', 'product_data' => ['name' => 'WordPress workshop']],
    ['first_order' => $order['id']], (string) $order['expiresAt'], 'first-checkout-' . $order['id']]);
$event = ['id' => 'evt_local_paid', 'type' => 'checkout.session.completed', 'data' => ['object' => [
    'object' => 'checkout.session', 'id' => 'cs_test_local_session', 'mode' => 'payment',
    'client_reference_id' => $order['id'], 'metadata' => ['first_order' => $order['id']],
    'currency' => 'usd', 'amount_total' => 1900, 'payment_status' => 'paid',
]]];
$webhook = static function (array $event, int $age = 0, ?string $signature = null) use ($wp, $signingSecret): array {
    $raw = json_encode($event);
    $timestamp = time() - $age;
    $signature ??= 't=' . $timestamp . ',v1=' . hash_hmac('sha256', $timestamp . '.' . $raw, $signingSecret);
    return $wp->call('POST', '/services/stripe/webhook', $raw, headers: ['Stripe-Signature' => $signature]);
};
eq('webhook rejects forgery and stale signatures before saving events', [$webhook($event, signature: 't=1,v1=bad')[0], $webhook($event, 301)[0], (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}first__services_events')], [401, 401, 0]);
$mismatch = $event; $mismatch['data']['object']['amount_total'] = 1;
eq('authenticated events still must match server pricing', $webhook($mismatch)[1]['code'], 'payment_mismatch');
eq('a rejected event does not consume its durable event identity', (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}first__services_events'), 0);
eq('valid authenticated paid event settles the order', $webhook($event)[1], ['received' => true, 'duplicate' => false]);
eq('the same event is durably deduplicated', $webhook($event)[1], ['received' => true, 'duplicate' => true]);
$mutated = $event; $mutated['data']['object']['payment_status'] = 'unpaid';
eq('an event id cannot be substituted with other signed content', $webhook($mutated)[1]['code'], 'event_mismatch');
foreach (['checkout.session.expired', 'checkout.session.async_payment_failed', 'checkout.session.completed'] as $n => $type) {
    $late = $event; $late['id'] = 'evt_local_late_' . $n; $late['type'] = $type; $late['data']['object']['payment_status'] = 'unpaid';
    eq('out-of-order event is accepted: ' . $type, $webhook($late)[0], 200);
}
eq('payment success survives late failure, expiry and unpaid completion', $wp->call('GET', '/services/checkout/' . $token)[1]['state'], 'paid');
eq('unguessable status capabilities do not enumerate orders', $wp->call('GET', '/services/checkout/' . str_repeat('0', 64))[0], 404);
$delayed = $servicePost('checkout', ['product' => 'workshop'], 'checkout-delayed')[1];
$delayedOrder = Storage::run('SELECT * FROM {orders} WHERE `tokenHash` = ?', [hash('sha256', $delayed['token'])])[0];
Storage::run('UPDATE {orders} SET `expiresAt` = ? WHERE `id` = ?', [time() + 1799, $delayedOrder['id']]);
eq('a delayed checkout closes its creation window instead of retrying a permanent failure',
    [Runner::run($delayedOrder['jobId'])['state'], $wp->call('GET', '/services/checkout/' . $delayed['token'])[1]['state']], ['done', 'expired']);
$fresh = $servicePost('checkout', ['product' => 'workshop'], 'checkout-after-expiry')[1];
check('an expired creation allows a fresh checkout intent', $fresh['token'] !== $delayed['token'] && $fresh['state'] === 'requested');

// A fresh PHP process loads the same real SQLite site, observes the payment ledger and replays safely.
$raw = json_encode($event);
$timestamp = time();
$signature = 't=' . $timestamp . ',v1=' . hash_hmac('sha256', $timestamp . '.' . $raw, $signingSecret);
$code = 'require ' . var_export(__DIR__ . '/wp.php', true) . '; wpLoad(' . var_export($wp->dir, true) . '); '
    . '$app = \\First\\Wp\\Runtime::plugin()->app(); $r = $app->handle("POST", "/services/stripe/webhook", [], '
    . var_export($raw, true) . ', ["stripe-signature" => ' . var_export($signature, true) . ']); echo $r[2];';
$pipes = [];
$child = proc_open([PHP_BINARY, '-d', 'memory_limit=512M', '-r', $code], [1 => ['pipe', 'w'], 2 => ['file', $evidence . '/restart.log', 'a']], $pipes);
$result = stream_get_contents($pipes[1]); fclose($pipes[1]);
eq('replay survives a fresh WordPress/PHP process', [proc_close($child), json_decode($result, true)['data'] ?? null], [0, ['received' => true, 'duplicate' => true]]);

$wp->startServer();
$page = file_get_contents($wp->url() . '/?app-services=1');
check('the runnable example is served by real WordPress', is_string($page) && str_contains($page, '<form id="contact">') && str_contains($page, '/first/v1/services'));
$http = file_get_contents($wp->url() . '/?rest_route=/first/v1/services/search&collection=posts&q=workshop');
eq('the real HTTP REST transport serves search results', json_decode($http, true)['data']['results'] ?? null, []);
$context = stream_context_create(['http' => ['method' => 'POST', 'header' => "Content-Type: application/json\r\nIdempotency-Key: contact-1\r\n", 'content' => json_encode($submission)]]);
$httpReceipt = file_get_contents($wp->url() . '/wp-json/first/v1/services/forms/contact', false, $context);
eq('real HTTP forwards the idempotency header and replays the form receipt', json_decode($httpReceipt, true)['data'] ?? null, $receipt);
file_put_contents($evidence . '/example.html', $page);
$ownedSite = $wp->dir;
$wp->destroy();
proc_terminate($sink);
proc_close($sink);
$sink = null;
file_put_contents($evidence . '/cleanup.json', json_encode(['site' => $ownedSite, 'siteRemoved' => !is_dir($ownedSite), 'artifact' => $artifact['directory'], 'artifactRemoved' => !is_dir($artifact['directory']), 'smtpStopped' => true, 'smtpMessages' => count(glob($evidence . '/mail/*.eml')), 'stripeProviderQualified' => false], JSON_PRETTY_PRINT));
eq('only the owned disposable sites were removed', [is_dir($ownedSite), is_dir($artifact['directory'])], [false, false]);
echo 'Evidence: ' . $evidence . "\nStripe: local signed-protocol tests only; no Stripe API request or provider qualification.\n";
finish('services');
