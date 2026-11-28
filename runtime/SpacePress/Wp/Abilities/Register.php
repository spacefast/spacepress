<?php

declare(strict_types=1);

namespace SpacePress\Wp\Abilities;

use SpacePress\Abilities\Module;
use SpacePress\Access;
use SpacePress\Extensions;
use SpacePress\HttpError;
use SpacePress\Schema;
use SpacePress\Wp\Runtime;

/**
 * Every API operation of the active app as a core WordPress Ability `<app>/<kebab-name>` (§7.1),
 * plus the app's named MCP server. Descriptors are built once per request from schema.php:
 *   name, op, label, description, input, output, annotations, agents, first (meta),
 *   rule [rule, op, what], data? (input → rule data), defer? (rule needs the pipeline),
 *   call (input → [method, path, query, body]) and result? (data → output), or run (input → output).
 * A post kind with revisions also gets one ability per staged-version step ({@see staged()}).
 * `agents: false` keeps the ability registered (PHP, `wp spacepress run`) but out of core REST
 * discovery and MCP; core's run route still serves an operation of the app's own schema to its typed
 * client ({@see running()}).
 */
final class Register {

	/** @var ?list<array> */
	private static ?array $operations = null;
	/** @var array<string, true> */
	private static array $names        = array();
	private static ?string $sanitizing = null;
	private static ?string $method     = null;
	private static ?string $untyped    = null;
	/** The REST run endpoint's JSON `input`, decoded with `{}` kept: [ability name, input]. */
	private static ?array $raw = null;
	/**
	 * @var array{string, array<string, string>}|null the run request's ability and its headers an
	 * operation reads (Idempotency-Key, SpacePress-Signature): they belong to that one run, not to abilities
	 * its code calls in turn.
	 */
	private static ?array $headers = null;
	/** @var array<string, string> headers the operation answered with, for the run response */
	private static array $responded = array();

	public static function categories(): void {
		$schema = self::schema();
		if ( null !== $schema ) {
			wp_register_ability_category(
				self::kebab( $schema->name() ),
				array(
					'label'       => self::app_label( $schema ),
					'description' => 'Operations of the ' . self::app_label( $schema ) . ' app, built with SpacePress.',
				)
			);
		}
	}

	public static function abilities(): void {
		foreach ( self::operations() as $op ) {
			wp_register_ability( $op['name'], self::args( $op ) );
		}
	}

	/** mcp_adapter_init: the app's own server, every agent-visible ability as a named tool. */
	public static function mcp( object $adapter ): void {
		$schema = self::schema();
		// Not on SpacePress's API, which never serves `/mcp` (see Module::register).
		if ( null === $schema || \SpacePress\Wp\Facade::path() !== null ) {
			return;
		}
		$id    = 'spacepress-' . self::kebab( $schema->name() );
		$tools = array_values( array_map( static fn ( array $op ): string => $op['name'], array_filter( self::operations(), static fn ( array $op ): bool => $op['agents'] ) ) );
		$adapter->create_server(
			$id,
			'mcp',
			$id,
			self::app_label( $schema ),
			'SpacePress app ' . $schema->name(),
			Runtime::VERSION,
			array( \WP\MCP\Transport\HttpTransport::class ),
			\WP\MCP\Infrastructure\ErrorHandling\ErrorLogMcpErrorHandler::class,
			null,
			$tools
		);
	}

	/** @return list<array> the descriptors of the active app */
	public static function operations(): array {
		$schema = self::schema();
		if ( null === $schema ) {
			return array();
		}
		if ( null === self::$operations ) {
			self::$operations = self::build( $schema );
			self::$names      = array_fill_keys( array_column( self::$operations, 'name' ), true );
		}

		return self::$operations;
	}

	/**
	 * wp_ability_validate_input: SpacePress's pipeline is the one validator of its abilities, so a bad
	 * input gets REST's 422 problem and pointer instead of core's generic 400. While the REST run
	 * endpoint sanitizes its `input` argument, core sanitizes only what validates: query-string
	 * input (GET/DELETE) is then typed by core's own check, as a query string must be, and JSON
	 * input (POST) is declared invalid so core passes it through byte-for-byte to SpacePress.
	 */
	public static function validate( mixed $valid, mixed $input, string $name ): mixed {
		self::operations();
		if ( ! isset( self::$names[ $name ] ) ) {
			return $valid;
		}

		if ( in_array( self::$sanitizing, array( 'GET', 'DELETE' ), true ) && ! self::$typed_query ) {
			// Core sanitizes (types) a query string only when all of it validates; remember which.
			self::$untyped = true === $valid ? null : ( $valid instanceof \WP_Error ? $valid->get_error_message() : 'Invalid input' );
		}

		return match ( true ) {
			null === self::$sanitizing => true,
			in_array( self::$sanitizing, array( 'GET', 'DELETE' ), true ) && ! self::$typed_query => $valid,
			default => new \WP_Error( 'sp_raw_input', 'SpacePress validates JSON input itself' ),
		};
	}

	/** Records why this request's query-string input was left untyped (null: it was typed). */
	public static function untyped( ?string $reason ): void {
		self::$untyped = $reason;
	}

