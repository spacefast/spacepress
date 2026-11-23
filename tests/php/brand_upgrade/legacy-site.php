<?php

declare(strict_types=1);

/*
 * Run with the PHP suites of the last commit before the rename (brand_upgrade_test.php exports
 * them): builds a WordPress-on-SQLite site with that commit's own runtime and identity plugins,
 * gives it real state the way a deployed site has it, and prints where the site is and what it
 * holds. Nothing here is written by hand: every row is the old runtime's.
 *
 *   php legacy-site.php <exported checkout>
 */

$checkout = $argv[1];
putenv('TP_WP_KEEP=1');
require "$checkout/tests/php/wp.php";

$schema = require "$checkout/tests/fixtures/blog/schema.php";
$schema['collections']['comments']['revisions'] = true;
// Runtime schema changes on (`runtimeSchema: true`): the site adds a field of its own.
$schema['runtimeSchema'] = ['version' => 0, 'hash' => ''];
// A custom-table child of a custom table, so the site has a foreign key between two of its tables.
$schema['collections']['replies'] = ['key' => 'replies', 'editor' => false, 'table' => 'tp_replies', 'primaryKey' => 'id', 'revisions' => false, 'softDelete' => false,
    'uid' => false, 'columns' => ['id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
        'commentId' => ['type' => 'integer', 'notNull' => true, 'references' => ['collection' => 'comments', 'column' => 'id', 'onDelete' => 'cascade']],
        'body' => ['type' => 'text', 'notNull' => true]],
    'access' => array_fill_keys(['read', 'create', 'update', 'delete'], ['role' => 'editor'])];
$wp = wpSite('brand-upgrade', ['schema' => $schema, 'identity' => true, 'functions' => file_get_contents("$checkout/tests/fixtures/blog/functions.php")]);
$app = $wp->app();

// App data: a post (post type, its field meta, uid and timestamps), a custom-table row with a
// revision, a soft-deleted post, and one waiting job.
[$status, $post] = $wp->call('POST', '/posts', ['title' => 'Kept through the rename', 'slug' => 'kept', 'body' => 'Body', 'excerpt' => 'Short', 'seo' => ['metaTitle' => 'Legacy SEO']], as: 'editor');
$status === 201 || throw new RuntimeException("post: $status " . json_encode($post));
[$status, $gone] = $wp->call('POST', '/posts', ['title' => 'Deleted before the rename', 'slug' => 'gone', 'body' => 'x'], as: 'editor');
$status === 201 || throw new RuntimeException("post: $status");
[$status] = $wp->call('DELETE', '/posts/' . $gone['id'], as: 'editor');
$status < 300 || throw new RuntimeException("delete: $status");
[$status, $comment] = $wp->call('POST', '/comments', ['postId' => $post['id'], 'name' => 'Ada', 'body' => 'First', 'approved' => true], as: 'editor');
$status === 201 || throw new RuntimeException("comment: $status " . json_encode($comment));
[$status, $reply] = $wp->call('POST', '/replies', ['commentId' => $comment['id'], 'body' => 'A reply'], as: 'editor');
$status === 201 || throw new RuntimeException("reply: $status " . json_encode($reply));
[$status] = $wp->call('PATCH', '/comments/' . $comment['id'], ['body' => 'First, edited'], as: 'editor');
$status < 300 || throw new RuntimeException("comment update: $status");
\TypedPress\Jobs\Jobs::enqueue('typedpress.mail', ['message' => \TypedPress\Mail::payload(['to' => 'a@example.test', 'subject' => 'Queued before the rename', 'text' => 'Hello'])], ['delay' => 3600]);

