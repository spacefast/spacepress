<?php

declare(strict_types=1);

require __DIR__ . '/../../tests/php/wp.php';
require __DIR__ . '/../../tests/php/harness.php';

$messages = json_decode(stream_get_contents(STDIN), true, flags: JSON_THROW_ON_ERROR);
$wp = wpSite('react-email-spike', [
    'schema' => require $argv[1] . '/schema.php',
    'functions' => file_get_contents($argv[1] . '/functions.php'),
]);
\SpacePress\Env::isolate(['SP_MAIL_SENDER_DOMAIN' => 'example.test']);

$captured = [];
add_filter('sp_mail_transport', static function ($accepted, array $payload) use (&$captured): bool {
    $captured[] = $payload;
    return true;
}, 10, 2);

foreach ($messages as $index => $message) {
    [$status] = $wp->handle('POST', '/actions/invite', json_encode($message, JSON_THROW_ON_ERROR));
    eq('compiled handler queues invitation', $status, 200);
    eq('delivery waits for the jobs tick', count($captured), $index);
    ActionScheduler_QueueRunner::instance()->run('SpacePress tests');
    eq('jobs tick delivers once', count($captured), $index + 1);
    $payload = $captured[$index] ?? [];
    eq('mail transport receives both original rendered bodies', [
        $payload['to'] ?? null,
        $payload['subject'] ?? null,
        $payload['html'] ?? null,
        $payload['text'] ?? null,
    ], [
        [['email' => 'guest@example.test']],
        'Organization invitation',
        $message['html'],
        $message['plainText'],
    ]);
}

finish('react email transport');
