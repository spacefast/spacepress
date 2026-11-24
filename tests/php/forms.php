<?php

declare(strict_types=1);

/*
 * Forms without JavaScript (docs/spec/rendering.md §4.2): tests/fixtures/forms, built by
 * `spacepress build`, on WordPress with php -S. Each step is what a browser with scripts off does: GET
 * the page, POST the form as `application/x-www-form-urlencoded` to its `action`, follow the 303
 * with the cookie it set. Prints one JSON object of what each step saw.
 *
 *   SP_WP_THEMES=1 php tests/php/forms.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

// A second argument (`/blog`) puts WordPress in that subdirectory and runs the redirect steps only.
$base = $argv[2] ?? '';
$site = wpSite(
	'forms',
	array(
		'wpContent' => $argv[1],
		'users'     => array( 'reader' => 'subscriber' ),
		'base'      => $base,
	)
);
$site->actAs( null );
$site->startServer();
$url = $site->url();

function fetch( string $url, string $method = 'GET', array $headers = array(), ?string $body = null ): array {
	$ch  = curl_init( $url );
	$out = array();
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_CUSTOMREQUEST  => $method,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 30,
			CURLOPT_HTTPHEADER     => $headers,
			CURLOPT_POSTFIELDS     => $body,
			CURLOPT_HEADERFUNCTION => static function ( $ch, string $line ) use ( &$out ): int {
				if ( str_contains( $line, ':' ) ) {
					[$name, $value]                       = explode( ':', $line, 2 );
					$out[ strtolower( trim( $name ) ) ][] = trim( $value );
				}
				return strlen( $line );
			},
		)
	);
	$text = (string) curl_exec( $ch );
	return array(
		'status'  => (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE ),
		'headers' => $out,
		'body'    => $text,
	);
}

/** The form with class $class on $html: its action, method and fields (hidden ones with values). */
function form( string $html, string $class ): array {
	$doc = new DOMDocument();
	@$doc->loadHTML( $html );
	foreach ( $doc->getElementsByTagName( 'form' ) as $form ) {
		if ( $form->getAttribute( 'class' ) !== $class ) {
			continue;
		}
		$fields = array();
		foreach ( $form->getElementsByTagName( 'input' ) as $input ) {
			$fields[] = array( $input->getAttribute( 'name' ), $input->getAttribute( 'type' ), $input->getAttribute( 'value' ) );
		}
		return array(
			'action' => $form->getAttribute( 'action' ),
			'method' => $form->getAttribute( 'method' ),
			'fields' => $fields,
		);
	}
	throw new RuntimeException( "no form .$class" );
}

/** The text of the first element with class $class, or null. */
function text( string $html, string $class ): ?string {
	$doc = new DOMDocument();
	@$doc->loadHTML( $html );
	foreach ( ( new DOMXPath( $doc ) )->query( "//*[@class='$class']" ) as $node ) {
		return trim( $node->textContent );
	}
	return null;
}

/**
 * Submits $form as a browser does: its hidden fields, then $values, form-encoded, to its action.
 * Follows the 303 with the cookie it set, as the browser does, and returns both responses.
 */
function submit( array $form, array $values, array $headers = array() ): array {
	$pairs = array();
	foreach ( $form['fields'] as [$name, $type, $value] ) {
		if ( 'hidden' === $type ) {
			$pairs[] = rawurlencode( $name ) . '=' . rawurlencode( $value );
		}
	}
	foreach ( $values as $name => $value ) {
		$pairs[] = rawurlencode( $name ) . '=' . rawurlencode( (string) $value );
	}
	$post     = fetch( $form['action'], 'POST', array( ...$headers, 'Content-Type: application/x-www-form-urlencoded' ), implode( '&', $pairs ) );
	$location = $post['headers']['location'][0] ?? null;
	$cookie   = explode( ';', $post['headers']['set-cookie'][0] ?? '' )[0];
	$back     = null === $location ? null : fetch( $location, headers: array( ...$headers, ...( '' === $cookie ? array() : array( "Cookie: $cookie" ) ) ) );

	return array(
		'post'     => $post,
		'location' => $location,
		'cookie'   => $cookie,
		'back'     => $back,
	);
}

