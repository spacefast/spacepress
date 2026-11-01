<?php
/**
 * The Zero menu: the app's collections, media, globals and the classic admin.
 *
 * Entries follow the viewer's read rules through the runtime's own access evaluation. A collection
 * whose rule denies the viewer outright has no entry; a filtered or per-row rule gets one, and the
 * list may then be empty. This decides navigation only: the API applies the rules.
 *
 * @package Zero_Admin
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The app's schema as `GET /zero/v1/_schema` describes it, or null without an app.
 *
 * @return array|null
 */
function zero_admin_schema() {
	static $schema = null;
	if ( null === $schema ) {
		$plugin = \Zero\Wp\Runtime::plugin();
		$schema = $plugin ? $plugin->schema->describe() : array();
		// The public description names no storage. The admin needs to know which API holds each
		// collection's rows, so it adds the post type (already public on /wp/v2/types) and the table.
		if ( $plugin ) {
			foreach ( $plugin->schema->collections() as $name => $spec ) {
				if ( isset( $schema['collections'][ $name ] ) ) {
					$schema['collections'][ $name ]['wp']    = $spec['wp'] ?? null;
					$schema['collections'][ $name ]['table'] = $spec['table'] ?? null;
				}
			}
		}
	}
	return $schema ? $schema : null;
}

/**
 * Which collections and globals the current viewer may read, by the runtime's rules.
 *
 * @return array{collections: array<string, bool>, globals: array<string, bool>}
 */
function zero_admin_permits() {
	$schema  = zero_admin_schema();
	$permits = array(
		'collections' => array(),
		'globals'     => array(),
	);
	if ( ! $schema ) {
		return $permits;
	}
	$viewer = \Zero\Wp\CoreAccess::viewer();
	$plugin = \Zero\Wp\Runtime::plugin();
	foreach ( array_keys( $schema['collections'] ) as $name ) {
		$permits['collections'][ $name ] = null !== $viewer && \Zero\Wp\CoreAccess::mayRead( (string) $name, $viewer );
	}
	foreach ( $plugin->schema->globals() as $name => $global ) {
		$rule                        = \Zero\Access::globalRules( $global )['read'];
		$permits['globals'][ $name ] = null !== $viewer && false !== \Zero\Access::evaluate( $rule, $viewer, 'read', null );
	}
	return $permits;
}

/**
 * Register the Zero entries. Runs on `zero_admin_init`, before the legacy wp-admin entries.
 */
function zero_admin_register_zero_menu() {
	$schema = zero_admin_schema();
	if ( ! $schema ) {
		return;
	}
	$permits  = zero_admin_permits();
	$position = 0;
	zero_admin_register_menu_item(
		'zero-overview',
		array(
			'to'       => '/',
			'label'    => __( 'Collections', 'zero-admin' ),
			'icon'     => 'dashicons-database',
			'position' => $position++,
		)
	);
	foreach ( $schema['collections'] as $name => $collection ) {
		if ( empty( $permits['collections'][ $name ] ) || ( isset( $collection['api']['list'] ) && false === $collection['api']['list'] ) ) {
			continue;
		}
		zero_admin_register_menu_item(
			'zero-collection-' . sanitize_key( $name ),
			array(
				'to'       => '/collections/' . rawurlencode( (string) $name ),
				'label'    => (string) $collection['label'],
				'icon'     => 'dashicons-database',
				'position' => $position++,
			)
		);
	}
	zero_admin_register_menu_item(
		'zero-media',
		array(
			'to'       => '/media',
			'label'    => __( 'Media', 'zero-admin' ),
			'icon'     => 'dashicons-admin-media',
			'position' => $position++,
		)
	);
	foreach ( $schema['globals'] as $name => $global ) {
		if ( empty( $permits['globals'][ $name ] ) ) {
			continue;
		}
		zero_admin_register_menu_item(
			'zero-global-' . sanitize_key( $name ),
			array(
				'to'       => '/globals/' . rawurlencode( (string) $name ),
				'label'    => (string) $global['label'],
				'icon'     => 'dashicons-admin-settings',
				'position' => $position++,
			)
		);
	}
	zero_admin_register_menu_item(
		'zero-classic',
		array(
			'to'       => '/legacy/index.php',
			'label'    => __( 'Classic admin', 'zero-admin' ),
			'icon'     => 'dashicons-wordpress',
			'position' => $position++,
		)
	);
}
add_action( 'zero_admin_init', 'zero_admin_register_zero_menu', 5 );

/**
 * The schema and the viewer's permits ride in the boot context, so the overview and the menu need
 * no round trip and the screens agree with the server on what to show. (Zero's REST responses are
 * emitted outside WordPress's response data, so `rest_preload_api_request` cannot carry them.)
 *
 * @param array $context Boot context.
 * @return array
 */
function zero_admin_boot_context_schema( $context ) {
	$context['schema']  = zero_admin_schema();
	$context['permits'] = zero_admin_permits();
	$user               = wp_get_current_user();
	$viewer             = \Zero\Wp\CoreAccess::viewer();
	$context['viewer']  = array(
		'id'   => $user->exists() ? (int) $user->ID : null,
		'role' => $viewer && $viewer->user ? $viewer->user['role'] : null,
	);
	$context['rest_url'] = esc_url_raw( rest_url( 'zero/v1/' ) );
	// SCF's pickers speak site time on core REST while Zero speaks UTC; the app converts with this.
	$context['site_time'] = array(
		'timezone'   => get_option( 'timezone_string' ) ? (string) get_option( 'timezone_string' ) : null,
		'gmt_offset' => (float) get_option( 'gmt_offset', 0 ),
	);
	return $context;
}
add_filter( 'zero_admin_boot_context', 'zero_admin_boot_context_schema' );

/**
 * The app's own wp-admin entries (its top-level menu with the globals pages, and one list per
 * collection post type) are what the Zero menu replaces; keep them out of the legacy entries.
 *
 * @param string[] $exclude Menu slugs to leave out.
 * @return string[]
 */
function zero_admin_exclude_app_menus( $exclude ) {
	$schema = zero_admin_schema();
	if ( ! $schema ) {
		return $exclude;
	}
	$exclude[] = 'zero-' . $schema['name'];
	foreach ( $schema['collections'] as $collection ) {
		if ( ! empty( $collection['wp']['postType'] ) ) {
			$exclude[] = 'edit.php?post_type=' . $collection['wp']['postType'];
		}
	}
	return $exclude;
}
add_filter( 'zero_admin_legacy_menu_items_exclude', 'zero_admin_exclude_app_menus' );
