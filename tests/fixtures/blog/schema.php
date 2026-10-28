<?php

// Hand-written frozen fixture: what `zero build examples/blog --target standalone` must emit
// (design §2, schema.php v2). The compiler (R) matches this file in behaviour; the runtime (P)
// and the WP stores (W) code against it.
//
// Decisions taken where the contract is silent (P, 2026-10-28):
//  1. Compiled function names: access `<table>__access__<op>` (design §1.6); validators
//     `<table>__validate__<column>` (nested: `<table>__validate__<column>__<sub>`, globals
//     `global__<name>__validate__<field>`); hooks `<table>__<hook>`; actions `action__<name>`.
//  2. `authors` is post-backed by default (`editor` defaults to true), so it gets drafts + revisions
//     and the two system columns like posts. Its read rule is the shorthand "anyone", so anonymous
//     readers only see published authors (§1.6 draft visibility).
//  3. `beforeCreateFills` is emitted as [] when empty (key always present, §2).
//  4. `slug()` without `.notNull()` stays nullable; `unique` is implied by slug() and emitted.
//  5. Every `access` op is emitted explicitly (defaults resolved by the compiler); actions always
//     carry `access`.
//  6. Global field shapes reuse the column shape; `wp` identifiers are emitted on both targets.
//  7. `select({ multiple: true })` column default `[]` is emitted as ['value' => []].

declare(strict_types=1);

$drafts = [
    'status' => ['type' => 'text', 'notNull' => true, 'enum' => ['draft', 'published', 'scheduled'], 'default' => ['value' => 'published'], 'system' => true],
    'publishedAt' => ['type' => 'timestamp', 'system' => true],
];
$crud = ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true];

