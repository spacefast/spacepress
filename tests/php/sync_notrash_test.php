<?php

declare(strict_types=1);

/*
 * Content sync on a site whose trash is off (`EMPTY_TRASH_DAYS` 0, wp-config.php). WordPress's
 * wp_trash_post() then deletes the post for good. A sync never deletes: its trash is refused before
 * anything is written, and the post, its revisions and the rows that depend on it stay.
 */

define('EMPTY_TRASH_DAYS', 0);

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$editor = ['read' => ['role' => 'anyone'], 'create' => ['role' => 'editor'], 'update' => ['role' => 'editor'], 'delete' => ['role' => 'editor']];
$api = ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true];
$uid = ['type' => 'text', 'unique' => true, 'system' => true, 'rules' => ['pattern' => ['source' => '^zr_[0-9a-f]{20}$', 'flags' => '']]];
$schema = [
    'name' => 'notrash',
    'collections' => [
        'notes' => [
            'primaryKey' => 'id', 'editor' => true, 'uid' => true, 'sync' => ['dir' => 'content/notes', 'format' => 'md'], 'title' => 'title', 'content' => 'body',
            'drafts' => true, 'revisions' => true, 'access' => $editor, 'api' => $api, 'relations' => [], 'hooks' => [],
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'title' => ['type' => 'text', 'notNull' => true],
                'body' => ['type' => 'richText'],
                'status' => ['type' => 'text', 'notNull' => true, 'enum' => ['draft', 'published', 'scheduled'], 'default' => ['value' => 'draft'], 'system' => true],
                'publishedAt' => ['type' => 'timestamp', 'system' => true],
                'uid' => $uid,
            ],
        ],
        'comments' => [
            'primaryKey' => 'id', 'editor' => false, 'table' => 'sp_comments', 'uid' => false, 'sync' => null, 'access' => $editor, 'api' => $api, 'relations' => [], 'hooks' => [],
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'noteId' => ['type' => 'integer', 'notNull' => true, 'references' => ['collection' => 'notes', 'column' => 'id', 'onDelete' => 'cascade']],
            ],
        ],
    ],
    'globals' => [], 'actions' => [],
];

$wp = wpSite('sync-notrash', ['schema' => $schema, 'users' => ['ed' => 'editor']]);
$app = $wp->app();
$db = \SpacePress\db();

$note = $db->insert('notes', ['title' => 'Keep me', 'body' => '<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->'], true)[0];
$db->insert('comments', ['noteId' => $note['id']]);
$before = get_post_status($note['id']);
[, $page] = $wp->call('GET', '/sync/notes', null, 'ed');
$item = $page['records'][0];
[$status, $problem] = $wp->call('POST', '/sync/notes/trash', ['uid' => $item['record']['uid'], 'expect' => $item['digest']], 'ed');
eq('a sync trash with the trash off is refused', [$status, $problem['code'] ?? null], [409, 'trash_disabled']);
clean_post_cache($note['id']);
eq('the post is still there, as it was', [get_post_status($note['id']), $before !== false], [$before, true]);
eq('the row that depends on it is kept', count($db->findMany('comments', ['where' => ['noteId' => $note['id']]])), 1);

finish('sync_notrash');