$out       = array();
$page      = fetch( "$url/?ref=nav" );
$subscribe = form( $page['body'], 'subscribe' );
if ( '' !== $base ) {
	// Under a subdirectory install the return is the request URI, home path included (`/blog/join`):
	// the form still comes back to that page once, with its result.
	$join = form( fetch( "$url/join/" )['body'], 'subscribe' );
	$ok   = submit(
		$join,
		array(
			'email' => 'sub@example.test',
			'seats' => '1',
		)
	);
	$sub  = array(
		'return'   => array_values( array_filter( $join['fields'], static fn ( $f ) => '_sp_return' === $f[0] ) )[0][2] ?? null,
		'location' => preg_replace( '/_flash=[0-9a-f]{12}/', '_flash=ID', (string) parse_url( (string) $ok['location'], PHP_URL_PATH ) . '?' . parse_url( (string) $ok['location'], PHP_URL_QUERY ) ),
		'back'     => array( $ok['back']['status'] ?? null, text( $ok['back']['body'] ?? '', 'done' ) ),
	);
	echo json_encode( $sub, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT ), "\n";
	$site->destroy();
	exit;
}
$out['form'] = array(
	'method'           => $subscribe['method'],
	'action'           => parse_url( $subscribe['action'], PHP_URL_PATH ),
	'hidden'           => array_values( array_filter( $subscribe['fields'], static fn ( $f ) => 'hidden' === $f[1] ) ),
	'page cache'       => fetch( "$url/" )['headers']['cache-control'][0] ?? null,
	// `ref` is not a parameter the page declares (`export const search`): that URL is not shared.
	'undeclared query' => $page['headers']['cache-control'][0] ?? null,
);

// Success: the action's result comes back on the page; the redirect goes to the page it came from.
$ok             = submit(
	$subscribe,
	array(
		'email'  => 'ada@example.test',
		'seats'  => '3',
		'weekly' => 'on',
		'note'   => '',
	)
);
$out['success'] = array(
	'status'         => $ok['post']['status'],
	'location'       => preg_replace( '/_flash=[0-9a-f]{12}/', '_flash=ID', (string) parse_url( (string) $ok['location'], PHP_URL_PATH ) . '?' . parse_url( (string) $ok['location'], PHP_URL_QUERY ) ),
	'cookie flags'   => array_slice( array_map( 'trim', explode( ';', $ok['post']['headers']['set-cookie'][0] ?? '' ) ), 1 ),
	'done'           => text( $ok['back']['body'], 'done' ),
	'back cache'     => $ok['back']['headers']['cache-control'][0] ?? null,
	'cookie cleared' => str_contains( implode( "\n", $ok['back']['headers']['set-cookie'] ?? array() ), 'Max-Age=0' ),
);
// Read once: the same URL again shows nothing (the browser dropped the cookie).
$again                   = fetch( (string) $ok['location'] );
$out['success']['again'] = text( $again['body'], 'done' );
// A forged or foreign cookie is no flash.
$forged                   = fetch( (string) $ok['location'], headers: array( 'Cookie: ' . explode( '=', $ok['cookie'], 2 )[0] . '=AAAA' . substr( explode( '=', $ok['cookie'], 2 )[1], 4 ) ) );
$out['success']['forged'] = text( $forged['body'], 'done' );
// Unchecked checkbox: false.
$off              = submit(
	$subscribe,
	array(
		'email' => 'bo@example.test',
		'seats' => '1',
	)
);
$out['unchecked'] = text( $off['back']['body'], 'done' );

// A field the input refuses: the error names it, the page fills the form again.
$bad            = submit(
	$subscribe,
	array(
		'email' => 'not an email',
		'seats' => '2',
	)
);
$out['invalid'] = array(
	'status'         => $bad['post']['status'],
	'error'          => text( $bad['back']['body'], 'error' ),
	'field'          => text( $bad['back']['body'], 'field-error' ),
	'refilled'       => form( $bad['back']['body'], 'subscribe' )['fields'][0][2] ?? null,
	'seats refilled' => array_values( array_filter( form( $bad['back']['body'], 'subscribe' )['fields'], static fn ( $f ) => 'seats' === $f[0] ) )[0][2] ?? null,
);
// Each named field of the form gets the last submit's state by itself: the error marks the field it
// names, a field the page doesn't fill is refilled, a checked box stays checked, and the form says
// how its last submit went. After a success the form starts over.
$state              = static function ( array $back ): array {
	$doc = new DOMDocument();
	@$doc->loadHTML( $back['body'] );
	$xpath = new DOMXPath( $doc );
	$form  = $xpath->query( "//form[@class='subscribe']" )->item( 0 );
	$attr  = static fn ( string $name, string $attribute ): ?string => ( $n = $xpath->query( ".//*[@name='$name']", $form )->item( 0 ) ) !== null && $n->hasAttribute( $attribute ) ? $n->getAttribute( $attribute ) : null;

	return array(
		'form'     => $form->getAttribute( 'data-sp-form-state' ) ?: null,
		'invalid'  => array_values( array_map( static fn ( DOMElement $n ) => $n->getAttribute( 'name' ), iterator_to_array( $xpath->query( ".//*[@aria-invalid='true']", $form ) ) ) ),
		'note'     => $attr( 'note', 'value' ),
		'weekly'   => $attr( 'weekly', 'checked' ) !== null,
		'password' => $attr( 'password', 'value' ),
	);
};
$typed              = submit(
	$subscribe,
	array(
		'email'    => 'nope',
		'seats'    => '2',
		'weekly'   => 'on',
		'note'     => 'Keep me',
		'password' => 'hunter2',
	)
);
$fresh              = submit(
	$subscribe,
	array(
		'email'  => 'kay@example.test',
		'seats'  => '2',
		'weekly' => 'on',
		'note'   => 'Gone',
	)
);
$out['field state'] = array(
	'initial' => $state( $page ),
	'error'   => $state( $typed['back'] ),
	'success' => $state( $fresh['back'] ),
);

