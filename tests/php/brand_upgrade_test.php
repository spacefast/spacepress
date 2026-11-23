<?php

declare(strict_types=1);

/*
 * A site deployed before the rename, upgraded by copying in this checkout's plugins (SpacePress\Wp\
 * BrandUpgrade), on WordPress on SQLite. The site is real: brand_upgrade/legacy-site.php builds it
 * with the runtime, identity and harness of LEGACY_COMMIT, the last commit with the old names, and
 * gives it data through that runtime. Then this checkout's plugins load on it, and everything it
 * stored is checked under the current names: the same rows, ids, hashes and history, and nothing of
 * another plugin's touched. A second load changes nothing.
 *
 * Needs git and the commit in the checkout's history (CI checks out the full history for this suite).
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

const LEGACY_COMMIT = '45d81e72857beb2d2f6b6c15bc3d749ead96baf2';

$before = require __DIR__ . '/brand_upgrade/legacy.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
$schema['collections']['comments']['revisions'] = true;
// A custom-table child of a custom table, so the site has a foreign key between two of its tables.
$schema['collections']['replies'] = ['key' => 'replies', 'editor' => false, 'table' => 'sp_replies', 'primaryKey' => 'id', 'revisions' => false, 'softDelete' => false,
    'uid' => false, 'columns' => ['id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
        'commentId' => ['type' => 'integer', 'notNull' => true, 'references' => ['collection' => 'comments', 'column' => 'id', 'onDelete' => 'cascade']],
        'body' => ['type' => 'text', 'notNull' => true]],
    'access' => array_fill_keys(['read', 'create', 'update', 'delete'], ['role' => 'editor'])];
$wp = WpSite::adopt($before['dir'], ['schema' => $schema, 'identity' => true, 'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php')],
    ['typedpress-app-blog', 'typedpress-identity', 'typedpress-runtime']);

global $wpdb;
$p = $wpdb->prefix;
$tables = static fn (string $like): array => array_column($wp->sql("SELECT name AS n FROM sqlite_master WHERE type = 'table' AND name LIKE ? ORDER BY name", [$like]), 'n');
$state = static function () use ($wp, $p, $tables): array {
    return [
        'tables' => $tables("{$p}%"),
        'options' => $wp->sql("SELECT option_name AS n, option_value AS v FROM `{$p}options` WHERE option_name NOT LIKE '\\_transient%' AND option_name NOT IN ('cron', 'sp_installed') ORDER BY option_name"),
        'postmeta' => $wp->sql("SELECT post_id, meta_key, meta_value FROM `{$p}postmeta` ORDER BY meta_id"),
        'usermeta' => $wp->sql("SELECT user_id, meta_key, meta_value FROM `{$p}usermeta` WHERE meta_key NOT LIKE '%session_tokens' ORDER BY umeta_id"),
        'posts' => $wp->sql("SELECT ID, post_type, post_status, post_name FROM `{$p}posts` ORDER BY ID"),
        'ledger' => $wp->sql("SELECT * FROM `{$p}sp__migrations` ORDER BY `id`"),
        'revisions' => $wp->sql("SELECT * FROM `{$p}sp__revisions` ORDER BY `id`"),
        'jobs' => $wp->sql("SELECT `id`, `job`, `state`, `runAt` FROM `{$p}sp__jobs` ORDER BY `id`"),
        'scheduler' => $wp->sql("SELECT a.`action_id`, a.`hook`, a.`status`, a.`scheduled_date_gmt`, g.`slug` FROM `{$p}actionscheduler_actions` a JOIN `{$p}actionscheduler_groups` g ON g.`group_id` = a.`group_id` ORDER BY a.`action_id`"),
        'groups' => $wp->sql("SELECT `group_id`, `slug` FROM `{$p}actionscheduler_groups` ORDER BY `group_id`"),
    ];
};

$legacy = 'typedpress';
$after = $state();
// The one stored value that keeps the earlier name on purpose (the S3 key prefix of objects already
// stored), and the look-alikes this test planted for other plugins and the site's owner.
$hasLegacy = static fn (array $rows): array => array_values(array_filter(array_map('json_encode', $rows), static fn (string $r): bool => !str_contains($r, '"sp_upload_prefix"')
    && !preg_match('/tp_(unrelated|prebuilt_other|global_other)|typedpress-home-owner/', $r)
    && (str_contains($r, $legacy) || preg_match('/(?<![a-z0-9])_?tp_/', $r) === 1)));

check('the upgrade is recorded', BrandUpgrade_done());
eq('no table keeps the earlier name', $tables("{$p}tp%"), []);
eq('every table moved under the current name', count($tables("{$p}sp%")), count($before['tables']));
eq('the ledger keeps every applied file and its SHA-256', array_map(static fn (array $r): array => [$r['app'], $r['id'], $r['kind'], $r['sql']], array_values(array_filter($after['ledger'], static fn (array $r): bool => $r['kind'] === 'schema'))),
    array_map(static fn (array $r): array => [$r['app'], $r['id'], $r['kind'], $r['sql']], $before['ledger']));
$audit = array_values(array_filter($after['ledger'], static fn (array $r): bool => $r['kind'] === 'data'));
eq('… and gains one data row per app saying what moved', [count($audit), $audit[0]['id'] ?? null, $audit[0]['actor'] ?? null], [1, 'brand-upgrade-v1', 'spacepress']);
eq('the revisions keep their chain', array_map(static fn (array $r): array => [$r['collection'], $r['pk'], (int) $r['version'], $r['op']], $after['revisions']),
    array_map(static fn (array $r): array => [$r['collection'], $r['pk'], (int) $r['version'], $r['op']], $before['revisions']));
$kept = array_values(array_filter($after['jobs'], static fn (array $r): bool => in_array($r['id'], array_column($before['jobs'], 'id'), true)));
eq('the queued job keeps its id and state, under the current job name', array_map(static fn (array $r): array => [$r['id'], $r['job'], $r['state']], $kept),
    array_map(static fn (array $r): array => [$r['id'], 'spacepress.mail', $r['state']], $before['jobs']));
eq('Action Scheduler keeps every action, under the current hooks and groups', array_map(static fn (array $r): array => [$r['hook'], $r['status'], $r['slug']], array_slice($after['scheduler'], 0, count($before['scheduler']))),
    array_map(static fn (array $r): array => [str_replace([$legacy, 'tp_'], ['spacepress', 'sp_'], $r['hook']), $r['status'], str_replace($legacy, 'spacepress', $r['slug'])], $before['scheduler']));
eq('the post keeps its fields, uid and timestamps', array_column($wp->sql("SELECT meta_key AS k, meta_value AS v FROM `{$p}postmeta` WHERE post_id = ? ORDER BY meta_key", [$before['post']]), 'v', 'k'),
    array_combine(array_map(static fn (array $m): string => str_replace('tp_', 'sp_', $m['k']), $before['meta']), array_map(static fn (array $m): string => str_replace('field_tp_', 'field_sp_', $m['v']), $before['meta'])));
eq('the soft-deleted post keeps its deletion metadata', array_column($wp->sql("SELECT meta_key AS k FROM `{$p}postmeta` WHERE post_id = ? AND meta_key LIKE '\\_sp\\_deleted%' ORDER BY meta_key", [$before['gone']]), 'k'),
    array_map(static fn (array $m): string => str_replace('_tp_', '_sp_', $m['k']), $before['goneMeta']));
eq('post types moved', array_column($wp->sql("SELECT DISTINCT post_type AS t FROM `{$p}posts` WHERE post_type LIKE 'sp\\_%' ORDER BY t"), 't'), array_map(static fn (string $t): string => 'sp_' . substr($t, 3), $before['postTypes']));
eq('the scoped application password keeps its scope', \SpacePress\Wp\AgentScope::KEY, 'sp_scope');
$entry = array_values(array_filter(WP_Application_Passwords::get_user_application_passwords($before['editor']), static fn (array $e): bool => $e['name'] === 'agent'))[0] ?? [];
eq('… under the current key', [$entry['sp_scope'] ?? null, array_key_exists('tp_scope', $entry)], [['write' => true, 'personal' => false, 'abilities' => null], false]);
check('the guest role moved', get_role('sp_guest') !== null && get_role('tp_guest') === null);
check('the subscriber who was a guest is still one', in_array('sp_guest', (new WP_User($wp->userId('subscriber')))->roles, true));
eq('the S3 namespace is kept', get_option('sp_upload_namespace'), str_repeat('ab', 16));
eq('… and stored objects keep their key prefix', [\SpacePress\Wp\BrandUpgrade::uploadPrefix(), str_starts_with(\SpacePress\Wp\Uploads::prefix(), $legacy . '/' . str_repeat('ab', 16) . '/')], [$legacy, true]);
check('the private files directory moved', is_dir(WP_CONTENT_DIR . '/uploads/spacepress-private') && !file_exists(WP_CONTENT_DIR . '/uploads/' . $legacy . '-private'));
eq('identity\'s cron event moved', array_values(array_filter(array_merge(...array_map('array_keys', array_values(array_filter(_get_cron_array(), 'is_array')))), static fn ($h) => str_contains($h, 'identity'))),
    array_map(static fn (string $h): string => 'sp_' . substr($h, 3), $before['cron']));
eq('another plugin\'s option that shares the prefix is untouched', [get_option('tp_unrelated_plugin_setting'), get_option('sp_unrelated_plugin_setting')], ['not ours', false]);
eq('nothing else is left under the earlier names', [
    ...$hasLegacy($after['options']), ...$hasLegacy($after['postmeta']), ...$hasLegacy($after['posts']), ...$hasLegacy($after['scheduler']), ...$hasLegacy($after['groups']),
], []);

// The app reads what it wrote before.
[$status, $post] = $wp->call('GET', '/posts/' . $before['post'], as: 'editor');
eq('the post reads back through the API, a group\'s field included', [$status, $post['title'] ?? null, $post['excerpt'] ?? null, $post['seo']['metaTitle'] ?? null], [200, 'Kept through the rename', 'Short', 'Legacy SEO']);
[$status, $global] = $wp->call('GET', '/globals/settings', as: 'editor');
eq('the global\'s value reads back', [$status, $global['tagline'] ?? null], [200, 'Kept tagline']);
$template = get_page_by_path('sp-login', OBJECT, 'wp_template');
eq('the owner\'s saved template keeps its markup, under the current slug and block', $template?->post_content,
    '<!-- wp:paragraph --><p>Owner text</p><!-- /wp:paragraph --><!-- wp:sp/login-form /-->');
eq('look-alike options of other plugins are untouched', [get_option('tp_prebuilt_other_plugin_setting'), get_option('tp_global_other_plugin')], ['not ours', 'not ours']);
[$status, $comment] = $wp->call('GET', '/comments/' . $before['comment'], as: 'editor');
eq('the custom-table row reads back', [$status, $comment['body'] ?? null], [200, 'First, edited']);
[$status, $list] = $wp->call('GET', '/posts', as: 'editor');
eq('the soft-deleted post stays deleted', in_array($before['gone'], array_column($list ?? [], 'id'), true), false);
eq('the next migration plan creates nothing anew', $wp->plugin()->pendingMigrations(), []);
eq('the foreign key keeps its target and rule, under the name the compiler gives it now', $wp->sql("SELECT k.CONSTRAINT_NAME AS n, k.REFERENCED_TABLE_NAME AS t, r.DELETE_RULE AS d FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_NAME = ?", ["{$p}sp_replies"]),
    [['n' => 'sp_replies_commentId_fk', 't' => "{$p}sp_comments", 'd' => 'CASCADE']]);
// A schema change after the upgrade alters the moved table: the driver rebuilds it from its metadata.
$wp->exec("ALTER TABLE `{$p}sp_replies` ADD COLUMN `probe` BIGINT NULL");
eq('… and the table still takes an ALTER, keeping its row and its key', [(int) $wp->scalar("SELECT COUNT(*) FROM `{$p}sp_replies`"), $wp->scalar("SELECT REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_NAME = ? AND CONSTRAINT_NAME = 'sp_replies_commentId_fk'", ["{$p}sp_replies"])], [1, "{$p}sp_comments"]);
$wp->exec("ALTER TABLE `{$p}sp_replies` DROP COLUMN `probe`");

// A password a pre-release build scoped, met before the site has moved (another site of a network,
// or a request that comes first): the earlier key is read, so it stays as narrow as it was.
eq('a scope under the earlier key still narrows its password', \SpacePress\Wp\AgentScope::normalize(\SpacePress\Wp\BrandUpgrade::earlierScope(['tp_scope' => ['write' => false, 'personal' => false, 'abilities' => ['typedpress-identity/account', 'tp/deployments']]])),
    ['write' => false, 'personal' => false, 'abilities' => ['spacepress-identity/account', 'sp/deployments']]);

eq('nothing written under a current name before the move was deleted: what was set aside is kept', array_values(array_filter(array_column($wp->sql("SELECT option_name AS n FROM `{$p}options` WHERE option_name LIKE '%\\_\\_superseded\\_%'"), 'n'), static fn (string $n): bool => !preg_match('/\\Asp_(runtime_secret|runtime_private_ok|runtime_private_checked|rewrite_rules|jobs_prepared|jobs_scheduled|search_shape|kind_urls|installed|identity_dummy_password_hash|identity_password_profiles|identity_password_inventory)__superseded_\\d+\\z/', $n))), []);

// Private files held back: a server that serves the new directory keeps them where they were, and
// so does every retry, whatever verdict the failed probe left behind.
$move = (new ReflectionClass(\SpacePress\Wp\BrandUpgrade::class))->getMethod('movePrivateFiles');
$held = WP_CONTENT_DIR . '/uploads/held-private-probe';
$to = WP_CONTENT_DIR . '/uploads/spacepress-private';
$kept = WP_CONTENT_DIR . '/uploads/spacepress-private-kept';
rename($to, $kept);
mkdir($held);
file_put_contents("$held/a.txt", 'secret');
// The web server answers the probe of the new directory with the file: it serves it.
$served = static fn ($pre, array $args, string $url) => str_contains($url, '/spacepress-private/probe-') ? ['headers' => [], 'body' => 'first', 'response' => ['code' => 200, 'message' => 'OK'], 'cookies' => []] : $pre;
add_filter('pre_http_request', $served, PHP_INT_MAX, 3);
$outcome = static function () use ($move, $held, $to): string {
    try {
        $move->invoke(null, $held, $to, true);

        return 'moved';
    } catch (\SpacePress\Wp\PrivateFilesHeld) {
        return 'held';
    }
};
eq('a served destination holds the files back', [$outcome(), is_file("$held/a.txt"), get_option(\SpacePress\Wp\WpFiles::OK)], ['held', true, '0']);
eq('… and a retry after that failed probe still probes, and still holds them', [$outcome(), is_file("$held/a.txt")], ['held', true]);
remove_filter('pre_http_request', $served, PHP_INT_MAX);
array_map('unlink', array_filter(glob("$to/{,.}*", GLOB_BRACE) ?: [], 'is_file'));
@rmdir($to);
foreach (glob("$held/*") ?: [] as $f) {
    unlink($f);
}
rmdir($held);
rename($kept, $to);

// A second run: the marker is recorded, so nothing moves; and a forced replan finds nothing to do.
eq('a second ensure changes nothing', \SpacePress\Wp\BrandUpgrade::ensure($wp->plugin()->schema), []);
$plan = \SpacePress\Wp\BrandUpgrade::plan($wp->connection(), $wp->plugin()->schema);
eq('… and a fresh plan finds nothing left to move', array_filter([$plan['tables'], $plan['options'], ...array_values($plan['meta']), $plan['postTypes'], $plan['taxonomies'], $plan['plugins'], $plan['private']]), []);
eq('… so the stored state is byte for byte the same', $state(), $after);

function BrandUpgrade_done(): bool
{
    return \SpacePress\Wp\BrandUpgrade::done();
}

finish('brand_upgrade');
