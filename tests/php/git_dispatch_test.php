<?php

declare(strict_types=1);

/*
 * Content in git, the site's half (runtime/First/Sync/GitDispatch.php), on WordPress in-process
 * (tests/php/wp.php): a save of a synced record, in wp-admin or through the API, queues one debounced
 * `repository_dispatch` to the repository; saves in the window join it; `first sync`'s own writes send
 * none; the job runs on Action Scheduler and POSTs to a local stand-in for GitHub's API. The token is
 * read from the environment, else from the Secrets API, which is never replaced by an option.
 * WordPress 7.1 has no Secrets API: a must-use plugin stands in for it, with WordPress 7.2's
 * function names, so both halves are proven.
 */

use First\Sync\GitDispatch;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

// A stand-in for GitHub's API: records each POST (path, headers, body) and answers with $inbox/status.
$inbox = sys_get_temp_dir() . '/first-git-dispatch-' . bin2hex(random_bytes(4));
@mkdir($inbox);
file_put_contents("$inbox/serve.php", <<<'PHP'
    <?php
    [, $dir] = $argv;
    while ($conn = stream_socket_accept(STDIN, -1)) {
        stream_set_timeout($conn, 5);
        $head = '';
        while (!str_contains($head, "\r\n\r\n") && ($c = fread($conn, 1)) !== false && $c !== '') {
            $head .= $c;
        }
        $lines = explode("\r\n", trim($head));
        $headers = [];
        foreach (array_slice($lines, 1) as $line) {
            [$k, $v] = array_map('trim', explode(':', $line, 2) + [1 => '']);
            $headers[strtolower($k)] = $v;
        }
        $body = '';
        $length = (int) ($headers['content-length'] ?? 0);
        while (strlen($body) < $length && ($c = fread($conn, $length - strlen($body))) !== false && $c !== '') {
            $body .= $c;
        }
        file_put_contents("$dir/log", json_encode(['line' => $lines[0], 'headers' => $headers, 'body' => $body]) . "\n", FILE_APPEND);
        $status = (int) (@file_get_contents("$dir/status") ?: 204);
        fwrite($conn, "HTTP/1.1 $status X\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        fclose($conn);
    }
    PHP);
$listener = stream_socket_server('tcp://127.0.0.1:0');
$port = (int) substr(strrchr(stream_socket_get_name($listener, false), ':'), 1);
$server = proc_open([PHP_BINARY, "$inbox/serve.php", $inbox], [0 => $listener, 2 => ['file', '/dev/null', 'w']], $pipes);
fclose($listener);
register_shutdown_function(static function () use ($server, $inbox): void {
    proc_terminate($server);
    exec('rm -rf ' . escapeshellarg($inbox));
});
$received = static fn (): array => is_file("$inbox/log") ? array_map(static fn ($l) => json_decode($l, true), file("$inbox/log", FILE_IGNORE_NEW_LINES)) : [];

$editor = ['read' => ['role' => 'anyone'], 'create' => ['role' => 'editor'], 'update' => ['role' => 'editor'], 'delete' => ['role' => 'editor']];
$uid = ['type' => 'text', 'unique' => true, 'system' => true, 'rules' => ['pattern' => ['source' => '^zr_[0-9a-f]{20}$', 'flags' => '']]];
$schema = [
    'name' => 'gitsync',
    'collections' => [
        'docs' => [
            'primaryKey' => 'id', 'editor' => true, 'uid' => true, 'sync' => ['dir' => 'content/docs', 'format' => 'md'], 'title' => 'title', 'content' => 'body', 'slug' => 'slug',
            'drafts' => false, 'revisions' => false, 'access' => $editor,
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'title' => ['type' => 'text', 'notNull' => true],
                'slug' => ['type' => 'slug', 'unique' => true, 'source' => 'title'],
                'body' => ['type' => 'richText'],
                'uid' => $uid,
            ],
        ],
        // Not synced: its saves tell nobody.
        'notes' => [
            'primaryKey' => 'id', 'uid' => true, 'sync' => null, 'access' => $editor,
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'title' => ['type' => 'text', 'notNull' => true],
                'uid' => $uid,
            ],
        ],
    ],
];
// WordPress 7.2's Secrets API with a provider of the test's own, as a host registers one
// ($wp_secrets_provider): kept in a global, never in an option, so the test can tell where the token
// went, and writable only while the test turns it on.
$secrets = <<<'PHP'
    <?php
    final class First_Test_Secrets extends WP_Secrets_Provider {
        public function get(string $name, string $version, bool $network = false) {
            return isset($GLOBALS['firstTestSecrets'][$name]) && $version === WP_Secret_Version::CURRENT
                ? new WP_Secret($name, $GLOBALS['firstTestSecrets'][$name], substr(hash('sha256', $GLOBALS['firstTestSecrets'][$name]), 0, 8)) : null;
        }
        public function set(string $name, #[\SensitiveParameter] $value, bool $network = false, bool $needs_rotation = false, ?string $action = null) {
            if (empty($GLOBALS['firstTestSecretsOn'])) { return new WP_Error('read_only', 'off'); }
            $GLOBALS['firstTestSecrets'][$name] = (string) $value;
            return true;
        }
        public function delete(string $name, bool $network = false) { unset($GLOBALS['firstTestSecrets'][$name]); return true; }
        public function retire_previous(string $name, bool $network = false) { return true; }
        public function list_secrets(string $name_prefix = '', bool $network = false) { return []; }
        public function get_label(): string { return 'test'; }
        public function get_protection_boundary(): string { return 'test'; }
        public function is_writable(): bool { return !empty($GLOBALS['firstTestSecretsOn']); }
    }
    $GLOBALS['wp_secrets_provider'] = new First_Test_Secrets();
    PHP;
