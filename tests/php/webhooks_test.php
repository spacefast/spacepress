<?php

declare(strict_types=1);

/*
 * Webhooks (§6.1, D2) on WordPress, in-process (tests/php/wp.php): committed writes become signed
 * deliveries to a real local receiver (a `php -S`-free socket server), a 500 retries with backoff, and
 * `signature` actions accept a valid `spacepress` / `hmac-sha256` signature and reject stale or forged ones.
 * Delivery goes through wp_safe_remote_post, as on every WordPress site.
 */

use SpacePress\Jobs\Runner;
use SpacePress\Jobs\Webhooks;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

// The receiver appends each request (headers + raw body) to a log and answers with the status in
// $inbox/status (200 unless told otherwise).
$inbox = sys_get_temp_dir() . '/spacepress-webhooks-inbox-' . bin2hex( random_bytes( 4 ) );
@mkdir( $inbox );
// This process binds the listening socket and hands it to the receiver as its stdin, so the port is
// never free between choosing and listening (no other process can take it) and there is no readiness
// poll. Other clients can still connect: the receiver records only complete POST requests, answers
// anything else 400, and gives up on a connection that stalls or closes early (5 s read timeout).
file_put_contents(
	"$inbox/serve.php",
	<<<'PHP'
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
PHP
);
$listener = stream_socket_server( 'tcp://127.0.0.1:0' );
$port     = (int) substr( strrchr( stream_socket_get_name( $listener, false ), ':' ), 1 );
$server   = proc_open(
	array( PHP_BINARY, "$inbox/serve.php", $inbox ),
	array(
		0 => $listener,
		2 => array( 'file', '/dev/null', 'w' ),
	),
	$pipes
);
fclose( $listener ); // the receiver holds the socket now
register_shutdown_function(
	static function () use ( $server, $inbox ): void {
		proc_terminate( $server );
		exec( 'rm -rf ' . escapeshellarg( $inbox ) );
	}
);
$received = static fn (): array => is_file( "$inbox/log" ) ? array_map( static fn ( $l ) => json_decode( $l, true ), file( "$inbox/log", FILE_IGNORE_NEW_LINES ) ) : array();

// The app's configuration comes from constants on WordPress (wp-config.php); Env::get reads them too.
define( 'SP_HOOK_URL', "http://127.0.0.1:$port/" );
define( 'SP_HOOK_SECRET', 'whsec_test' );
putenv( 'SP_INBOUND_SECRET=inbound_test' );
$schema             = require dirname( __DIR__ ) . '/fixtures/blog/schema.php';
$schema['webhooks'] = array(
	array(
		'url'    => array( 'env' => 'SP_HOOK_URL' ),
		'secret' => array( 'env' => 'SP_HOOK_SECRET' ),
		'events' => array( 'comments.created', 'comments.updated', 'pings.created' ),
	),
);
// A synced collection the seed writes, whose afterCreate hook sends mail.
$schema['collections']['pings']   = array(
	'primaryKey' => 'id',
	'editor'     => false,
	'uid'        => true,
	'sync'       => array(
		'dir'    => 'content/pings',
		'format' => 'json',
	),
	'access'     => array(
		'read'   => array( 'role' => 'anyone' ),
		'create' => array( 'role' => 'editor' ),
		'update' => array( 'role' => 'editor' ),
		'delete' => array( 'role' => 'editor' ),
	),
	'api'        => array(
		'list'   => true,
		'get'    => true,
		'create' => true,
		'update' => true,
		'delete' => true,
	),
	'relations'  => array(),
	'hooks'      => array( 'afterCreate' => 'pings__afterCreate' ),
	'columns'    => array(
		'id'   => array(
			'type'          => 'integer',
			'primaryKey'    => true,
			'autoIncrement' => true,
			'notNull'       => true,
		),
		'name' => array(
			'type'    => 'text',
			'notNull' => true,
		),
		'uid'  => array(
			'type'   => 'text',
			'unique' => true,
			'system' => true,
			'rules'  => array(
				'pattern' => array(
					'source' => '^zr_[0-9a-f]{20}$',
					'flags'  => '',
				),
			),
		),
	),
);
$signed                           = static fn ( string $scheme, string $header ) => array(
	'input'      => array( 'n' => array( 'type' => 'integer' ) ),
	'handler'    => 'action__inbound',
	'access'     => array( 'role' => 'editor' ),
	'agents'     => false,
	'idempotent' => false,
	'signature'  => array(
		'secret' => array( 'env' => 'SP_INBOUND_SECRET' ),
		'header' => $header,
		'scheme' => $scheme,
	),
);
$schema['actions']['inboundZero'] = $signed( 'spacepress', 'spacepress-signature' );
$schema['actions']['inboundHmac'] = $signed( 'hmac-sha256', 'x-hub-signature' );
$schema['actions']['inboundIdem'] = array( 'idempotent' => true ) + $signed( 'spacepress', 'spacepress-signature' );
$functions                        = file_get_contents( dirname( __DIR__ ) . '/fixtures/blog/functions.php' ) . <<<'PHP'

