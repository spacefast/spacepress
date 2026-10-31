<?php
/**
 * Post type registration overrides and default view configuration.
 *
 * @package ZeroAdmin
 */

/**
 * The media library's default DataViews configuration, attached to the
 * attachment post type so the screen reads it from `wp/v2/types`.
 *
 * @param array  $args      Post type arguments.
 * @param string $post_type Post type name.
 * @return array Modified post type arguments.
 */
function zero_admin_register_default_view_arg_for_post_type( $args, $post_type ) {
	if ( 'attachment' !== $post_type ) {
		return $args;
	}

	$default_view    = array(
		'type'       => 'grid',
		'perPage'    => 20,
		'sort'       => array(
			'field'     => 'date',
			'direction' => 'desc',
		),
		'titleField' => 'title',
		'mediaField' => 'media_thumbnail',
		'fields'     => array(),
		'showLevels' => false,
		'showMedia'  => true,
		'showTitle'  => false,
	);
	$default_layouts = array(
		'list'  => array(
			'fields'    => array( 'author', 'date', 'media_dimensions', 'filesize' ),
			'showTitle' => true,
		),
		'grid'  => array(
			'fields'    => array(),
			'showTitle' => false,
		),
		'table' => array(
			'fields'    => array( 'author', 'date', 'media_dimensions', 'filesize' ),
			'showTitle' => true,
		),
	);

	$args['default_view']    = $default_view;
	$args['default_layouts'] = $default_layouts;
	$args['import_handler']  = plugin_dir_url( __DIR__ ) . 'build/packages/attachment-importer/index.js';

	$args['quick_edit_form'] = array(
		'layout' => array(
			'type' => 'panel',
		),
		'fields' => array(
			'date',
			'author',
			'filename',
			'mime_type',
			'filesize',
			'media_dimensions',
			'attached_to',
			array(
				'id'     => 'title',
				'layout' => array(
					'type'          => 'regular',
					'labelPosition' => 'top',
				),
			),
			array(
				'id'     => 'alt_text',
				'layout' => array(
					'type'          => 'regular',
					'labelPosition' => 'top',
				),
			),
			array(
				'id'     => 'caption',
				'layout' => array(
					'type'          => 'regular',
					'labelPosition' => 'top',
				),
			),
			array(
				'id'     => 'description',
				'layout' => array(
					'type'          => 'regular',
					'labelPosition' => 'top',
				),
			),
		),
	);

	if ( ! isset( $args['views'] ) ) {
		$tabs = array(
			array(
				'media_type' => 'image',
				'label'      => __( 'Images', 'zero-admin' ),
			),
			array(
				'media_type' => 'video',
				'label'      => __( 'Videos', 'zero-admin' ),
			),
			array(
				'media_type' => 'audio',
				'label'      => __( 'Audio', 'zero-admin' ),
			),
			array(
				'media_type' => 'application',
				'label'      => __( 'Files', 'zero-admin' ),
			),
		);

		$args['views'] = array_merge(
			array(
				array(
					'slug'  => 'all',
					/* translators: Label for showing all posts regardless of status */
					'label' => __( 'All', 'zero-admin' ),
					'view'  => $default_view,
				),
			),
			array_map(
				function ( $tab ) use ( $default_view ) {
					return array(
						'slug'  => $tab['media_type'],
						'label' => $tab['label'],
						'view'  => array_merge(
							$default_view,
							array(
								'filters' => array_merge(
									$default_view['filters'] ?? array(),
									array(
										array(
											'field'    => 'media_type',
											'operator' => 'is',
											'value'    => $tab['media_type'],
										),
									)
								),
							)
						),
					);
				},
				$tabs
			)
		);
	}

	return $args;
}
add_filter( 'register_post_type_args', 'zero_admin_register_default_view_arg_for_post_type', 10, 2 );
