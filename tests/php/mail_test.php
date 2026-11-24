<?php

declare(strict_types=1);

/*
 * mail.send from "spacepress" on an in-process WordPress (tests/php/wp.php): message
 * normalization, header and address safety, the transactional queue, wp_mail hand-off arguments,
 * the host transport filter and retries. Delivery is drained through Action Scheduler.
 */

use SpacePress\HttpError;
use SpacePress\JsObject;
use SpacePress\Mail;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema                      = require dirname( __DIR__ ) . '/fixtures/blog/schema.php';
$schema['actions']['notify'] = array(
	'input'      => array(
		'to'   => array(
			'type'    => 'text',
			'notNull' => true,
		),
		'fail' => array( 'type' => 'boolean' ),
	),
	'handler'    => 'action__notify',
	'access'     => array( 'role' => 'anyone' ),
	'agents'     => false,
	'idempotent' => false,
	'signature'  => null,
);
$functions                   = file_get_contents( dirname( __DIR__ ) . '/fixtures/blog/functions.php' ) . <<<'PHP'

function action__notify(\SpacePress\JsObject $input, $ctx)
{
    $queued = \SpacePress\Mail::send(new \SpacePress\JsObject(['to' => $input->p['to'], 'subject' => 'Hello', 'text' => 'plain', 'html' => '<p>rich</p>']));
    if (($input->p['fail'] ?? false) === true) {
        throw new \SpacePress\HttpError(409, 'rolled_back', 'after queueing');
    }
    return $queued->p['id'];
}
PHP;

$wp = wpSite(
	'mail',
	array(
		'schema'    => $schema,
		'functions' => $functions,
	)
);
// The in-process site answers on a dotless host, which is no sending domain; name one.
\SpacePress\Env::isolate( array( 'SP_MAIL_SENDER_DOMAIN' => 'Example.Test' ) );
$jobs    = static fn () => $wp->sql( "SELECT `id`, `state`, `attempts`, `lastError` FROM {prefix}sp__jobs WHERE `job` = 'spacepress.mail' ORDER BY `createdAt`, `id`" );
$drain   = static fn () => ActionScheduler_QueueRunner::instance()->run( 'SpacePress tests' );
$refusal = static function ( mixed $message ): string {
	try {
		Mail::payload( $message );
		return 'ok';
	} catch ( HttpError $e ) {
		return $e->pointer . ' ' . $e->getMessage();
	}
};

