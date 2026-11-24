<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$profile   = null;
$muPlugins = array( 'test-mail' => "<?php add_filter('pre_wp_mail', '__return_true');" );
if ( $destination = getenv( 'SP_DRIVE_PROFILE' ) ) {
	require __DIR__ . '/drive_store_profile.php';
	$profile                    = new DriveStoreProfile( $destination );
	$muPlugins['drive-profile'] = DriveStoreProfile::PLUGIN;
}
$site = wpSite(
	'drive-store',
	array(
		'wpContent' => $argv[1],
		'users'     => array(
			'ann'    => 'subscriber',
			'editor' => 'editor',
		),
		'muPlugins' => $muPlugins,
		'server'    => true,
	)
);
$url  = $site->url();

function fetch( string $url, string $method = 'GET', array $headers = array(), ?string $body = null ): array {
	$ch  = curl_init( $url );
	$out = array();
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_CUSTOMREQUEST  => $method,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 60,
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

/** The form on $html that posts to a URL ending in $suffix: its action and its inputs. */
function form( string $html, string $suffix ): array {
	$doc = new DOMDocument();
	$doc->loadHTML( '<?xml encoding="utf-8"?>' . $html, LIBXML_NOERROR | LIBXML_NOWARNING );
	foreach ( $doc->getElementsByTagName( 'form' ) as $form ) {
		if ( str_ends_with( $form->getAttribute( 'action' ), $suffix ) ) {
			$fields = array();
			foreach ( $form->getElementsByTagName( 'input' ) as $input ) {
				$fields[] = array( $input->getAttribute( 'name' ), $input->getAttribute( 'type' ), $input->getAttribute( 'value' ) );
			}
			return array(
				'action' => $form->getAttribute( 'action' ),
				'fields' => $fields,
			);
		}
	}
	throw new RuntimeException( "no form posts to $suffix" );
}

/**
 * Submits $form as a browser does (its hidden fields, then $values, form-encoded), then follows the
 * 303 with the flash cookie it set, plus the visitor's own cookie. Returns the page it came back to.
 */
function submit( array $form, array $values, string $cookie = '' ): array {
	$pairs = array();
	foreach ( $form['fields'] as [$name, $type, $value] ) {
		if ( 'hidden' === $type ) {
			$pairs[] = rawurlencode( $name ) . '=' . rawurlencode( $value );
		}
	}
	foreach ( $values as $name => $value ) {
		$pairs[] = rawurlencode( $name ) . '=' . rawurlencode( (string) $value );
	}
	$session  = '' === $cookie ? array() : array( "Cookie: $cookie" );
	$post     = fetch( $form['action'], 'POST', array( ...$session, 'Content-Type: application/x-www-form-urlencoded' ), implode( '&', $pairs ) );
	$flash    = explode( ';', $post['headers']['set-cookie'][0] ?? '' )[0];
	$cookies  = implode( '; ', array_filter( array( $cookie, $flash ) ) );
	$location = $post['headers']['location'][0] ?? null;
	$back     = null === $location ? array( 'body' => '' ) : fetch( $location, headers: '' === $cookies ? array() : array( "Cookie: $cookies" ) );
	return array(
		'status' => $post['status'],
		'path'   => null === $location ? null : parse_url( $location, PHP_URL_PATH ),
		'body'   => $back['body'],
	);
}

/** A signed-in browser's cookie for $who. */
function session( WpSite $site, string $who ): string {
	$id      = $site->userId( $who );
	$expires = time() + 3600;
	$token   = WP_Session_Tokens::get_instance( $id )->create( $expires );
	return LOGGED_IN_COOKIE . '=' . rawurlencode( wp_generate_auth_cookie( $id, $expires, 'logged_in', $token ) );
}

$db      = $site->app()->db;
$admin   = new \SpacePress\Viewer(
	array(
		'id'   => $site->userId( 'admin' ),
		'name' => 'Admin',
		'role' => 'admin',
	)
);
$guest   = new \SpacePress\Viewer( null );
$catalog = $db->findMany( 'drives', array( 'orderBy' => array( 'slug' => 'asc' ) ), $guest );
eq(
	'a fresh installation seeds the Markdown drives',
	array_column( $catalog, 'slug' ),
	array(
		'crucial-p3-2tb',
		'samsung-870-evo-1tb',
		'seagate-exos-x16',
		'wd-red-plus-4tb',
	)
);
$drive  = $catalog[2];
$id     = $drive['id'];
$slug   = $drive['slug'];
$path   = "/drives/$slug/";
$native = wc_get_product( $id );
check( 'the catalog row is a native Woo product', $native instanceof WC_Product_Simple );
eq( 'typed capacity is stored on the Woo product', array( (int) $native->get_meta( '_sp_field_capacityGb' ), $drive['capacityGb'] ), array( 16000, 16000 ) );
eq( 'money is an exact decimal string', $drive['price'], '139.00' );
eq( 'the public product masks its serial', $drive['serial'] ?? null, null );
eq( 'staff can read the typed inventory serial', $db->findFirst( 'drives', array( 'where' => array( 'id' => $id ) ), $admin )['serial'], 'DEMO-SEAGATE-EXOS-X16' );
eq( 'new products start at zero Woo stock', array( $native->managing_stock(), $native->get_stock_quantity() ), array( true, 0 ) );
eq( 'checkout is a real WordPress Page containing the native block', has_block( 'woocommerce/checkout', get_post( wc_get_page_id( 'checkout' ) ) ), true );
eq( 'Markdown categories and tags are native Woo terms on the product', array( get_term( $drive['categories'][0], 'product_cat' )->name, get_term( $drive['tags'][0], 'product_tag' )->name ), array( 'NAS and server', 'Enterprise' ) );
// A date() product field is stored as YYYY-MM-DD and compared in that form.
$tested = static fn ( array $where ): array => array_column(
	$db->findMany(
		'drives',
		array(
			'where'   => array( 'testedOn' => $where ),
			'orderBy' => array( 'slug' => 'asc' ),
		),
		$guest
	),
	'slug'
);
eq( 'a date product field reads back as written', $drive['testedOn'], '2026-10-02' );
eq( 'a date product field filters by equality', $tested( array( 'eq' => '2026-10-02' ) ), array( 'seagate-exos-x16', 'wd-red-plus-4tb' ) );
eq( 'a date product field filters by range', array( $tested( array( 'gte' => '2026-10-19' ) ), $tested( array( 'lt' => '2026-10-19' ) ), $tested( array( 'gt' => '2026-11-03' ) ) ), array( array( 'crucial-p3-2tb', 'samsung-870-evo-1tb' ), array( 'seagate-exos-x16', 'wd-red-plus-4tb' ), array() ) );
eq(
	'a date product field sorts',
	array_column(
		$db->findMany(
			'drives',
			array(
				'orderBy' => array( 'testedOn' => 'desc' ),
				'limit'   => 1,
			),
			$guest
		),
		'slug'
	),
	array( 'crucial-p3-2tb' )
);

$catalogPage = fetch( "$url/" );
eq( 'catalog renders', $catalogPage['status'], 200 );
check( 'catalog renders the native product', str_contains( $catalogPage['body'], 'Seagate Exos X16' ) );
$filtered = fetch( "$url/?media=ssd&q=Samsung" );
eq( 'search and media filter render', $filtered['status'], 200 );
check( 'search and media filter select the matching drive', str_contains( $filtered['body'], 'Samsung 870 EVO' ) && ! str_contains( $filtered['body'], 'Seagate Exos X16' ) );
$missing = fetch( "$url/drives/does-not-exist/" );
eq( 'an unknown product slug returns 404', $missing['status'], 404 );
eq( 'guest staff page redirects to sign-in', fetch( "$url/staff/" )['status'], 302 );
eq( 'editors cannot use the Woo fulfilment page', fetch( "$url/staff/", headers: array( 'Cookie: ' . session( $site, 'editor' ) ) )['status'], 403 );
check( 'catalog offers the WordPress product feed', str_contains( $catalogPage['body'], 'post_type=product' ) );
$feed = fetch( "$url/?feed=rss2&post_type=product" );
eq( 'the product feed the catalog links is served', array( $feed['status'], str_contains( $feed['body'], '<rss' ), str_contains( $feed['body'], 'Seagate Exos X16' ) ), array( 200, true, true ) );
foreach ( array( 'cart', 'checkout' ) as $page ) {
	$answer = fetch( "$url/$page/" );
	eq( "the $page route renders", $answer['status'], 200 );
	check( "the $page response is private", str_contains( $answer['headers']['cache-control'][0] ?? '', 'no-store' ) );
}
check( 'the app source page still renders', str_contains( fetch( "$url/source/" )['body'], 'Drive Store source' ) );

$staffCookie = session( $site, 'admin' );
$staff       = fetch( "$url/staff/", headers: array( "Cookie: $staffCookie" ) );
eq( 'admin can open the staff page', $staff['status'], 200 );
check( 'the staff page links to SpacePress Admin', str_contains( $staff['body'], '/wp-admin/new/screens/shipping' ) );
eq(
	'editor cannot restock through the action',
	$site->call(
		'POST',
		'/actions/restock',
		array(
			'drive'    => $id,
			'quantity' => 2,
		),
		as: 'editor'
	)[0],
	403
);
[$status, $restocked] = $site->call(
	'POST',
	'/actions/restock',
	array(
		'drive'    => $id,
		'quantity' => 2,
	),
	as: 'admin'
);
eq( 'restock action increments Woo inventory', array( $status, $restocked['stock'] ?? null, wc_get_product( $id )->get_stock_quantity() ), array( 200, 2, 2 ) );

$detail = fetch( "$url$path" );
eq( 'native product URL renders', $detail['status'], 200 );
check( 'native product page shows specs and live stock', str_contains( $detail['body'], 'SMART power-on hours' ) && str_contains( $detail['body'], '2 in stock' ) && str_contains( $detail['body'], 'data-sp-live' ) );
check( 'native product page shows the test date, category and tag', str_contains( $detail['body'], '2026-10-02' ) && str_contains( $detail['body'], 'NAS and server, Enterprise' ) );
check( 'an available drive offers add to cart', str_contains( $detail['body'], 'Add to cart' ) );
check( 'the storefront does not print the inventory serial', ! str_contains( $detail['body'], 'DEMO-SEAGATE-EXOS-X16' ) );

$customerCookie = session( $site, 'ann' );
$review         = fetch( "$url$path", headers: array( "Cookie: $customerCookie" ) );
$reviewForm     = form( $review['body'], '/comments' );
$posted         = submit( $reviewForm, array( 'content' => 'Arrived well packed.' ), $customerCookie );
eq( 'a signed-in customer can post a review', $posted['status'], 303 );
check( 'first review is held for moderation', str_contains( $posted['body'], 'awaiting moderation' ) );
check( 'guests do not see the held review', ! str_contains( fetch( "$url$path" )['body'], 'Arrived well packed.' ) );

$profile?->measure( $site, 'catalog', '/' );
$profile?->measure( $site, 'catalog/search-and-filter', '/?media=ssd&q=Samsung' );
$profile?->measure( $site, 'product/in-stock', $path );
$profile?->measure( $site, 'cart', '/cart/' );
$profile?->measure( $site, 'checkout', '/checkout/' );

$order = wc_create_order();
$order->add_product( wc_get_product( $id ), 2 );
$order->calculate_totals();
$order->update_status( 'processing' );
$orderId = $order->get_id();
eq( 'native Woo order reduces stock', wc_get_product( $id )->get_stock_quantity(), 0 );
$record = $db->findFirst( 'orders', array( 'where' => array( 'id' => $orderId ) ), $admin );
eq( 'order() reads the native order and its lines', array( $record['status'], $record['lines'][0]['product'], $record['lines'][0]['quantity'] ), array( 'processing', $id, 2 ) );
eq( 'order() keeps native records private', $site->call( 'GET', '/orders' )[0], 401 );
$moves = static fn () => array_map( static fn ( $row ) => array( $row['reason'], (float) $row['change'], $row['order'] ), $db->findMany( 'stock_movements', array( 'orderBy' => array( 'id' => 'asc' ) ), $admin ) );
eq( 'the activity table logs restock and checkout stock changes', $moves(), array( array( 'restock', 2.0, null ), array( 'sale', -2.0, $orderId ) ) );
$sold  = fetch( "$url$path" );
check( 'fresh product HTML reflects the Woo stock change', str_contains( $sold['body'], 'Sold out' ) && ! str_contains( $sold['body'], 'Add to cart' ) );
$profile?->measure( $site, 'product/sold-out', $path );
$profile?->measure( $site, 'staff/processing', '/staff/', 200, $staffCookie );
$staff   = fetch( "$url/staff/", headers: array( "Cookie: $staffCookie" ) );
$shipped = submit( form( $staff['body'], '/actions/markShipped' ), array(), $staffCookie );
clean_post_cache( $orderId );
eq( 'staff form marks the native order shipped', array( $shipped['status'], wc_get_order( $orderId )->get_status() ), array( 303, 'completed' ) );
check( 'the staff page confirms the order', str_contains( $shipped['body'], 'marked shipped' ) );
eq( 'repeating the shipping action is safe', $site->call( 'POST', '/actions/markShipped', array( 'order' => $orderId ), as: 'admin' )[0], 200 );

$order = wc_get_order( $orderId );
$order->update_status( 'cancelled' );
eq( 'Woo restores cancelled stock and the log records the return', array( wc_get_product( $id )->get_stock_quantity(), $moves()[2] ?? null ), array( 2, array( 'return', 2.0, $orderId ) ) );
eq( 'typed product updates leave operational stock intact', $db->update( 'drives', array( 'powerOnHours' => 22000 ), array( 'id' => $id ), true, $admin )[0]['powerOnHours'], 22000 );
eq( 'a spec edit preserves the Woo stock count', wc_get_product( $id )->get_stock_quantity(), 2 );

// A refund that restocks its items returns stock without restoring the order's, on Woo's own hook.
$refunded = wc_create_order();
$line     = $refunded->add_product( wc_get_product( $id ), 1 );
$refunded->calculate_totals();
$refunded->update_status( 'processing' );
$refund = wc_create_refund(
	array(
		'order_id'      => $refunded->get_id(),
		'amount'        => $refunded->get_total(),
		'restock_items' => true,
		'line_items'    => array(
			$line => array(
				'qty'          => 1,
				'refund_total' => $refunded->get_total(),
				'refund_tax'   => array(),
			),
		),
	)
);
check( 'Woo accepts the restocking refund', $refund instanceof WC_Order_Refund, $refund );
eq( 'a restocking refund is logged as a return', array( wc_get_product( $id )->get_stock_quantity(), array_slice( $moves(), 3 ) ), array( 2, array( array( 'sale', -1.0, $refunded->get_id() ), array( 'return', 1.0, $refunded->get_id() ) ) ) );

// The stock ability checks its own input: an action's abilities.call() skips core's REST argument check.
$site->actAs( 'admin' );
$increase = static function ( array $input ): array {
	$result = wp_get_ability( 'drive-store/increase-product-stock' )->execute( $input );
	return $result instanceof WP_Error ? array( $result->get_error_data()['status'] ?? null, $result->get_error_message() ) : array( 200, $result );
};
foreach ( array(
	'a negative quantity'           => -3,
	'a quantity with trailing text' => '2abc',
	'a fractional quantity'         => 1.9,
	'zero'                          => 0,
	'a null quantity'               => null,
) as $label => $quantity ) {
	eq(
		"increase-product-stock refuses $label",
		$increase(
			array(
				'id'       => $id,
				'quantity' => $quantity,
			)
		)[0],
		422
	);
}
eq( 'increase-product-stock refuses a missing quantity', $increase( array( 'id' => $id ) )[0], 422 );
eq(
	'increase-product-stock refuses an unknown input',
	$increase(
		array(
			'id'        => $id,
			'quantity'  => 1,
			'operation' => 'set',
		)
	)[0],
	422
);
eq( 'refused quantities leave Woo stock unchanged', wc_get_product( $id )->get_stock_quantity(), 2 );
eq(
	'a missing product is named generically',
	$increase(
		array(
			'id'       => 999999,
			'quantity' => 1,
		)
	),
	array( 404, 'Product not found' )
);
eq(
	'a valid quantity still restocks',
	array(
		$increase(
			array(
				'id'       => $id,
				'quantity' => 3,
			)
		),
		wc_get_product( $id )->get_stock_quantity(),
	),
	array( array( 200, 5 ), 5 )
);
eq(
	'the restock action refuses a negative quantity before Woo sees it',
	$site->call(
		'POST',
		'/actions/restock',
		array(
			'drive'    => $id,
			'quantity' => -3,
		),
		as: 'admin'
	)[0],
	422
);

// Scoped credentials over real HTTP: what an agent is offered matches what it may run.
[$password, $item] = WP_Application_Passwords::create_new_application_password( $site->userId( 'admin' ), array( 'name' => 'Drive Store test agent' ) );
$scope             = static fn ( array $scope ) => \SpacePress\Wp\AgentScope::store( $site->userId( 'admin' ), $item['uuid'], $scope );
$request           = static function ( string $path, ?array $body = null, array $headers = array() ) use ( $url, $password ): array {
	$ch       = curl_init( $url . $path );
	$answered = array();
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 60,
			CURLOPT_CUSTOMREQUEST  => null === $body ? 'GET' : 'POST',
			CURLOPT_HTTPHEADER     => array( 'Authorization: Basic ' . base64_encode( 'admin:' . $password ), 'Content-Type: application/json', 'Accept: application/json, text/event-stream', ...$headers ),
			CURLOPT_HEADERFUNCTION => static function (
				$ch,
				string $line
			) use ( &$answered ): int {
					$parts = explode(
						':',
						$line,
						2
					);
				if ( count( $parts ) === 2 ) {
						$answered[ strtolower( trim( $parts[0] ) ) ] = trim( $parts[1] );
				} return strlen( $line );
			},
		)
	);
	if ( null !== $body ) {
		curl_setopt( $ch, CURLOPT_POSTFIELDS, json_encode( $body ) ); }
	$text = curl_exec( $ch );
	return array( (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE ), json_decode( (string) $text, true ), $answered );
};
/** One JSON-RPC call on an MCP server of the site, in a session of its own: the status and the result. */
$mcp = static function ( string $server, string $method, array|object $params ) use ( $request ): array {
	$session = $request(
		"/wp-json/mcp/$server",
		array(
			'jsonrpc' => '2.0',
			'id'      => 1,
			'method'  => 'initialize',
			'params'  => array(
				'protocolVersion' => '2025-11-25',
				'capabilities'    => new stdClass(),
				'clientInfo'      => array(
					'name'    => 'Drive Store test',
					'version' => '1',
				),
			),
		)
	);
	$answer  = $request(
		"/wp-json/mcp/$server",
		array(
			'jsonrpc' => '2.0',
			'id'      => 2,
			'method'  => $method,
			'params'  => $params,
		),
		array( 'Mcp-Session-Id: ' . ( $session[2]['mcp-session-id'] ?? '' ), 'Mcp-Protocol-Version: 2025-11-25' )
	);
	return array( $answer[0], $answer[1] );
};
/** What one tool of the default MCP server answers: whether it is an error, and its data. */
$adapter = static function ( string $tool, array|object $arguments ) use ( $mcp ): array {
	[, $answer] = $mcp(
		'mcp-adapter-default-server',
		'tools/call',
		array(
			'name'      => $tool,
			'arguments' => $arguments,
		)
	);
	$result     = $answer['result'] ?? array();
	$data       = $result['structuredContent'] ?? json_decode( (string) ( $result['content'][0]['text'] ?? 'null' ), true );
	return array( isset( $answer['error'] ) || ( $result['isError'] ?? false ) || isset( $data['error'] ), $data, $answer );
};
// The abilities this app registers for agents that a listing may or may not show, in every place one is listed.
$orderAbilities = array( 'drive-store/mark-shipped', 'drive-store/orders-get', 'drive-store/orders-list', 'drive-store/pending-orders' );
$openAbilities  = array( 'drive-store/drives-list', 'drive-store/restock' );
$shown          = static function ( array $names ) use ( $orderAbilities, $openAbilities ): array {
	$names = array_values( array_intersect( array( ...$orderAbilities, ...$openAbilities ), $names ) );
	sort( $names );
	return $names;
};
$tools          = static function () use ( $mcp, $shown ): array {
	[$status, $list] = $mcp( 'spacepress-drive-store', 'tools/list', new stdClass() );
	// The adapter names a tool after its ability, with the slash as a hyphen.
	return array( $status, array_map( static fn ( string $name ) => str_replace( 'drive-store/', 'drive-store-', $name ), $shown( array_map( static fn ( string $tool ) => preg_replace( '/^drive-store-/', 'drive-store/', $tool ), array_column( $list['result']['tools'] ?? array(), 'name' ) ) ) ) );
};
/** Core's abilities list, every page of it: the app's names, and whether any WooCommerce ability is in it. */
$listed = static function () use ( $request, $shown ): array {
	$names = array();
	for ( $page = 1, $pages = 1; $page <= $pages; $page++ ) {
		$answer = $request( "/wp-json/wp-abilities/v1/abilities?per_page=100&page=$page" );
		if ( 200 !== $answer[0] ) {
			return array( $answer[0], array(), false ); }
		$pages = (int) ( $answer[2]['x-wp-totalpages'] ?? 1 );
		array_push( $names, ...array_column( $answer[1], 'name' ) );
	}
	return array( 200, $shown( $names ), array_filter( $names, static fn ( string $name ) => str_starts_with( $name, 'woocommerce/' ) ) !== array() );
};
/** Each ability's own description route: the status per name. */
$described = static fn ( array $names ): array => array_map( static fn ( string $name ) => $request( "/wp-json/wp-abilities/v1/abilities/$name" )[0], array_combine( $names, $names ) );
/** The default MCP server's discovery tool: the app's names, and whether any WooCommerce ability is in it. */
$discovered = static function () use ( $adapter, $shown ): array {
	[$error, $data, $answer] = $adapter( 'mcp-adapter-discover-abilities', new stdClass() );
	$names                   = array_column( $data['abilities'] ?? array(), 'name' );
	return array( $error ? $answer : false, $shown( $names ), array_filter( $names, static fn ( string $name ) => str_starts_with( $name, 'woocommerce/' ) ) !== array() );
};
/** The default MCP server's description of one ability: the name it described, or null when it refused. */
$info = static function ( string $name ) use ( $adapter ): ?string {
	[$error, $data] = $adapter( 'mcp-adapter-get-ability-info', array( 'ability_name' => $name ) );
	return $error ? null : ( $data['name'] ?? null );
};
// A readonly action runs over GET and takes no input here; the others take theirs as JSON.
$run = static fn ( string $ability, ?array $input = null ) => $request( "/wp-json/wp-abilities/v1/abilities/drive-store/$ability/run", null === $input ? null : array( 'input' => $input ) );
// A kind's list ability is readonly too, and takes its input in the query string.
$list = static fn ( string $ability ) => $request( "/wp-json/wp-abilities/v1/abilities/drive-store/$ability/run?input%5Blimit%5D=1" );
// The server is another process: read Woo's stock past this one's object cache.
$stock = static function () use ( $id ): ?int {
	clean_post_cache( $id );
	return wc_get_product( $id )->get_stock_quantity();
};
$scope(
	array(
		'write'     => true,
		'personal'  => false,
		'abilities' => null,
	)
);
eq( 'without the personal grant an agent is offered restocking, and no tool that reads or completes orders', $tools(), array( 200, array( 'drive-store-drives-list', 'drive-store-restock' ) ) );
eq( 'the order tools it is not offered are refused when called', array( $run( 'pending-orders' )[0], $run( 'mark-shipped', array( 'order' => $orderId ) )[0], $list( 'orders-list' )[0] ), array( 403, 403, 403 ) );
eq( 'and what it is offered runs', $list( 'drives-list' )[0], 200 );
// Every other place abilities are listed or described leaves out the same ones.
eq( 'core\'s abilities list leaves them out too, and WooCommerce\'s own', $listed(), array( 200, $openAbilities, false ) );
eq( 'each one\'s description is refused, and the others answer', $described( array( ...$orderAbilities, ...$openAbilities ) ), array_fill_keys( $orderAbilities, 403 ) + array_fill_keys( $openAbilities, 200 ) );
eq( 'the default MCP server\'s discover-abilities leaves them out too', $discovered(), array( false, $openAbilities, false ) );
eq( 'and its get-ability-info describes none of them', array_map( $info, array( ...$orderAbilities, 'drive-store/restock' ) ), array( null, null, null, null, 'drive-store/restock' ) );
$scope(
	array(
		'write'     => true,
		'personal'  => true,
		'abilities' => null,
	)
);
$every = array( ...$openAbilities, ...$orderAbilities );
sort( $every );
eq( 'with the personal grant the order tools are offered', $tools(), array( 200, array( 'drive-store-drives-list', 'drive-store-mark-shipped', 'drive-store-orders-get', 'drive-store-orders-list', 'drive-store-pending-orders', 'drive-store-restock' ) ) );
eq( 'and run', array( $run( 'pending-orders' )[0], $list( 'orders-list' )[0] ), array( 200, 200 ) );
eq( 'core\'s abilities list shows them, and still none of WooCommerce\'s own', $listed(), array( 200, $every, false ) );
eq( 'each one is described', $described( $every ), array_fill_keys( $every, 200 ) );
eq( 'discover-abilities shows them', $discovered(), array( false, $every, false ) );
eq( 'and get-ability-info describes them', array_map( $info, $orderAbilities ), $orderAbilities );
// An action's abilities.call() is judged as the credential: the inner ability belongs on its list too.
$scope(
	array(
		'write'     => true,
		'personal'  => false,
		'abilities' => array( 'drive-store/restock' ),
	)
);
$refused = $run(
	'restock',
	array(
		'drive'    => $id,
		'quantity' => 1,
	)
);
eq( 'a credential limited to the restock action is refused the ability the action calls', $refused[0], 403 );
check( 'and the refusal names that ability', str_contains( (string) ( $refused[1]['message'] ?? '' ), '`drive-store/increase-product-stock`' ), $refused[1] );
eq( 'a refused restock changes no stock', $stock(), 5 );
$scope(
	array(
		'write'     => true,
		'personal'  => false,
		'abilities' => array( 'drive-store/restock', 'drive-store/increase-product-stock' ),
	)
);
$allowed = $run(
	'restock',
	array(
		'drive'    => $id,
		'quantity' => 1,
	)
);
eq( 'listing both lets the action restock', array( $allowed[0], $allowed[1]['stock'] ?? null, $stock() ), array( 200, 6, 6 ) );
$log = $site->debugLog();
check( 'the Drive Store runs without PHP warnings or fatal errors', ! preg_match( '/PHP (Warning|Fatal error):/', $log ), $log );

$profile?->save();
finish( 'drive_store' );
