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

$repo = dirname(__DIR__, 2);
$checkout = sys_get_temp_dir() . '/spacepress-legacy-' . bin2hex(random_bytes(4));
mkdir($checkout);
register_shutdown_function(static fn () => exec('rm -rf ' . escapeshellarg($checkout)));
exec('git -C ' . escapeshellarg($repo) . ' archive ' . LEGACY_COMMIT . ' tests/php tests/fixtures/blog tests/fixtures/blog.schema.json tests/fixtures/platform.json runtime | tar -x -C ' . escapeshellarg($checkout), $out, $code);
$code === 0 || throw new RuntimeException('cannot export ' . LEGACY_COMMIT . ': ' . implode("\n", $out));
$errors = tempnam(sys_get_temp_dir(), 'spacepress-legacy-');
$out = [];
// The earlier harness reads its download cache from the variable of its own name; share this checkout's.
exec('TP_WP_CACHE=' . escapeshellarg((string) realpath(wpCache())) . ' ' . escapeshellarg(PHP_BINARY) . ' -d memory_limit=512M ' . escapeshellarg(__DIR__ . '/brand_upgrade/legacy-site.php') . ' ' . escapeshellarg($checkout) . ' 2>' . escapeshellarg($errors), $out, $code);
$before = json_decode((string) end($out), true);
($code === 0 && is_array($before)) || throw new RuntimeException("the legacy site failed:\n" . implode("\n", $out) . file_get_contents($errors));
unlink($errors);
register_shutdown_function(static fn () => getenv('SP_WP_KEEP') === '1' || exec('rm -rf ' . escapeshellarg($before['dir'])));

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
$schema['collections']['comments']['revisions'] = true;
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
// The one stored value that keeps the earlier name on purpose: the S3 key prefix of objects already stored.
$hasLegacy = static fn (array $rows): array => array_values(array_filter(array_map('json_encode', $rows), static fn (string $r): bool => !str_contains($r, '"sp_upload_prefix"')
    && (str_contains($r, $legacy) || preg_match('/(?<![a-z0-9])_?tp_(?!unrelated)/', $r) === 1)));

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
eq('… and stored objects keep their key prefix', \SpacePress\Wp\BrandUpgrade::uploadPrefix(), $legacy);
check('the private files directory moved', is_dir(WP_CONTENT_DIR . '/uploads/spacepress-private') && !file_exists(WP_CONTENT_DIR . '/uploads/' . $legacy . '-private'));
eq('identity\'s cron event moved', array_values(array_filter(array_merge(...array_map('array_keys', array_values(array_filter(_get_cron_array(), 'is_array')))), static fn ($h) => str_contains($h, 'identity'))),
    array_map(static fn (string $h): string => 'sp_' . substr($h, 3), $before['cron']));
eq('another plugin\'s option that shares the prefix is untouched', [get_option('tp_unrelated_plugin_setting'), get_option('sp_unrelated_plugin_setting')], ['not ours', false]);
eq('nothing else is left under the earlier names', [
    ...$hasLegacy($after['options']), ...$hasLegacy($after['postmeta']), ...$hasLegacy($after['posts']), ...$hasLegacy($after['scheduler']), ...$hasLegacy($after['groups']),
], []);

// The app reads what it wrote before.
[$status, $post] = $wp->call('GET', '/posts/' . $before['post'], as: 'editor');
eq('the post reads back through the API', [$status, $post['title'] ?? null, $post['excerpt'] ?? null], [200, 'Kept through the rename', 'Short']);
[$status, $comment] = $wp->call('GET', '/comments/' . $before['comment'], as: 'editor');
eq('the custom-table row reads back', [$status, $comment['body'] ?? null], [200, 'First, edited']);
[$status, $list] = $wp->call('GET', '/posts', as: 'editor');
eq('the soft-deleted post stays deleted', in_array($before['gone'], array_column($list ?? [], 'id'), true), false);
eq('the next migration plan creates nothing anew', $wp->plugin()->pendingMigrations(), []);

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
