<?php

declare(strict_types=1);

use SpacePress\Identity\Organizations;
use SpacePress\Identity\Plugin;
use SpacePress\Identity\Security;

require __DIR__ . '/../../tests/php/wp.php';

wpSite(
	'organization-invite',
	array(
		'schema'    => require $argv[1] . '/schema.php',
		'functions' => file_get_contents( $argv[1] . '/functions.php' ),
		'identity'  => true,
	)
);

$value       = (object) array( 'name' => 'Before' );
$child       = \SpacePress\Html::component( static fn ( $props ): string => $props->name, $value );
$paragraph   = \SpacePress\Render\Email::component( 'EmailText', null, $child );
$value->name = 'After';
assert( str_contains( $paragraph->html(), '>After</p>' ), 'email components render children when placed' );

$request = static function ( array $params ): WP_REST_Request {
	$request = new WP_REST_Request( 'POST' );
	$request->set_body_params( $params );
	return $request;
};

$messages = array();
remove_all_filters( 'pre_wp_mail' );
add_action(
	'phpmailer_init',
	static function ( $mailer ) use ( &$messages ): void {
		$mailer->isSendmail();
		$mailer->Sendmail = '/usr/bin/true';
		$messages[]       = array(
			'to'      => array_keys( $mailer->getAllRecipientAddresses() )[0],
			'subject' => $mailer->Subject,
			'body'    => $mailer->Body,
			'text'    => $mailer->AltBody,
			'type'    => $mailer->ContentType,
		);
	},
	PHP_INT_MAX
);

$db            = Plugin::$db;
$organizations = new Organizations( $db, Plugin::$security, Plugin::$accounts );
$owner         = Plugin::$accounts->emailLogin( 'owner@example.test' );
$org           = $organizations->handle(
	'organizations',
	'POST',
	$request(
		array(
			'name'            => 'Email example',
			'idempotency_key' => Security::token(),
		)
	),
	$owner
);
$results       = array();
foreach ( array( 'Example site', 'A & <B>' ) as $index => $siteName ) {
	update_option( 'blogname', $siteName );
	$email   = "invitee-$index@example.test";
	$invitee = Plugin::$accounts->emailLogin( $email );
	$sent    = $organizations->handle(
		'organizations/invite',
		'POST',
		$request(
			array(
				'organization_id' => $org['id'],
				'email'           => $email,
			)
		),
		$owner
	);
	assert( true === $sent['sent'] );
	$mail     = $messages[ $index ];
	$siteName = get_bloginfo( 'name' );
	assert( $mail['to'] === $email && $mail['subject'] === 'Join your organization on ' . $siteName );
	$custom = 'override' === $argv[2];
	assert( $mail['type'] === ( $custom ? 'text/html' : 'text/plain' ) );
	assert( preg_match( '/[0-9a-f]{32}\.[a-zA-Z0-9_-]+(?=\s|<)/', $custom ? $mail['text'] : $mail['body'], $match ) === 1 );
	$code = $match[0];
	assert( Plugin::$accounts->owner( $email ) === $invitee, 'recipient owns verified address' );
	$challenge = $db->row(
		"SELECT payload FROM {$db->prefix}challenges WHERE id=%s AND purpose='invitation'",
		explode( '.', $code, 2 )[0],
	);
	assert( null !== $challenge, 'the message contains an issued challenge ID' );
	$joined = $organizations->handle( 'organizations/accept', 'POST', $request( array( 'invitation' => $code ) ), $invitee );
	assert( true === $joined['joined'] );
	if ( $custom ) {
		$results[] = array(
			'props' => array(
				'siteName'       => $siteName,
				'identityUrl'    => home_url( '/identity' ),
				'invitationCode' => $code,
				'expiresIn'      => 'seven days',
			),
			'html'  => $mail['body'],
			'text'  => $mail['text'],
		);
	}
}
echo wp_json_encode( $results );