$wp = wpSite('git-dispatch', ['schema' => $schema, 'users' => ['ed' => 'editor'], 'muPlugins' => ['secrets' => $secrets]]);
$db = $wp->app()->db;
putenv("FIRST_GITHUB_API_URL=http://127.0.0.1:$port");
putenv('FIRST_NOW=2026-11-13T10:00:00.000Z');

$pending = static fn () => $wp->sql("SELECT * FROM {prefix}first__jobs WHERE `job` = ? AND `state` IN ('pending', 'running', 'failed') ORDER BY `createdAt`", [GitDispatch::JOB]);
$all = static fn () => $wp->sql('SELECT * FROM {prefix}first__jobs WHERE `job` = ?', [GitDispatch::JOB]);
/** Due Action Scheduler actions, run by its own queue runner, as cron runs them. */
$drain = static fn () => ActionScheduler_QueueRunner::instance()->run('First tests');
$asEditor = static function (callable $fn) use ($wp) {
    wp_set_current_user($wp->userId('ed'));
    try {
        return $fn();
    } finally {
        wp_set_current_user(0);
    }
};

// No repository configured: saves queue nothing.
$db->transaction(static fn () => $db->insert('docs', ['title' => 'Before'], true));
eq('without a repository, a save of a synced record queues nothing', count($all()), 0);

[$code, $out] = $wp->cli('git-dispatch', 'set', '--repo=acme/site');
eq('git-dispatch set --repo stores the repository', [$code, $out['data']['repository'] ?? null, array_key_exists('token', $out['data'] ?? []) ? $out['data']['token'] : 'x'], [0, 'acme/site', null]);
eq('a repository that is not owner/name is refused', $wp->cli('git-dispatch', 'set', '--repo=../x')[1]['error']['code'] ?? null, 'invalid_input');

// A save in wp-admin (core's wp_insert_post as the editor) of a synced record queues one dispatch,
// due after the window.
$postId = $asEditor(static fn () => wp_insert_post(['post_type' => 'first_docs', 'post_status' => 'publish', 'post_title' => 'Written in wp-admin', 'post_content' => 'Hello'], true));
check('wp-admin saved the post', is_int($postId) && $postId > 0, $postId);
$queued = $pending();
eq('a wp-admin save queues one dispatch', count($queued), 1);
eq('…due after the debounce window (60 s)', $queued[0]['runAt'] ?? null, '2026-11-13T10:01:00.000Z');

// More saves in the window, through wp-admin and through the API, join the same dispatch.
$asEditor(static fn () => wp_update_post(['ID' => $postId, 'post_title' => 'Edited twice']));
[$status] = $wp->handle('POST', '/docs', json_encode(['title' => 'Through the API']), 'ed');
eq('the API save succeeds', $status, 201);
eq('saves in the window join the one waiting dispatch', count($pending()), 1);
$db->transaction(static fn () => $db->insert('notes', ['title' => 'Unsynced'], true));
eq('a save of an unsynced kind joins nothing and queues nothing', count($all()), 1);

// `first sync`'s own writes (the /sync routes) send nothing: cancel the waiting one, then sync a record.
[$code] = $wp->cli('jobs', 'cancel', $queued[0]['id']);
eq('the waiting dispatch is cancelled', $code, 0);
$record = ['uid' => 'zr_0123456789abcdef0123', 'fields' => ['title' => 'From a file', 'slug' => 'from-a-file'], 'body' => 'Pushed by first sync.'];
[$status, , $out] = $wp->handle('POST', '/sync/docs', json_encode(['record' => $record, 'expect' => 'absent']), 'ed');
eq('first sync pushes a record', $status, 201);
eq("first sync's writes queue no dispatch", count($pending()), 0);

