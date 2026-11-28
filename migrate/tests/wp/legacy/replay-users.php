<?php
// Loads users.json (the rows the ORIGINAL identity plugin wrote, captured by users-seed.php) with
// their original ids. Creates the original identity tables with that plugin's own column shapes.
declare(strict_types=1);

global $wpdb;
$site = json_decode( (string) file_get_contents( $args[0] ), true, 512, JSON_THROW_ON_ERROR );
$p    = $wpdb->prefix;
$wpdb->query( "CREATE TABLE IF NOT EXISTS {$p}sfi_accounts (wp_user_id bigint unsigned NOT NULL, primary_email_id bigint unsigned NULL, status varchar(20) NOT NULL DEFAULT 'active', created_at bigint NOT NULL, PRIMARY KEY (wp_user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4" );
$wpdb->query( "CREATE TABLE IF NOT EXISTS {$p}sfi_emails (id bigint unsigned NOT NULL AUTO_INCREMENT, wp_user_id bigint unsigned NOT NULL, normalized varbinary(254) NOT NULL, verified_at bigint NOT NULL, method varchar(32) NOT NULL, PRIMARY KEY (id), UNIQUE KEY normalized (normalized)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4" );
$insert = static function ( string $table, array $row ) use ( $wpdb ): void {
	if ( $wpdb->insert( $table, $row ) === false ) {
		WP_CLI::error( "cannot insert into $table: " . $wpdb->last_error );
	}
};
foreach ( $site['users'] as $u ) {
	$insert( $wpdb->users, $u );
}
foreach ( $site['usermeta'] as $m ) {
	$insert( $wpdb->usermeta, $m );
}
foreach ( $site['accounts'] as $a ) {
	$insert( "{$p}sfi_accounts", $a );
}
foreach ( $site['emails'] as $e ) {
	$e['normalized'] = hex2bin( $e['normalized'] );
	$insert( "{$p}sfi_emails", $e );
}
foreach ( $site['options'] as $o ) {
	$insert( $wpdb->options, $o + array( 'autoload' => 'off' ) );
}
wp_cache_flush();
echo wp_json_encode( $site['ids'] ), "\n";
