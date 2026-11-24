<?php
// The site fixture's one 0.8 table, created before activation as the Space already holds it.
declare(strict_types=1);
global $wpdb;
$table = 'sf_spc_migrate_test_leads_' . substr( hash( 'sha256', "spc_migrate_test\0leads" ), 0, 10 );
$sql   = "CREATE TABLE `$table` (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    createdAt TEXT NULL, updatedAt TEXT NULL, email TEXT NULL,
    PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
if ( $wpdb->query( $sql ) === false ) {
	WP_CLI::error( $wpdb->last_error ); }
echo $table;
