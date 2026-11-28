<?php
/** Local showcase rebuild bridge. The host service owns compilation and activation. */

defined( 'ABSPATH' ) || exit;

function sp_showcase_build_control_permission() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return new WP_Error( 'sp_showcase_forbidden', 'Only administrators can rebuild this demo.', array( 'status' => 403 ) );
	}
	return true;
}

function sp_showcase_build_control_request( $method, $path, $body = null ) {
	$offline = 'Demo rebuild is offline. Start the showcase launcher to enable it.';
	if ( ! function_exists( 'curl_init' ) || ! defined( 'CURLOPT_UNIX_SOCKET_PATH' ) ) {
		return new WP_Error( 'sp_showcase_rebuild_offline', $offline, array( 'status' => 503 ) );
	}

	$response_body = '';
	$too_large     = false;
	$handle        = curl_init( 'http://localhost' . $path );
	curl_setopt_array(
		$handle,
		array(
			CURLOPT_UNIX_SOCKET_PATH => '/var/run/spacepress-showcase/control.sock',
			CURLOPT_CUSTOMREQUEST    => $method,
			CURLOPT_HTTPHEADER       => array( 'Accept: application/json', 'Content-Type: application/json' ),
			CURLOPT_CONNECTTIMEOUT   => 2,
			CURLOPT_TIMEOUT          => 5,
			CURLOPT_FOLLOWLOCATION   => false,
			CURLOPT_PROXY            => '',
			CURLOPT_WRITEFUNCTION    => function ( $handle, $chunk ) use ( &$response_body, &$too_large ) {
				if ( strlen( $response_body ) + strlen( $chunk ) > 65536 ) {
					$too_large = true;
					return 0;
				}
				$response_body .= $chunk;
				return strlen( $chunk );
			},
		)
	);
	if ( null !== $body ) {
		curl_setopt( $handle, CURLOPT_POSTFIELDS, $body );
	}

	$result = curl_exec( $handle );
	$status = curl_getinfo( $handle, CURLINFO_RESPONSE_CODE );
	curl_close( $handle );
	if ( $too_large ) {
		return new WP_Error( 'sp_showcase_rebuild_response', 'The demo rebuild service returned an oversized response.', array( 'status' => 502 ) );
	}
	if ( false === $result ) {
		return new WP_Error( 'sp_showcase_rebuild_offline', $offline, array( 'status' => 503 ) );
	}

	$data = json_decode( $response_body, true );
	if ( json_last_error() !== JSON_ERROR_NONE || $status < 200 || $status > 599 ) {
		return new WP_Error( 'sp_showcase_rebuild_response', 'The demo rebuild service returned an invalid response.', array( 'status' => 502 ) );
	}
	return new WP_REST_Response( $data, $status );
}

add_action(
	'rest_api_init',
	function () {
		$permission = 'sp_showcase_build_control_permission';
		register_rest_route(
			'spacepress-showcase/v1',
			'/control',
			array(
				'methods'             => 'GET',
				'permission_callback' => $permission,
				'callback'            => function () {
					return sp_showcase_build_control_request( 'GET', '/control' );
				},
			)
		);
		register_rest_route(
			'spacepress-showcase/v1',
			'/builds',
			array(
				'methods'             => 'POST',
				'permission_callback' => $permission,
				'callback'            => function ( WP_REST_Request $request ) {
					if ( strlen( $request->get_body() ) > 1048576 ) {
						return new WP_Error( 'sp_showcase_build_too_large', 'The config exceeds the 1 MiB rebuild limit.', array( 'status' => 413 ) );
					}
					$params = json_decode( $request->get_body() );
					if ( json_last_error() !== JSON_ERROR_NONE || ! is_object( $params ) ) {
						return new WP_Error( 'sp_showcase_build_json', 'Send the config as a JSON object.', array( 'status' => 400 ) );
					}
					$body = wp_json_encode( $params );
					if ( false === $body || strlen( $body ) > 1048576 ) {
						return new WP_Error( 'sp_showcase_build_too_large', 'The config exceeds the 1 MiB rebuild limit.', array( 'status' => 413 ) );
					}
					return sp_showcase_build_control_request( 'POST', '/builds', $body );
				},
			)
		);
		register_rest_route(
			'spacepress-showcase/v1',
			'/builds/(?P<id>[a-f0-9-]{36})',
			array(
				'methods'             => 'GET',
				'permission_callback' => $permission,
				'callback'            => function ( WP_REST_Request $request ) {
					$params = $request->get_url_params();
					return sp_showcase_build_control_request( 'GET', '/builds/' . $params['id'] );
				},
			)
		);
	}
);
