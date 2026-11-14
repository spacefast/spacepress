<?php

declare(strict_types=1);

/*
 * Webhooks (§6.1, D2) on WordPress, in-process (tests/php/wp.php): committed writes become signed
 * deliveries to a real local receiver (a `php -S`-free socket server), a 500 retries with backoff, and
 * `signature` actions accept a valid `first` / `hmac-sha256` signature and reject stale or forged ones.
 * Delivery goes through wp_safe_remote_post, as on every WordPress site.
 */

use First\Jobs\Runner;
use First\Jobs\Webhooks;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

// The receiver appends each request (headers + raw body) to a log and answers with the status in
// $inbox/status (200 unless told otherwise).
$inbox = sys_get_temp_dir() . '/first-webhooks-inbox-' . bin2hex(random_bytes(4));
@mkdir($inbox);
// This process binds the listening socket and hands it to the receiver as its stdin, so the port is
// never free between choosing and listening (no other process can take it) and there is no readiness
// poll. Other clients can still connect: the receiver records only complete POST requests, answers
// anything else 400, and gives up on a connection that stalls or closes early (5 s read timeout).
file_put_contents("$inbox/serve.php", <<<'PHP'
    <?php
    [, $dir] = $argv;
    $server = STDIN;
    while ($conn = stream_socket_accept($server, -1)) {
        stream_set_timeout($conn, 5);
        $head = '';
        while (!str_contains($head, "\r\n\r\n") && ($chunk = fread($conn, 1)) !== false && $chunk !== '') {
            $head .= $chunk;
        }
        $lines = explode("\r\n", trim($head));
        if (!str_contains($head, "\r\n\r\n") || !preg_match('#^POST \S+ HTTP/1\.[01]$#', $lines[0])) {
            fwrite($conn, "HTTP/1.1 400 X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            fclose($conn);
            continue;
        }
        $headers = [];
        foreach (array_slice($lines, 1) as $line) {
            [$k, $v] = array_map('trim', explode(':', $line, 2));
            $headers[strtolower($k)] = $v;
        }
        $body = '';
        $length = (int) ($headers['content-length'] ?? 0);
        while (strlen($body) < $length && ($chunk = fread($conn, $length - strlen($body))) !== false && $chunk !== '') {
            $body .= $chunk;
        }
        if (strlen($body) < $length) {
            fclose($conn); // closed early or timed out: not a delivery
            continue;
        }
        file_put_contents("$dir/log", json_encode(['headers' => $headers, 'body' => $body]) . "\n", FILE_APPEND);
        // Read the file itself: is_file() would answer from this long-lived process's stat cache
        // after the test deletes it.
        $status = (int) (@file_get_contents("$dir/status") ?: 200);
        fwrite($conn, "HTTP/1.1 $status X\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        fclose($conn);
    }
    PHP);
$listener = stream_socket_server('tcp://127.0.0.1:0');
$port = (int) substr(strrchr(stream_socket_get_name($listener, false), ':'), 1);
$server = proc_open([PHP_BINARY, "$inbox/serve.php", $inbox], [0 => $listener, 2 => ['file', '/dev/null', 'w']], $pipes);
fclose($listener); // the receiver holds the socket now
register_shutdown_function(static function () use ($server, $inbox): void {
    proc_terminate($server);
    exec('rm -rf ' . escapeshellarg($inbox));
});
$received = static fn (): array => is_file("$inbox/log") ? array_map(static fn ($l) => json_decode($l, true), file("$inbox/log", FILE_IGNORE_NEW_LINES)) : [];

// The app's configuration comes from constants on WordPress (wp-config.php); Env::get reads them too.
define('FIRST_HOOK_URL', "http://127.0.0.1:$port/");
define('FIRST_HOOK_SECRET', 'whsec_test');
putenv('FIRST_INBOUND_SECRET=inbound_test');
$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
$schema['webhooks'] = [
    ['url' => ['env' => 'FIRST_HOOK_URL'], 'secret' => ['env' => 'FIRST_HOOK_SECRET'], 'events' => ['comments.created', 'comments.updated']],
];
$signed = static fn (string $scheme, string $header) => ['input' => ['n' => ['type' => 'integer']], 'handler' => 'action__inbound',
    'access' => ['role' => 'editor'], 'agents' => false, 'idempotent' => false,
    'signature' => ['secret' => ['env' => 'FIRST_INBOUND_SECRET'], 'header' => $header, 'scheme' => $scheme]];
$schema['actions']['inboundZero'] = $signed('first', 'first-signature');
$schema['actions']['inboundHmac'] = $signed('hmac-sha256', 'x-hub-signature');
$schema['actions']['inboundIdem'] = ['idempotent' => true] + $signed('first', 'first-signature');
$functions = file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php') . <<<'PHP'

    function action__inbound(\First\JsObject $input, $ctx)
    {
        return ['n' => $input->p['n'] ?? null, 'user' => $ctx->p['user']];
    }

    function route__woo(\First\JsObject $req, $ctx)
    {
        return ['status' => 202, 'body' => 'order ' . json_decode($req->p['body'], true)['id']];
    }
    PHP;

$wp = wpSite('webhooks', ['schema' => $schema, 'functions' => $functions, 'users' => ['ann' => 'admin']]);
$app = $wp->app();
$db = $app->db;
$jobs = static fn () => $wp->sql('SELECT * FROM {prefix}first__jobs ORDER BY `createdAt`, `id`');
$jobRow = static fn (string $id) => $wp->sql('SELECT * FROM {prefix}first__jobs WHERE `id` = ?', [$id])[0] ?? null;
$post = $db->insert('posts', ['title' => 'Hooked'], true)[0];
putenv('FIRST_NOW=2026-02-01T00:00:00.000Z');

// ---- outbound ----------------------------------------------------------------------------------------------------
$comment = $db->transaction(static fn () => $db->insert('comments', ['postId' => $post['id'], 'name' => 'a', 'body' => 'first'], true)[0]);
eq('posts writes are not subscribed; one comments.created job is queued', array_column($jobs(), 'job'), ['first.webhook']);
try {
    $db->transaction(static function () use ($db, $post): void {
        $db->insert('comments', ['postId' => $post['id'], 'name' => 'b', 'body' => 'doomed']);
        throw new \RuntimeException('rollback');
    });
} catch (\RuntimeException) {
}
eq('a rolled-back write sends nothing', count($jobs()), 1);
$job = $jobs()[0];
eq('delivery succeeds against the receiver', Runner::run($job['id'])['state'] ?? null, 'done');
// Deliveries are matched by event id, never by position in the log.
$hit = array_values(array_filter($received(), static fn ($r) => ($r['headers']['first-event-id'] ?? '') === $job['id']))[0] ?? null;
$event = json_decode($hit['body'] ?? 'null', true);
check('the event body is { id, event, collection, at, data: { row } }', $event === ['id' => $job['id'], 'event' => 'comments.created', 'collection' => 'comments',
    'at' => '2026-02-01T00:00:00.000Z', 'data' => ['row' => $comment]], $event);
check('First-Event-Id and First-Event headers', ($hit['headers']['first-event-id'] ?? null) === $job['id'] && ($hit['headers']['first-event'] ?? null) === 'comments.created', $hit['headers'] ?? null);
$t = 1769904000; // 2026-02-01T00:00:00Z
eq('First-Signature is t=<unix>,v1=hmac_sha256(secret, "<t>.<body>")', $hit['headers']['first-signature'] ?? null,
    "t=$t,v1=" . hash_hmac('sha256', "$t.{$hit['body']}", 'whsec_test'));

$db->update('comments', ['body' => 'edited'], ['id' => $comment['id']]);
file_put_contents("$inbox/status", '500');
$update = array_values(array_filter($jobs(), static fn ($j) => json_decode($j['input'], true)['event'] === 'comments.updated'))[0];
$attempt = Runner::run($update['id']);
check('a 500 fails the attempt and backs off with the job schedule', $attempt['state'] === 'failed' && str_contains($attempt['error'], 'answered 500')
    && $jobRow($update['id'])['runAt'] === '2026-02-01T00:01:00.000Z', $attempt);
unlink("$inbox/status");
putenv('FIRST_NOW=2026-02-01T00:01:00.000Z');
eq('the retry delivers', Runner::run($update['id'])['state'] ?? null, 'done');
$retried = array_values(array_filter($received(), static fn ($r) => ($r['headers']['first-event-id'] ?? '') === $update['id']));
$body = json_decode($retried[1]['body'] ?? 'null', true);
check('both attempts carry the same event id; updates include previous', count($retried) === 2 && $body['event'] === 'comments.updated'
    && $body['data']['row']['body'] === 'edited' && $body['data']['previous']['body'] === 'first', $retried);
eq('webhook jobs retry up to 8 times', Webhooks::spec()['retries'], 8);

// ---- inbound ------------------------------------------------------------------------------------------------------
$now = 1769904060; // the pinned clock
$call = static function (string $action, string $raw, array $headers, ?string $as = null) use ($wp): array {
    [$status, , $out] = $wp->handle('POST', "/actions/$action", $raw, $as, $headers);

    return [$status, json_decode($out, true)];
};
$raw = '{"n":7}';
$zeroSig = static fn (int $t, string $secret = 'inbound_test') => "t=$t,v1=" . hash_hmac('sha256', "$t.$raw", $secret);
eq('a valid first signature runs the action as an anonymous caller, with no access check', $call('inboundZero', $raw, ['first-signature' => $zeroSig($now)]),
    [200, ['data' => ['n' => 7, 'user' => null]]]);
eq('a rotated secret may list several v1 values', $call('inboundZero', $raw, ['first-signature' => $zeroSig($now, 'old') . ',v1=' . hash_hmac('sha256', "$now.$raw", 'inbound_test')])[0], 200);
eq('a t older than 5 minutes is rejected', $call('inboundZero', $raw, ['first-signature' => $zeroSig($now - 301)])[1]['code'] ?? null, 'invalid_signature');
eq('a bad HMAC is rejected', $call('inboundZero', $raw, ['first-signature' => $zeroSig($now, 'wrong')]), [401, $call('inboundZero', $raw, [])[1]]);
eq('a missing header is 401 invalid_signature', $call('inboundZero', $raw, [])[1]['code'] ?? null, 'invalid_signature');
eq('a signature over different bytes is rejected', $call('inboundZero', '{"n": 7}', ['first-signature' => $zeroSig($now)])[0], 401);
eq('hmac-sha256 compares hex(hmac(secret, raw body))', $call('inboundHmac', $raw, ['x-hub-signature' => hash_hmac('sha256', $raw, 'inbound_test')])[0], 200);
eq('hmac-sha256 rejects a forged digest', $call('inboundHmac', $raw, ['x-hub-signature' => hash_hmac('sha256', $raw, 'nope')])[1]['code'] ?? null, 'invalid_signature');
// WooCommerce signs base64(hmac_sha256(raw body, secret)) in X-WC-Webhook-Signature
// (woocommerce/includes/class-wc-webhook.php generate_signature()); Shopify does the same.
// The expected value was computed outside PHP:
//   printf %s "$body" | openssl dgst -sha256 -hmac inbound_test -binary | base64
$woo = '{"id":727,"parent_id":0,"status":"processing","currency":"USD","total":"29.35","billing":{"first_name":"John","last_name":"Doe"},'
    . '"line_items":[{"id":315,"name":"Woo Single #1","product_id":93,"quantity":2,"total":"6.00"}]}';
$wooSig = 'vL/fGCs5FfTAzsn71/GOxwMLlPtJdIRFOjTTJQT01nY=';
eq('the fixture signature is what WooCommerce\'s generate_signature() produces', base64_encode(hash_hmac('sha256', $woo, 'inbound_test', true)), $wooSig);
// A store delivers to a route handler (first/app/webhooks/woo/route.ts) that exports this signature.
$route = ['name' => 'webhooks/woo', 'params' => [], 'route' => ['handler' => 'route__woo', 'access' => ['allow' => false],
    'signature' => ['secret' => ['env' => 'FIRST_INBOUND_SECRET'], 'header' => 'x-wc-webhook-signature', 'scheme' => 'hmac-sha256']]];
$hook = static function (string $body, string $signature) use ($wp, $route): array {
    [$status, , $out] = $wp->app()->serveRoute($route, 'POST', '/webhooks/woo', '', $body,
        ['X-WC-Webhook-Topic' => 'order.created', 'X-WC-Webhook-Signature' => $signature], null, 'https://example.test/webhooks/woo');

    return [$status, $status === 401 ? (json_decode($out, true)['code'] ?? $out) : $out];
};
eq('hmac-sha256 accepts a WooCommerce base64 signature of the raw body', $hook($woo, $wooSig), [202, 'order 727']);
eq('base64 without its padding is the same digest', $hook($woo, rtrim($wooSig, '='))[0], 202);
eq('hex is still accepted, in either case and with a sha256= prefix (GitHub)',
    [$call('inboundHmac', $raw, ['x-hub-signature' => strtoupper(hash_hmac('sha256', $raw, 'inbound_test'))])[0],
        $call('inboundHmac', $raw, ['x-hub-signature' => 'sha256=' . hash_hmac('sha256', $raw, 'inbound_test')])[0]], [200, 200]);
eq('a base64 signature over other bytes is rejected', $hook($woo . ' ', $wooSig), [401, 'invalid_signature']);
eq('a base64 signature with another secret is rejected',
    $hook($woo, base64_encode(hash_hmac('sha256', $woo, 'nope', true))), [401, 'invalid_signature']);
eq('a truncated, url-safe, SHA-1 or base64-of-hex signature is rejected', [
    $hook($woo, substr($wooSig, 0, 40))[0],
    $hook($woo, strtr($wooSig, '+/', '-_'))[0],
    $hook($woo, base64_encode(hash_hmac('sha1', $woo, 'inbound_test', true)))[0],
    $hook($woo, base64_encode(hash_hmac('sha256', $woo, 'inbound_test')))[0],
], [401, 401, 401, 401]);
$keyed = ['first-signature' => $zeroSig($now), 'idempotency-key' => 'evt-1'];
[$s1, $anon] = $call('inboundIdem', $raw, $keyed);
[$s2, $asAdmin] = $call('inboundIdem', $raw, $keyed, 'ann');
eq('a signed caller is anonymous everywhere: credentials change neither ctx.user nor the idempotency receipt',
    [$s1, $s2, $anon, $asAdmin, (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}first__receipts WHERE CAST(`key` AS CHAR) = 'evt-1'")],
    [200, 200, ['data' => ['n' => 7, 'user' => null]], ['data' => ['n' => 7, 'user' => null]], 1]);
putenv('FIRST_INBOUND_SECRET');
eq('an unset secret rejects every request', $call('inboundHmac', $raw, ['x-hub-signature' => hash_hmac('sha256', $raw, '')])[0], 401);

finish('webhooks');
