<?php
declare(strict_types=1);

return array(
	'format'           => 'spacefast.wordpress-content-model.php',
	'version'          => 1,
	'revision'         => 'sha256:a559d636f943a672b1efbff954653ce9b085aea822b80f6a78efca48d3fd0769',
	'postTypes'        => array(
		array(
			'id'         => 'posts',
			'name'       => 'posts',
			'label'      => 'Posts',
			'kind'       => 'posts',
			'postType'   => 'post',
			'publicRead' => true,
			'fields'     => array(
				array(
					'id'          => 'posts-title',
					'name'        => 'title',
					'native'      => true,
					'storageName' => '_zero_posts_title',
					'definition'  => array(
						'label'       => 'Title',
						'required'    => true,
						'storageName' => '_zero_posts_title',
						'type'        => 'text',
						'multiline'   => false,
						'maxLength'   => 500,
					),
					'restSchema'  => array(
						'type' => 'string',
					),
				),
				array(
					'id'          => 'posts-content',
					'name'        => 'content',
					'native'      => true,
					'storageName' => '_zero_posts_content',
					'definition'  => array(
						'label'       => 'Content',
						'required'    => false,
						'storageName' => '_zero_posts_content',
						'type'        => 'richText',
					),
					'restSchema'  => array(
						'type'             => 'string',
						'contentMediaType' => 'text/html',
						'description'      => 'HTML. WordPress block markup is never exposed or accepted here.',
					),
				),
			),
		),
		array(
			'id'         => 'pages',
			'name'       => 'pages',
			'label'      => 'Pages',
			'kind'       => 'pages',
			'postType'   => 'page',
			'publicRead' => true,
			'fields'     => array(
				array(
					'id'          => 'pages-title',
					'name'        => 'title',
					'native'      => true,
					'storageName' => '_zero_pages_title',
					'definition'  => array(
						'label'       => 'Title',
						'required'    => true,
						'storageName' => '_zero_pages_title',
						'type'        => 'text',
						'multiline'   => false,
						'maxLength'   => 500,
					),
					'restSchema'  => array(
						'type' => 'string',
					),
				),
				array(
					'id'          => 'pages-content',
					'name'        => 'content',
					'native'      => true,
					'storageName' => '_zero_pages_content',
					'definition'  => array(
						'label'       => 'Content',
						'required'    => false,
						'storageName' => '_zero_pages_content',
						'type'        => 'richText',
					),
					'restSchema'  => array(
						'type'             => 'string',
						'contentMediaType' => 'text/html',
						'description'      => 'HTML. WordPress block markup is never exposed or accepted here.',
					),
				),
			),
		),
		array(
			'id'         => 'media',
			'name'       => 'media',
			'label'      => 'Media',
			'kind'       => 'media',
			'postType'   => 'attachment',
			'publicRead' => true,
			'fields'     => array(
				array(
					'id'          => 'media-alt',
					'name'        => 'alt',
					'native'      => true,
					'storageName' => '_zero_media_alt',
					'definition'  => array(
						'label'       => 'Alternative text',
						'required'    => false,
						'storageName' => '_zero_media_alt',
						'type'        => 'text',
						'multiline'   => false,
						'maxLength'   => 2000,
					),
					'restSchema'  => array(
						'type' => 'string',
					),
				),
			),
		),
		array(
			'id'         => 'projects',
			'name'       => 'projects',
			'label'      => 'Projects',
			'kind'       => 'collection',
			'postType'   => 'post',
			'publicRead' => true,
			'fields'     => array(
				array(
					'id'          => 'projects-title',
					'name'        => 'title',
					'native'      => true,
					'storageName' => '_zero_projects_title',
					'definition'  => array(
						'label'       => 'Title',
						'required'    => true,
						'storageName' => '_zero_projects_title',
						'type'        => 'text',
						'multiline'   => false,
						'maxLength'   => 120,
					),
					'restSchema'  => array(
						'type' => 'string',
					),
				),
				array(
					'id'          => 'projects-budget',
					'name'        => 'budget',
					'native'      => false,
					'storageName' => '_zero_projects_budget',
					'definition'  => array(
						'label'       => 'Budget',
						'required'    => false,
						'storageName' => '_zero_projects_budget',
						'type'        => 'number',
					),
					'restSchema'  => array(
						'type' => 'number',
					),
				),
				array(
					'id'          => 'projects-active',
					'name'        => 'active',
					'native'      => false,
					'storageName' => '_zero_projects_active',
					'definition'  => array(
						'label'       => 'Active',
						'required'    => false,
						'storageName' => '_zero_projects_active',
						'type'        => 'boolean',
					),
					'restSchema'  => array(
						'type' => 'boolean',
					),
				),
				array(
					'id'          => 'projects-kickoff',
					'name'        => 'kickoff',
					'native'      => false,
					'storageName' => '_zero_projects_kickoff',
					'definition'  => array(
						'label'       => 'Kickoff',
						'required'    => false,
						'storageName' => '_zero_projects_kickoff',
						'type'        => 'datetime',
					),
					'restSchema'  => array(
						'type'   => 'string',
						'format' => 'date-time',
					),
				),
				array(
					'id'          => 'projects-stage',
					'name'        => 'stage',
					'native'      => false,
					'storageName' => '_zero_projects_stage',
					'definition'  => array(
						'label'       => 'Stage',
						'required'    => false,
						'storageName' => '_zero_projects_stage',
						'type'        => 'select',
						'options'     => array(
							'idea',
							'live',
							'done',
						),
						'multiple'    => false,
					),
					'restSchema'  => array(
						'type' => 'string',
						'enum' => array(
							'idea',
							'live',
							'done',
						),
					),
				),
				array(
					'id'          => 'projects-tags',
					'name'        => 'tags',
					'native'      => false,
					'storageName' => '_zero_projects_tags',
					'definition'  => array(
						'label'       => 'Tags',
						'required'    => false,
						'storageName' => '_zero_projects_tags',
						'type'        => 'select',
						'options'     => array(
							'red',
							'green',
							'blue',
						),
						'multiple'    => true,
					),
					'restSchema'  => array(
						'type'  => 'array',
						'items' => array(
							'type' => 'string',
							'enum' => array(
								'red',
								'green',
								'blue',
							),
						),
					),
				),
				array(
					'id'          => 'projects-cover',
					'name'        => 'cover',
					'native'      => false,
					'storageName' => '_zero_projects_cover',
					'definition'  => array(
						'label'       => 'Cover',
						'required'    => false,
						'storageName' => '_zero_projects_cover',
						'type'        => 'media',
						'multiple'    => false,
					),
					'restSchema'  => array(
						'type' => 'integer',
					),
				),
				array(
					'id'          => 'projects-gallery',
					'name'        => 'gallery',
					'native'      => false,
					'storageName' => '_zero_projects_gallery',
					'definition'  => array(
						'label'       => 'Gallery',
						'required'    => false,
						'storageName' => '_zero_projects_gallery',
						'type'        => 'media',
						'multiple'    => true,
					),
					'restSchema'  => array(
						'type'  => 'array',
						'items' => array(
							'type' => 'integer',
						),
					),
				),
			),
		),
		array(
			'id'         => 'tasks',
			'name'       => 'tasks',
			'label'      => 'Tasks',
			'kind'       => 'collection',
			'postType'   => 'post',
			'publicRead' => true,
			'fields'     => array(
				array(
					'id'          => 'tasks-title',
					'name'        => 'title',
					'native'      => true,
					'storageName' => '_zero_tasks_title',
					'definition'  => array(
						'label'       => 'Title',
						'required'    => true,
						'storageName' => '_zero_tasks_title',
						'type'        => 'text',
						'multiline'   => false,
					),
					'restSchema'  => array(
						'type' => 'string',
					),
				),
				array(
					'id'          => 'tasks-notes',
					'name'        => 'notes',
					'native'      => false,
					'storageName' => '_zero_tasks_notes',
					'definition'  => array(
						'label'       => 'Notes',
						'required'    => false,
						'storageName' => '_zero_tasks_notes',
						'type'        => 'text',
						'multiline'   => true,
					),
					'restSchema'  => array(
						'type' => 'string',
					),
				),
				array(
					'id'          => 'tasks-project',
					'name'        => 'project',
					'native'      => false,
					'storageName' => '_zero_tasks_project',
					'definition'  => array(
						'label'       => 'Project',
						'required'    => true,
						'storageName' => '_zero_tasks_project',
						'type'        => 'relation',
						'collection'  => 'projects',
						'multiple'    => false,
					),
					'restSchema'  => array(
						'type' => 'integer',
					),
				),
				array(
					'id'          => 'tasks-parent',
					'name'        => 'parent',
					'native'      => false,
					'storageName' => '_zero_tasks_parent',
					'definition'  => array(
						'label'       => 'Parent',
						'required'    => false,
						'storageName' => '_zero_tasks_parent',
						'type'        => 'relation',
						'collection'  => 'tasks',
						'multiple'    => false,
					),
					'restSchema'  => array(
						'type' => 'integer',
					),
				),
			),
		),
	),
	'scfFieldGroups'   => array(
		array(
			'resourceId' => 'projects',
			'title'      => 'Projects fields',
			'fields'     => array(
				array(
					'id'         => 'projects-budget',
					'name'       => 'budget',
					'definition' => array(
						'label'       => 'Budget',
						'required'    => false,
						'storageName' => '_zero_projects_budget',
						'type'        => 'number',
					),
				),
				array(
					'id'         => 'projects-active',
					'name'       => 'active',
					'definition' => array(
						'label'       => 'Active',
						'required'    => false,
						'storageName' => '_zero_projects_active',
						'type'        => 'boolean',
					),
				),
				array(
					'id'         => 'projects-kickoff',
					'name'       => 'kickoff',
					'definition' => array(
						'label'       => 'Kickoff',
						'required'    => false,
						'storageName' => '_zero_projects_kickoff',
						'type'        => 'datetime',
					),
				),
				array(
					'id'         => 'projects-stage',
					'name'       => 'stage',
					'definition' => array(
						'label'       => 'Stage',
						'required'    => false,
						'storageName' => '_zero_projects_stage',
						'type'        => 'select',
						'options'     => array(
							'idea',
							'live',
							'done',
						),
						'multiple'    => false,
					),
				),
				array(
					'id'         => 'projects-tags',
					'name'       => 'tags',
					'definition' => array(
						'label'       => 'Tags',
						'required'    => false,
						'storageName' => '_zero_projects_tags',
						'type'        => 'select',
						'options'     => array(
							'red',
							'green',
							'blue',
						),
						'multiple'    => true,
					),
				),
				array(
					'id'         => 'projects-cover',
					'name'       => 'cover',
					'definition' => array(
						'label'       => 'Cover',
						'required'    => false,
						'storageName' => '_zero_projects_cover',
						'type'        => 'media',
						'multiple'    => false,
					),
				),
				array(
					'id'         => 'projects-gallery',
					'name'       => 'gallery',
					'definition' => array(
						'label'       => 'Gallery',
						'required'    => false,
						'storageName' => '_zero_projects_gallery',
						'type'        => 'media',
						'multiple'    => true,
					),
				),
			),
		),
		array(
			'resourceId' => 'tasks',
			'title'      => 'Tasks fields',
			'fields'     => array(
				array(
					'id'         => 'tasks-notes',
					'name'       => 'notes',
					'definition' => array(
						'label'       => 'Notes',
						'required'    => false,
						'storageName' => '_zero_tasks_notes',
						'type'        => 'text',
						'multiline'   => true,
					),
				),
				array(
					'id'         => 'tasks-project',
					'name'       => 'project',
					'definition' => array(
						'label'       => 'Project',
						'required'    => true,
						'storageName' => '_zero_tasks_project',
						'type'        => 'relation',
						'collection'  => 'projects',
						'multiple'    => false,
					),
				),
				array(
					'id'         => 'tasks-parent',
					'name'       => 'parent',
					'definition' => array(
						'label'       => 'Parent',
						'required'    => false,
						'storageName' => '_zero_tasks_parent',
						'type'        => 'relation',
						'collection'  => 'tasks',
						'multiple'    => false,
					),
				),
			),
		),
	),
	'tables'           => array(),
	'pages'            => array(),
	'abilities'        => array(),
	'hooks'            => array(),
	'syncBindings'     => array(),
	'materializations' => array(),
);
