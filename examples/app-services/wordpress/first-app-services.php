<?php
/**
 * Plugin Name: First App Services Example
 * Description: Native forms, publication search and hosted checkout for the example app.
 * License: GPL-2.0-or-later
 */
declare(strict_types=1);

namespace FirstAppServicesExample;

defined('ABSPATH') || exit;

add_filter('first_services_config', static fn (): array => [
    'forms' => ['contact' => [
        'fields' => [
            'email' => ['type' => 'email', 'notNull' => true, 'rules' => ['max' => 191]],
            'message' => ['type' => 'text', 'notNull' => true, 'rules' => ['min' => 3, 'max' => 2000]],
        ],
        'recipientEnv' => 'FIRST_SERVICES_MAIL_TO', 'senderEnv' => 'FIRST_SERVICES_MAIL_FROM', 'limit' => 5,
    ]],
    'search' => ['posts' => ['title', 'excerpt']],
    'products' => ['workshop' => ['name' => 'WordPress workshop', 'amount' => 1900, 'currency' => 'usd']],
    'checkoutReturnUrl' => home_url('/?app-services=1'),
]);

add_action('parse_request', static function (): void {
    if (!isset($_GET['app-services'])) {
        return;
    }
    status_header(200);
    header('Content-Type: text/html; charset=UTF-8');
    header('Cache-Control: no-store');
    $api = rest_url('first/v1/services');
    require __DIR__ . '/page.php';
    exit;
});
