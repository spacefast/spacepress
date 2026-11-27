<?php

declare(strict_types=1);

namespace SpacePress\Commerce;

use SpacePress\Render\Cache;

final class StoreApiPolicy {

	private const STORE_PREFIX = '/wc/store/';

	public static function register( string|false|null $frontend ): void {
		$frontend = is_string( $frontend ) ? self::origin( $frontend ) : null;
		add_filter(
			'rest_jsonp_enabled',
			static function ( bool $enabled ): bool {
				$route = self::http_route();
				return $enabled && ! self::store_route( $route ) && ! self::batch_route( $route );
			}
		);
		add_filter(
			'rest_pre_dispatch',
			static function ( $result, $server, $request ) use ( $frontend ) {
				$route = $request->get_route();
				if ( null !== $result || ! self::store_route( $route ) ) {
					return $result; }
				// WordPress's route regex accepts case aliases that bypass Woo's authentication and CORS hooks.
				if ( ! str_starts_with( $route, self::STORE_PREFIX ) ) {
					return rest_convert_error_to_response( new \WP_Error( 'rest_no_route', __( 'No route was found matching the URL and request method.' ), array( 'status' => 404 ) ) );
				}
				if ( self::batch_route( self::http_route() ) ) {
					if ( self::external_origin( $frontend ) ) {
						// The batch envelope includes inner headers even on errors. Stop before Woo opens a session.
						return rest_convert_error_to_response( new \WP_Error( 'sp_store_batch_forbidden', 'Use the Store API route directly.', array( 'status' => 403 ) ) );
					}
				} elseif ( self::frontend_request( $frontend ) && self::preflight() ) {
					// Check the HTTP method itself, before a REST method override can dispatch a handler.
					return new \WP_REST_Response( null, 204 );
				}
				return $result;
			},
			10,
			3
		);
		add_filter(
			'rest_post_dispatch',
			static function ( $response, $server, $request ) {
				if ( self::store_route( $request->get_route() ) || self::includes_store_request( $request ) ) {
					$response->header( 'Cache-Control', Cache::PRIVATE );
					$response->header( Cache::EDGE_HEADER, 'no-cache' );
					if ( function_exists( 'batcache_cancel' ) ) {
						batcache_cancel(); }
				}
				return $response;
			},
			10,
			3
		);
		add_filter(
			'rest_pre_serve_request',
			static function ( $served, $result, $request, $server ) use ( $frontend ) {
				if ( ! str_starts_with( $request->get_route(), self::STORE_PREFIX ) || ! self::frontend_request( $frontend ) || ! self::preflight() ) {
					return $served;
				}
				// Woo sends credentialed headers and exits at priority 10 on a preflight.
				self::send_frontend_cors( $server, $frontend );
				$server->send_header( 'Access-Control-Allow-Methods', 'OPTIONS, GET, POST, PUT, PATCH, DELETE' );
				$server->send_header( 'Vary', 'Origin', false );
				status_header( 204 );
				exit;
			},
			9,
			4
		);
		add_filter(
			'rest_pre_serve_request',
			static function ( $served, $result, $request, $server ) use ( $frontend ) {
				$route = $request->get_route();
				$store = str_starts_with( $route, self::STORE_PREFIX );
				$batch = self::includes_store_request( $request );
				if ( ( ! $store && self::store_route( $route ) ) || ( $batch && self::external_origin( $frontend ) ) ) {
					$server->remove_header( 'Access-Control-Allow-Origin' );
					$server->remove_header( 'Access-Control-Allow-Credentials' );
				}
				if ( ( $store || $batch ) && self::frontend_request( $frontend ) ) {
					self::send_frontend_cors( $server, $frontend );
				}
				return $served;
			},
			11,
			4
		);
	}

	private static function http_route(): string {
		$route = $GLOBALS['wp']->query_vars['rest_route'] ?? '';
		return is_string( $route ) ? $route : '';
	}

	private static function store_route( string $route ): bool {
		return strncasecmp( $route, self::STORE_PREFIX, strlen( self::STORE_PREFIX ) ) === 0;
	}

	private static function batch_route( string $route ): bool {
		return strcasecmp( rtrim( $route, '/' ), '/batch/v1' ) === 0;
	}

	private static function includes_store_request( \WP_REST_Request $request ): bool {
		if ( ! self::batch_route( $request->get_route() ) ) {
			return false; }
		$requests = $request['requests'];
		if ( ! is_array( $requests ) ) {
			return false; }
		foreach ( $requests as $inner ) {
			$path = $inner['path'] ?? null;
			if ( is_string( $path ) && self::store_route( (string) wp_parse_url( $path, PHP_URL_PATH ) ) ) {
				return true; }
		}
		return false;
	}

	private static function origin( string $frontend ): ?string {
		$url = wp_parse_url( $frontend );
		if ( ! isset( $url['scheme'], $url['host'] ) ) {
			return null; }
		$scheme = strtolower( $url['scheme'] );
		$port   = isset( $url['port'] ) && $url['port'] !== ( array( // phpcs:ignore WordPress.PHP.YodaConditions.NotYoda -- Preserve the existing comparison order.
			'http'  => 80,
			'https' => 443,
		)[ $scheme ] ?? 0 ) ? ':' . $url['port'] : '';
		return $scheme . '://' . strtolower( $url['host'] ) . $port;
	}

	private static function frontend_request( ?string $frontend ): bool {
		return null !== $frontend && ( $_SERVER['HTTP_ORIGIN'] ?? null ) === $frontend;
	}

	private static function external_origin( ?string $frontend ): bool {
		$origin = get_http_origin();
		return '' !== $origin && ( self::frontend_request( $frontend ) || ! is_allowed_http_origin( $origin ) );
	}

	private static function preflight(): bool {
		return ( $_SERVER['REQUEST_METHOD'] ?? '' ) === 'OPTIONS'
			&& isset( $_SERVER['HTTP_ACCESS_CONTROL_REQUEST_METHOD'], $_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS'] );
	}

	private static function send_frontend_cors( \WP_REST_Server $server, string $origin ): void {
		$server->send_header( 'Access-Control-Allow-Origin', $origin );
		$server->remove_header( 'Access-Control-Allow-Credentials' );
	}
}
