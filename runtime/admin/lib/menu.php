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
    first_admin_register_menu_item( 'all-collections', array( 'to' => '/collections', 'label' => __( 'All collections', 'first-admin' ), 'parent' => 'collections' ) );
    foreach ( first_admin_navigation() as $name ) {
        $collection = \First\Wp\Runtime::plugin()->schema->collection( $name );
        first_admin_register_menu_item( 'collection-' . $name, array( 'to' => '/collections/' . rawurlencode( $name ), 'label' => $collection['label'] ?? $name, 'parent' => 'collections' ) );
    }
    first_admin_register_menu_item( 'media', array( 'to' => '/media', 'label' => __( 'Media', 'first-admin' ), 'icon' => 'dashicons-format-image' ) );
    first_admin_register_menu_item( 'globals', array( 'to' => '/globals', 'label' => __( 'Globals', 'first-admin' ), 'icon' => 'dashicons-admin-settings' ) );
    // Classic wp-admin on its own is for developers: everyone else reaches its pages framed, below.
    if ( first_admin_developer_mode() ) {
        first_admin_register_menu_item( 'classic', array( 'to' => admin_url(), 'label' => __( 'Classic admin', 'first-admin' ), 'icon' => 'dashicons-wordpress' ) );
    }
    if ( first_admin_comments_relevant() && current_user_can( 'moderate_comments' ) ) {
        first_admin_register_classic_children( 'comments', __( 'Comments', 'first-admin' ), 'dashicons-admin-comments', 'edit-comments.php' );
    }
    if ( current_user_can( 'edit_posts' ) ) {
        first_admin_register_classic_children( 'tools', __( 'Tools', 'first-admin' ), 'dashicons-admin-tools', 'tools.php' );
    }
} );

/**
 * Whether comments are part of this app: a collection takes them (`comments: true`, the only kinds
 * the `comments` hardening switch leaves open), or the site has comments to moderate anyway.
 *
 * @return bool
 */
function first_admin_comments_relevant() {
    foreach ( \First\Wp\Runtime::plugin()->schema->collections() as $collection ) {
        if ( true === ( $collection['comments'] ?? false ) ) {
            return true;
        }
    }
    return (int) wp_count_comments()->total_comments > 0;
}

/**
 * A sidebar dropdown for a classic menu (Comments, Tools): one entry per page wp-admin lists under
 * it for this user, each opening framed at `/classic/<slug>`. Plugin pages under it are included;
 * pages the user may not open (an editor the site refuses, say) wp-admin has already left out.
 *
 * @param string $id     Menu id.
 * @param string $label  Menu label.
 * @param string $icon   Dashicon.
 * @param string $parent wp-admin parent file.
 * @param array  $skip   Parent-menu slugs First Admin shows natively.
 */
function first_admin_register_classic_children( $id, $label, $icon, $parent, $skip = array() ) {
    global $submenu;
    $children = array();
    foreach ( (array) ( $submenu[ $parent ] ?? array() ) as $item ) {
        // A declared screen (`first-screen-<id>`) has its own sidebar entry (lib/screens.php).
        if ( empty( $item[0] ) || empty( $item[2] ) || in_array( $item[2], $skip, true ) || str_starts_with( $item[2], 'first-screen-' )
            || ( ! empty( $item[1] ) && ! current_user_can( $item[1] ) ) ) {
            continue;
        }
        $children[] = $item;
    }
    if ( array() === $children ) {
        return;
    }
    if ( null !== $label ) {
        first_admin_register_menu_item( $id, array( 'label' => $label, 'icon' => $icon, 'parent_type' => 'dropdown' ) );
    }
    foreach ( $children as $item ) {
        first_admin_register_menu_item(
            $id . '-' . sanitize_key( $item[2] ),
            array(
                'to'     => first_admin_get_menu_to_from_slug( $item[2], $parent ),
                'label'  => wp_strip_all_tags( preg_replace( '/<span.*/s', '', $item[0] ) ),
                'parent' => $id,
            )
        );
    }
}

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

// Inside wp-admin, the classic menu lists First's post types and its globals page; First Admin
// has its own entries for both (Collections, Globals), so the copied plugin menu leaves them out.
add_filter( 'first_admin_classic_menu_items_exclude', static function ( $slugs ) {
    $plugin = \First\Wp\Runtime::plugin();
    foreach ( $plugin->schema->collections() as $collection ) {
        if ( isset( $collection['wp']['postType'] ) ) {
            $slugs[] = 'edit.php?post_type=' . $collection['wp']['postType'];
        }
    }
    $slugs[] = 'first-' . $plugin->schema->name();
    return $slugs;
} );