function action__inbound(\SpacePress\JsObject $input, $ctx)
{
    return ['n' => $input->p['n'] ?? null, 'user' => $ctx->p['user']];
}

function pings__afterCreate($row)
{
    \SpacePress\Mail::send(new \SpacePress\JsObject(['from' => 'app@example.test', 'to' => 'owner@example.test', 'subject' => 'New ping', 'text' => $row->p['name'] ?? '']));
}

function route__woo(\SpacePress\JsObject $req, $ctx)
{
    return ['status' => 202, 'body' => 'order ' . json_decode($req->p['body'], true)['id']];
}
PHP;

$wp      = wpSite(
	'webhooks',
	array(
		'schema'    => $schema,
		'functions' => $functions,
		'users'     => array( 'ann' => 'admin' ),
	)
);
$app     = $wp->app();
$db      = $app->db;
$jobs    = static fn () => $wp->sql( 'SELECT * FROM {prefix}sp__jobs ORDER BY `createdAt`, `id`' );
$job_row = static fn ( string $id ) => $wp->sql( 'SELECT * FROM {prefix}sp__jobs WHERE `id` = ?', array( $id ) )[0] ?? null;
$post    = $db->insert( 'posts', array( 'title' => 'Hooked' ), true )[0];
putenv( 'SP_NOW=2026-02-01T00:00:00.000Z' );

// ---- outbound ----------------------------------------------------------------------------------------------------
$comment = $db->transaction(
	static fn () => $db->insert(
		'comments',
		array(
			'postId' => $post['id'],
			'name'   => 'a',
			'body'   => 'first',
		),
		true
	)[0]
);
eq( 'posts writes are not subscribed; one comments.created job is queued', array_column( $jobs(), 'job' ), array( 'spacepress.webhook' ) );
try {
	$db->transaction(
		static function () use ( $db, $post ): void {
			$db->insert(
				'comments',
				array(
					'postId' => $post['id'],
					'name'   => 'b',
					'body'   => 'doomed',
				)
			);
			throw new \RuntimeException( 'rollback' );
		}
	);
} catch ( \RuntimeException ) {
}
eq( 'a rolled-back write sends nothing', count( $jobs() ), 1 );
$job = $jobs()[0];
eq( 'delivery succeeds against the receiver', Runner::run( $job['id'] )['state'] ?? null, 'done' );
// Deliveries are matched by event id, never by position in the log.
$hit   = array_values( array_filter( $received(), static fn ( $r ) => ( $r['headers']['spacepress-event-id'] ?? '' ) === $job['id'] ) )[0] ?? null;
$event = json_decode( $hit['body'] ?? 'null', true );
check(
	'the event body is { id, event, collection, at, data: { row } }',
	$event === array(
		'id'         => $job['id'],
		'event'      => 'comments.created',
		'collection' => 'comments',
		'at'         => '2026-02-01T00:00:00.000Z',
		'data'       => array( 'row' => $comment ),
	),
	$event
);
check( 'SpacePress-Event-Id and SpacePress-Event headers', ( $hit['headers']['spacepress-event-id'] ?? null ) === $job['id'] && ( $hit['headers']['spacepress-event'] ?? null ) === 'comments.created', $hit['headers'] ?? null );
$t = 1769904000; // 2026-02-01T00:00:00Z
eq(
	'SpacePress-Signature is t=<unix>,v1=hmac_sha256(secret, "<t>.<body>")',
	$hit['headers']['spacepress-signature'] ?? null,
	"t=$t,v1=" . hash_hmac( 'sha256', "$t.{$hit['body']}", 'whsec_test' )
);