// A password the visitor typed is never sent back to fill the form.
$secret          = submit(
	$subscribe,
	array(
		'email'    => 'p-at-example',
		'seats'    => '1',
		'password' => 'hunter2',
	)
);
$out['password'] = array(
	text( $secret['back']['body'], 'error' ),
	array_values( array_filter( form( $secret['back']['body'], 'subscribe' )['fields'], static fn ( $f ) => 'password' === $f[0] ) )[0][2] ?? null,
	form( $secret['back']['body'], 'subscribe' )['fields'][0][2] ?? null,
);
// The handler's own HttpError, and a number that isn't one.
$out['handler error'] = text(
	submit(
		$subscribe,
		array(
			'email' => 'c@example.test',
			'seats' => '9',
		)
	)['back']['body'],
	'error'
);
$out['not a number']  = text(
	submit(
		$subscribe,
		array(
			'email' => 'c@example.test',
			'seats' => 'lots',
		)
	)['back']['body'],
	'error'
);

// The return path is a path on this site, never another host.
$evil                 = $subscribe;
$evil['fields']       = array_map( static fn ( $f ) => '_sp_return' === $f[0] ? array( $f[0], $f[1], '//evil.example/x' ) : $f, $evil['fields'] );
$out['open redirect'] = parse_url(
	(string) submit(
		$evil,
		array(
			'email' => 'd@example.test',
			'seats' => '1',
		)
	)['location'],
	PHP_URL_HOST
) === parse_url( $url, PHP_URL_HOST );

// A form rendered at a page's other spelling (`/join`, before its redirect) comes back to `/join/`.
$bare                  = $subscribe;
$bare['fields']        = array_map( static fn ( $f ) => '_sp_return' === $f[0] ? array( $f[0], $f[1], '/join' ) : $f, $bare['fields'] );
$joined                = submit(
	$bare,
	array(
		'email' => 'b@example.test',
		'seats' => '2',
	)
);
$out['other spelling'] = array( parse_url( (string) $joined['location'], PHP_URL_PATH ), text( $joined['back']['body'], 'done' ) );
// A request that carries a result is answered where it is, even at the other spelling.
$flashBare         = fetch( "$url/join?_flash=" . str_repeat( 'a', 12 ) );
$out['flash bare'] = array( $flashBare['status'], $flashBare['headers']['location'][0] ?? null );

// A cross-site form post is refused before the action runs.
$cross             = submit(
	$subscribe,
	array(
		'email' => 'e@example.test',
		'seats' => '1',
	),
	array( 'Origin: https://evil.example' )
);
$out['cross site'] = array( $cross['post']['status'], text( $cross['back']['body'], 'error' ), text( $cross['back']['body'], 'done' ) );

// A JSON call to the same URL is unchanged: `{ data }`, no redirect.
$json        = fetch( $subscribe['action'], 'POST', array( 'Content-Type: application/json' ), '{"email":"f@example.test","seats":1,"weekly":false}' );
$out['json'] = array( $json['status'], json_decode( $json['body'], true )['data']['seats'] ?? null );

// An action the visitor may not run: the refusal comes back to the page.
$members           = form( $page['body'], 'members' );
$denied            = submit( $members, array( 'name' => 'Ann' ) );
$out['signed out'] = array( text( $denied['back']['body'], 'member-error' ), text( $denied['back']['body'], 'member' ) );

// Signed in: the page carries the REST nonce (and isn't shared), the action runs as the user.
$id      = $site->userId( 'reader' );
$expires = time() + 3600;
$token   = WP_Session_Tokens::get_instance( $id )->create( $expires );
$logged  = wp_generate_auth_cookie( $id, $expires, 'logged_in', $token );
$session = array( 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode( $logged ) );
$mine    = fetch( "$url/", headers: $session );
$members = form( $mine['body'], 'members' );
$signed  = submit( $members, array( 'name' => 'Ann' ), $session );
// The browser sends both cookies on the way back.
$back             = fetch( (string) $signed['location'], headers: array( 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode( $logged ) . '; ' . $signed['cookie'] ) );
$out['signed in'] = array(
	'nonce'      => in_array( '_wpnonce', array_column( $members['fields'], 0 ), true ),
	'page cache' => $mine['headers']['cache-control'][0] ?? null,
	'member'     => text( $back['body'], 'member' ),
	'user'       => $id,
);
// Without the nonce a signed-in cookie isn't the user: the action runs signed out and is refused.
$members['fields'] = array_values( array_filter( $members['fields'], static fn ( $f ) => '_wpnonce' !== $f[0] ) );
$nn                = submit( $members, array( 'name' => 'Ann' ), $session );
$nnBack            = fetch( (string) $nn['location'], headers: array( 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode( $logged ) . '; ' . $nn['cookie'] ) );
$out['no nonce']   = array( $nn['post']['status'], text( $nnBack['body'], 'member-error' ), text( $nnBack['body'], 'member' ) );

