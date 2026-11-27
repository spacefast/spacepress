<?php

declare(strict_types=1);

/*
 * What SpacePress relies on in WordPress core that core does not promise to keep: the protected members
 * of core's classes SpacePress subclasses or calls, and the globals and plugin internals listed in
 * docs/wordpress-internals.md. Read by reflection from the WordPress that is installed (the pinned
 * floor here, the nightly and the next beta in .github/workflows/wordpress-ahead.yml), so a core
 * release that renames, hides or reshapes one fails here by name instead of as a 500 somewhere.
 * Each entry names the SpacePress file that uses it; the doc says what to do when one fails.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$site = wpSite(
	'core-shape',
	array(
		'schema' => array(
			'name'        => 'shape',
			'collections' => array(),
		),
	)
);

/**
 * A method: it exists, has this visibility, and accepts the argument count First passes.
 * `$args` is how many arguments SpacePress's call passes; null when SpacePress only overrides it.
 */
function method( string $class, string $name, string $visibility, ?int $args, string $usedBy ): void {
	$label = "$class::$name ($usedBy)";
	if ( ! class_exists( $class ) && ! interface_exists( $class ) ) {
		check( $label, false, "class $class is gone" );
		return;
	}
	if ( ! method_exists( $class, $name ) ) {
		check( $label, false, "method $name is gone" );
		return;
	}
	$method = new ReflectionMethod( $class, $name );
	$is     = $method->isPublic() ? 'public' : ( $method->isProtected() ? 'protected' : 'private' );
	eq( "$label is $visibility", $is, $visibility );
	if ( null !== $args ) {
		check(
			"$label takes $args argument(s)",
			$method->getNumberOfRequiredParameters() <= $args && $method->getNumberOfParameters() >= $args,
			array(
				'required' => $method->getNumberOfRequiredParameters(),
				'accepted' => $method->getNumberOfParameters(),
			)
		);
	}
	check( "$label is not final", ! $method->isFinal() || null !== $args, 'SpacePress overrides it' );
}

/** A property SpacePress reads or sets on a subclass or an instance of $class. */
function property( string $class, string $name, string $visibility, string $usedBy ): void {
	$label = "$class::\$$name ($usedBy)";
	if ( ! property_exists( $class, $name ) ) {
		check( $label, false, "property $name is gone" );
		return;
	}
	$property = new ReflectionProperty( $class, $name );
	$is       = $property->isPublic() ? 'public' : ( $property->isProtected() ? 'protected' : 'private' );
	eq( "$label is $visibility", $is, $visibility );
}

// ---------------------------------------------------------------- REST controllers SpacePress subclasses

// Wp/PostsController.php extends WP_REST_Posts_Controller and overrides or calls these.
$posts = 'WP_REST_Posts_Controller';
property( $posts, 'meta', 'protected', 'PostsController sets its PostMeta' );
property( $posts, 'post_type', 'protected', 'PostsController reads its post type' );
method( $posts, 'get_post', 'protected', 1, 'PostsController::get_item, update_item' );
method( $posts, 'get_items', 'public', 1, 'PostsController overrides' );
method( $posts, 'get_item', 'public', 1, 'PostsController overrides' );
method( $posts, 'create_item', 'public', 1, 'PostsController overrides' );
method( $posts, 'update_item', 'public', 1, 'PostsController overrides' );
method( $posts, 'delete_item', 'public', 1, 'PostsController overrides' );
method( $posts, 'get_items_permissions_check', 'public', 1, 'PostsController overrides' );
method( $posts, 'get_item_permissions_check', 'public', 1, 'PostsController overrides' );
method( $posts, 'update_item_permissions_check', 'public', 1, 'PostsController overrides' );
method( $posts, 'check_read_permission', 'public', 1, 'PostsController calls parent' );
method( $posts, 'prepare_item_for_response', 'public', 2, 'PostsController overrides' );
method( $posts, 'get_collection_params', 'public', 0, 'PostsController extends' );
method( $posts, 'handle_template', 'public', 3, 'PostsController::coreFields' );
method( 'WP_REST_Controller', 'get_fields_for_response', 'public', 1, 'PostsController, TableController' );
method( 'WP_REST_Controller', 'update_additional_fields_for_object', 'protected', 2, 'PostsController::spWrite, UserMeta::create' );
method( 'WP_REST_Controller', 'prepare_response_for_collection', 'public', 1, 'TableController' );
property( 'WP_REST_Controller', 'namespace', 'protected', 'TableController sets it' );
property( 'WP_REST_Controller', 'rest_base', 'protected', 'TableController sets it' );

// Wp/PostMeta.php extends WP_REST_Post_Meta_Fields.
method( 'WP_REST_Meta_Fields', 'get_registered_fields', 'protected', 0, 'PostMeta overrides and calls parent' );
method( 'WP_REST_Meta_Fields', 'get_value', 'public', 2, 'PostMeta overrides and calls parent' );
method( 'WP_REST_Meta_Fields', 'update_value', 'public', 2, 'PostMeta, UserMeta' );