// ---- normalization, field for field
eq(
	'addresses coerce to { email, name? } lists and trim; text and html both travel',
	Mail::payload(
		array(
			'from'    => ' app@example.test ',
			'to'      => 'a@example.test',
			'subject' => 'S',
			'text'    => 't',
			'html'    => '<b>h</b>',
			'cc'      => array(
				array(
					'email' => 'c@example.test',
					'name'  => 'Cé',
				),
			),
			'replyTo' => 'r@example.test',
		)
	),
	array(
		'from'    => array( 'email' => 'app@example.test' ),
		'to'      => array( array( 'email' => 'a@example.test' ) ),
		'subject' => 'S',
		'text'    => 't',
		'html'    => '<b>h</b>',
		'cc'      => array(
			array(
				'email' => 'c@example.test',
				'name'  => 'Cé',
			),
		),
		'replyTo' => array( 'email' => 'r@example.test' ),
	)
);
eq(
	'a field holding undefined is a field left out, in the message and in an address',
	Mail::payload(
		\SpacePress\Seam::toPhp(
			new JsObject(
				array(
					'from'    => 'app@example.test',
					'to'      => new JsObject(
						array(
							'email' => 'a@example.test',
							'name'  => \SpacePress\JsUndefined::Value,
						)
					),
					'subject' => 'S',
					'text'    => 't',
					'replyTo' => \SpacePress\JsUndefined::Value,
					'cc'      => \SpacePress\JsUndefined::Value,
					'headers' => \SpacePress\JsUndefined::Value,
				)
			)
		)
	),
	array(
		'from'    => array( 'email' => 'app@example.test' ),
		'to'      => array( array( 'email' => 'a@example.test' ) ),
		'subject' => 'S',
		'text'    => 't',
	)
);
$sender = static function ( string $configured, string $host, bool $local ): string {
	try {
		return Mail::sender( $configured, $host, $local )['email'];
	} catch ( HttpError $e ) {
		return $e->pointer . ' ' . $e->getMessage();
	}
};
eq(
	'the default sender is noreply@ the configured domain, else the site host; a local site on a host that is no mail domain uses the reserved name',
	array( $sender( 'Example.Test', '127.0.0.1', false ), $sender( '', 'kitchen.example', false ), $sender( '', '127.0.0.1', true ), $sender( '', 'localhost', true ) ),
	array( 'noreply@example.test', 'noreply@kitchen.example', Mail::LOCAL_SENDER, Mail::LOCAL_SENDER )
);
eq(
	'anywhere else, a host that is no mail domain is refused with what to set',
	array( $sender( '', '127.0.0.1', false ), $sender( 'localhost', 'kitchen.example', true ) ),
	array(
		'/from This site\'s host (127.0.0.1) is not a domain email can be sent from. Set `from` on the message, or set SP_MAIL_SENDER_DOMAIN to the sending domain.',
		'/from SP_MAIL_SENDER_DOMAIN (localhost) is not a domain email can be sent from. Set `from` on the message, or set SP_MAIL_SENDER_DOMAIN to the sending domain.',
	)
);
eq(
	'bad messages are refused at send, with a pointer',
	array_map(
		$refusal,
		array(
			null,
			array(
				'to'   => 'a@example.test',
				'text' => 'x',
			),
			array(
				'to'      => 'a@example.test',
				'subject' => "two\r\nlines",
				'text'    => 'x',
			),
			array(
				'to'      => 'a@example.test',
				'subject' => 'S',
			),
			array(
				'to'      => array(),
				'subject' => 'S',
				'text'    => 'x',
			),
			array(
				'to'      => 'not-an-address',
				'subject' => 'S',
				'text'    => 'x',
			),
			array(
				'to'      => 'a,b@example.test',
				'subject' => 'S',
				'text'    => 'x',
			),
			array(
				'to'      => array(
					'email' => 'a@example.test',
					'name'  => "Evil\r\nBcc: x@example.test",
				),
				'subject' => 'S',
				'text'    => 'x',
			),
			array(
				'to'      => 'a@example.test',
				'subject' => 'S',
				'text'    => 'x',
				'headers' => array( 'Bcc' => 'x@example.test' ),
			),
			array(
				'to'      => 'a@example.test',
				'subject' => 'S',
				'text'    => 'x',
				'headers' => array( 'X-Ok' => "v\nInjected: 1" ),
			),
			array(
				'to'      => array_fill( 0, 51, 'a@example.test' ),
				'subject' => 'S',
				'text'    => 'x',
			),
			array(
				'to'          => 'a@example.test',
				'subject'     => 'S',
				'text'        => 'x',
				'attachments' => array(),
			),
		)
	),
	array(
		' A message object is required.',
		'/subject Message subject is required and must be one line.',
		'/subject Message subject is required and must be one line.',
		'/text Message must carry text, html, or both.',
		'/to At least one address is required.',
		'/to/0 Not a valid email address.',
		'/to/0 Not a valid email address.',
		'/to/0/name A display name is one line of UTF-8.',
		'/headers/Bcc Header Bcc is not a header a message may set.',
		'/headers/X-Ok Header X-Ok must be a single-line string.',
		'/to A message may have at most 50 recipients.',
		'/attachments Unknown message field attachments.',
	)
);
eq(
	'wp_mail arguments: encoded display names, html with a text alternative, custom headers last',
	Mail::wpMailArguments(
		Mail::payload(
			array(
				'from'    => array(
					'email' => 'app@example.test',
					'name'  => 'SpacePress, Inc.',
				),
				'to'      => array( 'a@example.test' ),
				'subject' => 'S',
				'text'    => 'alt',
				'html'    => '<p>h</p>',
				'bcc'     => array( 'b@example.test' ),
				'headers' => array( 'X-App' => 'first' ),
			)
		)
	),
	array(
		'to'      => array( 'a@example.test' ),
		'subject' => 'S',
		'message' => '<p>h</p>',
		'headers' => array(
			'From: =?UTF-8?B?' . base64_encode( 'SpacePress, Inc.' ) . '?= <app@example.test>',
			'Reply-To: =?UTF-8?B?' . base64_encode( 'SpacePress, Inc.' ) . '?= <app@example.test>',
			'Bcc: b@example.test',
			'Content-Type: text/html; charset=UTF-8',
			'X-App: first',
		),
		'alt'     => 'alt',
	)
);
eq(
	'from defaults to noreply@ the sending domain',
	Mail::payload(
		array(
			'to'      => 'a@example.test',
			'subject' => 'S',
			'text'    => 'x',
		)
	)['from'],
	array( 'email' => 'noreply@example.test' )
);

