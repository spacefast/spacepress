<?php
/** Local showcase rebuild bridge. The host service owns compilation and activation. */

defined('ABSPATH') || exit;

function zero_showcase_build_control_permission() {
    if (!current_user_can('manage_options')) {
        return new WP_Error('zero_showcase_forbidden', 'Only administrators can rebuild this demo.', ['status' => 403]);
    }
    return true;
}

function zero_showcase_build_control_request($method, $path, $body = null) {
    $offline = 'Demo rebuild is offline. Start the showcase launcher to enable it.';
    if (!function_exists('curl_init') || !defined('CURLOPT_UNIX_SOCKET_PATH')) {
        return new WP_Error('zero_showcase_rebuild_offline', $offline, ['status' => 503]);
    }

    $response_body = '';
    $too_large = false;
    $handle = curl_init('http://localhost' . $path);
    curl_setopt_array($handle, [
        CURLOPT_UNIX_SOCKET_PATH => '/var/run/zero-showcase/control.sock',
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json'],
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_TIMEOUT => 5,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_PROXY => '',
        CURLOPT_WRITEFUNCTION => function ($handle, $chunk) use (&$response_body, &$too_large) {
            if (strlen($response_body) + strlen($chunk) > 65536) {
                $too_large = true;
                return 0;
            }
            $response_body .= $chunk;
            return strlen($chunk);
        },
    ]);
    if ($body !== null) {
        curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
    }

    $result = curl_exec($handle);
    $status = curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);
    if ($too_large) {
        return new WP_Error('zero_showcase_rebuild_response', 'The demo rebuild service returned an oversized response.', ['status' => 502]);
    }
    if ($result === false) {
        return new WP_Error('zero_showcase_rebuild_offline', $offline, ['status' => 503]);
    }

    $data = json_decode($response_body, true);
    if (json_last_error() !== JSON_ERROR_NONE || $status < 200 || $status > 599) {
        return new WP_Error('zero_showcase_rebuild_response', 'The demo rebuild service returned an invalid response.', ['status' => 502]);
    }
    return new WP_REST_Response($data, $status);
}

add_action('rest_api_init', function () {
    $permission = 'zero_showcase_build_control_permission';
    register_rest_route('zero-showcase/v1', '/control', [
        'methods' => 'GET',
        'permission_callback' => $permission,
        'callback' => function () {
            return zero_showcase_build_control_request('GET', '/control');
        },
    ]);
    register_rest_route('zero-showcase/v1', '/builds', [
        'methods' => 'POST',
        'permission_callback' => $permission,
        'callback' => function (WP_REST_Request $request) {
            if (strlen($request->get_body()) > 1048576) {
                return new WP_Error('zero_showcase_build_too_large', 'The config exceeds the 1 MiB rebuild limit.', ['status' => 413]);
            }
            $params = json_decode($request->get_body());
            if (json_last_error() !== JSON_ERROR_NONE || !is_object($params)) {
                return new WP_Error('zero_showcase_build_json', 'Send the config as a JSON object.', ['status' => 400]);
            }
            $body = wp_json_encode($params);
            if ($body === false || strlen($body) > 1048576) {
                return new WP_Error('zero_showcase_build_too_large', 'The config exceeds the 1 MiB rebuild limit.', ['status' => 413]);
            }
            return zero_showcase_build_control_request('POST', '/builds', $body);
        },
    ]);
    register_rest_route('zero-showcase/v1', '/builds/(?P<id>[a-f0-9-]{36})', [
        'methods' => 'GET',
        'permission_callback' => $permission,
        'callback' => function (WP_REST_Request $request) {
            $params = $request->get_url_params();
            return zero_showcase_build_control_request('GET', '/builds/' . $params['id']);
        },
    ]);
});