	/** Why core left this request's query-string input untyped, or null when it typed it. */
	public static function untypedReason(): ?string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return self::$untyped;
	}

	/**
	 * rest_pre_dispatch (before {@see startSanitizing()}): a GET or DELETE run of one of the app's
	 * abilities may carry its input as JSON, `?input={"limit":5,"where":{…}}` (what the typed client
	 * sends), as well as in core's bracketed form (`input[limit]=5`, what `wp.url` builds).
	 *
	 * A kind's read (`-list`, `-get`) is decoded into the bracketed form's shape, with `where`, `with`
	 * and `orderBy` as the strings the list query takes, so core and the pipeline read both forms the
	 * same way. Any other ability (a readonly action, a revision read) takes its JSON as sent, as a
	 * POSTed run does: its values keep their types and `{}` stays an object ({@see sentInput()}).
	 */
	public static function jsonInput( mixed $result, mixed $server, \WP_REST_Request $request ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( ! empty( $result ) || ( $name = self::run_name_for_dispatch( $request ) ) === null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
			return $result;
		}
		$selected = $request->get_param( 'name' );
		if ( null !== $selected && $selected !== $name ) {
			return self::wrong_run_name();
		}
		self::$stack[]     = array( $request, self::state() );
		self::$typed_query = false;
		self::$queried     = null;
		if ( ! in_array( $request->get_method(), array( 'GET', 'HEAD', 'DELETE' ), true ) ) {
			return $result;
		}
		$query = $request->get_query_params();
		if ( ! is_string( $query['input'] ?? null ) || ! str_starts_with( ltrim( $query['input'] ), '{' ) ) {
			return $result;
		}
		$op = null;
		foreach ( self::operations() as $candidate ) {
			if ( $candidate['name'] === $name ) {
				$op = $candidate;
				break;
			}
		}
		$input = json_decode( $query['input'], true );
		if ( null === $op || ! is_array( $input ) ) {
			return $result;
		}
		if ( ( $op['shape']['type'] ?? null ) !== 'query' ) {
			try {
				$sent = \SpacePress\Js::decodeJson( $query['input'] );
			} catch ( \JsonException ) {
				return $result;
			}
			self::$typed_query = true;
			self::$queried     = array( $name, $sent );
			$query['input']    = $input;
			$request->set_query_params( $query );

			return $result;
		}
		// `where` and `with` as the JSON strings the list query takes, from the input as sent, so an
		// empty object operand (`{ meta: { eq: {} } }`) stays `{}` and doesn't become `[]`.
		try {
			$sent = \SpacePress\Js::decodeJson( $query['input'] );
		} catch ( \JsonException ) {
			return $result;
		}
		foreach ( array( 'where', 'with' ) as $key ) {
			if ( is_array( $input[ $key ] ?? null ) && $sent instanceof \SpacePress\JsObject && array_key_exists( $key, $sent->p ) ) {
				$input[ $key ] = (string) \SpacePress\Js::jsonStringify( $sent->p[ $key ] );
			}
		}
		if ( is_array( $input['orderBy'] ?? null ) ) {
			$input['orderBy'] = implode( ',', array_map( static fn ( $col, $dir ): string => ( 'desc' === $dir ? '-' : '' ) . $col, array_keys( $input['orderBy'] ), $input['orderBy'] ) );
		}
		// Scalars as a query string carries them: core types them by the ability's schema.
		array_walk_recursive(
			$input,
			static function ( mixed &$v ): void {
				$v = is_bool( $v ) ? ( $v ? 'true' : 'false' ) : ( is_scalar( $v ) ? (string) $v : $v );
			}
		);
		$query['input'] = $input;
		$request->set_query_params( $query );

		return $result;
	}

	/** The ability name of a request to core's run route (`/wp-abilities/v1/abilities/<name>/run`), or null. */
	private static function runRoute( \WP_REST_Request $request ): ?string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return self::run_name( $request->get_route() );
	}

	private static function run_name( string $route ): ?string {
		// Match core's case-insensitive route and keep the ability name as captured.
		return preg_match( '#^/wp-abilities/v1/abilities/([a-z0-9/-]+?)/run$#i', $route, $m ) ? $m[1] : null;
	}

	private static function run_name_for_dispatch( \WP_REST_Request $request ): ?string {
		// These are core's run handlers, including its fallback from HEAD to GET. A method
		// miss returns before the cleanup hooks run, so only prepare requests core can match.
		return in_array( $request->get_method(), array( 'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE' ), true )
			? self::runRoute( $request ) : null;
	}

	/** rest_pre_dispatch starts the run before WordPress sanitizes its input. */
	public static function startSanitizing( mixed $passthrough, mixed $server, \WP_REST_Request $request ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( ! empty( $passthrough ) || ( $name = self::run_name_for_dispatch( $request ) ) === null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
			return $passthrough;
		}
		self::$sanitizing = $request->get_method();
		self::$method     = self::$sanitizing;
		self::$untyped    = null;
		self::$responded  = array();
		self::$run_route  = ! \SpacePress\Wp\Facade::dispatching() && self::client_operation( $name ) ? $name : null;
		$headers          = array();
		foreach ( $request->get_headers() as $key => $values ) {
			$headers[ str_replace( '_', '-', strtolower( (string) $key ) ) ] = implode( ', ', (array) $values );
		}
		self::$headers = array( $name, $headers );
		self::$raw     = self::raw_input( $request ) ?? self::$queried;
		self::$queried = null;

		return $passthrough;
	}

	/**
	 * Core decodes a POSTed run body associatively, so `{}` in a json() value reaches the ability as
	 * `[]`. SpacePress declares its JSON input invalid during sanitizing, so core passes the body through
	 * as sent: the same input, decoded again with `{}` kept, is what the ability runs on.
	 */
	private static function raw_input( \WP_REST_Request $request ): ?array {
		if ( $request->get_method() !== 'POST' || ( $ran = self::runRoute( $request ) ) === null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
			return null;
		}
		try {
			$body = \SpacePress\Js::decodeJson( (string) $request->get_body() );
		} catch ( \JsonException ) {
			return null;
		}

		return $body instanceof \SpacePress\JsObject && array_key_exists( 'input', $body->p ) ? array( $ran, $body->p['input'] ) : null;
	}

	/**
	 * Run $fn with $json (a raw JSON object) as ability $name's input as sent, so `{}` inside a json()
	 * value survives the array core hands to the ability (the facade's actions).
	 */
	public static function withSentInput( string $name, string $json, callable $fn ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, Universal.NamingConventions.NoReservedKeywordParameterNames.fnFound -- Preserve the existing PHP method name. Preserve the existing PHP parameter name.
		$previous = self::$given;
		try {
			$decoded = trim( $json ) === '' ? new \SpacePress\JsObject() : \SpacePress\Js::decodeJson( $json );
		} catch ( \JsonException ) {
			$decoded = null;
		}
		self::$given = null === $decoded ? null : array( $name, $decoded );
		try {
			return $fn();
		} finally {
			self::$given = $previous;
		}
	}

	/** The executing ability's input as sent: the facade's own ({@see withSentInput()}), else the run request's. */
	public static function sentInput( string $name, mixed $input ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		foreach ( array( self::$given, self::$raw ) as $sent ) {
			if ( null !== $sent && $sent[0] === $name ) {
				return $sent[1];
			}
		}

		return $input;
	}

	/** @var array{string, mixed}|null the facade's input as sent for one ability it runs ({@see withSentInput()}) */
	private static ?array $given = null;
	/** @var array{string, mixed}|null a GET/DELETE run's JSON query input, for the request {@see startSanitizing()} starts next */
	private static ?array $queried = null;

	/** rest_post_dispatch: the request that carried the input is over; its operation's headers go out with it. */
	public static function dispatched( mixed $response, mixed $server = null, mixed $request = null ): mixed {
		if ( $response instanceof \WP_REST_Response ) {
			foreach ( self::$responded as $name => $value ) {
				$response->header( $name, $value );
			}
			// A run of the app's own ability answers for whoever asks, as the app API does: never a
			// shared copy (Batcache keeps what a request without a WordPress cookie prints otherwise).
			if ( $request instanceof \WP_REST_Request && ( $name = self::runRoute( $request ) ) !== null && self::client_operation( $name ) ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
				$response->header( 'Cache-Control', 'private, no-store' );
				$response->header( 'Vary', 'Origin, Cookie, Authorization' );
				if ( function_exists( 'batcache_cancel' ) ) {
					batcache_cancel();
				}
			}
		}
		self::restore( $request );

		return $response;
	}

	/**
	 * @var list<array{\WP_REST_Request, array}> the requests being dispatched, innermost last, each with
	 * the state of the request it interrupted
	 */
	private static array $stack = array();

	/** @return array this request's state, as {@see restore()} puts it back */
	private static function state(): array {
		return array( self::$sanitizing, self::$method, self::$untyped, self::$raw, self::$headers, self::$responded, self::$run_route, self::$typed_query, self::$queried );
	}

	/**
	 * An ordinary REST request gets its own state once its route matches. A route miss leaves
	 * the enclosing Ability run's state in place.
	 */
	public static function beginCallbacks( mixed $response, mixed $handler, \WP_REST_Request $request ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( self::runRoute( $request ) === null && array() !== self::$stack ) {
			self::$stack[]     = array( $request, self::state() );
			self::$method      = self::$untyped = self::$run_route = null; // phpcs:ignore Squiz.PHP.DisallowMultipleAssignments.Found -- Keep the assignment and its test together.
			self::$raw         = self::$headers = self::$queried = null; // phpcs:ignore Squiz.PHP.DisallowMultipleAssignments.Found -- Keep the assignment and its test together.
			self::$responded   = array();
			self::$typed_query = false;
		}
		self::$sanitizing = null;

		return $response;
	}

	public static function discardShortCircuit( mixed $response, mixed $server, \WP_REST_Request $request ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( ! empty( $response ) ) {
			self::restore( $request );
		}

		return $response;
	}

	public static function beforePermission( mixed $response, mixed $handler, \WP_REST_Request $request ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return self::beforeExecute( $response, $request );
	}

	public static function beforeExecute( mixed $response, \WP_REST_Request $request ): mixed { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		self::resume( $request );
		// The run controller reads the merged name. Route-scoped credentials and visibility use
		// the path, so permission checks and execution must use the same name.
		$name = self::runRoute( $request );

		return ! is_wp_error( $response ) && null !== $name && $request->get_param( 'name' ) !== $name
			? self::wrong_run_name() : $response;
	}

	private static function wrong_run_name(): \WP_Error {
		return new \WP_Error( 'rest_ability_not_found', 'Ability not found.', array( 'status' => 404 ) );
	}

	/** Drop frames left by a nested dispatch that returned before its callbacks ran. */
	private static function resume( \WP_REST_Request $request ): void {
		$count = count( self::$stack );
		for ( $i = $count - 1; $i >= 0; $i-- ) {
			if ( self::$stack[ $i ][0] === $request ) {
				if ( $i < $count - 1 ) {
					// The frame above holds this request's state as the first abandoned request saved it.
					[self::$sanitizing, self::$method, self::$untyped, self::$raw, self::$headers, self::$responded, self::$run_route, self::$typed_query, self::$queried] = self::$stack[ $i + 1 ][1];
					array_splice( self::$stack, $i + 1 );
				}

				return;
			}
		}
	}

	/** Restore the enclosing request's state when the current request finishes. */
	private static function restore( mixed $request ): void {
		for ( $i = count( self::$stack ) - 1; $i >= 0; $i-- ) {
			if ( self::$stack[ $i ][0] === $request ) {
				[self::$sanitizing, self::$method, self::$untyped, self::$raw, self::$headers, self::$responded, self::$run_route, self::$typed_query, self::$queried] = self::$stack[ $i ][1];
				array_splice( self::$stack, $i );

				return;
			}
		}
	}

	/**
	 * rest_request_after_callbacks: the operation's own headers (`Idempotent-Replayed`) on its
	 * response. Core's run route stamps 401/403 over any error a permission check returns; one of
	 * SpacePress's own (`sp_*`: 503 while storage is behind, a scope refusal) keeps the status and
	 * pointer it was made with.
	 */
	public static function answered( mixed $response, mixed $handler = null, mixed $request = null ): mixed {
		// An ability that answers null (signed-out `me`, an action that returns nothing) is a 204:
		// core would send 200 with an empty body, which is not JSON to a client that parses it.
		if ( $response instanceof \WP_REST_Response && $response->get_data() === null && $response->get_status() === 200
			&& $request instanceof \WP_REST_Request && ( $name = self::runRoute( $request ) ) !== null && isset( self::$names[ $name ] ) ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
			$response->set_status( 204 );
		}
		if ( $response instanceof \WP_Error && str_starts_with( (string) $response->get_error_code(), 'sp_' ) ) {
			$data = $response->get_all_error_data();
			if ( count( $data ) > 1 && is_array( $data[0] ) && isset( $data[0]['status'] ) ) {
				$response->add_data( $data[0] );
			}
		}
		if ( $response instanceof \WP_REST_Response ) {
			foreach ( self::$responded as $name => $value ) {
				$response->header( $name, $value );
			}
		}
		self::$responded = array();
		// An internal dispatch skips rest_post_dispatch: its state ends with its callbacks.
		self::restore( $request );

		return $response;
	}

	/**
	 * The run request's headers, lower-cased, for ability $name's own run, once: an ability that code
	 * inside it executes (`wp_get_ability()->execute()`) sees none, so an Idempotency-Key sent for the
	 * outer run never keys an inner one.
	 *
	 * @return array<string, string>
	 */
	public static function headers( string $name ): array {
		if ( null === self::$headers || self::$headers[0] !== $name ) {
			return array();
		}
		$headers       = self::$headers[1];
		self::$headers = null;

		return $headers;
	}

	/** The operation's own response headers (`Idempotent-Replayed`), for the run response. */
	public static function responded( array $headers ): void {
		self::$responded = array_filter( $headers, static fn ( $v, $k ): bool => is_string( $v ) && strcasecmp( (string) $k, 'Content-Type' ) !== 0, ARRAY_FILTER_USE_BOTH );
	}

	/**
	 * Whether the executing ability's input arrived as a query string (core's GET/DELETE run), whose
	 * values core types. JSON input in the query of a non-query ability is read as sent instead.
	 */
	public static function queryString(): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return in_array( self::$method, array( 'GET', 'DELETE' ), true ) && ! self::$typed_query;
	}

	/** This run's query carries an ability's JSON input as sent ({@see jsonInput()}). */
	private static bool $typed_query = false;

	/**
	 * One of the app's abilities core's run route is serving in this request, as {@see startSanitizing()}
	 * recorded it: an operation of the app's own schema, which its typed client calls even when it is
	 * `agents: false`. One a feature or plugin adds (`sp_ability_operations`: WooCommerce's stock and
	 * order steps) is not: hidden from agents, it has no HTTP route either.
	 */
	public static function running(): ?string {
		return self::$run_route;
	}

	private static function client_operation( string $name ): bool {
		self::operations();

		return isset( self::$client[ $name ] );
	}

	/** sp_identity_rest_cookie_route: core's run route of an operation the app's schema declares. */
	public static function cookieRoute( mixed $allowed, mixed $route ): bool { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		if ( $allowed || ! is_string( $route ) || ( $name = self::run_name( $route ) ) === null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
			return (bool) $allowed;
		}

		return self::client_operation( $name );
	}

	/** @var array<string, true> the operations the app's schema declares, by ability name */
	private static array $client = array();

	private static ?string $run_route = null;

	/** Public view of one descriptor: what core receives, minus callbacks. */
	public static function describe( array $op ): array {
		$args = self::args( $op );
		unset( $args['execute_callback'], $args['permission_callback'], $args['ability_class'] );

		return array( 'name' => $op['name'] ) + $args;
	}

	/** The Rust compiler's kebab-case (`shopping_list` → `shopping-list`, `approveComment` → `approve-comment`). */
	public static function kebab( string $name ): string {
		$chars = preg_split( '//u', $name, -1, PREG_SPLIT_NO_EMPTY ) ?: array(); // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
		$out   = '';
		foreach ( $chars as $i => $c ) {
			if ( '_' === $c || '-' === $c ) {
				if ( ! str_ends_with( $out, '-' ) ) {
					$out .= '-';
				}
				continue;
			}
			$prev = $chars[ $i - 1 ] ?? '';
			$next = $chars[ $i + 1 ] ?? '';
			if ( self::upper( $c ) && $i > 0 && ! str_ends_with( $out, '-' )
				&& ( self::lower( $prev ) || ctype_digit( $prev ) || self::lower( $next ) ) ) {
				$out .= '-';
			}
			$out .= mb_strtolower( $c, 'UTF-8' );
		}

		return $out;
	}

	// ================================================================ descriptors

	private static function build( Schema $schema ): array {
		$app   = self::kebab( $schema->name() );
		$label = self::app_label( $schema );
		$ops   = array();
		foreach ( $schema->kinds() as $name => $spec ) {
			array_push( $ops, ...self::collection( $app, $label, (string) $name, $spec, $schema->locales()['all'] ?? array() ) );
		}
		foreach ( $schema->actions() as $name => $action ) {
			$ops[] = self::action( $app, $label, (string) $name, $action );
		}
		foreach ( $schema->globals() as $name => $global ) {
			array_push( $ops, ...self::global( $app, $label, (string) $name, $global ) );
		}
		array_push( $ops, ...self::media( $app, $label ) );
		// What the app's schema declares: the operations its typed client runs ({@see running()}).
		self::$client = array_fill_keys( array_column( $ops, 'name' ), true );
		// Features add their own operations here (runtime schema changes: SpacePress\RuntimeSchema\Surfaces).
		$ops = apply_filters( 'sp_ability_operations', $ops, $app );
		if ( ( $enqueue = Module::enqueuer() ) !== null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
			foreach ( $schema->jobs() as $name => $job ) {
				if ( $job['agents'] ?? false ) {
					$ops[] = self::job( $app, $label, (string) $name, $job, $enqueue );
				}
			}
		}

		foreach ( $ops as &$op ) {
			$first = $op['spacepress'] ?? array();
			if ( isset( $first['action'] ) ) {
				$op['shape'] = $schema->action( $first['action'] )['input'] ?? array();
			} elseif ( isset( $first['job'] ) ) {
				$op['shape'] = $schema->jobs()[ $first['job'] ]['input'] ?? array();
			} elseif ( isset( $first['global'] ) ) {
				$op['shape'] = 'update' === $op['op'] ? $schema->global( $first['global'] )['fields'] : array();
			} elseif ( isset( $first['collection'] ) && $schema->hasCollection( $first['collection'] ) ) {
				$collection  = $first['collection'];
				$columns     = $schema->collection( $collection )['columns'];
				$op['shape'] = match ( $op['op'] ) {
					'create' => $columns,
					'update', 'stage' => array(
						'id'    => null,
						'patch' => $columns,
					),
					'sync-apply', 'sync-trash', 'sync-read' => array(
						'type'       => 'sync',
						'collection' => $collection,
					),
					default => array(
						'type'       => 'query',
						'collection' => $collection,
					),
				};
			} else {
				$op['shape'] = array();
			}
			$op['bodyShape'] = 'update' === $op['op'] && isset( $first['collection'] ) ? ( $op['shape']['patch'] ?? array() ) : $op['shape'];
		}
		unset( $op );

		return $ops;
	}

	/** @return list<array> */
	/** @param list<string> $locales */
	private static function collection( string $app, string $app_label, string $name, array $spec, array $locales ): array {
		$k         = self::kebab( $name );
		$agents    = (bool) ( $spec['agents'] ?? true );
		$rules     = Access::collectionRules( $spec );
		$row       = JsonSchema::row( $spec );
		$pk        = 'integer' === $spec['columns'][ $spec['primaryKey'] ]['type'] ? array( 'type' => 'integer' ) : array( 'type' => 'string' );
		$localized = (bool) ( $spec['localized'] ?? false );
		// A read's `locale`: one of the app's, or `*` for every row.
		$locale = $localized ? array(
			'locale' => array(
				'type' => 'string',
				'enum' => array( ...$locales, '*' ),
			),
		) : array();
		// Virtual create inputs other features consume before column validation (§6.2, §7.3).
		$virtual = ( $localized ? array( 'translationOf' => $pk ) : array() ) + ( ( $spec['auth'] ?? false ) ? array( 'password' => array( 'type' => 'string' ) ) : array() );
		$with    = ( $spec['relations'] ?? array() ) !== array() || self::has_media( $spec ) ? array( 'with' => JsonSchema::with( $spec ) ) : array();
		$item    = static fn ( string $suffix = '' ): \Closure => static fn ( array $in ): string => "/$name/" . Invoke::id( $in ) . $suffix;
		$base    = array(
			'agents'     => $agents,
			'spacepress' => array( 'collection' => $name ),
		);
		$api     = $spec['api'] ?? array();
		$ops     = array();
		$columns = array_values( array_map( 'strval', array_keys( array_filter( $spec['columns'], static fn ( array $c ): bool => ! ( $c['hidden'] ?? false ) ) ) ) );

		// Post kinds with staged versions take `_rev` and `takeover`; SQL tables with revisions take `_rev`.
		$guard = \SpacePress\Wp\Staged::enabled( $spec )
			? array(
				\SpacePress\Wp\Rev::FIELD    => array( 'type' => 'string' ),
				\SpacePress\Wp\Rev::TAKEOVER => array( 'type' => 'boolean' ),
			)
			: ( \SpacePress\Wp\Rev::enabled( $spec ) ? array( \SpacePress\Wp\Rev::FIELD => array( 'type' => 'string' ) ) : array() );
		if ( array() !== $guard ) {
			$row['properties'][ \SpacePress\Wp\Rev::FIELD ] = array( 'type' => 'string' );
		}
		if ( $api['list'] ?? true ) {
			$ops[] = $base + array(
				'name'        => "$app/$k-list",
				'op'          => 'list',
				'label'       => "List $name",
				'description' => "List $name of the $app_label app, filtered, ordered and paged like GET /$name.",
				'input'       => JsonSchema::input(
					array(
						'where'   => JsonSchema::where( $spec ),
						'orderBy' => JsonSchema::orderBy( $columns ),
						'limit'   => array(
							'type'    => 'integer',
							'minimum' => 0,
						),
						'offset'  => array(
							'type'    => 'integer',
							'minimum' => 0,
						),
					) + $with + $locale
				),
				'output'      => array(
					'type'       => 'object',
					'properties' => array(
						'rows' => array(
							'type'  => 'array',
							'items' => $row,
						),
					),
					'required'   => array( 'rows' ),
				),
				'annotations' => array(
					'readonly'   => true,
					'idempotent' => true,
				),
				'rule'        => array( $rules['read'], 'read', "read $name" ),
				'defer'       => true,
				'call'        => static fn ( array $in ): array => array( 'GET', "/$name", Invoke::listQuery( $in ), null ),
				'result'      => static fn ( array $rows ): array => array( 'rows' => $rows ),
			) + ( array() === $guard ? array() : array( 'guard' => true ) );
		}
		if ( $api['get'] ?? true ) {
			$ops[] = $base + array(
				'name'        => "$app/$k-get",
				'op'          => 'get',
				'label'       => "Get one of $name",
				'description' => "Get one $name row of the $app_label app by {$spec['primaryKey']}.",
				'input'       => JsonSchema::input( array( 'id' => $pk ) + $with + $locale, array( 'id' ) ),
				'output'      => $row,
				'annotations' => array(
					'readonly'   => true,
					'idempotent' => true,
				),
				'rule'        => array( $rules['read'], 'read', "read $name" ),
				'defer'       => true,
				'call'        => static fn ( array $in ): array => array( 'GET', $item()( $in ), Invoke::listQuery( array_diff_key( $in, array( 'id' => 1 ) ) ), null ),
			) + ( array() === $guard ? array() : array( 'guard' => true ) );
		}
		if ( $api['create'] ?? true ) {
			$ops[] = $base + array(
				'name'        => "$app/$k-create",
				'op'          => 'create',
				'label'       => "Create in $name",
				'description' => "Create one $name row in the $app_label app; the input is the row.",
				'input'       => JsonSchema::insert( $spec, $virtual ),
				'output'      => $row,
				'annotations' => array(),
				'rule'        => array( $rules['create'], 'create', "create $name rows" ),
				'defer'       => true,
				'call'        => static fn ( array $in ): array => array( 'POST', "/$name", array(), $in ),
				// The new row carries its `_rev`, as the API's create answers.
			) + ( array() === $guard ? array() : array( 'guard' => true ) );
		}
		if ( $api['update'] ?? true ) {
			$ops[] = $base + array(
				'name'        => "$app/$k-update",
				'op'          => 'update',
				'label'       => "Update in $name",
				'description' => "Update one $name row of the $app_label app: the given fields of `patch` change, the rest stay."
						. ( array() === $guard ? '' : ' Send the `_rev` of your read to refuse the update if the row changed since.' ),
				'input'       => JsonSchema::input(
					array(
						'id'    => $pk,
						'patch' => JsonSchema::patch( $spec ),
					) + $guard,
					array( 'id', 'patch' )
				),
				'output'      => $row,
				'annotations' => array(),
				'rule'        => array( $rules['update'], 'update', "update $name rows" ),
				'dataShape'   => $spec['columns'],
				'data'        => static fn ( array $in ): array => Invoke::object( $in['patch'] ?? null ) ?? throw new \InvalidArgumentException( 'patch' ),
				'call'        => static fn ( array $in ): array => array( 'PATCH', $item()( $in ), array(), Invoke::object( $in['patch'] ?? false ) ?? throw HttpError::invalidInput( 'patch must be an object', '/patch' ) ),
			) + ( array() === $guard ? array() : array( 'guard' => true ) );
		}
		if ( $api['delete'] ?? true ) {
			$ops[] = $base + array(
				'name'        => "$app/$k-delete",
				'op'          => 'delete',
				'label'       => "Delete from $name",
				'description' => "Delete one $name row of the $app_label app; returns the deleted row.",
				'input'       => JsonSchema::input( array( 'id' => $pk ) + $guard, array( 'id' ) ),
				'output'      => $row,
				'annotations' => array( 'destructive' => true ),
				'rule'        => array( $rules['delete'], 'delete', "delete $name rows" ),
				'call'        => static fn ( array $in ): array => array( 'DELETE', $item()( $in ), array(), null ),
			) + ( array() === $guard ? array() : array( 'guard' => true ) );
		}
		if ( $spec['revisions'] ?? false ) {
			$ops[] = $base + array(
				'name'        => "$app/$k-revisions",
				'op'          => 'revisions',
				'label'       => "Revisions of $name",
				'description' => "List the saved revisions of one $name row of the $app_label app, newest first.",
				'input'       => JsonSchema::input( array( 'id' => $pk ), array( 'id' ) ),
				'output'      => array(
					'type'       => 'object',
					'required'   => array( 'revisions' ),
					'properties' => array(
						'revisions' => array(
							'type'  => 'array',
							'items' => array(
								'type'       => 'object',
								'properties' => array(
									'id'              => array( 'type' => 'integer' ),
									'version'         => array( 'type' => 'integer' ),
									'op'              => array( 'type' => 'string' ),
									'at'              => array(
										'type'   => 'string',
										'format' => 'date-time',
									),
									'user'            => array(
										'type'       => array( 'object', 'null' ),
										'properties' => array(
											'id'   => array( 'type' => 'integer' ),
											'name' => array( 'type' => 'string' ),
										),
									),
									'schemaMigration' => array( 'type' => array( 'string', 'null' ) ),
									'changed'         => array(
										'type'  => array( 'array', 'null' ),
										'items' => array( 'type' => 'string' ),
									),
								),
							),
						),
					),
				),
				'annotations' => array(
					'readonly'   => true,
					'idempotent' => true,
				),
				'rule'        => array( $rules['update'], 'update', "update $name rows" ),
				'call'        => static fn ( array $in ): array => array( 'GET', $item( '/revisions' )( $in ), array(), null ),
				'result'      => static fn ( array $revisions ): array => array( 'revisions' => $revisions ),
			);
		}
		if ( \SpacePress\Wp\Staged::enabled( $spec ) && ( $api['update'] ?? true ) ) {
			array_push( $ops, ...self::staged( $app, $app_label, $name, $base, $rules['update'], $row, $pk, $spec ) );
		}
		// Content sync (§5.3) rides its `/sync` routes: these exist exactly when the sync feature does.
		if ( ( $spec['sync'] ?? null ) !== null && Extensions::routeHandler( 'sync' ) !== null ) {
			// Apply is a create or an update depending on `expect`; only the sync route can tell, so it decides.
			$sync  = static fn ( string $op, string $label, string $description, array $input, array $annotations, \Closure $call, bool $defer = false ): array => $base + array(
				'name'        => "$app/$k-sync-$op",
				'op'          => "sync-$op",
				'label'       => $label,
				'description' => $description,
				'defer'       => $defer,
				'input'       => $input,
				'output'      => array(),
				'annotations' => $annotations,
				'rule'        => 'trash' === $op ? array( $rules['delete'], 'delete', "delete $name rows" ) : array( $rules['update'], 'update', "update $name rows" ),
				'call'        => $call,
			);
			$ops[] = $sync(
				'read',
				"Read $name for sync",
				"Read $name records of the $app_label app as sync records with digests, by primary key pages.",
				JsonSchema::input(
					array(
						'after' => $pk,
						'first' => array(
							'type'    => 'integer',
							'minimum' => 1,
							'maximum' => 100,
						),
					)
				),
				array(
					'readonly'   => false,
					'idempotent' => true,
				),
				static fn ( array $in ): array => array(
					'GET',
					"/sync/$name",
					array_map(
						'strval',
						array_intersect_key(
							$in,
							array(
								'after' => 1,
								'first' => 1,
							)
						)
					),
					null,
				)
			);
			$ops[] = $sync(
				'apply',
				"Apply a $name sync record",
				"Create or update one $name record of the $app_label app when it still matches `expect`.",
				JsonSchema::input(
					array(
						'record' => array( 'type' => 'object' ),
						'expect' => array( 'type' => 'string' ),
					),
					array( 'record', 'expect' )
				),
				array(),
				static fn ( array $in ): array => array( 'POST', "/sync/$name", array(), $in ),
				true
			);
			$ops[] = $sync(
				'trash',
				"Trash a $name sync record",
				"Trash one $name record of the $app_label app by uid when it still matches `expect`.",
				JsonSchema::input(
					array(
						'uid'    => array( 'type' => 'string' ),
						'expect' => array( 'type' => 'string' ),
					),
					array( 'uid', 'expect' )
				),
				array( 'destructive' => true ),
				static fn ( array $in ): array => array( 'POST', "/sync/$name/trash", array(), $in )
			);
		}

		return $ops;
	}

	/**
	 * A post kind's staged version ({@see \SpacePress\Wp\Staged}), one ability per step, so that a
	 * credential can be given `-stage` without `-staged-promote`. Each needs the item's update rule;
	 * the operation itself decides it (`defer`), so a caller it doesn't cover gets the 404 a missing
	 * item gets and never learns whether anything is staged.
	 *
	 * @return list<array>
	 */
	private static function staged( string $app, string $app_label, string $name, array $base, array $rule, array $row, array $pk, array $spec ): array {
		$k                                   = self::kebab( $name );
		$when                                = array(
			'type'   => 'string',
			'format' => 'date-time',
		);
		$record                              = array(
			'id'        => array( 'type' => 'integer' ),
			'at'        => $when,
			'promoteAt' => array(
				'type'   => array( 'string', 'null' ),
				'format' => 'date-time',
			),
			'by'        => array(
				'type'       => array( 'object', 'null' ),
				'properties' => array(
					'id'   => array( 'type' => 'integer' ),
					'name' => array( 'type' => 'string' ),
				),
			),
		);
		$record[ \SpacePress\Wp\Rev::FIELD ] = array( 'type' => 'string' );
		$version                             = array(
			'type'       => 'object',
			'required'   => array( 'id', 'row', 'fields' ),
			'properties' => array(
				'row'    => $row,
				'fields' => array(
					'type'  => 'array',
					'items' => array( 'type' => 'string' ),
				),
			) + $record,
		);
		$id                                  = static fn ( array $in ): int|string => is_int( $in['id'] ?? null ) || ( is_string( $in['id'] ?? null ) && '' !== $in['id'] ) ? $in['id'] : throw HttpError::invalidInput( 'id is required', '/id' );
		$op                                  = static fn ( string $suffix, string $kind, string $label, string $description, array $input, array $output, array $annotations, \Closure $run ): array => $base + array(
			'name'        => "$app/$k-$suffix",
			'op'          => $kind,
			'label'       => $label,
			'description' => $description,
			'input'       => $input,
			'output'      => $output,
			'annotations' => $annotations,
			'rule'        => array( $rule, 'update', "update $name rows" ),
			'defer'       => true,
			'run'         => static fn ( array $in ): mixed => $run( $id( $in ), $in, Invoke::viewer() ),
		);
		$one                                 = JsonSchema::input( array( 'id' => $pk ), array( 'id' ) );
		$readonly                            = array(
			'readonly'   => true,
			'idempotent' => true,
		);
		// Writes take the staged version's `_rev` and `takeover` ({@see \SpacePress\Wp\Rev}).
		$guard      = array(
			\SpacePress\Wp\Rev::FIELD    => array( 'type' => 'string' ),
			\SpacePress\Wp\Rev::TAKEOVER => array( 'type' => 'boolean' ),
		);
		$conditions = static fn ( array $in ): array => array( $in[ \SpacePress\Wp\Rev::FIELD ] ?? null, ( $in[ \SpacePress\Wp\Rev::TAKEOVER ] ?? false ) === true );

		return array(
			$op(
				'stage',
				'stage',
				"Stage a change to $name",
				"Save changes to one $name row of the $app_label app as its staged version: the given fields of `patch` are staged, and the live row stays as it is until the staged version is promoted.",
				JsonSchema::input(
					array(
						'id'    => $pk,
						'patch' => JsonSchema::patch( $spec ),
					) + $guard,
					array( 'id', 'patch' )
				),
				$version,
				array(),
				static fn ( int|string $id, array $in, \SpacePress\Viewer $viewer ): array => \SpacePress\Wp\Staged::stage(
					$name,
					$id,
					( Invoke::object( $in['patch'] ?? false ) ?? throw HttpError::invalidInput( 'patch must be an object', '/patch' ) ) + array_intersect_key( $in, $guard ),
					$viewer
				)
			),
			$op(
				'staged-get',
				'staged-get',
				"Staged version of $name",
				"Read the staged version of one $name row of the $app_label app: the row as it would be once promoted, and the fields that are staged.",
				$one,
				$version,
				$readonly,
				static fn ( int|string $id, array $in, \SpacePress\Viewer $viewer ): array => \SpacePress\Wp\Staged::get( $name, $id, $viewer )
			),
			$op(
				'staged-compare',
				'staged-compare',
				"Compare staged and live $name",
				"List the staged fields of one $name row of the $app_label app whose value differs from the live row, with both values.",
				$one,
				array(
					'type'       => 'object',
					'required'   => array( 'id', 'changes' ),
					'properties' => array(
						'changes' => array(
							'type'  => 'array',
							'items' => array(
								'type'       => 'object',
								'required'   => array( 'field' ),
								'properties' => array( 'field' => array( 'type' => 'string' ) ),
							),
						),
					) + $record,
				),
				$readonly,
				static fn ( int|string $id, array $in, \SpacePress\Viewer $viewer ): array => \SpacePress\Wp\Staged::compare( $name, $id, $viewer )
			),
			$op(
				'staged-promote',
				'staged-promote',
				"Promote staged $name",
				"Make the staged version of one $name row of the $app_label app live, as an update of the row. With `at` (a future time) the promote is scheduled instead; `at: null` cancels a scheduled promote.",
				JsonSchema::input(
					array(
						'id' => $pk,
						'at' => array(
							'type'   => array( 'string', 'null' ),
							'format' => 'date-time',
						),
					) + $guard,
					array( 'id' )
				),
				array(),
				array(),
				static fn ( int|string $id, array $in, \SpacePress\Viewer $viewer ): array => array_key_exists( 'at', $in )
					? \SpacePress\Wp\Staged::schedule( $name, $id, $in['at'], $viewer, ...$conditions( $in ) )
					: \SpacePress\Wp\Rev::attach( $name, \SpacePress\Wp\Staged::promote( $name, $id, $viewer, ...$conditions( $in ) ) )
			),
			$op(
				'staged-discard',
				'staged-discard',
				"Discard staged $name",
				"Discard the staged version of one $name row of the $app_label app. The live row is untouched and the discarded version stays in the row's revisions.",
				JsonSchema::input( array( 'id' => $pk ) + $guard, array( 'id' ) ),
				array(
					'type'       => 'object',
					'required'   => array( 'revision' ),
					'properties' => array( 'revision' => array( 'type' => 'integer' ) ),
				),
				array( 'idempotent' => false ),
				static fn ( int|string $id, array $in, \SpacePress\Viewer $viewer ): array => \SpacePress\Wp\Staged::discard( $name, $id, $viewer, ...$conditions( $in ) )
			),
			$op(
				'staged-preview',
				'staged-preview',
				"Preview link for staged $name",
				"Create a signed link to the staged version of one $name row of the $app_label app. It works without signing in until it expires (`ttl` seconds, an hour by default) or the staged version is promoted or discarded.",
				JsonSchema::input(
					array(
						'id'  => $pk,
						'ttl' => array(
							'type'    => 'integer',
							'minimum' => 60,
							'maximum' => 86400,
						),
					),
					array( 'id' )
				),
				array(
					'type'       => 'object',
					'required'   => array( 'token', 'expiresAt', 'api' ),
					'properties' => array(
						'token'     => array( 'type' => 'string' ),
						'expiresAt' => $when,
						'api'       => array( 'type' => 'string' ),
						'url'       => array( 'type' => array( 'string', 'null' ) ),
					),
				),
				array(),
				static fn ( int|string $id, array $in, \SpacePress\Viewer $viewer ): array => \SpacePress\Wp\Staged::preview( $name, $id, $in['ttl'] ?? null, $viewer )
			),
		);
	}

	private static function action( string $app, string $app_label, string $name, array $action ): array {
		$required = array_values( array_map( 'strval', array_keys( array_filter( $action['input'] ?? array(), Schema::isRequired( ... ) ) ) ) );
		$props    = array_map( static fn ( array $c ): array => JsonSchema::column( $c ), $action['input'] ?? array() );

		return array(
			'name'        => "$app/" . self::kebab( $name ),
			'op'          => 'run',
			'agents'      => (bool) ( $action['agents'] ?? true ),
			'label'       => "Run $name",
			'description' => "Run the $name action of the $app_label app.",
			// The result type, as the compiler inferred it from the handler (none when it has no JSON shape).
			'input'       => JsonSchema::input( $props, $required ),
			'output'      => is_array( $action['output'] ?? null ) ? $action['output'] : array(),
			// The action's own options (spec §3a). Core's run route picks the method from them: GET for
			// readonly, DELETE for destructive + idempotent, POST otherwise.
			'annotations' => array_filter(
				array(
					'readonly'    => (bool) ( $action['readonly'] ?? false ),
					'destructive' => (bool) ( $action['destructive'] ?? false ),
					'idempotent'  => (bool) ( $action['idempotent'] ?? false ) || (bool) ( $action['readonly'] ?? false ),
				)
			),
			'rule'        => array( $action['access'] ?? Access::DEFAULT_WRITE, 'create', "run $name" ),
			// A signature replaces the access check (§6.1); the action path verifies it, so nothing is judged early.
			'defer'       => ( $action['signature'] ?? null ) !== null,
			'call'        => static fn ( array $in ): array => array( 'POST', '/actions/' . rawurlencode( $name ), array(), $in ),
			// `personal`: the handler's code reads orders or calls an ability that needs the grant (the
			// compiler's Action::personal); AgentScope::withheld leaves it out of a credential's lists.
			'spacepress'  => array( 'action' => $name ) + ( ( $action['personal'] ?? false ) ? array( 'personal' => true ) : array() ),
		);
	}

	/** @return list<array> */
	private static function global( string $app, string $app_label, string $name, array $global ): array { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.globalFound -- Preserve the existing PHP parameter name.
		$k      = self::kebab( $name );
		$rules  = Access::globalRules( $global );
		$values = JsonSchema::fields( $global['fields'], true );
		$base   = array(
			'agents'     => (bool) ( $global['agents'] ?? true ),
			'spacepress' => array( 'global' => $name ),
		);
		$label  = $global['label'] ?? $name;
		$patch  = array_map( static fn ( array $c ): array => JsonSchema::column( $c ), $global['fields'] );

		return array(
			$base + array(
				'name'        => "$app/global-$k-get",
				'op'          => 'get',
				'label'       => "Get $label",
				'description' => "Read the $label values of the $app_label app.",
				'input'       => JsonSchema::input( array() ),
				'output'      => $values,
				'annotations' => array(
					'readonly'   => true,
					'idempotent' => true,
				),
				'rule'        => array( $rules['read'], 'read', "read $name" ),
				'call'        => static fn ( array $in ): array => array( 'GET', '/globals/' . rawurlencode( $name ), array(), null ),
			),
			$base + array(
				'name'        => "$app/global-$k-update",
				'op'          => 'update',
				'label'       => "Update $label",
				'description' => "Change some $label values of the $app_label app; the input is the patch.",
				'input'       => JsonSchema::input( $patch ),
				'output'      => $values,
				'annotations' => array(),
				'rule'        => array( $rules['update'], 'update', "update $name" ),
				'dataShape'   => $global['fields'],
				'data'        => static fn ( array $in ): array => $in,
				'call'        => static fn ( array $in ): array => array( 'PATCH', '/globals/' . rawurlencode( $name ), array(), $in ),
			),
		);
	}

	/** @return list<array> media list/get/delete; uploads stay HTTP (abilities carry no files). */
	private static function media( string $app, string $app_label ): array {
		$row  = JsonSchema::media();
		$base = array(
			'agents'     => true,
			'spacepress' => array( 'collection' => 'media' ),
		);
		$id   = array( 'id' => array( 'type' => 'integer' ) );

		return array(
			$base + array(
				'name'        => "$app/media-list",
				'op'          => 'list',
				'label'       => 'List media',
				'description' => "List the media library of the $app_label app.",
				'input'       => JsonSchema::input(
					array(
						'where'   => JsonSchema::mediaWhere(),
						'orderBy' => JsonSchema::orderBy( array( 'id', 'filename', 'mime', 'alt', 'createdAt' ) ),
						'limit'   => array(
							'type'    => 'integer',
							'minimum' => 0,
						),
						'offset'  => array(
							'type'    => 'integer',
							'minimum' => 0,
						),
					)
				),
				'output'      => array(
					'type'       => 'object',
					'properties' => array(
						'rows' => array(
							'type'  => 'array',
							'items' => $row,
						),
					),
					'required'   => array( 'rows' ),
				),
				'annotations' => array(
					'readonly'   => true,
					'idempotent' => true,
				),
				'rule'        => array( Access::MEDIA['read'], 'read', 'read media' ),
				'call'        => static fn ( array $in ): array => array( 'GET', '/media', Invoke::listQuery( $in ), null ),
				'result'      => static fn ( array $rows ): array => array( 'rows' => $rows ),
			),
			$base + array(
				'name'        => "$app/media-get",
				'op'          => 'get',
				'label'       => 'Get media',
				'description' => "Get one media item of the $app_label app by id.",
				'input'       => JsonSchema::input( $id, array( 'id' ) ),
				'output'      => $row,
				'annotations' => array(
					'readonly'   => true,
					'idempotent' => true,
				),
				'rule'        => array( Access::MEDIA['read'], 'read', 'read media' ),
				'call'        => static fn ( array $in ): array => array( 'GET', '/media/' . Invoke::id( $in ), array(), null ),
			),
			$base + array(
				'name'        => "$app/media-delete",
				'op'          => 'delete',
				'label'       => 'Delete media',
				'description' => "Delete one media item of the $app_label app and its files.",
				'input'       => JsonSchema::input( $id, array( 'id' ) ),
				'output'      => $row,
				'annotations' => array( 'destructive' => true ),
				'rule'        => array( Access::MEDIA['delete'], 'delete', 'delete media' ),
				'call'        => static fn ( array $in ): array => array( 'DELETE', '/media/' . Invoke::id( $in ), array(), null ),
			),
		);
	}

	private static function job( string $app, string $app_label, string $name, array $job, \Closure $enqueue ): array {
		$required = array_values( array_map( 'strval', array_keys( array_filter( $job['input'] ?? array(), Schema::isRequired( ... ) ) ) ) );

		return array(
			'name'        => "$app/job-" . self::kebab( $name ),
			'op'          => 'enqueue',
			'agents'      => true,
			'label'       => "Enqueue $name",
			'description' => "Queue the $name job of the $app_label app; returns the job id.",
			'input'       => JsonSchema::input( array_map( static fn ( array $c ): array => JsonSchema::column( $c ), $job['input'] ?? array() ), $required ),
			'output'      => array(
				'type'       => 'object',
				'properties' => array( 'id' => array( 'type' => array( 'integer', 'string' ) ) ),
				'required'   => array( 'id' ),
			),
			'annotations' => array(),
			'rule'        => array( Access::DEFAULT_WRITE, 'create', "enqueue $name" ),
			'spacepress'  => array( 'job' => $name ),
			'run'         => static function ( array $in ) use ( $enqueue, $name ): array {
				Access::require( Access::DEFAULT_WRITE, Invoke::viewer(), 'create', null, "enqueue $name" );
				$db = Runtime::plugin()?->app()->db ?? throw new \RuntimeException( 'No SpacePress app is active' );

				return array(
					'id' => $db->transaction(
						static function () use ( $db, $enqueue, $name, $in ) {
							$previous = $db->actor();
							$db->setActor( Invoke::viewer()->user );
							try {
								return $enqueue( $name, $in );
							} finally {
								$db->setActor( $previous );
							}
						}
					),
				);
			},
		);
	}

	// ================================================================ core args

	private static function args( array $op ): array {
		return array(
			'label'               => $op['label'],
			'description'         => $op['description'],
			'category'            => explode( '/', $op['name'] )[0],
			'input_schema'        => $op['input'],
			'output_schema'       => $op['output'],
			'permission_callback' => static fn ( mixed $input = null ): bool|\WP_Error => Invoke::allowed( $op, $input ),
			'execute_callback'    => static fn ( mixed $input = null ): mixed => Invoke::call( $op, $input ),
			'ability_class'       => SpacePressAbility::class,
			'meta'                => array(
				'public'       => $op['agents'],
				'show_in_rest' => $op['agents'],
				'mcp'          => array( 'public' => $op['agents'] ),
				'annotations'  => $op['annotations'],
				'spacepress'   => $op['spacepress'] + array( 'op' => $op['op'] ),
			),
		);
	}

	private static function schema(): ?Schema {
		return Runtime::plugin()?->schema;
	}

	private static function app_label( Schema $schema ): string {
		return ucfirst( $schema->name() );
	}

	private static function has_media( array $spec ): bool {
		foreach ( $spec['columns'] as $col ) {
			if ( in_array( $col['type'], array( 'media', 'mediaList' ), true ) ) {
				return true;
			}
		}

		return false;
	}

	private static function upper( string $c ): bool {
		return '' !== $c && mb_strtolower( $c, 'UTF-8' ) !== $c;
	}

	private static function lower( string $c ): bool {
		return '' !== $c && mb_strtoupper( $c, 'UTF-8' ) !== $c;
	}
}