// ---- transactional queue: a rollback sends nothing
$sent = array();
remove_all_filters( 'pre_wp_mail' );
add_filter(
	'pre_wp_mail',
	static function ( $short, array $atts ) use ( &$sent ) {
		$sent[] = $atts;
		return true;
	},
	10,
	2
);
[$status] = $wp->handle(
	'POST',
	'/actions/notify',
	json_encode(
		array(
			'to'   => 'rolled@example.test',
			'fail' => true,
		)
	)
);
eq( 'a handler that throws after send queues nothing', array( $status, count( $jobs() ) ), array( 409, 0 ) );
[$status, , $raw] = $wp->handle( 'POST', '/actions/notify', json_encode( array( 'to' => 'ok@example.test' ) ) );
$id               = json_decode( $raw, true )['data'];
eq( 'send returns the queued delivery id and nothing is sent before the queue runs', array( $status, $jobs()[0]['id'] === $id, $sent ), array( 200, true, array() ) );
$drain();
eq(
	'the queue hands the message to wp_mail once',
	array( count( $sent ), $sent[0]['to'], $sent[0]['subject'], $sent[0]['message'], $jobs()[0]['state'] ),
	array( 1, array( 'ok@example.test' ), 'Hello', '<p>rich</p>', 'done' )
);

// ---- one PHPMailer serves the whole queue run: a text alternative never carries over
// WordPress's own mailer; preSend() builds each message, nothing is sent.
remove_all_filters( 'pre_wp_mail' );
$bodies = array();
add_action(
	'phpmailer_init',
	static function ( $mailer ) use ( &$bodies ): void {
		$mailer->isSendmail();
		$mailer->Sendmail = '/usr/bin/true';
	},
	PHP_INT_MIN
);
add_action(
	'phpmailer_init',
	static function ( $mailer ) use ( &$bodies ): void {
		$bodies[] = array(
			'to'  => array_keys( $mailer->getAllRecipientAddresses() )[0],
			'alt' => $mailer->AltBody,
		);
	},
	PHP_INT_MAX
);
// The queued job input is the normalized message send() stores.
$rich  = static fn ( string $to ) => array(
	'message' => Mail::payload(
		array(
			'to'      => $to,
			'subject' => 'S',
			'html'    => '<p>rich</p>',
			'text'    => "private text for $to",
		)
	),
);
$plain = static fn ( string $to ) => array(
	'message' => Mail::payload(
		array(
			'to'      => $to,
			'subject' => 'S',
			'html'    => '<p>html only</p>',
		)
	),
);
Mail::deliver( $rich( 'first@example.test' ), array() );
Mail::deliver( $plain( 'second@example.test' ), array() );
eq(
	'a later html-only message does not inherit the previous message\'s text part',
	$bodies,
	array(
		array(
			'to'  => 'first@example.test',
			'alt' => 'private text for first@example.test',
		),
		array(
			'to'  => 'second@example.test',
			'alt' => '',
		),
	)
);
global $phpmailer;
eq( 'the shared mailer is left as it was found', $phpmailer->AltBody, '' );
remove_all_actions( 'phpmailer_init' );
add_filter(
	'pre_wp_mail',
	static function ( $short, array $atts ) use ( &$sent ) {
		$sent[] = $atts;
		return true;
	},
	10,
	2
);

