<?php

declare(strict_types=1);

/*
 * Spam checks on an in-process WordPress (tests/php/wp.php). Akismet isn't a platform plugin: a site
 * gets it through Jetpack, and comment creates are spam-checked only while it has a key. Without a key
 * the app still mounts and the check fails open. With one (WPCOM_API_KEY, or Jetpack's connection),
 * Akismet's own code checks every create. Only Akismet's API endpoint is a local stand-in, which records
 * each comment-check request and answers that the comment is spam.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname( __DIR__ ) . '/fixtures/blog/schema.php';
// SpacePress closes comments on every kind that doesn't turn them on (Hardening::comments), so the target is
// the blog's posts collection with `comments: true`.
$schema['collections']['posts']['comments'] = true;
$wp = wpSite(
	'spam',
	array(
		'schema'    => $schema,
		'functions' => file_get_contents( dirname( __DIR__ ) . '/fixtures/blog/functions.php' ),
		'akismet'   => true,
		// Two commenters: core's flood check refuses a second comment from one author within 15 seconds.
		'users'     => array(
			'sub'  => 'subscriber',
			'sub2' => 'subscriber',
		),
	)
);

eq( 'the app mounted with Akismet active and no key', array( $wp->plugin()->unavailable(), \SpacePress\Wp\Platform::problems(), class_exists( 'Akismet', false ), (bool) \Akismet::get_api_key() ), array( null, array(), true, false ) );
eq(
	'runtime.wp reports Akismet without spam checks',
	\SpacePress\Wp\Platform::versions()['akismet'],
	array(
		'version'    => AKISMET_VERSION,
		'spamChecks' => false,
	)
);

/** @var list<array{url: string, body: array<string, string>}> */
$checks = array();
add_filter(
	'pre_http_request',
	static function ( mixed $pre, array $args, string $url ) use ( &$checks ): mixed {
		if ( parse_url( $url, PHP_URL_HOST ) !== \Akismet::API_HOST ) {
			return $pre;
		}
		parse_str( (string) $args['body'], $body );
		$checks[] = array(
			'url'  => $url,
			'body' => $body,
		);
		return array(
			'headers'  => array(),
			'body'     => str_ends_with( (string) parse_url( $url, PHP_URL_PATH ), '/comment-check' ) ? 'true' : 'valid',
			'response' => array(
				'code'    => 200,
				'message' => 'OK',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	},
	10,
	3
);

$post    = wp_insert_post(
	array(
		'post_type'      => $schema['collections']['posts']['wp']['postType'],
		'post_title'     => 'Spam target',
		'post_status'    => 'publish',
		'comment_status' => 'open',
	),
	true
);
$comment = static function ( string $content, string $as ) use ( $post, $wp ): array {
	$wp->actAs( $as );
	$request = new \WP_REST_Request( 'POST', '/wp/v2/comments' );
	$request->set_body_params(
		array(
			'post'    => $post,
			'content' => $content,
		)
	);
	$response = rest_do_request( $request );
	wp_set_current_user( 0 );
	return array( $response->get_status(), $response->get_data() );
};

[$status, $data] = $comment( 'Without a key nothing is checked.', 'sub' );
eq( 'without a key a create is not spam-checked: no Akismet request, the comment is not spam', array( $status, $checks, 'spam' !== get_comment( (int) $data['id'] )->comment_approved ), array( 201, array(), true ) );

define( 'WPCOM_API_KEY', 'spacepress-test-akismet-key' );
eq( 'with WPCOM_API_KEY, runtime.wp reports spam checks on', \SpacePress\Wp\Platform::versions()['akismet']['spamChecks'], true );
[$status, $data] = $comment( 'Buy cheap things now.', 'sub2' );
$check           = array_values( array_filter( $checks, static fn ( array $c ): bool => str_ends_with( (string) parse_url( $c['url'], PHP_URL_PATH ), '/comment-check' ) ) );
eq( 'with a key a create is spam-checked with that key and the comment', array( count( $check ), $check[0]['body']['api_key'] ?? null, $check[0]['body']['comment_content'] ?? null ), array( 1, 'spacepress-test-akismet-key', 'Buy cheap things now.' ) );
eq( 'Akismet\'s spam answer marks the comment spam', array( $status, get_comment( (int) $data['id'] )->comment_approved ), array( 201, 'spam' ) );

finish( 'spam_test' );
