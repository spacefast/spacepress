<?php
/**
 * WordPress REST API extensions.
 *
 * @package Zero_Admin
 */

add_filter(
	'rest_post_type_collection_params',
	function ( $params ) {
		$params['default_view']    = array(
			'description' => 'Default DataViews config for the post type',
			'type'        => 'object',
			'default'     => (object) array(),
		);
		$params['quick_edit_form'] = array(
			'description' => 'Default DataForm config for the quick edit form for the post type',
			'type'        => 'object',
			'default'     => (object) array(),
		);
		return $params;
	}
);

add_filter(
	'rest_prepare_post_type',
	function ( $response, $post_type ) {
		$response->data['default_view']    = $post_type->default_view;
		$response->data['default_layouts'] = $post_type->default_layouts;
		$response->data['quick_edit_form'] = $post_type->quick_edit_form;
		if ( isset( $post_type->views ) ) {
			$response->data['views'] = $post_type->views;
		}
		if ( isset( $post_type->import_handler ) ) {
			$response->data['import_handler'] = $post_type->import_handler;
		}
		return $response;
	},
	10,
	2
);

/**
 * Allow auto-draft status in WordPress REST API for all post types
 */
function zero_admin_allow_auto_draft_in_rest_api() {
	$auto_draft_filter = function ( $schema ) {
		if ( isset( $schema['properties']['status']['enum'] ) ) {
			$schema['properties']['status']['enum'][] = 'auto-draft';
		}
		return $schema;
	};

	// Get post types that should support auto-draft.
	$post_types = get_post_types(
		array(
			'show_in_rest' => true,
			'show_ui'      => true,
		),
		'objects'
	);

	foreach ( $post_types as $post_type ) {
		$supports_editor   = post_type_supports( $post_type->name, 'editor' );
		$supports_title    = post_type_supports( $post_type->name, 'title' );
		$is_wp_core_system = strpos( $post_type->name, 'wp_' ) === 0;
		$is_attachment     = 'attachment' === $post_type->name;

		// Only add auto-draft to content post types:
		// - Must support either editor or title (content editing capabilities).
		// - Exclude WordPress core system types (wp_block, wp_navigation, etc.).
		// - Exclude attachments (media files don't need auto-draft status).
		$should_support_auto_draft = ( $supports_editor || $supports_title ) &&
										! $is_wp_core_system &&
										! $is_attachment;

		if ( $should_support_auto_draft ) {
			add_filter( "rest_{$post_type->name}_item_schema", $auto_draft_filter );
		}
	}
}

add_action( 'rest_api_init', 'zero_admin_allow_auto_draft_in_rest_api' );

/**
 * Add comment_status filtering support to REST API for all post types that support comments
 */
function zero_admin_add_comment_status_filter_to_rest_api() {
	$post_types = get_post_types( array( 'show_in_rest' => true ), 'objects' );

	foreach ( $post_types as $post_type ) {
		if ( post_type_supports( $post_type->name, 'comments' ) ) {
			add_filter(
				"rest_{$post_type->name}_query",
				function ( $args, $request ) {
					if ( ! empty( $request['comment_status'] ) ) {
						$args['comment_status'] = sanitize_text_field( $request['comment_status'] );
					}

					if ( ! empty( $request['comment_status_exclude'] ) ) {
						$excluded_status        = sanitize_text_field( $request['comment_status_exclude'] );
						$args['comment_status'] = 'open' === $excluded_status ? 'closed' : 'open';
					}

					return $args;
				},
				10,
				2
			);
		}
	}
}

add_action( 'rest_api_init', 'zero_admin_add_comment_status_filter_to_rest_api' );

/**
 * Add comment_status parameters to REST API collection params for all post types that support comments
 */
function zero_admin_add_comment_status_collection_params() {
	$post_types = get_post_types( array( 'show_in_rest' => true ), 'objects' );

	foreach ( $post_types as $post_type ) {
		if ( post_type_supports( $post_type->name, 'comments' ) ) {
			add_filter(
				"rest_{$post_type->name}_collection_params",
				function ( $params ) {
					$params['comment_status'] = array(
						'description' => 'Limit result set to posts with a specific comment status.',
						'type'        => 'string',
						'enum'        => array( 'open', 'closed' ),
					);

					$params['comment_status_exclude'] = array(
						'description' => 'Exclude posts with a specific comment status.',
						'type'        => 'string',
						'enum'        => array( 'open', 'closed' ),
					);

					return $params;
				}
			);
		}
	}
}

add_action( 'rest_api_init', 'zero_admin_add_comment_status_collection_params' );

/**
 * Add comment count field to REST API response for posts. Don't compute it, as
 * it will be exposed by `zero_admin_prepare_comment_count_rest_field`.
 */
function zero_admin_register_comment_count_rest_field() {
	register_rest_field(
		'post',
		'comment_count',
		array(
			'schema' => array(
				'description' => __( 'Number of approved comments for this post.', 'zero-admin' ),
				'type'        => 'integer',
			),
		)
	);
}

/**
 * Expose `WP_Post`'s `comment_count` property in REST API response for posts.
 *
 * @param WP_REST_Response $response The response object.
 * @param WP_Post          $post     Post object.
 */
function zero_admin_prepare_comment_count_rest_field( $response, $post ) {
	$response->data['comment_count'] = (int) $post->comment_count;
	return $response;
}

add_action( 'rest_api_init', 'zero_admin_register_comment_count_rest_field' );
add_filter( 'rest_prepare_post', 'zero_admin_prepare_comment_count_rest_field', 10, 2 );

/**
 * Overrides the REST controller for the `attachments` post type.
 *
 * @param array $args Array of arguments for registering a post type.
 *                          See the register_post_type() function for accepted arguments.
 *
 * @return array Array of arguments for registering a post type.
 */
function zero_admin_override_attachments_endpoint( array $args ): array {
	$args['rest_controller_class']   = 'Zero_Admin_REST_Attachments_Controller';
	$args['late_route_registration'] = true;

	return $args;
}
add_filter( 'register_attachment_post_type_args', 'zero_admin_override_attachments_endpoint' );
