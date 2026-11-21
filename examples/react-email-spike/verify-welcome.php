<?php

declare(strict_types=1);

require __DIR__ . '/../../tests/php/wp.php';
require __DIR__ . '/../../tests/php/harness.php';

$inputs = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
$wp = wpSite('react-email-welcome', [
    'schema' => require $argv[1] . '/schema.php',
    'functions' => file_get_contents($argv[1] . '/functions.php'),
]);
\TypedPress\Env::isolate(['TP_MAIL_SENDER_DOMAIN' => 'example.test']);

$captured = [];
add_filter('tp_mail_transport', static function ($accepted, array $payload) use (&$captured): bool {
    $captured[] = $payload;
    return true;
}, 10, 2);

foreach ($inputs as $index => $input) {
    [$status, $body] = $wp->handle('POST', '/actions/welcome', json_encode($input, JSON_THROW_ON_ERROR));
    if ($status !== 200) {
        fwrite(STDERR, "welcome action returned $status: " . json_encode($body) . "\n");
        exit(1);
    }
    ActionScheduler_QueueRunner::instance()->run('TypedPress tests');
    $payload = $captured[$index] ?? null;
    if ($payload === null || $payload['to'] !== [['email' => $input['email']]] || $payload['subject'] !== 'Welcome, ' . $input['name']) {
        fwrite(STDERR, "welcome message was not delivered as queued: " . json_encode($payload) . "\n");
        exit(1);
    }
}
echo wp_json_encode(array_map(static fn (array $p): array => ['html' => $p['html'], 'text' => $p['text']], $captured));