$db->update( 'comments', array( 'body' => 'edited' ), array( 'id' => $comment['id'] ) );
file_put_contents( "$inbox/status", '500' );
$update  = array_values( array_filter( $jobs(), static fn ( $j ) => 'comments.updated' === json_decode( $j['input'], true )['event'] ) )[0];
$attempt = Runner::run( $update['id'] );
check(
	'a 500 fails the attempt and backs off with the job schedule',
	'failed' === $attempt['state'] && str_contains( $attempt['error'], 'answered 500' )
	&& '2026-02-01T00:01:00.000Z' === $job_row( $update['id'] )['runAt'],
	$attempt
);
unlink( "$inbox/status" );
putenv( 'SP_NOW=2026-02-01T00:01:00.000Z' );
eq( 'the retry delivers', Runner::run( $update['id'] )['state'] ?? null, 'done' );
$retried = array_values( array_filter( $received(), static fn ( $r ) => ( $r['headers']['spacepress-event-id'] ?? '' ) === $update['id'] ) );
$body    = json_decode( $retried[1]['body'] ?? 'null', true );
check(
	'both attempts carry the same event id; updates include previous',
	count( $retried ) === 2 && 'comments.updated' === $body['event']
	&& 'edited' === $body['data']['row']['body'] && 'first' === $body['data']['previous']['body'],
	$retried
);
eq( 'webhook jobs retry up to 8 times', Webhooks::spec()['retries'], 8 );

// ---- the seed on a preview binding (Loader::load's `preview`) ----------------------------------------------------
$seed_dir = sys_get_temp_dir() . '/sp-webhooks-seed-' . bin2hex( random_bytes( 4 ) );
mkdir( $seed_dir );
$seed_pings = static function ( string $name ) use ( $seed_dir, $wp ): array {
	file_put_contents(
		"$seed_dir/pings.json",
		wp_json_encode(
			array(
				'collection' => 'pings',
				'format'     => 'json',
				'records'    => array(
					array(
						'uid'    => \SpacePress\Sync\Uid::mint(),
						'fields' => array( 'name' => $name ),
					),
				),
			)
		)
	);

	return \SpacePress\Sync\Seed::run( $wp->plugin(), $seed_dir );
};
$queued     = static function () use ( $jobs ): array {
	$count = array(
		'spacepress.webhook' => 0,
		'spacepress.mail'    => 0,
	);
	foreach ( $jobs() as $j ) {
		if ( isset( $count[ $j['job'] ] ) ) {
			++$count[ $j['job'] ];
		}
	}

	return $count;
};
$before     = $queued();
eq(
	'off by default: a seed write queues its webhook and its hook\'s mail, as on production',
	array( $seed_pings( 'production' )['pings']['created'], array_map( static fn ( $n, $b ) => $n - $b, $queued(), $before ) ),
	array( 1, array( 1, 1 ) )
);
\SpacePress\Preview::bind( true );
$before = $queued();
eq(
	'on a preview, a seed write is stored and queues no webhook and no mail',
	array( $seed_pings( 'preview' )['pings']['created'], $queued(), $db->findFirst( 'pings', array( 'where' => array( 'name' => 'preview' ) ) )['name'] ?? null ),
	array( 1, $before, 'preview' )
);
problem(
	'a message the seed\'s hook sends on a preview is still checked',
	static fn () => \SpacePress\Preview::seeding(
		static fn () => \SpacePress\Mail::send(
			new \SpacePress\JsObject(
				array(
					'from'    => 'app@example.test',
					'to'      => 'owner@example.test',
					'subject' => '',
				)
			)
		)
	),
	422,
	'invalid_input',
	'/subject'
);
$db->insert( 'pings', array( 'name' => 'after the seed' ) );
eq( 'after the seed a preview write queues its webhook and mail again', array_map( static fn ( $n, $b ) => $n - $b, $queued(), $before ), array( 1, 1 ) );
\SpacePress\Preview::bind( false );
unlink( "$seed_dir/pings.json" );
rmdir( $seed_dir );

