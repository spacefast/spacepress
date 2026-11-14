<?php
// Test stack only: one screen declared once for both admins (runtime/admin/lib/screens.php), over
// the test app's comments table. It lists through the app's `blog/comments-list` ability and
// approves through `blog/comments-update`, so who may see and do what is the app's access rules.
// runtime/admin/apps/wp-journey/screens.spec.ts opens it in First Admin and in classic wp-admin.
add_action('first_admin_screens', static function (): void {
    first_admin_register_screen('test-comments', [
        'title' => 'Comment review',
        'description' => 'Comments waiting for approval.',
        'capability' => 'read',
        'classic' => ['parent' => 'edit-comments.php'],
        'view' => [
            'ability' => 'blog/comments-list',
            // Waiting comments, newest first: `where` and `orderBy` as the list ability takes them.
            'input' => ['where' => ['approved' => false], 'orderBy' => ['createdAt' => 'desc'], 'limit' => 100],
            'items' => 'rows',
            'fields' => [
                ['id' => 'name', 'label' => 'Name'],
                ['id' => 'body', 'label' => 'Comment'],
                ['id' => 'approved', 'label' => 'Approved', 'type' => 'boolean'],
            ],
            'layout' => ['type' => 'table', 'fields' => ['body', 'approved'], 'titleField' => 'name'],
        ],
        'actions' => [
            ['id' => 'approve', 'label' => 'Approve', 'ability' => 'blog/comments-update', 'input' => ['id' => '{item.id}', 'patch' => ['approved' => true]]],
        ],
        'data' => ['Approving a comment publishes it.'],
    ]);
});

// A plugin that patches the users list with WordPress 7.1's own view config API.
add_filter('get_entity_view_config_root_user', static function (WP_View_Config_Data $data): WP_View_Config_Data {
    return $data->merge(['default_view' => ['perPage' => 37], 'view_list' => [['slug' => 'harness', 'title' => 'Harness tab', 'view' => ['filters' => []]]]], 1);
});
