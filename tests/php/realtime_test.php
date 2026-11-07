<?php

declare(strict_types=1);

/*
 * Change notices on WordPress, in-process (tests/php/wp.php): one batch per committed transaction,
 * ids only, nothing on rollback, the zero_realtime_changes action, a failing publisher that never
 * fails the write, and the shared-room projection that drops ids a visitor could not list.
 */

use Zero\Realtime\Module as Realtime;
use Zero\Realtime\Publisher;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema = require dirname(__DIR__) . '/fixtures/blog/schema.php';
// Comments readable by anyone, so the shared projection has one public collection to keep ids for.
$schema['collections']['comments']['access']['read'] = ['role' => 'anyone'];
$wp = wpSite('realtime', ['schema' => $schema, 'functions' => file_get_contents(dirname(__DIR__) . '/fixtures/blog/functions.php')]);
$db = $wp->app()->db;

$post = $db->insert('posts', ['title' => 'Before any publisher'], true)[0];

$sent = [];
$recorder = new class ($sent) implements Publisher {
    public function __construct(private array &$sent)
    {
    }

    public function publish(array $notice): void
    {
        $this->sent[] = $notice;
    }
};
check('no publisher: nothing is collected or delivered', !Realtime::enabled());
Realtime::publish($recorder);
check('a registered publisher enables notices', Realtime::enabled());

$db->transaction(static function () use ($db, $post, &$sent): void {
    $db->insert('comments', ['postId' => $post['id'], 'name' => 'a', 'body' => 'one']);
    $db->insert('comments', ['postId' => $post['id'], 'name' => 'b', 'body' => 'two']);
    $db->update('posts', ['title' => 'Renamed'], ['id' => $post['id']]);
    eq('nothing is published before the commit', count($sent), 0);
});
eq('one notice for the whole transaction', count($sent), 1);
$notice = $sent[0];
$comments = array_map('intval', array_column($db->findMany('comments', ['where' => ['postId' => $post['id']]]), 'id'));
sort($comments);
check('notice names id, time and the changes', is_string($notice['id']) && strlen($notice['id']) === 24 && preg_match('/^\d{4}-\d\d-\d\dT/', $notice['at']) === 1, $notice);
$changes = array_map(static function (array $c): array {
    if ($c['ids'] !== null) {
        $c['ids'] = array_map('intval', $c['ids']);
        sort($c['ids']);
    }
    return $c;
}, $notice['changes']);
eq('changes per collection, sorted, with ops and ids', $changes, [
    ['collection' => 'comments', 'ops' => ['create'], 'ids' => $comments],
    ['collection' => 'posts', 'ops' => ['update'], 'ids' => [(int) $post['id']]],
]);
check('no row values travel', !str_contains(json_encode($notice), 'Renamed') && !str_contains(json_encode($notice), '"one"'), $notice);

$sent = [];
try {
    $db->transaction(static function () use ($db, $post): void {
        $db->insert('comments', ['postId' => $post['id'], 'name' => 'c', 'body' => 'doomed']);
        throw new \RuntimeException('rollback');
    });
} catch (\RuntimeException) {
}
eq('a rolled-back transaction publishes nothing', $sent, []);
$db->delete('comments', ['id' => $comments[0]]);
eq('the next commit carries only its own change', array_map(static fn ($c) => [$c['collection'], $c['ops'], array_map('intval', $c['ids'])], $sent[0]['changes'] ?? []),
    [['comments', ['delete'], [$comments[0]]]]);

$sent = [];
$db->transaction(static function () use ($db, $post): void {
    for ($i = 0; $i <= Realtime::MAX_IDS; $i++) {
        $db->insert('comments', ['postId' => $post['id'], 'name' => "bulk$i", 'body' => 'x']);
    }
});
eq('past MAX_IDS a collection is listed without ids', $sent[0]['changes'] ?? null, [['collection' => 'comments', 'ops' => ['create'], 'ids' => null]]);

// The WordPress action fires once per commit with the same notice.
$actions = [];
add_action(Realtime::ACTION, static function (array $notice) use (&$actions): void {
    $actions[] = $notice;
});
$sent = [];
$db->insert('comments', ['postId' => $post['id'], 'name' => 'hooked', 'body' => 'y']);
check('zero_realtime_changes fires with the published notice', count($actions) === 1 && $actions[0] === $sent[0], ['actions' => $actions, 'sent' => $sent]);

// A failing publisher never fails the write and never blocks the next one.
Realtime::reset();
$after = [];
Realtime::publish(new class implements Publisher {
    public function publish(array $notice): void
    {
        throw new \RuntimeException('transport down');
    }
});
Realtime::publish(new class ($after) implements Publisher {
    public function __construct(private array &$after)
    {
    }

    public function publish(array $notice): void
    {
        $this->after[] = $notice;
    }
});
$row = $db->insert('comments', ['postId' => $post['id'], 'name' => 'still', 'body' => 'saved'], true)[0];
check('the write committed although a publisher threw', $db->findFirst('comments', ['where' => ['id' => $row['id']]]) !== null);
eq('later publishers still receive the notice', count($after), 1);

// A write to a collection the schema doesn't name (a system table) is not announced and never fails.
$after = [];
\Zero\Realtime\Module::written('create', '__zero_media', ['id' => 1], null);
\Zero\Realtime\Module::flush();
eq('system collections are skipped without an error', $after, []);

// Shared rooms: ids only where any visitor may list the collection.
$shared = Realtime::shared(['id' => 'x', 'at' => 'now', 'changes' => [
    ['collection' => 'comments', 'ops' => ['create'], 'ids' => [1]],
    ['collection' => 'posts', 'ops' => ['update'], 'ids' => [2]],
    ['collection' => 'authors', 'ops' => ['update'], 'ids' => [3]],
]]);
eq('public, draft-free collections keep ids; rule-gated and draft collections lose them', array_column($shared['changes'], 'ids', 'collection'),
    ['comments' => [1], 'posts' => null, 'authors' => null]);

Realtime::reset();
finish('realtime');
