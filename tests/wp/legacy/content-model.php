<?php
declare(strict_types=1);

return [
    'format' => 'spacefast.wordpress-content-model.php',
    'version' => 1,
    'revision' => 'sha256:a559d636f943a672b1efbff954653ce9b085aea822b80f6a78efca48d3fd0769',
    'postTypes' => [
        [
            'id' => 'posts',
            'name' => 'posts',
            'label' => 'Posts',
            'kind' => 'posts',
            'postType' => 'post',
            'publicRead' => true,
            'fields' => [
                [
                    'id' => 'posts-title',
                    'name' => 'title',
                    'native' => true,
                    'storageName' => '_zero_posts_title',
                    'definition' => [
                        'label' => 'Title',
                        'required' => true,
                        'storageName' => '_zero_posts_title',
                        'type' => 'text',
                        'multiline' => false,
                        'maxLength' => 500,
                    ],
                    'restSchema' => [
                        'type' => 'string',
                    ],
                ],
                [
                    'id' => 'posts-content',
                    'name' => 'content',
                    'native' => true,
                    'storageName' => '_zero_posts_content',
                    'definition' => [
                        'label' => 'Content',
                        'required' => false,
                        'storageName' => '_zero_posts_content',
                        'type' => 'richText',
                    ],
                    'restSchema' => [
                        'type' => 'string',
                        'contentMediaType' => 'text/html',
                        'description' => 'HTML. WordPress block markup is never exposed or accepted here.',
                    ],
                ],
            ],
        ],
        [
            'id' => 'pages',
            'name' => 'pages',
            'label' => 'Pages',
            'kind' => 'pages',
            'postType' => 'page',
            'publicRead' => true,
            'fields' => [
                [
                    'id' => 'pages-title',
                    'name' => 'title',
                    'native' => true,
                    'storageName' => '_zero_pages_title',
                    'definition' => [
                        'label' => 'Title',
                        'required' => true,
                        'storageName' => '_zero_pages_title',
                        'type' => 'text',
                        'multiline' => false,
                        'maxLength' => 500,
                    ],
                    'restSchema' => [
                        'type' => 'string',
                    ],
                ],
                [
                    'id' => 'pages-content',
                    'name' => 'content',
                    'native' => true,
                    'storageName' => '_zero_pages_content',
                    'definition' => [
                        'label' => 'Content',
                        'required' => false,
                        'storageName' => '_zero_pages_content',
                        'type' => 'richText',
                    ],
                    'restSchema' => [
                        'type' => 'string',
                        'contentMediaType' => 'text/html',
                        'description' => 'HTML. WordPress block markup is never exposed or accepted here.',
                    ],
                ],
            ],
        ],
        [
            'id' => 'media',
            'name' => 'media',
            'label' => 'Media',
            'kind' => 'media',
            'postType' => 'attachment',
            'publicRead' => true,
            'fields' => [
                [
                    'id' => 'media-alt',
                    'name' => 'alt',
                    'native' => true,
                    'storageName' => '_zero_media_alt',
                    'definition' => [
                        'label' => 'Alternative text',
                        'required' => false,
                        'storageName' => '_zero_media_alt',
                        'type' => 'text',
                        'multiline' => false,
                        'maxLength' => 2000,
                    ],
                    'restSchema' => [
                        'type' => 'string',
                    ],
                ],
            ],
        ],
        [
            'id' => 'projects',
            'name' => 'projects',
            'label' => 'Projects',
            'kind' => 'collection',
            'postType' => 'post',
            'publicRead' => true,
            'fields' => [
                [
                    'id' => 'projects-title',
                    'name' => 'title',
                    'native' => true,
                    'storageName' => '_zero_projects_title',
                    'definition' => [
                        'label' => 'Title',
                        'required' => true,
                        'storageName' => '_zero_projects_title',
                        'type' => 'text',
                        'multiline' => false,
                        'maxLength' => 120,
                    ],
                    'restSchema' => [
                        'type' => 'string',
                    ],
                ],
                [
                    'id' => 'projects-budget',
                    'name' => 'budget',
                    'native' => false,
                    'storageName' => '_zero_projects_budget',
                    'definition' => [
                        'label' => 'Budget',
                        'required' => false,
                        'storageName' => '_zero_projects_budget',
                        'type' => 'number',
                    ],
                    'restSchema' => [
                        'type' => 'number',
                    ],
                ],
                [
                    'id' => 'projects-active',
                    'name' => 'active',
                    'native' => false,
                    'storageName' => '_zero_projects_active',
                    'definition' => [
                        'label' => 'Active',
                        'required' => false,
                        'storageName' => '_zero_projects_active',
                        'type' => 'boolean',
                    ],
                    'restSchema' => [
                        'type' => 'boolean',
                    ],
                ],
                [
                    'id' => 'projects-kickoff',
                    'name' => 'kickoff',
                    'native' => false,
                    'storageName' => '_zero_projects_kickoff',
                    'definition' => [
                        'label' => 'Kickoff',
                        'required' => false,
                        'storageName' => '_zero_projects_kickoff',
                        'type' => 'datetime',
                    ],
                    'restSchema' => [
                        'type' => 'string',
                        'format' => 'date-time',
                    ],
                ],
                [
                    'id' => 'projects-stage',
                    'name' => 'stage',
                    'native' => false,
                    'storageName' => '_zero_projects_stage',
                    'definition' => [
                        'label' => 'Stage',
                        'required' => false,
                        'storageName' => '_zero_projects_stage',
                        'type' => 'select',
                        'options' => [
                            'idea',
                            'live',
                            'done',
                        ],
                        'multiple' => false,
                    ],
                    'restSchema' => [
                        'type' => 'string',
                        'enum' => [
                            'idea',
                            'live',
                            'done',
                        ],
                    ],
                ],
                [
                    'id' => 'projects-tags',
                    'name' => 'tags',
                    'native' => false,
                    'storageName' => '_zero_projects_tags',
                    'definition' => [
                        'label' => 'Tags',
                        'required' => false,
                        'storageName' => '_zero_projects_tags',
                        'type' => 'select',
                        'options' => [
                            'red',
                            'green',
                            'blue',
                        ],
                        'multiple' => true,
                    ],
                    'restSchema' => [
                        'type' => 'array',
                        'items' => [
                            'type' => 'string',
                            'enum' => [
                                'red',
                                'green',
                                'blue',
                            ],
                        ],
                    ],
                ],
                [
                    'id' => 'projects-cover',
                    'name' => 'cover',
                    'native' => false,
                    'storageName' => '_zero_projects_cover',
                    'definition' => [
                        'label' => 'Cover',
                        'required' => false,
                        'storageName' => '_zero_projects_cover',
                        'type' => 'media',
                        'multiple' => false,
                    ],
                    'restSchema' => [
                        'type' => 'integer',
                    ],
                ],
                [
                    'id' => 'projects-gallery',
                    'name' => 'gallery',
                    'native' => false,
                    'storageName' => '_zero_projects_gallery',
                    'definition' => [
                        'label' => 'Gallery',
                        'required' => false,
                        'storageName' => '_zero_projects_gallery',
                        'type' => 'media',
                        'multiple' => true,
                    ],
                    'restSchema' => [
                        'type' => 'array',
                        'items' => [
                            'type' => 'integer',
                        ],
                    ],
                ],
            ],
        ],
        [
            'id' => 'tasks',
            'name' => 'tasks',
            'label' => 'Tasks',
            'kind' => 'collection',
            'postType' => 'post',
            'publicRead' => true,
            'fields' => [
                [
                    'id' => 'tasks-title',
                    'name' => 'title',
                    'native' => true,
                    'storageName' => '_zero_tasks_title',
                    'definition' => [
                        'label' => 'Title',
                        'required' => true,
                        'storageName' => '_zero_tasks_title',
                        'type' => 'text',
                        'multiline' => false,
                    ],
                    'restSchema' => [
                        'type' => 'string',
                    ],
                ],
                [
                    'id' => 'tasks-notes',
                    'name' => 'notes',
                    'native' => false,
                    'storageName' => '_zero_tasks_notes',
                    'definition' => [
                        'label' => 'Notes',
                        'required' => false,
                        'storageName' => '_zero_tasks_notes',
                        'type' => 'text',
                        'multiline' => true,
                    ],
                    'restSchema' => [
                        'type' => 'string',
                    ],
                ],
                [
                    'id' => 'tasks-project',
                    'name' => 'project',
                    'native' => false,
                    'storageName' => '_zero_tasks_project',
                    'definition' => [
                        'label' => 'Project',
                        'required' => true,
                        'storageName' => '_zero_tasks_project',
                        'type' => 'relation',
                        'collection' => 'projects',
                        'multiple' => false,
                    ],
                    'restSchema' => [
                        'type' => 'integer',
                    ],
                ],
                [
                    'id' => 'tasks-parent',
                    'name' => 'parent',
                    'native' => false,
                    'storageName' => '_zero_tasks_parent',
                    'definition' => [
                        'label' => 'Parent',
                        'required' => false,
                        'storageName' => '_zero_tasks_parent',
                        'type' => 'relation',
                        'collection' => 'tasks',
                        'multiple' => false,
                    ],
                    'restSchema' => [
                        'type' => 'integer',
                    ],
                ],
            ],
        ],
    ],
    'scfFieldGroups' => [
        [
            'resourceId' => 'projects',
            'title' => 'Projects fields',
            'fields' => [
                [
                    'id' => 'projects-budget',
                    'name' => 'budget',
                    'definition' => [
                        'label' => 'Budget',
                        'required' => false,
                        'storageName' => '_zero_projects_budget',
                        'type' => 'number',
                    ],
                ],
                [
                    'id' => 'projects-active',
                    'name' => 'active',
                    'definition' => [
                        'label' => 'Active',
                        'required' => false,
                        'storageName' => '_zero_projects_active',
                        'type' => 'boolean',
                    ],
                ],
                [
                    'id' => 'projects-kickoff',
                    'name' => 'kickoff',
                    'definition' => [
                        'label' => 'Kickoff',
                        'required' => false,
                        'storageName' => '_zero_projects_kickoff',
                        'type' => 'datetime',
                    ],
                ],
                [
                    'id' => 'projects-stage',
                    'name' => 'stage',
                    'definition' => [
                        'label' => 'Stage',
                        'required' => false,
                        'storageName' => '_zero_projects_stage',
                        'type' => 'select',
                        'options' => [
                            'idea',
                            'live',
                            'done',
                        ],
                        'multiple' => false,
                    ],
                ],
                [
                    'id' => 'projects-tags',
                    'name' => 'tags',
                    'definition' => [
                        'label' => 'Tags',
                        'required' => false,
                        'storageName' => '_zero_projects_tags',
                        'type' => 'select',
                        'options' => [
                            'red',
                            'green',
                            'blue',
                        ],
                        'multiple' => true,
                    ],
                ],
                [
                    'id' => 'projects-cover',
                    'name' => 'cover',
                    'definition' => [
                        'label' => 'Cover',
                        'required' => false,
                        'storageName' => '_zero_projects_cover',
                        'type' => 'media',
                        'multiple' => false,
                    ],
                ],
                [
                    'id' => 'projects-gallery',
                    'name' => 'gallery',
                    'definition' => [
                        'label' => 'Gallery',
                        'required' => false,
                        'storageName' => '_zero_projects_gallery',
                        'type' => 'media',
                        'multiple' => true,
                    ],
                ],
            ],
        ],
        [
            'resourceId' => 'tasks',
            'title' => 'Tasks fields',
            'fields' => [
                [
                    'id' => 'tasks-notes',
                    'name' => 'notes',
                    'definition' => [
                        'label' => 'Notes',
                        'required' => false,
                        'storageName' => '_zero_tasks_notes',
                        'type' => 'text',
                        'multiline' => true,
                    ],
                ],
                [
                    'id' => 'tasks-project',
                    'name' => 'project',
                    'definition' => [
                        'label' => 'Project',
                        'required' => true,
                        'storageName' => '_zero_tasks_project',
                        'type' => 'relation',
                        'collection' => 'projects',
                        'multiple' => false,
                    ],
                ],
                [
                    'id' => 'tasks-parent',
                    'name' => 'parent',
                    'definition' => [
                        'label' => 'Parent',
                        'required' => false,
                        'storageName' => '_zero_tasks_parent',
                        'type' => 'relation',
                        'collection' => 'tasks',
                        'multiple' => false,
                    ],
                ],
            ],
        ],
    ],
    'tables' => [],
    'pages' => [],
    'abilities' => [],
    'hooks' => [],
    'syncBindings' => [],
    'materializations' => [],
];
