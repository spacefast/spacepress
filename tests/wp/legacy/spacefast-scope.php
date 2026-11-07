<?php
// Disposable fixture: bind before normal plugins, just as the host does.
declare(strict_types=1);
global $wpdb, $table_prefix;
// The users-only proof binds a second Space; everything else uses imported-space.
$space = is_file('/tmp/spacefast-space') ? trim((string) file_get_contents('/tmp/spacefast-space')) : 'imported-space';
$table_prefix = 'sfz_' . substr(hash('sha256', $space), 0, 24) . '_';
$wpdb->set_prefix($table_prefix);
add_filter('zero_identity_session_cookie_aliases', static fn () => ['__Host-sfi_session']);
// Deliberately disposable provider config, never connected to a real Google client.
define('ZERO_IDENTITY_GOOGLE_CLIENT_ID', 'migration-contract-client');
define('ZERO_IDENTITY_GOOGLE_CLIENT_SECRET', 'migration-contract-secret');
