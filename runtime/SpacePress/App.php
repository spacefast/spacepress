<?php

declare(strict_types=1);

namespace SpacePress;

/**
 * Boots a generated app and serves its REST API (§4.8) and CLI. The WordPress plugin passes its
 * Store/Auth/Media and calls handle() with the path after the API prefix (`/wp-json/spacepress/v1`): the
 * WordPress facade for SpacePress's own routes with no core route (sign-in, sync, files), and
 * the abilities (invoke).
 */
final class App {

	private const LIST_LIMIT     = 50;
	private const MAX_LIST_LIMIT = 200;
	private const TITLES         = array(
		'invalid_input'       => 'Invalid input',
		'schema_refused'      => 'Schema change refused',
		'invalid_drop'        => 'Invalid --drop',
		'invalid_query'       => 'Invalid query',
		'invalid_json'        => 'Invalid JSON',
		'not_found'           => 'Not found',
		'method_not_allowed'  => 'Method not allowed',
		'unique_violation'    => 'Unique violation',
		'reference_violation' => 'Reference violation',
		'rejected'            => 'Rejected',
		'unauthenticated'     => 'Unauthenticated',
		'forbidden'           => 'Forbidden',
		'payload_too_large'   => 'Payload too large',
		'internal'            => 'Internal error',
		'unavailable'         => 'Service unavailable',
	);

	private function __construct(
		public readonly string $root,
		public readonly Schema $schema,
		public readonly Db $db,
		public readonly Store $store,
		public readonly Auth $auth,
	) {
	}

	/** Boot an app root (`sp/app/{schema.php,functions.php}`) on the services the plugin provides. */
	public static function boot( string $appRoot, Schema $schema, Store $store, Auth $auth, Media $media ): self { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$functions = $appRoot . '/sp/app/functions.php'; // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		if ( is_file( $functions ) ) {
			require_once $functions;
		}
		$db = new Db( $store, $schema, $media );
		Db::setInstance( $db );

		return new self( $appRoot, $schema, $db, $store, $auth ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	}

