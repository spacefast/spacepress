<?php
// Test stack only: one screen declared once for both admins (runtime/admin/lib/screens.php), over
// the test app's comments table. It lists through the app's `blog/comments-list` ability and
// approves through `blog/comments-update`, so who may see and do what is the app's access rules.
// runtime/admin/apps/wp-journey/screens.spec.ts opens it in SpacePress Admin and in classic wp-admin.
add_action(
	'sp_admin_screens',
	static function (): void {
		sp_admin_register_screen(
			'test-comments',
			array(
				'title'       => 'Comment review',
				'description' => 'Comments waiting for approval.',
				'capability'  => 'read',
				'classic'     => array( 'parent' => 'edit-comments.php' ),
				'view'        => array(
					'ability' => 'blog/comments-list',
					// Waiting comments, newest first: `where` and `orderBy` as the list ability takes them.
					'input'   => array(
						'where'   => array( 'approved' => false ),
						'orderBy' => array( 'createdAt' => 'desc' ),
						'limit'   => 100,
					),
					'items'   => 'rows',
					'fields'  => array(
						array(
							'id'    => 'name',
							'label' => 'Name',
						),
						array(
							'id'    => 'body',
							'label' => 'Comment',
						),
						array(
							'id'    => 'approved',
							'label' => 'Approved',
							'type'  => 'boolean',
						),
					),
					'layout'  => array(
						'type'       => 'table',
						'fields'     => array( 'body', 'approved' ),
						'titleField' => 'name',
					),
				),
				'actions'     => array(
					array(
						'id'      => 'approve',
						'label'   => 'Approve',
						'ability' => 'blog/comments-update',
						'input'   => array(
							'id'    => '{item.id}',
							'patch' => array( 'approved' => true ),
						),
					),
				),
				'data'        => array( 'Approving a comment publishes it.' ),
			)
		);
		// An administrators-only screen: the same list, and a `data` line that must never reach anyone else.
		sp_admin_register_screen(
			'test-admin-only',
			array(
				'title'      => 'Admin only',
				'capability' => 'manage_options',
				'classic'    => array( 'parent' => 'tools.php' ),
				'view'       => array(
					'ability' => 'blog/comments-list',
					'items'   => 'rows',
					'fields'  => array( array( 'id' => 'body' ) ),
				),
				'data'       => static function (): array {
					update_option( 'sp_harness_admin_only_data', (int) get_option( 'sp_harness_admin_only_data', 0 ) + 1, false );
					return array( 'Administrators only.' );
				},
			)
		);
	}
);

// A plugin that patches the users list with WordPress 7.1's own view config API.
add_filter(
	'get_entity_view_config_root_user',
	static function ( WP_View_Config_Data $data ): WP_View_Config_Data {
		return $data->merge(
			array(
				'default_view' => array( 'perPage' => 37 ),
				'view_list'    => array(
					array(
						'slug'  => 'harness',
						'title' => 'Harness tab',
						'view'  => array( 'filters' => array() ),
					),
				),
			),
			1
		);
	}
);
