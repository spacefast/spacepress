<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$admin = var_export( dirname( __DIR__, 2 ) . '/runtime/admin/spacepress-admin.php', true );
$site  = wpSite(
	'admin-boot',
	array(
		'schema'    => array(
			'name'        => 'admin-boot',
			'collections' => array(),
		),
		'muPlugins' => array( 'admin' => "<?php require_once $admin;" ),
	)
);

function loadedControllers(): array {
	return array_values( array_filter( get_declared_classes(), static fn ( string $class ) => str_starts_with( $class, 'SpacePress_Admin_REST_' ) ) );
}

eq( 'WordPress boots without loading admin REST controllers', loadedControllers(), array() );
eq(
	'core can instantiate the configured attachment controller before REST initializes',
	get_class( get_post_type_object( 'attachment' )->get_rest_controller() ),
	'SpacePress_Admin_REST_Attachments_Controller'
);
eq( 'requesting attachments loads only that controller', loadedControllers(), array( 'SpacePress_Admin_REST_Attachments_Controller' ) );

$routes = rest_get_server()->get_routes();
foreach ( array(
	'/wp/v2/editor/settings'           => 'SpacePress_Admin_REST_Editor_Controller',
	'/wp/v2/field-collections'         => 'SpacePress_Admin_REST_Field_Collections_Controller',
	'/spacepress-admin/v1/view-config' => 'SpacePress_Admin_REST_View_Config_Controller',
	'/wp/v2/plugins'                   => 'SpacePress_Admin_REST_Plugins_Controller',
	'/wp/v2/resolved-template'         => 'SpacePress_Admin_REST_Resolved_Template_Controller',
) as $path => $controller ) {
	eq( "$path uses its admin controller", get_class( $routes[ $path ][0]['callback'][0] ), $controller );
}
$theme_path        = '/wp/v2/themes/(?P<stylesheet>' . WP_REST_Themes_Controller::PATTERN . ')';
$theme_controllers = array_map( static fn ( $endpoint ) => get_class( $endpoint['callback'][0] ), $routes[ $theme_path ] );
eq( 'theme routes include the admin controller', in_array( 'SpacePress_Admin_REST_Themes_Controller', $theme_controllers, true ), true );
finish( 'admin_boot' );
