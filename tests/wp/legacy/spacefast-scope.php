<?php
// Disposable fixture: bind before normal plugins, just as the host does.
declare(strict_types=1);
global $wpdb, $table_prefix;
$table_prefix = 'sfz_' . substr(hash('sha256', 'imported-space'), 0, 24) . '_';
$wpdb->set_prefix($table_prefix);
add_filter('first_identity_session_cookie_aliases', static fn () => ['__Host-sfi_session']);
// Deliberately disposable provider config, never connected to a real Google client.
define('FIRST_IDENTITY_GOOGLE_CLIENT_ID', 'migration-contract-client');
define('FIRST_IDENTITY_GOOGLE_CLIENT_SECRET', 'migration-contract-secret');
