<?php

declare(strict_types=1);

/** One authoring journey against the built plugins, real WordPress/SQLite and loopback SMTP. */
require dirname(__DIR__, 2) . '/tests/php/wp.php';
require dirname(__DIR__, 2) . '/tests/php/harness.php';

[$script, $content, $evidence] = $argv;
if (!is_dir($evidence)) mkdir($evidence, 0777, true);
$wp = null;
$sink = null;
$pipes = [];
$siteDirectory = null;
$report = [];
try {
    putenv('FIRST_SERVICES_RATE_SECRET=' . bin2hex(random_bytes(32)));
    putenv('APP_SERVICES_RECIPIENT=ts-inbox@example.test');
    putenv('APP_SERVICES_SENDER=ts-sender@example.test');
    putenv('FIRST_SERVICES_STRIPE_SECRET');
    putenv('FIRST_SERVICES_STRIPE_WEBHOOK_SECRET');
    $wp = wpSite('ts-services', ['wpContent' => $content]);
    $siteDirectory = $wp->dir;
    $_SERVER['REMOTE_ADDR'] = '127.0.0.1';

    // A classic plugin can add named entries before the generated filter; authored entries win whole.
    add_filter('first_services_config', static fn (array $config): array => array_replace($config, [
        'forms' => ['classic' => ['fields' => ['message' => ['type' => 'text']], 'recipientEnv' => 'APP_SERVICES_RECIPIENT', 'senderEnv' => 'APP_SERVICES_SENDER']],
        'search' => ['service_posts' => ['title', 'discarded']],
        'products' => ['classic' => ['name' => 'Native product', 'amount' => 500, 'currency' => 'usd'], 'workshop' => ['amount' => 1]],
        'classicOption' => true,
    ]), 5);
    $config = \First\Services\Module::config();
    eq('generated entries preserve classic plugin config and replace named entries atomically', [
        array_keys($config['forms']), array_keys($config['products']), $config['search'], $config['classicOption'],
        $config['products']['workshop'], $config['checkoutReturnUrl'],
        $config['forms']['contact']['recipientEnv'], $config['forms']['contact']['senderEnv'],
    ], [
        ['classic', 'contact'], ['classic', 'workshop'], ['service_posts' => ['title', 'excerpt']], true,
        ['name' => 'WordPress workshop', 'currency' => 'usd', 'amount' => 1900], 'https://example.test/checkout',
        'APP_SERVICES_RECIPIENT', 'APP_SERVICES_SENDER',
    ]);
    $override = static function (array $config): array { $config['forms']['contact']['limit'] = 7; return $config; };
    add_filter('first_services_config', $override, 20);
    eq('a deliberate later native filter can override authored configuration', \First\Services\Module::config()['forms']['contact']['limit'], 7);
    remove_filter('first_services_config', $override, 20);

    // Run the generated PHP schema and the real public schema endpoint, rather than inspecting source.
    $privateSchema = require $wp->content . '/plugins/first-app-services-ts/first/app/schema.php';
    [$schemaStatus, $publicSchema] = $wp->call('GET', '/_schema');
    eq('service configuration stays outside both runtime and public schemas', [
        array_key_exists('services', $privateSchema), $schemaStatus, array_key_exists('services', $publicSchema),
    ], [false, 200, false]);

    $sink = proc_open(['python3', dirname(__DIR__) . '/app-services/smtp-sink.py', '--directory', $evidence . '/mail'],
        [1 => ['pipe', 'w'], 2 => ['file', $evidence . '/smtp.log', 'a']], $pipes);
    if (!is_resource($sink)) throw new RuntimeException('Cannot start local SMTP sink');
    $ready = json_decode(fgets($pipes[1]), true, 8, JSON_THROW_ON_ERROR);
    putenv('FIRST_SERVICES_SMTP_HOST=127.0.0.1');
    putenv('FIRST_SERVICES_SMTP_PORT=' . $ready['port']);
    putenv('FIRST_SERVICES_SMTP_ENCRYPTION=');
    putenv('FIRST_SERVICES_SMTP_USER=');
    putenv('FIRST_SERVICES_SMTP_PASSWORD=');
    remove_all_filters('pre_wp_mail');

    $values = ['email' => 'visitor@example.test', 'message' => 'Hello from TypeScript service configuration.', 'guests' => 2, 'updates' => true];
    [$status, $receipt] = $wp->call('POST', '/services/forms/contact', ['website' => '', 'data' => $values], headers: ['Idempotency-Key' => 'ts-contact']);
    eq('the TypeScript form accepts an intent through the real service route', [$status, $receipt['delivery']], [201, 'queued']);
    $saved = $wp->call('GET', '/services/submissions/' . $receipt['id'], as: 'editor')[1];
    eq('the native service saves the configured field types and queues delivery', [$saved['body'], $saved['delivery']['state'], glob($evidence . '/mail/*.eml')], [$values, 'pending', []]);
    ActionScheduler_QueueRunner::instance()->run('TypeScript services authoring journey');
    $delivered = $wp->call('GET', '/services/submissions/' . $receipt['id'], as: 'editor')[1];
    $messages = glob($evidence . '/mail/*.eml');
    eq('the native queued job reaches the local SMTP transport exactly once', [$delivered['delivery']['state'], $delivered['delivery']['attempts'], count($messages)], ['done', 1, 1]);
    $mime = count($messages) === 1 ? file_get_contents($messages[0]) : '';
    check('the transport uses runtime env addresses and the saved submission',
        str_contains($mime, 'To: ts-inbox@example.test') && str_contains($mime, 'ts-sender@example.test')
        && str_contains($mime, $values['message']) && str_contains($mime, 'zero-' . $receipt['id'] . '@example.test'));

    $db = $wp->app()->db;
    $article = $db->insert('service_posts', ['title' => 'TypeScript workshop', 'excerpt' => 'Configured publication search', 'status' => 'published'], returning: true)[0];
    $db->insert('service_posts', ['title' => 'Draft workshop', 'status' => 'draft']);
    [$searchStatus, $search] = $wp->call('GET', '/services/search', query: ['collection' => 'service_posts', 'q' => 'workshop']);
    eq('the authored collection key binds to its physical name and configured publication fields', [$searchStatus, $search['results']], [200, [
        ['id' => $article['id'], 'title' => 'TypeScript workshop', 'excerpt' => 'Configured publication search'],
    ]]);
    // Product emission is checked above. Leave provider credentials absent and never enqueue a charge.
    [$checkoutStatus, $checkout] = $wp->call('POST', '/services/checkout', ['product' => 'workshop'], headers: ['Idempotency-Key' => 'unconfigured']);
    eq('configured checkout fails closed without deployment credentials', [$checkoutStatus, $checkout['code'], (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}first__services_orders')], [503, 'service_unconfigured', 0]);
    $report = ['submission' => $receipt, 'delivery' => $delivered['delivery'], 'search' => $search, 'checkoutStatus' => $checkoutStatus, 'smtp' => $ready];
} finally {
    if (isset($GLOBALS['phpmailer'])) $GLOBALS['phpmailer']->smtpClose();
    if (is_resource($sink)) { proc_terminate($sink); proc_close($sink); }
    foreach ($pipes as $pipe) if (is_resource($pipe)) fclose($pipe);
    if ($wp !== null) $wp->destroy();
    $report['cleanup'] = ['site' => $siteDirectory, 'siteRemoved' => $siteDirectory !== null && !is_dir($siteDirectory), 'smtpStopped' => !is_resource($sink)];
    $report['assertions'] = ['passed' => $passed, 'failed' => $failed];
    file_put_contents($evidence . '/result.json', json_encode($report, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
}
finish('TypeScript services authoring');
