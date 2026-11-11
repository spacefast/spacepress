<?php
/** First navigation. Data endpoints remain the authority. @package First_Admin */
function first_admin_navigation() {
    $plugin = \First\Wp\Runtime::plugin();
    $viewer = \First\Wp\CoreAccess::viewer();
    $readable = array();
    if ( $viewer === null ) {
        return $readable;
    }
    foreach ( $plugin->schema->collections() as $name => $collection ) {
        $rule = \First\Access::collectionRules( $collection )['read'];
        if ( isset( $rule['fn'] ) || \First\Access::evaluate( $rule, $viewer, 'read' ) !== false ) {
            $readable[] = $name;
        }
    }
    return $readable;
}
add_action( 'first_admin_init', static function () {
    first_admin_register_menu_item( 'collections', array( 'parent_type' => 'dropdown', 'label' => __( 'Collections', 'first-admin' ), 'icon' => 'dashicons-database' ) );
    first_admin_register_menu_item( 'all-collections', array( 'to' => '/', 'label' => __( 'All collections', 'first-admin' ), 'parent' => 'collections' ) );
    foreach ( first_admin_navigation() as $name ) {
        $collection = \First\Wp\Runtime::plugin()->schema->collection( $name );
        first_admin_register_menu_item( 'collection-' . $name, array( 'to' => '/collections/' . rawurlencode( $name ), 'label' => $collection['label'] ?? $name, 'parent' => 'collections' ) );
    }
    first_admin_register_menu_item( 'media', array( 'to' => '/media', 'label' => __( 'Media', 'first-admin' ), 'icon' => 'dashicons-format-image' ) );
    first_admin_register_menu_item( 'globals', array( 'to' => '/globals', 'label' => __( 'Globals', 'first-admin' ), 'icon' => 'dashicons-admin-settings' ) );
    first_admin_register_menu_item( 'classic', array( 'to' => admin_url(), 'label' => __( 'Classic admin', 'first-admin' ), 'icon' => 'dashicons-wordpress' ) );
} );

// First collections already have access-aware entries. Keep native WordPress types alongside them.
add_filter( 'first_admin_native_post_types', static function ( $types ) {
    unset( $types['attachment'] );
    foreach ( \First\Wp\Runtime::plugin()->schema->collections() as $collection ) {
        if ( isset( $collection['wp']['postType'] ) ) {
            unset( $types[$collection['wp']['postType']] );
        }
    }
    return $types;
} );
