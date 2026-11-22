<?php

declare(strict_types=1);

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$admin = var_export(dirname(__DIR__, 2) . '/runtime/admin/typedpress-admin.php', true);
$site = wpSite('admin-boot', [
    'schema' => ['name' => 'admin-boot', 'collections' => []],
    'muPlugins' => ['admin' => "<?php require_once $admin;"],
]);

function loadedControllers(): array
{
    return array_values(array_filter(get_declared_classes(), static fn (string $class) => str_starts_with($class, 'TypedPress_Admin_REST_')));
}

eq('WordPress boots without loading admin REST controllers', loadedControllers(), []);
eq('core can instantiate the configured attachment controller before REST initializes',
    get_class(get_post_type_object('attachment')->get_rest_controller()), 'TypedPress_Admin_REST_Attachments_Controller');
eq('requesting attachments loads only that controller', loadedControllers(), ['TypedPress_Admin_REST_Attachments_Controller']);

$routes = rest_get_server()->get_routes();
foreach ([
    '/wp/v2/editor/settings' => 'TypedPress_Admin_REST_Editor_Controller',
    '/wp/v2/field-collections' => 'TypedPress_Admin_REST_Field_Collections_Controller',
    '/typedpress-admin/v1/view-config' => 'TypedPress_Admin_REST_View_Config_Controller',
    '/wp/v2/plugins' => 'TypedPress_Admin_REST_Plugins_Controller',
    '/wp/v2/resolved-template' => 'TypedPress_Admin_REST_Resolved_Template_Controller',
] as $path => $controller) {
    eq("$path uses its admin controller", get_class($routes[$path][0]['callback'][0]), $controller);
}
$themePath = '/wp/v2/themes/(?P<stylesheet>' . WP_REST_Themes_Controller::PATTERN . ')';
$themeControllers = array_map(static fn ($endpoint) => get_class($endpoint['callback'][0]), $routes[$themePath]);
eq('theme routes include the admin controller', in_array('TypedPress_Admin_REST_Themes_Controller', $themeControllers, true), true);
finish('admin_boot');