	/** Validate input against an action's schema, check its access, run its handler. */
	private function action( string $name, string $rawBody, array $headers = array(), ?Viewer $viewer = null ): Response { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$input  = self::parse_body( $rawBody ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$action = $this->schema->action( $name );
		if ( null !== $viewer && ( $action['signature'] ?? null ) !== null ) {
			// A `signature` action authenticates by HMAC in the beforeAction seam instead of an access
			// rule (§6.1): whoever is logged in, the verified caller is anonymous for everything after.
			Extensions::action( $action, $name, $rawBody, array_change_key_case( $headers, CASE_LOWER ), $viewer ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$viewer = new Viewer( null );
			$this->db->setActor( null );
		} else {
			if ( null !== $viewer ) {
				$this->db->current( static fn () => Access::require( $action['access'] ?? Access::DEFAULT_WRITE, $viewer, 'create', null, "run $name" ) );
			}
			Extensions::action( $action, $name, $rawBody, array_change_key_case( $headers, CASE_LOWER ), $viewer ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		}
		if ( isset( $action['rateLimit'] ) ) {
			RateLimit::check( $name, $action['rateLimit'], $viewer?->user );
		}
		$ctx   = $this->db->hookCtx();
		$input = Schema::validateInput( $action['input'] ?? array(), $input, '', $ctx['user'] );
		$slot  = $action['handler'];
		$fn    = $slot;
		if ( is_string( $slot ) ) {
			$fn    = '\\SpacePressApp\\' . $slot;
			$input = Seam::toJs( $input, $action['input'] ?? array() );
			$ctx   = Seam::ctx( $ctx );
		}

		// The kind API runs as the caller; a signed action's caller is the system (§6.1).
		$visitor = ( $action['signature'] ?? null ) !== null ? null : $viewer;

		return Extensions::execute(
			'action:' . $name,
			$action,
			$rawBody, // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			array_change_key_case( $headers, CASE_LOWER ),
			$viewer,
			static fn (): Response => Response::json( JsBinary::refuseWire( Seam::asVisitor( $visitor, static fn (): mixed => Timers::run( static fn (): mixed => $fn( $input, $ctx ) ) ), 'action ' . $name ) )
		);
	}

	/**
	 * Run a matched route in one transaction. `$user` is the resolved caller (null: anonymous);
	 * a `signature` route verifies the raw body instead and always runs anonymously. A GET or HEAD
	 * route's transaction starts at its first write (Db::reading()): most only read.
	 *
	 * @return array{int, array<string, string>, string}
	 */
	public function serveRoute( array $match, string $method, string $path, string $query, string $body, array $headers, ?array $user, string $url ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid, Universal.NamingConventions.NoReservedKeywordParameterNames.matchFound -- Preserve the existing PHP method name. Preserve the existing PHP parameter name.
		$headers = array_change_key_case( $headers, CASE_LOWER );
		try {
			$run      = in_array( $method, array( 'GET', 'HEAD' ), true ) ? $this->db->reading( ... ) : $this->db->transaction( ... );
			$response = $run(
				function () use ( $match, $method, $path, $query, $body, $headers, $user, $url ): array {
					$route  = $match['route'];
					$name   = $match['name'];
					$viewer = new Viewer( $user );
					if ( ( $route['signature'] ?? null ) !== null ) {
						Jobs\Webhooks::verify( $route, 'route ' . $name, $body, $headers, $viewer );
						$viewer = new Viewer( null );
					} else {
						Access::require( $route['access'], $viewer, 'create', null, "call route $name" );
					}
					$previous = $this->db->actor();
					$this->db->setActor( $viewer->user );
					try {
						$this->db->promoteDue();
						$string  = static fn ( array $values ): JsObject => new JsObject( array_map( 'strval', $values ) );
						$request = new JsObject(
							array(
								'method'  => $method,
								'url'     => $url,
								'path'    => $path,
								'params'  => $string( $match['params'] ),
								'query'   => QueryString::toJs( QueryString::parse( $query ) ),
								'headers' => $string( $headers ),
								'body'    => $body,
							)
						);
						$fn      = '\\SpacePressApp\\' . $route['handler'];
						// `once()` in a handler is keyed to this exact request body, as in actions.
						$visitor = ( $route['signature'] ?? null ) !== null ? null : $viewer;
						$result  = Jobs\Receipts::withFingerprint(
							hash( 'sha256', $body ),
							fn (): mixed => Seam::container( Seam::asVisitor( $visitor, fn (): mixed => Timers::run( fn (): mixed => $fn( $request, Seam::ctx( $this->db->hookCtx() ) ) ) ) )
						);
					} finally {
						$this->db->setActor( $previous );
					}

					return self::route_response( $name, $result );
				}
			);

			return 'HEAD' === $method ? array( $response[0], $response[1], '' ) : $response;
		} catch ( \Throwable $e ) {
			return self::respond( $e );
		}
	}

	/** @return array{int, array<string, string>, string} */
	private static function route_response( string $name, mixed $result ): array {
		$result = is_array( $result ) ? $result : array();
		// An optional property set to `undefined` is absent, as in JavaScript.
		$result = array_filter( $result, static fn ( mixed $value ): bool => JsUndefined::Value !== $value );
		$status = $result['status'] ?? 200;
		if ( ! is_int( $status ) && ! ( is_float( $status ) && floor( $status ) === $status ) || $status < 200 || $status > 599 ) {
			throw new \LogicException( "Route $name returned an invalid status" );
		}
		$headers = array();
		foreach ( Seam::container( $result['headers'] ?? array() ) as $header => $value ) {
			$header = (string) $header;
			if ( JsUndefined::Value === $value ) {
				continue;
			}
			if ( preg_match( '/\A[!#$%&\'*+.^_`|~0-9A-Za-z-]+\z/', $header ) !== 1 || ! is_string( $value ) || preg_match( '/[\r\n\0]/', $value ) === 1 ) {
				throw new \LogicException( "Route $name returned an invalid header" );
			}
			$headers[ $header ] = $value;
		}
		$headers = Response::mergeHeaders(
			array(
				'Content-Type'  => 'text/plain; charset=utf-8',
				'Cache-Control' => 'private, no-store',
			),
			$headers
		);

		return array( (int) $status, $headers, (string) ( $result['body'] ?? '' ) );
	}

	/** Invoke any API operation with explicit authority. No authentication, JSON envelope or error conversion. */
	public function invoke( string $method, string $path, array $query, mixed $body, Viewer $viewer, array $headers = array() ): mixed {
		return $this->invokeResponse( $method, $path, $query, $body, $viewer, $headers )->data;
	}

	/** invoke(), with the operation's status and headers (`Idempotent-Replayed`) for a transport to pass on. */
	public function invokeResponse( string $method, string $path, array $query, mixed $body, Viewer $viewer, array $headers = array() ): Response { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$raw = is_string( $body ) ? $body : ( null === $body ? '' : ( Js::jsonStringify( $body ) ?? '' ) );

		return $this->dispatch( $method, $path, $query, $raw, $viewer, $headers );
	}

	/** The shared operation dispatcher; errors throw, and response emission belongs to the transport. */
	public function dispatch( string $method, string $path, array $query, string $body, Viewer $viewer, array $headers = array(), array $files = array(), array $form = array() ): Response {
		return $this->db->transaction(
			function () use ( $method, $path, $query, $body, $viewer, $headers, $files, $form ): Response {
				$previous = $this->db->actor();
				$this->db->setActor( $viewer->user );
				try {
					$this->db->promoteDue();
					$result = $this->route( $method, $path, $query, $body, $viewer, array_change_key_case( $headers, CASE_LOWER ), $files, $form );

					return $result instanceof Response ? $result : Response::json( $result[1], $result[0] );
				} finally {
					$this->db->setActor( $previous );
				}
			}
		);
	}

	// ================================================================ HTTP

	/**
	 * One API request. $path is relative to the API prefix ('/posts/1'). $files/$form are the
	 * multipart parts (PHP's $_FILES/$_POST shape) for POST /media.
	 *
	 * @param array<string, mixed> $query
	 * @param array<string, string> $headers lower-cased names
	 * @return array{int, array<string, string>, string|\Closure}
	 */
	public function handle( string $method, string $path, array $query, string $body, array $headers = array(), array $files = array(), array $form = array() ): array {
		try {
			$response                 = $this->db->transaction(
				function () use ( $method, $path, $query, $body, $headers, $files, $form ): Response {
					$user = $this->auth->resolve( array_change_key_case( $headers, CASE_LOWER ) );

					return $this->dispatch( $method, $path, $query, $body, new Viewer( $user ), $headers, $files, $form );
				}
			);
			[$status, $out, $payload] = $response->http();

			return array( $status, $out, $payload );
		} catch ( \Throwable $e ) {
			return self::respond( $e );
		}
	}

	/** @return array{int, array<string, string>, string} */
	private static function respond( \Throwable $e ): array {
		$problem = self::problem( $e );

		return array( $problem['status'], array( 'Content-Type' => 'application/problem+json' ), Js::jsonStringify( $problem ) ?? '{}' );
	}

	/** @return array{int, mixed}|Response */
	private function route( string $method, string $path, array $query, string $body, Viewer $viewer, array $headers, array $files, array $form ): array|Response {
		$segments = array_map( 'rawurldecode', array_values( array_filter( explode( '/', $path ), static fn ( $s ) => '' !== $s ) ) );
		$n        = count( $segments );
		$name     = $segments[0] ?? '';
		$notFound = static fn () => HttpError::notFound( "No route for $path" ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.

		if ( ( $handler = Extensions::routeHandler( $name ) ) !== null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
			return $handler( $method, $segments, $query, $body, $viewer, $files, $form, $headers );
		}
		switch ( true ) {
			case '_schema' === $name && 1 === $n:
				self::allow( $method, array( 'GET' ) );

				return array( 200, $this->schema->describe() );
			case 'me' === $name && 1 === $n:
				self::allow( $method, array( 'GET' ) );

				return array( 200, Auth\Module::me( $viewer->user ) );
			case 'actions' === $name && 2 === $n:
				self::allow( $method, array( 'POST' ) );

				return $this->action( $segments[1], $body, $headers, $viewer );
			case 'globals' === $name && 2 === $n:
				self::allow( $method, array( 'GET', 'PATCH' ) );

				return 'GET' === $method
					? array( 200, $this->db->globalGet( $segments[1], $viewer ) )
					: array( 200, $this->db->globalUpdate( $segments[1], self::object( self::parse_body( $body ) ), $viewer ) );
		}

		if ( $n < 1 || $n > 5 ) {
			throw $notFound(); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		}

		if ( ! $this->schema->hasCollection( $name ) ) {
			throw HttpError::notFound( "Unknown collection '$name'" );
		}
		$spec = $this->schema->collection( $name );

		if ( 1 === $n ) {
			self::allow( $method, array( 'GET', 'POST' ) );
			if ( 'GET' === $method ) {
				$this->gate( $spec, 'list' );
				$rows = $this->db->findMany( $name, self::listOptions( $query ), $viewer );

				return array( 200, array_map( static fn ( array $r ): array => Wp\Rev::attach( $name, $r ), $rows ) );
			}
			$this->gate( $spec, 'create' );
			$data = self::object( self::parse_body( $body ) );

			$result = null;
			$around = static function ( callable $write ) use ( $name, $spec, $body, $headers, $viewer, &$result ): array {
				$result = Extensions::execute(
					'create:' . $name,
					$spec,
					$body,
					$headers,
					$viewer,
					static fn (): Response => Response::json( $write(), 201 )
				);

				return $result->data;
			};
			$row    = $this->db->insert( $name, $data, true, $viewer, $around )[0];

			return Response::json( Wp\Rev::attach( $name, $row ), $result->status, $result->headers );
		}

		$pk      = $this->pk_from_path( $spec, $segments[1] );
		$where   = array( $spec['primaryKey'] => $pk );
		$missing = static fn () => HttpError::notFound( "No $name row with {$spec['primaryKey']} {$segments[1]}" );

		if ( 2 === $n ) {
			self::allow( $method, array( 'GET', 'PATCH', 'DELETE' ) );
			$this->gate(
				$spec,
				array(
					'GET'    => 'get',
					'PATCH'  => 'update',
					'DELETE' => 'delete',
				)[ $method ]
			);

			if ( 'GET' === $method ) {
				$row = $this->db->findFirst( $name, array( 'where' => $where ) + self::item_options( $query ), $viewer ) ?? throw $missing();

				return array( 200, Wp\Rev::attach( $name, $row ) );
			}
			if ( 'PATCH' === $method ) {
				[$patch, $rev, $takeover] = Wp\Rev::split( self::object( self::parse_body( $body ) ) );
				$row                      = Wp\Rev::guarded(
					$name,
					$pk,
					$rev,
					$takeover,
					$viewer,
					fn () => $this->db->update( $name, $patch, $where, true, $viewer )[0] ?? throw $missing(),
					$patch
				);

				return array( 200, Wp\Rev::attach( $name, $row ) );
			}
			$row = Wp\Rev::guarded(
				$name,
				$pk,
				$query[ Wp\Rev::FIELD ] ?? null,
				( $query[ Wp\Rev::TAKEOVER ] ?? '' ) === '1',
				$viewer,
				fn () => $this->db->delete( $name, $where, true, $viewer )[0] ?? throw $missing()
			);

			return array( 200, $row );
		}

		if ( 3 === $n && in_array( $segments[2], array( 'restore', 'purge' ), true ) ) {
			$op = $segments[2];
			self::allow( $method, 'restore' === $op ? array( 'POST' ) : array( 'DELETE' ) );
			$this->gate( $spec, 'delete' );
			$row = 'restore' === $op
				? ( $this->db->restore( $name, $where, true, $viewer )[0] ?? throw $missing() )
				: ( $this->db->purge( $name, $where, true, $viewer )[0] ?? throw $missing() );

			return array( 200, $row );
		}

		if ( 'revisions' !== $segments[2] ) {
			throw $notFound(); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		}
		$this->gate( $spec, 'update' );
		if ( 3 === $n ) {
			self::allow( $method, array( 'GET' ) );

			return array(
				200,
				array_map(
					fn ( array $r ) => array(
						'id'              => $r['id'],
						'version'         => $r['version'],
						'op'              => $r['op'],
						'at'              => $r['at'],
						'user'            => null === $r['userId'] ? null : ( ( $u = $this->auth->user( $r['userId'] ) ) === null ? null : array( // phpcs:ignore WordPress.CodeAnalysis.AssignmentInTernaryCondition.FoundInTernaryCondition, Squiz.PHP.DisallowMultipleAssignments.Found -- Keep the assignment and its test together.
							'id'   => $u['id'],
							'name' => $u['name'],
						) ),
						'schemaMigration' => $r['schemaMigration'],
						'changed'         => $r['changed'],
					),
					$this->db->revisions( $name, $pk, $viewer )
				),
			);
		}
		if ( 4 === $n && 'diff' === $segments[3] ) {
			self::allow( $method, array( 'GET' ) );
			$from = self::query_int( $query, 'from' ) ?? throw HttpError::invalidQuery( 'from must be a revision version or id', '/from' );
			$to   = self::query_int( $query, 'to' ) ?? throw HttpError::invalidQuery( 'to must be a revision version or id', '/to' );

			return array( 200, $this->db->diffRevisions( $name, $pk, $from, $to, $viewer, byVersion: true ) );
		}
		if ( ! preg_match( '/^\d{1,18}$/D', $segments[3] ) ) {
			throw HttpError::notFound( "No revision {$segments[3]}" );
		}
		$rid = (int) $segments[3];
		if ( 4 === $n ) {
			self::allow( $method, array( 'GET' ) );

			return array( 200, $this->db->revision( $name, $pk, $rid, $viewer ) );
		}
		if ( 'restore' !== $segments[4] ) {
			throw $notFound(); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		}
		self::allow( $method, array( 'POST' ) );

		return array( 200, $this->db->restoreRevision( $name, $pk, $rid, $viewer ) );
	}

	public static function allow( string $method, array $allowed ): void {
		if ( ! in_array( $method, $allowed, true ) ) {
			throw new HttpError( 405, 'method_not_allowed', "$method is not allowed here" );
		}
	}

	private function gate( array $spec, string $op ): void {
		if ( ! ( $spec['api'][ $op ] ?? false ) ) {
			throw new HttpError( 405, 'method_not_allowed', "The $op operation is disabled for this collection" );
		}
	}

	private function pk_from_path( array $spec, string $id ): int|string {
		$type = $spec['columns'][ $spec['primaryKey'] ]['type'];
		if ( 'integer' !== $type ) {
			return $id;
		}
		if ( ! preg_match( '/^-?\d{1,18}$/D', $id ) ) {
			throw HttpError::notFound( "No row with {$spec['primaryKey']} $id" );
		}

		return (int) $id;
	}

	public static function listOptions( array $query ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		$opts = array( 'limit' => min( self::query_int( $query, 'limit' ) ?? self::LIST_LIMIT, self::MAX_LIST_LIMIT ) );
		if ( isset( $query['where'] ) ) {
			$opts['where'] = self::query_json( $query['where'], '/where' );
		}
		if ( isset( $query['status'] ) ) {
			$status        = array( 'status' => self::query_string( $query['status'], '/status' ) );
			$opts['where'] = isset( $opts['where'] ) ? array( 'AND' => array( $opts['where'], $status ) ) : $status;
		}
		if ( isset( $query['orderBy'] ) ) {
			$opts['orderBy'] = array();
			foreach ( explode( ',', self::query_string( $query['orderBy'], '/orderBy' ) ) as $part ) {
				$part = trim( $part );
				if ( '' !== $part ) {
					$desc                                    = '-' === $part[0];
					$opts['orderBy'][ ltrim( $part, '-+' ) ] = $desc ? 'desc' : 'asc';
				}
			}
		}
		if ( ( $offset = self::query_int( $query, 'offset' ) ) !== null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
			$opts['offset'] = $offset;
		}
		if ( isset( $query['with'] ) ) {
			$opts['with'] = self::with_option( $query['with'] );
		}

		return $opts + array_diff_key( $query, array_fill_keys( array( 'limit', 'where', 'status', 'orderBy', 'offset', 'with' ), true ) );
	}

	private static function item_options( array $query ): array {
		return ( isset( $query['with'] ) ? array( 'with' => self::with_option( $query['with'] ) ) : array() ) + array_diff_key( $query, array( 'with' => true ) );
	}

	/** `with=author,comments` or JSON `with={"author":true}`. */
	private static function with_option( mixed $value ): array {
		$s = trim( self::query_string( $value, '/with' ) );
		if ( str_starts_with( $s, '{' ) ) {
			$with = self::query_json( $s, '/with' );
			$with = Seam::container( $with );
			if ( ! is_array( $with ) || ( array() !== $with && array_is_list( $with ) ) ) {
				throw HttpError::invalidQuery( 'with must be an object', '/with' );
			}

			return $with;
		}
		$names = array_filter( array_map( 'trim', explode( ',', $s ) ), static fn ( $x ) => '' !== $x );

		return array_fill_keys( $names, true );
	}

	private static function query_string( mixed $value, string $ptr ): string {
		return is_string( $value ) ? $value : throw HttpError::invalidQuery( 'Expected a single string parameter', $ptr );
	}

	private static function query_int( array $query, string $key ): ?int {
		if ( ! isset( $query[ $key ] ) ) {
			return null;
		}
		$v = self::query_string( $query[ $key ], "/$key" );
		if ( ! preg_match( '/^\d{1,9}$/D', $v ) ) {
			throw HttpError::invalidQuery( "$key must be a non-negative integer", "/$key" );
		}

		return (int) $v;
	}

	private static function query_json( mixed $value, string $ptr ): mixed {
		try {
			// `{}` stays an object here; Db flattens query options by schema, keeping json() operands.
			return Js::decodeJson( self::query_string( $value, $ptr ) );
		} catch ( \JsonException $e ) {
			throw HttpError::invalidQuery( 'Invalid JSON: ' . $e->getMessage(), $ptr );
		}
	}

	private static function parse_body( string $body ): mixed {
		if ( trim( $body ) === '' ) {
			return array();
		}
		try {
			// `{}` inside a json() column value stays an object; Db/Schema flatten it everywhere else.
			return Js::decodeJson( $body );
		} catch ( \JsonException $e ) {
			throw new HttpError( 400, 'invalid_json', 'Request body is not valid JSON: ' . $e->getMessage() );
		}
	}

	private static function object( mixed $v ): array {
		$v = Seam::container( $v );
		if ( ! is_array( $v ) || ( array() !== $v && array_is_list( $v ) ) ) {
			throw HttpError::invalidInput( 'Body must be a JSON object', '' );
		}

		return $v;
	}

	/** RFC 9457 problem document for any throwable. */
	public static function problem( \Throwable $e ): array {
		[$status, $code, $detail, $pointer] = match ( true ) {
			$e instanceof HttpError => array( $e->status, $e->errorCode, $e->getMessage(), $e->pointer ), // phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Preserve the existing PHP property name.
			$e instanceof JsError => array( 422, 'rejected', $e->getMessage(), null ),
			default => array( 500, 'internal', getenv( 'SP_DEBUG' ) === '1' ? $e->getMessage() : 'Internal server error', null ),
		};
		if ( $status >= 500 ) {
			error_log( '[spacepress] ' . $e::class . ': ' . $e->getMessage() . ' at ' . $e->getFile() . ':' . $e->getLine() );
		}
		$problem = array(
			'type'   => 'about:blank',
			'title'  => self::TITLES[ $code ] ?? self::reason( $status ),
			'status' => $status,
			'code'   => $code,
			'detail' => $detail,
		);

		if ( $e instanceof Wp\StaleRevision || $e instanceof Wp\Locked ) {
			$problem += $e->details(); // the current _rev and what changed; or who holds the lock
		}
		if ( $e instanceof Wp\SchemaRefused ) {
			// Each refusal has its own stable code, the live count, and the fix; `drop` lists the
			// `--drop` arguments that accept today's counts, for a publisher to offer.
			$problem += array(
				'refusals' => $e->refusals,
				'drop'     => $e->drops(),
			);
		}

		return null === $pointer ? $problem : $problem + array( 'pointer' => $pointer );
	}

	private static function reason( int $status ): string {
		return match ( $status ) {
			400 => 'Bad request', 401 => 'Unauthorized', 403 => 'Forbidden', 404 => 'Not found',
			405 => 'Method not allowed', 409 => 'Conflict', 413 => 'Payload too large', 422 => 'Unprocessable content',
			429 => 'Too many requests', 500 => 'Internal error', 503 => 'Service unavailable', default => 'Error',
		};
	}

	// ================================================================ CLI

	/**
	 * Run a `wp spacepress` command (trusted: no access checks). Returns [exit code, stdout JSON].
	 *
	 * @param list<string> $args arguments after the script name
	 * @return array{int, string}
	 */
	public function cli( array $args ): array {
		try {
			$data = $this->cli_command( $args );

			return array( 0, Js::jsonStringify( array( 'data' => $data ) ) ?? '{}' );
		} catch ( \Throwable $e ) {
			return array( 1, Js::jsonStringify( array( 'error' => self::problem( $e ) ) ) ?? '{}' );
		}
	}

	private const USAGE = 'Usage: wp spacepress migrate | publish-due | action <name> [json] | find <collection> [opts]'
		. ' | insert <collection> <json> | update <collection> <where> <set> | delete <collection> <where>';

	private function cli_command( array $args ): mixed {
		[$pos, $flags] = self::cli_args( $args );
		$cmd           = $pos[0] ?? '';
		$json          = static function ( int $i, bool $required = true ) use ( $pos ): mixed {
			if ( ! isset( $pos[ $i ] ) ) {
				return $required ? throw HttpError::invalidInput( 'Missing JSON argument ' . $i ) : null;
			}

			return self::parse_body( $pos[ $i ] );
		};
		$usage         = static fn () => new HttpError( 400, 'invalid_command', self::USAGE );

		return $this->db->transaction(
			function () use ( $cmd, $pos, $flags, $json, $usage ) {
				$promoted = $this->db->promoteDue();
				if ( 'publish-due' === $cmd ) {
					return array( 'promoted' => (object) $promoted );
				}
				if ( ( $handler = Extensions::cliHandler( $cmd ) ) !== null ) { // phpcs:ignore Generic.CodeAnalysis.AssignmentInCondition.Found, Squiz.PHP.DisallowMultipleAssignments.FoundInControlStructure -- Keep the assignment and its test together.
					return $handler( array_slice( $pos, 1 ), $flags );
				}
				$sub = $pos[1] ?? null;
				if ( ! in_array( $cmd, array( 'action', 'find', 'insert', 'update', 'delete' ), true ) || null === $sub ) {
					throw $usage();
				}

				return match ( $cmd ) {
					'action' => $this->action( $sub, $pos[2] ?? '' )->data,
					'find' => $this->db->findMany( $sub, self::object( $json( 2, false ) ?? array() ) ),
					'insert' => $this->db->insert( $sub, self::rows( $json( 2 ) ), true ),
					'update' => $this->db->update( $sub, self::object( $json( 3 ) ), self::object( $json( 2 ) ), true ),
					'delete' => $this->db->delete( $sub, self::object( $json( 2 ) ), true ),
				};
			}
		);
	}

	/**
	 * Split argv into positionals and --flags. `--flag value`, `--flag=value`; a flag followed by
	 * nothing or another flag is `true`.
	 *
	 * @return array{list<string>, array<string, string|true>}
	 */
	private static function cli_args( array $args ): array {
		$pos   = array();
		$flags = array();
		for ( $i = 0; $i < count( $args ); $i++ ) {
			$a = $args[ $i ];
			if ( str_starts_with( $a, '--' ) && strlen( $a ) > 2 ) {
				$eq = strpos( $a, '=' );
				if ( false !== $eq ) {
					$flags[ substr( $a, 2, $eq - 2 ) ] = substr( $a, $eq + 1 );
				} elseif ( isset( $args[ $i + 1 ] ) && ! str_starts_with( $args[ $i + 1 ], '--' ) ) {
					$flags[ substr( $a, 2 ) ] = $args[ ++$i ];
				} else {
					$flags[ substr( $a, 2 ) ] = true;
				}
			} else {
				$pos[] = $a;
			}
		}

		return array( $pos, $flags );
	}

	/** The row or rows of an insert argument as a list, a top-level `{}` meaning an empty row. */
	private static function rows( mixed $v ): array {
		$v = Seam::container( $v ); // a top-level `{}` row; nested json() values keep theirs

		return is_array( $v ) ? $v : throw HttpError::invalidInput( 'Expected a JSON object or array of objects' );
	}
}
