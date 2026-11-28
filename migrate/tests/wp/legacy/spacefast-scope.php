<?php
// Disposable fixture: bind before normal plugins, just as the host does.
declare(strict_types=1);
global $wpdb, $table_prefix;
$table_prefix = 'sfz_' . substr( hash( 'sha256', 'imported-space' ), 0, 24 ) . '_';
$wpdb->set_prefix( $table_prefix );
add_filter( 'sp_identity_rest_cookie_auth', '__return_true' );
// Deliberately disposable provider config, never connected to a real Google client.
define( 'SP_IDENTITY_GOOGLE_CLIENT_ID', 'migration-contract-client' );
define( 'SP_IDENTITY_GOOGLE_CLIENT_SECRET', 'migration-contract-secret' );
