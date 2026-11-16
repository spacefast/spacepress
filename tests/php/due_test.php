<?php

declare(strict_types=1);

/*
 * Lazy scheduled promotion, throttled (First\Wp\DueRows) on WordPress on SQLite: a table-backed kind
 * with drafts is scanned for due rows only once the site's autoloaded "next due" time has come. A
 * row scheduled through First lowers that time when its write commits, so it is published on the
 * first request at or after its time, as before; a row scheduled any other way is found by the scan
 * that runs at least once a minute.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
$status = ['type' => 'text', 'notNull' => true, 'enum' => ['draft', 'published', 'scheduled'], 'default' => ['value' => 'published'], 'system' => true];
$open = ['read' => ['role' => 'anyone'], 'create' => ['role' => 'anyone'], 'update' => ['role' => 'anyone'], 'delete' => ['role' => 'anyone']];
$wp = wpSite('due', ['schema' => ['name' => 'due', 'collections' => [
    'bulletins' => ['primaryKey' => 'id', 'drafts' => true, 'access' => $open,
        'columns' => ['id' => $id, 'title' => ['type' => 'text', 'notNull' => true], 'status' => $status, 'publishedAt' => ['type' => 'timestamp', 'system' => true]]],
]]]);
$db = $wp->app()->db;
$at = static fn (int $seconds): string => gmdate('Y-m-d\TH:i:s.000\Z', 1_900_000_000 + $seconds);
$clock = static fn (int $seconds) => putenv('FIRST_NOW=' . $at($seconds));
$scans = 0;
\First\Wp\Connection::$observer = static function (string $sql) use (&$scans): void {
    if (str_contains($sql, "`status` = 'scheduled'")) {
        $scans++;
    }
};
$promote = static function () use ($db, &$scans): array {
    $scans = 0;
    $promoted = $db->transaction(static fn () => $db->promoteDue());

    return [$scans, array_map('count', $promoted)];
};
$option = static fn (): mixed => $wp->sql("SELECT option_value AS v, autoload AS a FROM {prefix}options WHERE option_name = 'first_due_due_at'")[0] ?? null;

$clock(0);
[$scans] = $promote();
check('the first promotion scans and records when to look next', $scans > 0 && $option() !== null, [$scans, $option()]);
check('autoloaded', in_array($option()['a'] ?? null, ['on', 'yes'], true), $option());
eq('until then, no request scans', $promote(), [0, []]);

$row = $db->insert('bulletins', ['title' => 'later', 'status' => 'scheduled', 'publishedAt' => $at(30)], true)[0];
eq('a row scheduled through First lowers the time to its own', $option()['v'], $at(30));
$clock(29);
eq('before its time, still no scan', $promote(), [0, []]);
$clock(30);
[$scans, $promoted] = $promote();
eq('at its time it is published by that request', [$promoted, $db->findFirst('bulletins', ['where' => ['id' => $row['id']]])['status']], [['bulletins' => 1], 'published']);
eq('with nothing else scheduled, the next look is a minute later', $option()['v'], $at(90));

// A schedule written past First (raw SQL): found by the scan that runs at least once a minute.
$wp->exec("INSERT INTO {prefix}first_bulletins (`title`, `status`, `publishedAt`) VALUES ('raw', 'scheduled', ?)", [$at(40)]);
$clock(60);
eq('not before the next look', $promote(), [0, []]);
$clock(90);
eq('then promoted', $promote()[1], ['bulletins' => 1]);

// Two writers lower the time; the earliest wins whatever order they commit in.
$db->insert('bulletins', ['title' => 'b', 'status' => 'scheduled', 'publishedAt' => $at(500)]);
$db->insert('bulletins', ['title' => 'a', 'status' => 'scheduled', 'publishedAt' => $at(200)]);
$db->insert('bulletins', ['title' => 'c', 'status' => 'scheduled', 'publishedAt' => $at(400)]);
eq('the earliest schedule is kept', $option()['v'], $at(150));
// A scheduling write that rolls back leaves the time as it was.
try {
    $db->transaction(static function () use ($db, $at): void {
        $db->insert('bulletins', ['title' => 'gone', 'status' => 'scheduled', 'publishedAt' => $at(100)]);
        throw new RuntimeException('roll back');
    });
} catch (RuntimeException) {
}
eq('a rolled-back schedule changes nothing', $option()['v'], $at(150));

// A scan doesn't raise a time that a write committed while it ran lowered.
\First\Wp\DueRows::scanned($wp->connection(), 'due', $at(150), $at(1000));
eq('the scan recorded its next time (a minute on, sooner than the row it was told of)', $option()['v'], $at(210));
\First\Wp\DueRows::scheduled($wp->connection(), 'due', $at(180));
\First\Wp\DueRows::scanned($wp->connection(), 'due', $at(150), $at(1000));
eq('a scan that began before the write keeps the lowered time', $option()['v'], $at(180));
\First\Wp\DueRows::scheduled($wp->connection(), 'due', $at(300));
eq('a later schedule never raises it', $option()['v'], $at(180));

\First\Wp\Connection::$observer = null;
putenv('FIRST_NOW');
finish('due');