// ---- inbound ------------------------------------------------------------------------------------------------------
$now      = 1769904060; // the pinned clock
$call     = static function ( string $action, string $raw, array $headers, ?string $as = null ) use ( $wp ): array {
	[$status, , $out] = $wp->handle( 'POST', "/actions/$action", $raw, $as, $headers );

	return array( $status, json_decode( $out, true ) );
};
$raw      = '{"n":7}';
$zero_sig = static fn ( int $t, string $secret = 'inbound_test' ) => "t=$t,v1=" . hash_hmac( 'sha256', "$t.$raw", $secret );
eq(
	'a valid first signature runs the action as an anonymous caller, with no access check',
	$call( 'inboundZero', $raw, array( 'spacepress-signature' => $zero_sig( $now ) ) ),
	array(
		200,
		array(
			'data' => array(
				'n'    => 7,
				'user' => null,
			),
		),
	)
);
eq( 'a rotated secret may list several v1 values', $call( 'inboundZero', $raw, array( 'spacepress-signature' => $zero_sig( $now, 'old' ) . ',v1=' . hash_hmac( 'sha256', "$now.$raw", 'inbound_test' ) ) )[0], 200 );
eq( 'a t older than 5 minutes is rejected', $call( 'inboundZero', $raw, array( 'spacepress-signature' => $zero_sig( $now - 301 ) ) )[1]['code'] ?? null, 'invalid_signature' );
eq( 'a bad HMAC is rejected', $call( 'inboundZero', $raw, array( 'spacepress-signature' => $zero_sig( $now, 'wrong' ) ) ), array( 401, $call( 'inboundZero', $raw, array() )[1] ) );
eq( 'a missing header is 401 invalid_signature', $call( 'inboundZero', $raw, array() )[1]['code'] ?? null, 'invalid_signature' );
eq( 'a signature over different bytes is rejected', $call( 'inboundZero', '{"n": 7}', array( 'spacepress-signature' => $zero_sig( $now ) ) )[0], 401 );
eq( 'hmac-sha256 compares hex(hmac(secret, raw body))', $call( 'inboundHmac', $raw, array( 'x-hub-signature' => hash_hmac( 'sha256', $raw, 'inbound_test' ) ) )[0], 200 );
eq( 'hmac-sha256 rejects a forged digest', $call( 'inboundHmac', $raw, array( 'x-hub-signature' => hash_hmac( 'sha256', $raw, 'nope' ) ) )[1]['code'] ?? null, 'invalid_signature' );
// WooCommerce signs base64(hmac_sha256(raw body, secret)) in X-WC-Webhook-Signature
// (woocommerce/includes/class-wc-webhook.php generate_signature()); Shopify does the same.
// The expected value was computed outside PHP:
//   printf %s "$body" | openssl dgst -sha256 -hmac inbound_test -binary | base64
$woo     = '{"id":727,"parent_id":0,"status":"processing","currency":"USD","total":"29.35","billing":{"first_name":"John","last_name":"Doe"},'
	. '"line_items":[{"id":315,"name":"Woo Single #1","product_id":93,"quantity":2,"total":"6.00"}]}';
