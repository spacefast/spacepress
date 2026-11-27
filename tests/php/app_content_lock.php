<?php

declare(strict_types=1);

/*
 * A second process for tests/php/app_content.php. It loads the site, so it starts storing the
 * installed build's `page.md` versions like any first request, and stops inside its first write
 * to a Page: it prints `storing` and waits for a line on stdin. Then it finishes and prints `stored`.
 * While it waits it holds whatever lock storing takes.
 *
 *   php tests/php/app_content_lock.php <site dir>
 */

require __DIR__ . '/wp.php';

$dir  = $argv[1];
$site = json_decode( (string) file_get_contents( "$dir/site.json" ), true, 512, JSON_THROW_ON_ERROR );
wpDefine( $dir, $site['url'] );
$_SERVER['REQUEST_METHOD'] = 'GET';
// Registered before WordPress loads: the pause is in place when `init` stores the pages.
$GLOBALS['wp_filter']['wp_insert_post_data'][10]['pause'] = array(
	'accepted_args' => 1,
	'function'      => static function ( array $data ): array {
		static $paused = false;
		if ( ! $paused && ( $data['post_type'] ?? null ) === 'page' ) {
			$paused = true;
			echo "storing\n";
			fgets( STDIN );
		}

		return $data;
	},
);
require_once ABSPATH . 'wp-settings.php';
echo "stored\n";