// One form per row for one action (/rows): a refused submit's state comes back on the row that
// posted only, its checked boxes and radio choice included; the other rows show what is stored.
$sign = str_replace( '/actions/subscribe', '/actions/sign', $subscribe['action'] );
foreach ( array( 'Ann', 'Bo', 'Cy' ) as $n ) {
	fetch( $sign, 'POST', array( 'Content-Type: application/json' ), json_encode( array( 'name' => $n ) ) );
}
$rows     = fetch( "$url/rows/" );
$rowState = static function ( string $html ): array {
	$doc = new DOMDocument();
	@$doc->loadHTML( $html );
	$xpath = new DOMXPath( $doc );
	$out   = array();
	foreach ( $xpath->query( "//form[starts-with(@class, 'row ')]" ) as $form ) {
		$one   = static fn ( string $q ): ?DOMElement => $xpath->query( $q, $form )->item( 0 );
		$out[] = array(
			'state'   => $form->getAttribute( 'data-sp-form-state' ) ?: null,
			'form'    => $one( ".//input[@name='_sp_form']" )?->getAttribute( 'value' ),
			'name'    => $one( ".//input[@name='name']" )?->getAttribute( 'value' ),
			'invalid' => $one( ".//input[@name='name']" )?->getAttribute( 'aria-invalid' ) ?: null,
			'tags'    => array_values( array_map( static fn ( DOMElement $n ) => $n->getAttribute( 'value' ), iterator_to_array( $xpath->query( ".//input[@name='tags'][@checked]", $form ) ) ) ),
			'size'    => array_values( array_map( static fn ( DOMElement $n ) => $n->getAttribute( 'value' ), iterator_to_array( $xpath->query( ".//input[@name='size'][@checked]", $form ) ) ) ),
		);
	}

	return $out;
};
$second   = ( static function ( string $html ): array {
	$doc = new DOMDocument();
	@$doc->loadHTML( $html );
	$xpath  = new DOMXPath( $doc );
	$form   = $xpath->query( "//form[starts-with(@class, 'row ')]" )->item( 1 );
	$fields = array();
	foreach ( $xpath->query( './/input', $form ) as $input ) {
		$fields[] = array( $input->getAttribute( 'name' ), $input->getAttribute( 'type' ), $input->getAttribute( 'value' ) );
	}

	return array(
		'action' => $form->getAttribute( 'action' ),
		'method' => 'post',
		'fields' => $fields,
	);
} )( $rows['body'] );
// Two boxes of one name: the body sends both, as a browser does.
$second['fields'] = array_values( array_filter( $second['fields'], static fn ( $f ) => 'hidden' === $f[1] ) );
$refused          = submit(
	$second,
	array(
		'name' => 'x',
		'tags' => 'red',
		'size' => 's',
	)
);
$pairs            = array();
foreach ( $second['fields'] as [$n, , $v] ) {
	$pairs[] = rawurlencode( $n ) . '=' . rawurlencode( $v );
}
$both        = fetch( $second['action'], 'POST', array( 'Content-Type: application/x-www-form-urlencoded' ), implode( '&', array( ...$pairs, 'name=x', 'tags=red', 'tags=blue', 'size=s' ) ) );
$bothBack    = fetch( (string) ( $both['headers']['location'][0] ?? '' ), headers: array( 'Cookie: ' . explode( ';', $both['headers']['set-cookie'][0] ?? '' )[0] ) );
$renamed     = submit(
	$second,
	array(
		'name' => 'Bea',
		'tags' => 'blue',
	)
);
$out['rows'] = array(
	'initial'   => $rowState( $rows['body'] ),
	'refused'   => $rowState( $refused['back']['body'] ),
	'two boxes' => $rowState( $bothBack['body'] )[1]['tags'] ?? null,
	'messages'  => array( text( $refused['back']['body'], 'rename-error' ), text( $renamed['back']['body'], 'rename-error' ) ),
	'renamed'   => array( text( $renamed['back']['body'], 'renamed' ), $rowState( $renamed['back']['body'] ) ),
);

echo json_encode( $out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT ), "\n";
$site->destroy();