// A rolled-back save sends nothing.
try {
    $db->transaction(static function () use ($db): void {
        $db->insert('docs', ['title' => 'Doomed'], true);
        throw new RuntimeException('rollback');
    });
} catch (RuntimeException) {
}
eq('a rolled-back save queues nothing', count($pending()), 0);

// No token anywhere: the dispatch fails loudly (and retries); nothing reaches GitHub.
$asEditor(static fn () => wp_update_post(['ID' => $postId, 'post_title' => 'Needs a token']));
$job = $pending()[0];
putenv('FIRST_NOW=2026-11-13T10:01:00.000Z');
$run = \First\Jobs\Runner::run($job['id']);
check('without a token the attempt fails and says why', ($run['state'] ?? null) === 'failed' && str_contains($run['error'] ?? '', 'FIRST_GITHUB_DISPATCH_TOKEN'), $run);
eq('…and sends nothing', $received(), []);

// Without the Secrets API a token is refused, never stored in the database.
$stdin = static fn (string $token) => fopen('data://text/plain,' . rawurlencode($token), 'r');
$GLOBALS['firstTestSecretsOn'] = false;
problem('set --token without a Secrets API is refused', static fn () => GitDispatch::storeToken('ghp_secret_value'), 409, 'secrets_unavailable');
$leak = (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}options WHERE `option_value` LIKE '%ghp_secret_value%'");
eq('…and the token is in no option', $leak, 0);

// With the Secrets API: the token is stored there, the dispatch runs on Action Scheduler.
$GLOBALS['firstTestSecretsOn'] = true;
GitDispatch::storeToken('ghp_secret_value');
eq('the token goes to the Secrets API', $GLOBALS['firstTestSecrets'][GitDispatch::SECRET] ?? null, 'ghp_secret_value');
eq('…never to an option', (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}options WHERE `option_value` LIKE '%ghp_secret_value%'"), 0);
[, $status] = $wp->cli('git-dispatch', 'status');
eq('status names where the token is, never the token', [$status['data']['token'] ?? null, str_contains(json_encode($status), 'ghp_')], ['secrets', false]);
putenv('FIRST_NOW=2026-11-13T10:02:00.000Z');
$wp->exec("UPDATE {prefix}actionscheduler_actions SET `scheduled_date_gmt` = '2000-01-01 00:00:00', `scheduled_date_local` = '2000-01-01 00:00:00' WHERE `hook` = ? AND `status` = 'pending'", [\First\Wp\Jobs\ActionSchedulerQueue::HOOK]);
$drain();
$sent = $received();
eq('Action Scheduler ran the dispatch: one request', count($sent), 1);
eq('…a POST to /repos/<owner>/<name>/dispatches', $sent[0]['line'] ?? null, 'POST /repos/acme/site/dispatches HTTP/1.1');
eq('…with the token as a bearer', $sent[0]['headers']['authorization'] ?? null, 'Bearer ghp_secret_value');
$body = json_decode($sent[0]['body'] ?? 'null', true);
eq('…and the event type the workflow listens for', [$body['event_type'] ?? null, isset($body['client_payload']['site'])], ['first-content-changed', true]);
eq('the dispatch is done', $wp->scalar('SELECT `state` FROM {prefix}first__jobs WHERE `id` = ?', [$job['id']]), 'done');

// After it ran, the next save starts a new window; the environment's token wins over the stored one.
putenv('FIRST_GITHUB_DISPATCH_TOKEN=ghp_from_env');
$asEditor(static fn () => wp_update_post(['ID' => $postId, 'post_title' => 'A later edit']));
$next = $pending();
eq('a save after the dispatch queues a new one', count($next), 1);
file_put_contents("$inbox/status", '403');
$run = \First\Jobs\Runner::run($next[0]['id']);
check("GitHub's refusal fails the attempt with a hint, without the token", ($run['state'] ?? null) === 'failed' && str_contains($run['error'] ?? '', '403') && !str_contains($run['error'] ?? '', 'ghp_'), $run);
$log = $received();
eq('…sent with the environment token', end($log)['headers']['authorization'] ?? null, 'Bearer ghp_from_env');
putenv('FIRST_GITHUB_DISPATCH_TOKEN');

[$code, $out] = $wp->cli('git-dispatch', 'clear', '--token');
eq('clear removes the repository and the stored token', [$code, array_key_exists('repository', $out['data'] ?? []) ? $out['data']['repository'] : 'x', $GLOBALS['firstTestSecrets'][GitDispatch::SECRET] ?? null], [0, null, null]);

finish('git-dispatch');