$woo_sig = 'vL/fGCs5FfTAzsn71/GOxwMLlPtJdIRFOjTTJQT01nY=';
eq( 'the fixture signature is what WooCommerce\'s generate_signature() produces', base64_encode( hash_hmac( 'sha256', $woo, 'inbound_test', true ) ), $woo_sig );
// A store delivers to a route handler (sp/app/webhooks/woo/route.ts) that exports this signature.
$route = array(
	'name'   => 'webhooks/woo',
	'params' => array(),
	'route'  => array(
		'handler'   => 'route__woo',
		'access'    => array( 'allow' => false ),
		'signature' => array(
			'secret' => array( 'env' => 'SP_INBOUND_SECRET' ),
			'header' => 'x-wc-webhook-signature',
			'scheme' => 'hmac-sha256',
		),
	),
);
$hook  = static function ( string $body, string $signature ) use ( $wp, $route ): array {
	[$status, , $out] = $wp->app()->serveRoute(
		$route,
		'POST',
		'/webhooks/woo',
		'',
		$body,
		array(
			'X-WC-Webhook-Topic'     => 'order.created',
			'X-WC-Webhook-Signature' => $signature,
		),
		null,
		'https://example.test/webhooks/woo'
	);

	return array( $status, 401 === $status ? ( json_decode( $out, true )['code'] ?? $out ) : $out );
};
eq( 'hmac-sha256 accepts a WooCommerce base64 signature of the raw body', $hook( $woo, $woo_sig ), array( 202, 'order 727' ) );
eq( 'base64 without its padding is the same digest', $hook( $woo, rtrim( $woo_sig, '=' ) )[0], 202 );
eq(
	'hex is still accepted, in either case and with a sha256= prefix (GitHub)',
	array(
		$call( 'inboundHmac', $raw, array( 'x-hub-signature' => strtoupper( hash_hmac( 'sha256', $raw, 'inbound_test' ) ) ) )[0],
		$call( 'inboundHmac', $raw, array( 'x-hub-signature' => 'sha256=' . hash_hmac( 'sha256', $raw, 'inbound_test' ) ) )[0],
	),
	array( 200, 200 )
);
eq( 'a base64 signature over other bytes is rejected', $hook( $woo . ' ', $woo_sig ), array( 401, 'invalid_signature' ) );
eq(
	'a base64 signature with another secret is rejected',
	$hook( $woo, base64_encode( hash_hmac( 'sha256', $woo, 'nope', true ) ) ),
	array( 401, 'invalid_signature' )
);
eq(
	'a truncated, url-safe, SHA-1 or base64-of-hex signature is rejected',
	array(
		$hook( $woo, substr( $woo_sig, 0, 40 ) )[0],
		$hook( $woo, strtr( $woo_sig, '+/', '-_' ) )[0],
		$hook( $woo, base64_encode( hash_hmac( 'sha1', $woo, 'inbound_test', true ) ) )[0],
		$hook( $woo, base64_encode( hash_hmac( 'sha256', $woo, 'inbound_test' ) ) )[0],
	),
	array( 401, 401, 401, 401 )
);
$keyed           = array(
	'spacepress-signature' => $zero_sig( $now ),
	'idempotency-key'      => 'evt-1',
);
[$s1, $anon]     = $call( 'inboundIdem', $raw, $keyed );
[$s2, $as_admin] = $call( 'inboundIdem', $raw, $keyed, 'ann' );
eq(
	'a signed caller is anonymous everywhere: credentials change neither ctx.user nor the idempotency receipt',
	array( $s1, $s2, $anon, $as_admin, (int) $wp->scalar( "SELECT COUNT(*) FROM {prefix}sp__receipts WHERE CAST(`key` AS CHAR) = 'evt-1'" ) ),
	array(
		200,
		200,
		array(
			'data' => array(
				'n'    => 7,
				'user' => null,
			),
		),
		array(
			'data' => array(
				'n'    => 7,
				'user' => null,
			),
		),
		1,
	)
);
putenv( 'SP_INBOUND_SECRET' );
eq( 'an unset secret rejects every request', $call( 'inboundHmac', $raw, array( 'x-hub-signature' => hash_hmac( 'sha256', $raw, '' ) ) )[0], 401 );

finish( 'webhooks' );
