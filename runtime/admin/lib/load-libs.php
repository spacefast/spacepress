<?php
/**
 * Zero Admin load Libraries.
 *
 * This file loads all the libraries and registration needed for Zero Admin.
 * Loaded for the admin page and for REST requests alike.
 *
 * @package Zero_Admin
 */

define( 'ZERO_ADMIN_PLUGIN_DIR', plugin_dir_path( __DIR__ ) );
define( 'ZERO_ADMIN_PLUGIN_URL', plugin_dir_url( __DIR__ ) );

// Registration APIs.
require_once __DIR__ . '/api/field-collections.php';
require_once __DIR__ . '/api/view-config.php';
require_once __DIR__ . '/api/menu-items.php';
require_once __DIR__ . '/api/init-modules.php';
require_once __DIR__ . '/api/routes.php';

// REST API overrides and endpoints.
require_once __DIR__ . '/rest-api/class-zero-admin-rest-attachments-controller.php';
require_once __DIR__ . '/rest-api/class-zero-admin-rest-field-collections-controller.php';
require_once __DIR__ . '/rest-api/class-zero-admin-rest-view-config-controller.php';
require_once __DIR__ . '/rest-api/class-zero-admin-rest-editor-controller.php';
require_once __DIR__ . '/rest-api/core-rest-api-overrides.php';

// Core Entities overrides.
require_once __DIR__ . '/post.php';

// i18n support in Zero Admin.
require_once __DIR__ . '/i18n.php';

// Legacy routes support in Zero Admin.
require_once __DIR__ . '/legacy-route.php';

// Default Zero Admin menu registration.
require_once __DIR__ . '/menu.php';

// Build output: registers the modules, routes and fields. Absent until the build is committed.
if ( is_file( __DIR__ . '/../build/index.php' ) ) {
	require_once __DIR__ . '/../build/index.php';
}