// ---- a host transport at priority 0 is still the transport (has_filter() answers 0)
$first = array();
add_filter(
	'sp_mail_transport',
	static function ( $accepted, array $payload ) use ( &$first ) {
		$first[] = $payload['to'][0]['email'];
		return true;
	},
	0,
	2
);
$sent = array();
Mail::deliver( $plain( 'first@example.test' ), array() );
eq( 'a priority-0 transport receives the message and wp_mail is not used', array( $first, $sent ), array( array( 'first@example.test' ), array() ) );
remove_all_filters( 'sp_mail_transport' );

// ---- the host transport replaces wp_mail and a refusal is retried
$offered = array();
$accept  = false;
add_filter(
	'sp_mail_transport',
	static function ( $accepted, array $payload ) use ( &$offered, &$accept ) {
		$offered[] = $payload;
		return $accept;
	},
	10,
	2
);
[, , $raw] = $wp->handle( 'POST', '/actions/notify', json_encode( array( 'to' => 'host@example.test' ) ) );
$sent      = array();
$drain();
$row = array_values( array_filter( $jobs(), static fn ( $j ) => $j['id'] === json_decode( $raw, true )['data'] ) )[0];
eq(
	'a refusing host transport fails the attempt for a retry, and wp_mail is never used',
	array( count( $offered ), $offered[0]['to'], $row['state'], (int) $row['attempts'], str_contains( (string) $row['lastError'], 'did not accept' ), $sent ),
	array( 1, array( array( 'email' => 'host@example.test' ) ), 'failed', 1, true, array() )
);
$accept = true;
$wp->sql( "UPDATE {prefix}sp__jobs SET `runAt` = '2000-01-01T00:00:00.000Z' WHERE `id` = ?", array( $row['id'] ) );
\SpacePress\Jobs\Runner::run( $row['id'] );
eq( 'the retry reaches the host transport and completes', array( count( $offered ), $wp->sql( 'SELECT `state` FROM {prefix}sp__jobs WHERE `id` = ?', array( $row['id'] ) )[0]['state'] ), array( 2, 'done' ) );

// ---- the host transport is optional: a transport that takes nothing leaves the message to wp_mail
remove_all_filters( 'sp_mail_transport' );
$declined = array();
add_filter(
	'sp_mail_transport',
	static function ( $accepted, array $payload ) use ( &$declined ) {
		$declined[] = $payload['to'][0]['email'];
		return $accepted;
	},
	10,
	2
);
$sent = array();
Mail::deliver( $plain( 'passthrough@example.test' ), array() );
eq(
	'a transport that answers null is asked, then wp_mail sends the message',
	array( $declined, array_column( $sent, 'to' ) ),
	array( array( 'passthrough@example.test' ), array( array( 'passthrough@example.test' ) ) )
);
remove_all_filters( 'sp_mail_transport' );

// ---- a managed build with no host transport sends through wp_mail (WP Cloud, Pressable, VIP mail)
$managed = new \ReflectionProperty( \SpacePress\Wp\Runtime::class, 'managed' );
$managed->setValue( null, true );
try {
	$sent = array();
	Mail::deliver( $plain( 'managed@example.test' ), array() );
	eq( 'a managed build without sp_mail_transport hands the message to wp_mail', array( \SpacePress\Wp\Runtime::managed(), array_column( $sent, 'to' ) ), array( true, array( array( 'managed@example.test' ) ) ) );
	// ...and a refusing wp_mail is still a failed attempt for the runner to retry.
	remove_all_filters( 'pre_wp_mail' );
	add_filter( 'pre_wp_mail', static fn () => false );
	$refused = null;
	try {
		Mail::deliver( $plain( 'refused@example.test' ), array() );
	} catch ( \RuntimeException $e ) {
		$refused = $e->getMessage();
	}
	eq( 'a managed build whose wp_mail refuses fails the attempt', $refused, 'Mail transport did not accept the message' );
} finally {
	$managed->setValue( null, false );
}

finish( 'mail' );