[$status, $global] = $wp->call('PATCH', '/globals/settings', ['tagline' => 'Kept tagline'], as: 'editor');
$status === 200 || throw new RuntimeException("global: $status " . json_encode($global));
// Options of other plugins that only look like the runtime's, and a page of the owner's that has the
// home page's slug but is not a route page.
add_option('tp_prebuilt_other_plugin_setting', 'not ours', '', false);
add_option('tp_global_other_plugin', 'not ours', '', false);
$ownerPage = wp_insert_post(['post_type' => 'page', 'post_status' => 'draft', 'post_title' => 'Owner page', 'post_name' => 'typedpress-home-owner']);
// Meta on the owner's own page that shares the spelling of an app field's nested row, with no SCF reference.
add_post_meta($ownerPage, 'tp_seo_metaTitle', 'not the app\'s');
// A field the site added at runtime, through the earlier runtime's schema versions, with a value.
$versions = \TypedPress\Wp\SchemaVersions::of($wp->plugin());
$versions->apply(0, ['format' => 1, 'changes' => [['op' => 'addField', 'kind' => 'posts', 'field' => 'mood', 'definition' => ['type' => 'text']]]], ['user' => 1, 'login' => 'admin', 'via' => 'test']);
update_post_meta($post['id'], 'tp_mood', 'calm');
// A signed-in identity session of the editor's, as the earlier identity opened it (its browser keeps the secret).
\TypedPress\Identity\Plugin::$accounts->ensure($wp->userId('editor'));
$opened = \TypedPress\Identity\Plugin::$sessions->create($wp->userId('editor'));
// The owner's saved copy of the sign-in template, as the Site Editor stores one.
wp_insert_post(['post_type' => 'wp_template', 'post_status' => 'publish', 'post_name' => 'tp-login', 'post_title' => 'Sign in',
    'post_content' => '<!-- wp:paragraph --><p>Owner text</p><!-- /wp:paragraph --><!-- wp:tp/login-form /-->', 'tax_input' => ['wp_theme' => ['typedpress-default']]]);
// It was saved for the runtime's fallback theme (an owner with no block theme of their own edits that one).
$saved = get_page_by_path('tp-login', OBJECT, 'wp_template');
wp_set_object_terms($saved->ID, 'typedpress-default', 'wp_theme');
update_option('theme_mods_typedpress-default', ['custom_css_post_id' => -1, 'owner' => 'kept']);
// Site state the runtime keeps: the S3 namespace, the guest role, a scoped application password,
// a cron event of identity, and one option of another plugin that only shares the prefix.
add_option('tp_upload_namespace', str_repeat('ab', 16), '', false);
\TypedPress\Wp\IdentityBridge::provision();
$editor = $wp->userId('editor');
[$password, $item] = WP_Application_Passwords::create_new_application_password($editor, ['name' => 'agent']);
\TypedPress\Wp\AgentScope::store($editor, $item['uuid'], ['write' => true, 'personal' => false, 'abilities' => null]);
(new WP_User($wp->userId('subscriber')))->set_role('tp_guest');
add_option('tp_unrelated_plugin_setting', 'not ours', '', false);

global $wpdb;
$p = $wpdb->prefix;
$tables = array_column($wp->sql("SELECT name AS n FROM sqlite_master WHERE type = 'table' AND name LIKE '{$p}tp%' ORDER BY name"), 'n');
echo json_encode([
    'dir' => $wp->dir,
    'post' => $post['id'],
    'gone' => $gone['id'],
    'comment' => $comment['id'],
    'editor' => $editor,
    'session' => $opened['secret'],
    'tables' => $tables,
    'ledger' => $wp->sql("SELECT `app`, `id`, `kind`, `sql` FROM `{$p}tp__migrations` ORDER BY `id`"),
    'revisions' => $wp->sql("SELECT `collection`, `pk`, `version`, `op` FROM `{$p}tp__revisions` ORDER BY `id`"),
    'jobs' => $wp->sql("SELECT `id`, `job`, `state` FROM `{$p}tp__jobs` ORDER BY `id`"),
    'scheduler' => $wp->sql("SELECT a.`hook`, a.`status`, g.`slug` FROM `{$p}actionscheduler_actions` a JOIN `{$p}actionscheduler_groups` g ON g.`group_id` = a.`group_id` ORDER BY a.`action_id`"),
    'meta' => $wp->sql("SELECT `meta_key` AS k, `meta_value` AS v FROM `{$p}postmeta` WHERE `post_id` = ? ORDER BY `meta_key`", [$post['id']]),
    'goneMeta' => $wp->sql("SELECT `meta_key` AS k FROM `{$p}postmeta` WHERE `post_id` = ? AND `meta_key` LIKE '\\_tp\\_deleted%' ORDER BY `meta_key`", [$gone['id']]),
    'options' => array_column($wp->sql("SELECT option_name AS n FROM `{$p}options` WHERE option_name LIKE 'tp\\_%' ORDER BY option_name"), 'n'),
    'postTypes' => array_column($wp->sql("SELECT DISTINCT post_type AS t FROM `{$p}posts` WHERE post_type LIKE 'tp\\_%' ORDER BY t"), 't'),
    'cron' => array_values(array_filter(array_merge(...array_map('array_keys', array_values(array_filter(_get_cron_array(), 'is_array')))), static fn ($h) => str_starts_with($h, 'tp_'))),
    'files' => is_dir(WP_CONTENT_DIR . '/uploads/typedpress-private'),
], JSON_THROW_ON_ERROR) . "\n";
// Stop here without the harness's cleanup: the site is the next test's input.
$wp->stopServer();
exit(0);