return [
    'version' => 2,
    'name' => 'blog',
    'target' => 'standalone',
    'collections' => [
        'authors' => [
            'key' => 'authors',
            'label' => 'Authors',
            'editor' => true,
            'drafts' => true,
            'revisions' => true,
            'title' => 'name',
            'content' => null,
            'slug' => null,
            'primaryKey' => 'id',
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'name' => ['type' => 'text', 'notNull' => true, 'rules' => ['max' => 80]],
                'email' => ['type' => 'email', 'notNull' => true, 'unique' => true, 'rules' => ['max' => 191]],
                'bio' => ['type' => 'text', 'multiline' => true, 'rules' => ['max' => 500]],
                'avatar' => ['type' => 'media', 'accept' => 'image'],
                'userId' => ['type' => 'integer'],
            ] + $drafts,
            'relations' => [
                'posts' => ['kind' => 'many', 'collection' => 'posts', 'from' => 'id', 'to' => 'authorId', 'optional' => false],
            ],
            'hooks' => [],
            'beforeCreateFills' => [],
            'access' => [
                'read' => ['role' => 'anyone'],
                'create' => ['role' => 'admin'],
                'update' => ['role' => 'admin'],
                'delete' => ['role' => 'admin'],
            ],
            'api' => $crud,
            'wp' => ['postType' => 'zero_authors', 'groupKey' => 'group_zero_authors', 'metaPrefix' => 'zero_', 'fieldKeyPrefix' => 'field_zero_authors_'],
            'table' => null,
        ],
        'posts' => [
            'key' => 'posts',
            'label' => 'Posts',
            'editor' => true,
            'drafts' => true,
            'revisions' => true,
            'title' => 'title',
            'content' => 'body',
            'slug' => 'slug',
            'primaryKey' => 'id',
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'title' => ['type' => 'text', 'notNull' => true, 'rules' => ['min' => 1, 'max' => 120]],
                'slug' => ['type' => 'slug', 'unique' => true, 'source' => 'title'],
                'body' => ['type' => 'richText'],
                'excerpt' => ['type' => 'text', 'multiline' => true, 'rules' => ['max' => 300]],
                'cover' => ['type' => 'media', 'accept' => 'image'],
                'tags' => ['type' => 'select', 'multiple' => true, 'enum' => ['news', 'guide', 'release'], 'notNull' => true, 'default' => ['value' => []]],
                'authorId' => ['type' => 'integer', 'references' => ['collection' => 'authors', 'column' => 'id', 'onDelete' => 'set null']],
                'seo' => ['type' => 'group', 'fields' => [
                    'metaTitle' => ['type' => 'text', 'rules' => ['max' => 70]],
                    'metaDescription' => ['type' => 'text', 'rules' => ['max' => 160]],
                    'noindex' => ['type' => 'boolean', 'notNull' => true, 'default' => ['value' => false]],
                ]],
                'gallery' => ['type' => 'repeater', 'rules' => ['max' => 12], 'fields' => [
                    'image' => ['type' => 'media', 'accept' => 'image', 'notNull' => true],
                    'caption' => ['type' => 'text', 'rules' => ['max' => 120]],
                ]],
                'sections' => ['type' => 'blocks', 'layouts' => [
                    'hero' => [
                        'heading' => ['type' => 'text', 'notNull' => true, 'rules' => ['max' => 80]],
                        'image' => ['type' => 'media', 'accept' => 'image'],
                    ],
                    'quote' => [
                        'text' => ['type' => 'text', 'multiline' => true, 'notNull' => true],
                        'cite' => ['type' => 'text', 'rules' => ['max' => 80]],
                    ],
                ]],
                'createdAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => ['now' => true]],
                'updatedAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => ['now' => true], 'onUpdate' => ['now' => true]],
            ] + $drafts,
            'relations' => [
                'author' => ['kind' => 'one', 'collection' => 'authors', 'from' => 'authorId', 'to' => 'id', 'optional' => true],
                'comments' => ['kind' => 'many', 'collection' => 'comments', 'from' => 'id', 'to' => 'postId', 'optional' => false],
            ],
            'hooks' => ['beforeCreate' => 'posts__beforeCreate'],
            'beforeCreateFills' => [],
            'access' => [
                'read' => ['fn' => 'posts__access__read'],
                'create' => ['role' => 'author'],
                'update' => ['fn' => 'posts__access__update'],
                'delete' => ['role' => 'editor'],
            ],
            'api' => $crud,
            'wp' => ['postType' => 'zero_posts', 'groupKey' => 'group_zero_posts', 'metaPrefix' => 'zero_', 'fieldKeyPrefix' => 'field_zero_posts_'],
            'table' => null,
        ],
        'comments' => [
            'key' => 'comments',
            'label' => 'Comments',
            'editor' => false,
            'drafts' => false,
            'revisions' => false,
            'title' => null,
            'content' => null,
            'slug' => null,
            'primaryKey' => 'id',
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'postId' => ['type' => 'integer', 'notNull' => true, 'references' => ['collection' => 'posts', 'column' => 'id', 'onDelete' => 'cascade']],
                'name' => ['type' => 'text', 'notNull' => true, 'rules' => ['max' => 60]],
                'body' => ['type' => 'text', 'multiline' => true, 'notNull' => true, 'rules' => ['min' => 1, 'max' => 2000, 'validate' => 'comments__validate__body']],
                'approved' => ['type' => 'boolean', 'notNull' => true, 'default' => ['value' => false]],
                'createdAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => ['now' => true]],
            ],
            'relations' => [
                'post' => ['kind' => 'one', 'collection' => 'posts', 'from' => 'postId', 'to' => 'id', 'optional' => false],
            ],
            'hooks' => ['afterCreate' => 'comments__afterCreate'],
            'beforeCreateFills' => [],
            'access' => [
                'read' => ['fn' => 'comments__access__read'],
                'create' => ['role' => 'anyone'],
                'update' => ['role' => 'editor'],
                'delete' => ['role' => 'editor'],
            ],
            'api' => $crud,
            'wp' => null,
            'table' => 'zero_comments',
        ],
    ],
    'globals' => [
        'settings' => [
            'label' => 'Site settings',
            'fields' => [
                'siteTitle' => ['type' => 'text', 'notNull' => true, 'default' => ['value' => 'My blog'], 'rules' => ['max' => 80]],
                'tagline' => ['type' => 'text', 'rules' => ['max' => 160]],
                'postsPerPage' => ['type' => 'integer', 'notNull' => true, 'default' => ['value' => 10], 'rules' => ['min' => 1, 'max' => 50]],
                'social' => ['type' => 'repeater', 'fields' => [
                    'label' => ['type' => 'text', 'notNull' => true, 'rules' => ['max' => 40]],
                    'href' => ['type' => 'url', 'notNull' => true],
                ]],
            ],
            'access' => ['read' => ['role' => 'anyone'], 'update' => ['role' => 'editor']],
            'wp' => ['postId' => 'zero_global_settings', 'menuSlug' => 'zero-global-settings', 'groupKey' => 'group_zero_global_settings', 'fieldKeyPrefix' => 'field_zero_global_settings_', 'optionPrefix' => 'zero_global_settings_'],
        ],
    ],
    'actions' => [
        'approveComment' => [
            'input' => ['id' => ['type' => 'integer', 'notNull' => true]],
            'handler' => 'action__approveComment',
            'access' => ['role' => 'editor'],
        ],
        'publishedCount' => [
            'input' => [],
            'handler' => 'action__publishedCount',
            'access' => ['role' => 'anyone'],
        ],
    ],
];
