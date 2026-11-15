<?php
/**
 * Classic wp-admin inside First Admin: the `/classic/<slug>` route frames a wp-admin page, and a
 * per-user developer mode decides whether classic wp-admin is also shown on its own.
 *
 * @package FirstAdmin
 */

/** The user meta that turns developer mode on for one user. Off unless set. */
const FIRST_ADMIN_DEVELOPER_MODE_META = 'first_admin_developer_mode';

/**
 * Handle iframe mode - call the parent window's _firstAdminLoad function if
 * present.
 */
function first_admin_handle_iframe_mode() {
	add_action(
		'admin_head',
		function () {
			echo '<script>window.frameElement?._firstAdminLoad?.();</script>';
		}
	);
}

/**
 * Whether a user has developer mode on: classic wp-admin opens on its own and First Admin's sidebar
 * links to it. Off (the default), classic pages open framed in First Admin.
 *
 * @param int|null $user_id User ID; the current user when null.
 * @return bool
 */
function first_admin_developer_mode( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;
	return $user_id > 0 && (bool) get_user_meta( $user_id, FIRST_ADMIN_DEVELOPER_MODE_META, true );
}

/**
 * `first_admin_developer_mode` on core's user route, which the profile form saves. A user may change
 * it where they may edit that user.
 */
function first_admin_register_developer_mode_field() {
	register_rest_field(
		'user',
		FIRST_ADMIN_DEVELOPER_MODE_META,
		array(
			'get_callback'    => static fn ( $user ) => first_admin_developer_mode( $user['id'] ),
			'update_callback' => static function ( $value, $user ) {
				if ( ! current_user_can( 'edit_user', $user->ID ) ) {
					return new WP_Error( 'rest_cannot_edit', __( 'Sorry, you are not allowed to edit this user.', 'first-admin' ), array( 'status' => rest_authorization_required_code() ) );
				}
				if ( $value ) {
					update_user_meta( $user->ID, FIRST_ADMIN_DEVELOPER_MODE_META, '1' );
				} else {
					delete_user_meta( $user->ID, FIRST_ADMIN_DEVELOPER_MODE_META );
				}
				return true;
			},
			'schema'          => array(
				'description' => __( 'Show classic wp-admin on its own, and link to it from First Admin.', 'first-admin' ),
				'type'        => 'boolean',
				'context'     => array( 'edit' ),
			),
		)
	);
}
add_action( 'rest_api_init', 'first_admin_register_developer_mode_field' );

/**
 * The classic pages that open framed in First Admin when a user without developer mode asks for
 * them as a page of their own. Editing (post.php, post-new.php), uploads, admin-ajax.php and
 * admin-post.php are not on it and are served as they always were.
 *
 * @return string[] wp-admin file names.
 */
function first_admin_framed_pages() {
	return apply_filters(
		'first_admin_framed_pages',
		array(
			'index.php',
			'edit-comments.php',
			'options-general.php',
			'options-writing.php',
			'options-reading.php',
			'options-discussion.php',
			'options-media.php',
			'options-permalink.php',
			'options-privacy.php',
			'tools.php',
			'import.php',
			'export.php',
			'site-health.php',
			'export-personal-data.php',
			'erase-personal-data.php',
			'profile.php',
			'users.php',
			'plugins.php',
			'themes.php',
			'upload.php',
			'edit.php',
			'edit-tags.php',
			'admin.php',
		)
	);
}

/**
 * Where a classic page opens in First Admin: the home route for the classic dashboard, otherwise
 * `/classic/<slug>`, or null when the page stays as it is.
 *
 * @param string $pagenow The wp-admin file (`options-general.php`).
 * @param string $query   The request's query string, without `?`.
 * @param string $page    wp-admin's `page` argument as WordPress read it (`$_GET['page']`): under
 *                        First Admin's rewrite the query is the route's, whose own `page` is not it.
 * @return string|null
 */
function first_admin_framed_url( $pagenow, $query, $page ) {
	if ( ! in_array( $pagenow, first_admin_framed_pages(), true ) ) {
		return null;
	}
	// First's own pages decide for themselves: First Admin's page, and the app's menu entry.
	if ( 'admin.php' === $pagenow && ( '' === $page || str_starts_with( $page, 'first-admin' ) || 'first-' . \First\Wp\Runtime::plugin()->schema->name() === $page ) ) {
		return null;
	}
	if ( 'index.php' === $pagenow && '' === $query ) {
		return first_admin_url( '/' );
	}
	$slug = $pagenow . ( '' !== $query ? '?' . $query : '' );
	$route = '/classic/' . rawurlencode( $slug );
	// Apache refuses an encoded slash in a path: a plugin page named after its file goes in the query form.
	return str_contains( $slug, '/' ) ? first_admin_query_url( $route ) : first_admin_url( $route );
}

/**
 * Without developer mode, a classic page the browser opens as a page of its own (a bookmark, a
 * notice's link, a plugin's redirect) opens framed in First Admin instead, so the user never sees
 * wp-admin's chrome. The frame's own request (`Sec-Fetch-Dest: iframe`) is served as is. A request
 * that doesn't say it is a top-level page (scripts, WP-CLI, REST, a browser without Fetch Metadata)
 * is served as is too.
 */
function first_admin_redirect_classic_page() {
	global $pagenow;
	if ( 'GET' !== ( $_SERVER['REQUEST_METHOD'] ?? '' ) || 'document' !== ( $_SERVER['HTTP_SEC_FETCH_DEST'] ?? '' )
		|| wp_doing_ajax() || ( defined( 'IFRAME_REQUEST' ) && IFRAME_REQUEST ) || ( defined( 'WP_CLI' ) && WP_CLI )
		|| ! is_string( $pagenow ) || first_admin_developer_mode()
		|| ! current_user_can( 'read' ) || \First\Wp\CoreAccess::viewer() === null ) {
		return;
	}
	$uri = wp_unslash( $_SERVER['REQUEST_URI'] ?? '' ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- compared, never printed.
	$page = is_string( $_GET['page'] ?? null ) ? wp_unslash( $_GET['page'] ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended,WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- compared, never printed.
	$to   = first_admin_framed_url( $pagenow, (string) wp_parse_url( $uri, PHP_URL_QUERY ), $page );
	if ( null !== $to ) {
		wp_safe_redirect( $to );
		exit;
	}
}

/**
 * The route's earlier address, `/legacy/<slug>`, for links saved before it was renamed: the same
 * page at `/classic/<slug>`.
 *
 * @param string $route The First Admin route the request asked for.
 * @return string|null The route to redirect to, or null.
 */
function first_admin_renamed_route( $route ) {
	return preg_match( '#^/legacy(/.*)$#', $route, $m ) ? '/classic' . $m[1] : null;
}
