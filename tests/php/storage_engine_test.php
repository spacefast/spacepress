<?php

declare(strict_types=1);

use TypedPress\Wp\Connection;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$wp = wpSite('storage-engine', ['schema' => require dirname(__DIR__) . '/fixtures/blog/schema.php']);
$db = $wp->app()->db;
$engineChecks = [];
Connection::$observer = static function (string $sql) use (&$engineChecks): void {
    if (str_contains($sql, 'information_schema.TABLES')) {
        $engineChecks[] = $sql;
    }
};
try {
    eq('the test site uses SQLite', $wp->connection()->sqlite(), true);
    eq('an eager SQLite transaction can write', $db->transaction(static fn () => update_option('storage_engine_probe', 'eager')), true);
    eq('a deferred SQLite transaction can write through wpdb', $db->reading(static fn () => update_option('storage_engine_probe', 'deferred')), true);
    eq('a subsequent read sees the committed write', $db->reading(static fn () => get_option('storage_engine_probe')), 'deferred');
    eq('SQLite does not query storage engines', $engineChecks, []);
} finally {
    Connection::$observer = null;
}

finish('storage_engine');