// Wp/UserMeta.php calls the users controller's protected update_additional_fields_for_object on
// its own instance (the method is WP_REST_Controller's, checked above).
check( 'WP_REST_Users_Controller extends WP_REST_Controller (UserMeta::create)', is_subclass_of( 'WP_REST_Users_Controller', 'WP_REST_Controller' ) );
method( 'WP_REST_Users_Controller', 'prepare_item_for_response', 'public', 2, 'UserMeta::create, remove' );

// Wp/SearchHandler.php extends WP_REST_Search_Handler and sets its type and subtypes.
property( 'WP_REST_Search_Handler', 'type', 'protected', 'SearchHandler sets it' );
property( 'WP_REST_Search_Handler', 'subtypes', 'protected', 'SearchHandler sets it' );
method( 'WP_REST_Search_Handler', 'search_items', 'public', 1, 'SearchHandler overrides' );
method( 'WP_REST_Search_Handler', 'prepare_item', 'public', 2, 'SearchHandler overrides' );
method( 'WP_REST_Search_Handler', 'prepare_item_links', 'public', 1, 'SearchHandler overrides' );
method( 'WP_REST_Search_Handler', 'get_subtypes', 'public', 0, 'SearchHandler reads core\'s' );

// Wp/Abilities/SpacePressAbility.php extends WP_Ability and overrides get_meta_item.
method( 'WP_Ability', 'get_meta_item', 'public', 2, 'SpacePressAbility overrides' );
method( 'WP_Ability', 'get_name', 'public', 0, 'SpacePressAbility' );

// Wp/Sitemap.php's provider extends WP_Sitemaps_Provider.
method( 'WP_Sitemaps_Provider', 'get_url_list', 'public', 2, 'Sitemap provider overrides' );
method( 'WP_Sitemaps_Provider', 'get_max_num_pages', 'public', 1, 'Sitemap provider overrides' );
method( 'WP_Sitemaps_Provider', 'get_object_subtypes', 'public', 0, 'Sitemap::filesFor' );

// ---------------------------------------------------------------- globals and internals

// Wp/Kinds.php reads another plugin's register_rest_field registrations: core keeps them here.
global $wp_rest_additional_fields;
register_rest_field( 'post', 'sp_shape_probe', array( 'update_callback' => static fn () => true ) );
check(
	'$wp_rest_additional_fields holds register_rest_field calls (Kinds::restField)',
	isset( $wp_rest_additional_fields['post']['sp_shape_probe']['update_callback'] ),
	array_keys( $wp_rest_additional_fields['post'] ?? array() )
);

// Wp/Facade.php: an autosave is a revision named "<parent>-autosave-v1", which wp_is_post_autosave reads.
$parent = wp_insert_post(
	array(
		'post_title'  => 'Shape',
		'post_status' => 'draft',
		'post_author' => 1,
	)
);
wp_set_current_user( 1 );
require_once ABSPATH . 'wp-admin/includes/post.php';
$autosave = wp_create_post_autosave(
	array(
		'post_ID'    => $parent,
		'post_title' => 'Shape, autosaved',
		'post_type'  => 'post',
	)
);
check(
	'an autosave is a revision named "<parent>-autosave…" (Facade revisions list, WpPostStore)',
	is_int( $autosave ) && str_starts_with( (string) get_post( $autosave )->post_name, "$parent-autosave" ),
	is_int( $autosave ) ? get_post( $autosave )->post_name : $autosave
);
check( 'wp_is_post_autosave recognises it', is_int( $autosave ) && wp_is_post_autosave( $autosave ) === $parent );

// Wp/AppRouter.php replaces the main query: these globals are what the template functions read.
check( '$wp_query and $wp_the_query are WP_Query (AppRouter::mainQuery)', ( $GLOBALS['wp_query'] ?? null ) instanceof WP_Query && ( $GLOBALS['wp_the_query'] ?? null ) instanceof WP_Query );

// Wp/Connection.php: the SQLite driver's MySQL parser and its token list (the SQLite lanes only).
global $wpdb;
if ( $wpdb->dbh instanceof PDO ) {
	check( 'the SQLite driver has create_parser (Connection::tokens)', method_exists( $wpdb->dbh, 'create_parser' ) );
	if ( method_exists( $wpdb->dbh, 'create_parser' ) ) {
		$parser = $wpdb->dbh->create_parser( 'SELECT 1' );
		check( 'its parser keeps its tokens in $tokens (Connection::tokens)', property_exists( $parser, 'tokens' ), get_class( $parser ) );
	}
}

// Polylang's internals (Wp/Polylang.php, Runtime's pll_context) are checked where Polylang runs:
// tests/wp/core-shape.test.ts, on the Docker lane.

$site->destroy();
finish( 'core_shape' );
