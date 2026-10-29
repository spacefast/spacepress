<?php

declare(strict_types=1);

/*
 * Db + write pipeline + migrations + HTTP + CLI, against a hand-written app root
 * in a temp dir (what `zero build` would emit), on a real SQLite file.
 */

use Zero\App;
use Zero\HttpError;
use Zero\JsError;

$runtime = dirname(__DIR__, 2) . '/runtime';
$root = sys_get_temp_dir() . '/zero-db-test-' . bin2hex(random_bytes(4));

// ================================================================ fixture app

$files = [
    'public/index.php' => <<<'PHP'
        <?php
        declare(strict_types=1);
        if (PHP_SAPI === 'cli-server' && is_file(__DIR__ . parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH)) && !str_ends_with(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '.php')) {
            return false;
        }
        require __DIR__ . '/../zero/runtime/bootstrap.php';
        \Zero\App::boot(dirname(__DIR__))->handleHttp();
        PHP,
    'zero/app/schema.php' => <<<'PHP'
        <?php
        declare(strict_types=1);
        $now = ['now' => true];
        $open = ['read' => ['role' => 'anyone'], 'create' => ['role' => 'anyone'], 'update' => ['role' => 'anyone'], 'delete' => ['role' => 'anyone']];
        return [
            'version' => 3, 'runtime' => '0.2',
            'collections' => [
                'locations' => [
                    'primaryKey' => 'id',
                    'columns' => [
                        'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                        'name' => ['type' => 'text', 'notNull' => true, 'unique' => true],
                        'code' => ['type' => 'text', 'notNull' => true],
                        'kind' => ['type' => 'text', 'notNull' => true, 'enum' => ['shelf', 'bin'], 'default' => ['value' => 'shelf']],
                        'active' => ['type' => 'boolean', 'notNull' => true, 'default' => ['value' => true]],
                        'meta' => ['type' => 'json'],
                        'createdAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => $now],
                        'updatedAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => $now, 'onUpdate' => $now],
                    ],
                    'relations' => [
                        'items' => ['kind' => 'many', 'collection' => 'items', 'from' => 'id', 'to' => 'locationId'],
                    ],
                    'hooks' => ['beforeCreate' => 'locations__beforeCreate'],
                    'beforeCreateFills' => ['code'],
                    'access' => $open,
                    'api' => ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true],
                ],
                'items' => [
                    'primaryKey' => 'id',
                    'columns' => [
                        'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                        'name' => ['type' => 'text', 'notNull' => true],
                        'qty' => ['type' => 'integer', 'notNull' => true, 'default' => ['value' => 1]],
                        'price' => ['type' => 'real'],
                        'seenAt' => ['type' => 'timestamp'],
                        'bestBefore' => ['type' => 'date'],
                        'locationId' => ['type' => 'integer', 'references' => ['collection' => 'locations', 'column' => 'id', 'onDelete' => 'cascade']],
                    ],
                    'relations' => [
                        'location' => ['kind' => 'one', 'collection' => 'locations', 'from' => 'locationId', 'to' => 'id', 'optional' => true],
                    ],
                    'hooks' => ['beforeCreate' => 'items__beforeCreate', 'afterUpdate' => 'items__afterUpdate'],
                    'access' => $open,
                    'api' => ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true],
                ],
                'logs' => [
                    'primaryKey' => 'id',
                    'columns' => [
                        'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                        'message' => ['type' => 'text', 'notNull' => true],
                        'at' => ['type' => 'timestamp', 'notNull' => true, 'default' => $now],
                    ],
                    'relations' => [],
                    'hooks' => ['afterCreate' => 'logs__afterCreate'],
                    'access' => $open,
                    'api' => ['list' => true, 'get' => true, 'create' => false, 'update' => false, 'delete' => false],
                ],
            ],
            'actions' => [
                'restock' => [
                    'input' => [
                        'itemId' => ['type' => 'integer', 'notNull' => true],
                        'amount' => ['type' => 'integer', 'notNull' => true, 'default' => ['value' => 5]],
                    ],
                    'handler' => 'action__restock',
                    'access' => ['role' => 'anyone'],
                ],
            ],
        ];
        PHP,
    'zero/app/functions.php' => <<<'PHP'
        <?php
        declare(strict_types=1);
        namespace ZeroApp;

        use Zero\HttpError;
        use Zero\JsError;
        use Zero\Js;
        use function Zero\db;

        // Compiled from a hook that mutates its argument: by-reference, no return.
        function locations__beforeCreate(array &$data)
        {
            $data['name'] = Js::trim($data['name'] ?? null);
            if ($data['name'] !== 'forget-code') {
                $data['code'] = strtoupper(Js::slice($data['name'], 0, 3));
            }
        }

        function items__beforeCreate($data)
        {
            if (!array_key_exists('name', $data)) {
                throw new \LogicException('beforeCreate ran without a required field');
            }
            return [...$data, 'name' => ucfirst($data['name'])];
        }

        function items__afterUpdate($row, $previous)
        {
            db()->insert('logs', ['message' => "item {$row['id']} qty {$previous['qty']}->{$row['qty']}"]);
            if ($row['qty'] < 0) {
                throw new JsError('qty cannot go negative');
            }
        }

        // Self-recursive: "loop:N" writes "loop:N-1" until 0.
        function logs__afterCreate($row)
        {
            if (preg_match('/^loop:(\d+)$/', $row['message'], $m) && (int) $m[1] > 0) {
                db()->insert('logs', ['message' => 'loop:' . ((int) $m[1] - 1)]);
            }
        }

        function action__restock($input)
        {
            $item = db()->findFirst('items', ['where' => ['id' => $input['itemId']]])
                ?? throw new HttpError(404, 'not_found', 'No such item');
            return db()->update('items', ['qty' => $item['qty'] + $input['amount']], ['id' => $item['id']], true)[0];
        }
        PHP,
    'zero/app/migrations/0001_init.sql' => <<<'SQL'
        CREATE TABLE "locations" (
        	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        	"name" text NOT NULL,
        	"code" text NOT NULL,
        	"kind" text DEFAULT 'shelf' NOT NULL,
        	"active" integer DEFAULT 1 NOT NULL,
        	"meta" text,
        	"createdAt" text NOT NULL,
        	"updatedAt" text NOT NULL
        );
        --> statement-breakpoint
        CREATE UNIQUE INDEX "locations_name_unique" ON "locations" ("name");
        --> statement-breakpoint
        CREATE TABLE "items" (
        	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        	"name" text NOT NULL,
        	"qty" integer DEFAULT 1 NOT NULL,
        	"price" real,
        	"seenAt" text,
        	"bestBefore" text,
        	"locationId" integer REFERENCES "locations"("id") ON DELETE cascade
        );
        --> statement-breakpoint
        CREATE TABLE "logs" (
        	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        	"message" text NOT NULL,
        	"at" text NOT NULL
        );
        SQL,
];

// Rebuild-style migration on the parent table (what the compiler emits to add a column).
$rebuild = <<<'SQL'
    CREATE TABLE "__new_locations" (
    	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    	"name" text NOT NULL,
    	"code" text NOT NULL,
    	"kind" text DEFAULT 'shelf' NOT NULL,
    	"active" integer DEFAULT 1 NOT NULL,
    	"meta" text,
    	"createdAt" text NOT NULL,
    	"updatedAt" text NOT NULL,
    	"note" text
    );
    --> statement-breakpoint
    INSERT INTO "__new_locations"("id", "name", "code", "kind", "active", "meta", "createdAt", "updatedAt") SELECT "id", "name", "code", "kind", "active", "meta", "createdAt", "updatedAt" FROM "locations";
    --> statement-breakpoint
    DROP TABLE "locations";
    --> statement-breakpoint
    ALTER TABLE "__new_locations" RENAME TO "locations";
    --> statement-breakpoint
    CREATE UNIQUE INDEX "locations_name_unique" ON "locations" ("name");
    SQL;

require __DIR__ . '/blog_app.php';
copyRuntime($root);
foreach ($files as $rel => $content) {
    @mkdir(dirname("$root/$rel"), 0777, true);
    file_put_contents("$root/$rel", $content);
}
putenv('ZERO_DB_PATH'); // default path <root>/data/zero.sqlite, created on demand
putenv('ZERO_AUTO_MIGRATE');
ini_set('error_log', "$root/error.log"); // 5xx problems are logged by design; keep test output clean

register_shutdown_function(static function () use ($root): void {
    stopServer();
    exec('rm -rf ' . escapeshellarg($root));
});

require __DIR__ . '/harness.php';

function names(array $rows): array
{
    return array_column($rows, 'name');
}

// ================================================================ boot + migrate

require $root . '/zero/runtime/bootstrap.php';
$previousSecret = getenv('ZERO_SECRET');
putenv('ZERO_SECRET');
$app = App::boot($root);
$db = \Zero\db();
$pdo = $app->store->pdo();
check('boot creates data/zero.sqlite', is_file("$root/data/zero.sqlite"));
$secret = file_get_contents("$root/data/secret");
check('boot creates a private 32-byte signing key', preg_match('/^[0-9a-f]{64}$/D', $secret) === 1 && (fileperms("$root/data/secret") & 0777) === 0600);
eq('reloading preserves the signing key', \Zero\Secret::load($root), $secret);
putenv('ZERO_SECRET=deployment-signing-key');
eq('deployment signing key overrides the persistent key', \Zero\Secret::load($root), 'deployment-signing-key');
putenv($previousSecret === false ? 'ZERO_SECRET' : 'ZERO_SECRET=' . $previousSecret);
eq('init migration recorded', $pdo->query('SELECT id FROM __zero_migrations')->fetchAll(PDO::FETCH_COLUMN), ['0001_init']);
eq('foreign keys on after boot', (int) $pdo->query('PRAGMA foreign_keys')->fetchColumn(), 1);
eq('second migrate is a no-op', $app->migrate(), []);

// ================================================================ write pipeline: create

$tsPattern = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/';
$garage = $db->insert('locations', ['name' => '  Garage  ', 'meta' => ['floor' => 1, 'tags' => ['a/b', 'é']]], true)[0];
eq('by-ref beforeCreate mutation is kept (trim + fill)', [$garage['name'], $garage['code']], ['Garage', 'GAR']);
eq('defaults: enum value + boolean', [$garage['kind'], $garage['active']], ['shelf', true]);
check('default now: timestamps in ISO ms UTC', preg_match($tsPattern, $garage['createdAt']) === 1 && $garage['createdAt'] === $garage['updatedAt'], $garage);
eq('json column round-trips', $garage['meta'], ['floor' => 1, 'tags' => ['a/b', 'é']]);
eq('json stored with unescaped slashes/unicode', $pdo->query('SELECT meta FROM locations')->fetchColumn(), '{"floor":1,"tags":["a/b","é"]}');

[$attic, $basement] = $db->insert('locations', [
    ['name' => 'Attic', 'kind' => 'bin', 'active' => false, 'updatedAt' => '2000-01-01T00:00:00Z'],
    ['name' => 'Basement'],
], true);
eq('multi-row insert + explicit timestamp normalized', $attic['updatedAt'], '2000-01-01T00:00:00.000Z');

$items = $db->insert('items', [
    ['name' => 'hammer', 'qty' => 2, 'price' => 9.5, 'locationId' => $garage['id']],
    ['name' => 'nails', 'qty' => 100, 'price' => 2, 'locationId' => $garage['id'], 'seenAt' => 0],
    ['name' => 'box'],
    ['name' => 'lamp', 'qty' => 3.0, 'locationId' => $attic['id'], 'seenAt' => '2020-01-01T10:00:00+02:00', 'bestBefore' => '2024-02-29'],
], true);
[$hammer, $nails, $box, $lamp] = $items;
eq('beforeCreate return value replaces data', names($items), ['Hammer', 'Nails', 'Box', 'Lamp']);
eq('every column key present, nulls included', array_keys($box), ['id', 'name', 'qty', 'price', 'seenAt', 'bestBefore', 'locationId']);
eq('default value + nullable columns', [$box['qty'], $box['price'], $box['locationId']], [1, null, null]);
check('integral float accepted for integer, int for real', $lamp['qty'] === 3 && $nails['price'] === 2.0, [$lamp['qty'], $nails['price']]);
eq('timestamp from epoch ms and from offset string', [$nails['seenAt'], $lamp['seenAt']], ['1970-01-01T00:00:00.000Z', '2020-01-01T08:00:00.000Z']);
eq('date column', $lamp['bestBefore'], '2024-02-29');
eq('insert without returning → null', $db->insert('logs', ['message' => 'hello']), null);

// Step 2b: required fields are checked before the hook (the items hook throws LogicException otherwise).
problem('missing required field → invalid_input before beforeCreate', fn () => $db->insert('items', ['qty' => 1]), 422, 'invalid_input', '/name');
problem('missing required on a beforeCreateFills column is left to the hook… which forgot it', fn () => $db->insert('locations', ['name' => 'forget-code']), 422, 'invalid_input', '/code');
problem('unknown key', fn () => $db->insert('items', ['name' => 'x', 'bogus' => 1]), 422, 'invalid_input', '/bogus');
$e = problem('fractional integer', fn () => $db->insert('items', ['name' => 'x', 'qty' => 1.5]), 422, 'invalid_input', '/qty');
check('detail names the expected type', $e !== null && str_contains($e->getMessage(), 'integer'), $e?->getMessage());
problem('string for integer', fn () => $db->insert('items', ['name' => 'x', 'qty' => '2']), 422, 'invalid_input', '/qty');
problem('enum', fn () => $db->insert('locations', ['name' => 'Loft', 'kind' => 'crate']), 422, 'invalid_input', '/kind');
problem('boolean', fn () => $db->insert('locations', ['name' => 'Loft', 'active' => 1]), 422, 'invalid_input', '/active');
problem('null for notNull', fn () => $db->insert('items', ['name' => 'x', 'qty' => null]), 422, 'invalid_input', '/qty');
problem('NaN for real', fn () => $db->insert('items', ['name' => 'x', 'price' => NAN]), 422, 'invalid_input', '/price');
problem('bad timestamp', fn () => $db->insert('items', ['name' => 'x', 'seenAt' => 'yesterday-ish']), 422, 'invalid_input', '/seenAt');
problem('impossible calendar date', fn () => $db->insert('items', ['name' => 'x', 'bestBefore' => '2023-02-29']), 422, 'invalid_input', '/bestBefore');
problem('unique_violation with pointer', fn () => $db->insert('locations', ['name' => 'Garage']), 409, 'unique_violation', '/name');
problem('reference_violation names the column', fn () => $db->insert('items', ['name' => 'x', 'locationId' => 99999]), 409, 'reference_violation', '/locationId');

// ================================================================ reads

$find = fn (array $opts, string $c = 'items') => $db->findMany($c, $opts);
eq('gt + orderBy', names($find(['where' => ['qty' => ['gt' => 2]], 'orderBy' => ['name' => 'asc']])), ['Lamp', 'Nails']);
eq('top-level OR', names($find(['where' => ['OR' => [['name' => 'Box'], ['qty' => ['gte' => 100]]]], 'orderBy' => ['id' => 'asc']])), ['Nails', 'Box']);
eq('top-level NOT with null', names($find(['where' => ['NOT' => ['locationId' => null]], 'orderBy' => ['id' => 'asc']])), ['Hammer', 'Nails', 'Lamp']);
eq('in / notIn', [names($find(['where' => ['name' => ['in' => ['Lamp', 'Hammer']]], 'orderBy' => ['id' => 'asc']])), count($find(['where' => ['name' => ['notIn' => ['Lamp']]]]))], [['Hammer', 'Lamp'], 3]);
eq('empty in matches nothing', $find(['where' => ['id' => ['in' => []]]]), []);
eq('like is case-sensitive, ilike is not', [names($find(['where' => ['name' => ['like' => 'ha%']]])), names($find(['where' => ['name' => ['ilike' => 'ha%']]]))], [[], ['Hammer']]);
eq('notIlike', names($find(['where' => ['name' => ['notIlike' => '%A%']]])), ['Box']);
eq('like escapes and _', names($find(['where' => ['name' => ['like' => '_ox']]])), ['Box']);
eq('field-level OR + several operators ANDed', names($find(['where' => ['qty' => ['OR' => [['lt' => 3], ['gt' => 50]], 'ne' => 1], 'price' => ['isNotNull' => true]], 'orderBy' => ['id' => 'asc']])), ['Hammer', 'Nails']);
eq('field-level NOT', names($find(['where' => ['qty' => ['NOT' => ['lte' => 3]]]])), ['Nails']);
eq('isNull', names($find(['where' => ['seenAt' => ['isNull' => true]], 'orderBy' => ['id' => 'asc']])), ['Hammer', 'Box']);
eq('relation one: filter', names($find(['where' => ['location' => ['name' => 'Garage']], 'orderBy' => ['id' => 'asc']])), ['Hammer', 'Nails']);
eq('relation one: exists', count($find(['where' => ['location' => true]])), 3);
eq('relation many: filter', names($find(['where' => ['items' => ['qty' => ['gt' => 50]]]], 'locations')), ['Garage']);
eq('boolean filter coerced', names($find(['where' => ['active' => false]], 'locations')), ['Attic']);
eq('timestamp filter normalized', count($find(['where' => ['updatedAt' => ['lt' => '2001-01-01']]], 'locations')), 1);
eq('orderBy desc + limit/offset', names($find(['orderBy' => ['qty' => 'desc'], 'limit' => 2, 'offset' => 1])), ['Lamp', 'Hammer']);
eq('columns', $find(['columns' => ['id' => true, 'name' => true], 'where' => ['id' => $box['id']]]), [['id' => $box['id'], 'name' => 'Box']]);
eq('findFirst', $db->findFirst('items', ['where' => ['name' => 'Nails']])['qty'], 100);
eq('findFirst none', $db->findFirst('items', ['where' => ['name' => 'Nope']]), null);

$tree = $db->findMany('locations', [
    'orderBy' => ['name' => 'asc'],
    'columns' => ['name' => true],
    'with' => ['items' => ['orderBy' => ['qty' => 'desc'], 'limit' => 1, 'columns' => ['name' => true, 'qty' => true], 'with' => ['location' => ['columns' => ['code' => true]]]]],
]);
eq('nested with: per-parent limit, columns, one-in-many', $tree, [
    ['name' => 'Attic', 'items' => [['name' => 'Lamp', 'qty' => 3, 'location' => ['code' => 'ATT']]]],
    ['name' => 'Basement', 'items' => []],
    ['name' => 'Garage', 'items' => [['name' => 'Nails', 'qty' => 100, 'location' => ['code' => 'GAR']]]],
]);
$withLocation = array_column($find(['with' => ['location' => ['columns' => ['name' => true]]], 'orderBy' => ['id' => 'asc']]), null, 'name');
eq('with one: row or null, key always present', [$withLocation['Hammer']['location'], array_key_exists('location', $withLocation['Box']), $withLocation['Box']['location']], [['name' => 'Garage'], true, null]);
eq('with many: filtered', names($db->findFirst('locations', ['where' => ['id' => $garage['id']], 'with' => ['items' => ['where' => ['qty' => ['lt' => 10]]]]])['items']), ['Hammer']);

problem('unknown column', fn () => $find(['where' => ['qtty' => 1]]), 400, 'invalid_query', '/where/qtty');
problem('unknown operator', fn () => $find(['where' => ['qty' => ['near' => 1]]]), 400, 'invalid_query', '/where/qty/near');
problem('bad filter value', fn () => $find(['where' => ['qty' => ['gt' => 'x']]]), 400, 'invalid_query', '/where/qty/gt');
problem('unknown relation in with', fn () => $find(['with' => ['owner' => true]]), 400, 'invalid_query', '/with/owner');
problem('unknown orderBy column', fn () => $find(['orderBy' => ['nope' => 'asc']]), 400, 'invalid_query', '/orderBy/nope');

// ================================================================ update / delete / hooks

$updated = $db->update('locations', ['name' => 'Attic+'], ['id' => $attic['id']], true)[0];
check('onUpdate now applied when absent from patch', $updated['updatedAt'] !== '2000-01-01T00:00:00.000Z' && preg_match($tsPattern, $updated['updatedAt']) === 1, $updated);
eq('createdAt untouched by update', $updated['createdAt'], $attic['createdAt']);
problem('primary key change rejected', fn () => $db->update('items', ['id' => 999], ['id' => $box['id']]), 422, 'invalid_input', '/id');
eq('same primary key value is allowed', $db->update('items', ['id' => $box['id'], 'qty' => 4], ['id' => $box['id']], true)[0]['qty'], 4);

$logsBefore = count($db->findMany('logs'));
$rows = $db->update('items', ['qty' => 5], ['locationId' => $garage['id']], true);
eq('update every matching row, returning post-write rows', array_column($rows, 'qty', 'name'), ['Hammer' => 5, 'Nails' => 5]);
eq('afterUpdate hook inserted into another collection per row', array_column(array_slice($db->findMany('logs', ['orderBy' => ['id' => 'asc']]), $logsBefore), 'message'), ["item {$hammer['id']} qty 2->5", "item {$nails['id']} qty 100->5"]);
eq('update matching nothing', $db->update('items', ['qty' => 1], ['id' => -1], true), []);

$logCount = fn () => count($db->findMany('logs'));
$before = $logCount();
$e = problem('JsError from afterUpdate → rejected', fn () => $db->transaction(fn () => $db->update('items', ['qty' => -1], ['id' => $hammer['id']])), 422, 'rejected');
check('JsError keeps its message', $e instanceof JsError && $e->getMessage() === 'qty cannot go negative');
eq('transaction rolled back the update and the hook insert', [$db->findFirst('items', ['where' => ['id' => $hammer['id']]])['qty'], $logCount()], [5, $before]);

// Callback effects use another connection: they must see committed rows, never uncommitted state.
$observer = \Zero\Store\SqliteStore::connect("$root/data/zero.sqlite");
$committed = [];
$db->transaction(function () use ($db, $observer, &$committed) {
    \Zero\Extensions::afterCommit(function () use ($observer, &$committed) {
        $committed[] = 'outer:' . $observer->query("SELECT qty FROM items WHERE name = 'Hammer'")->fetchColumn();
    });
    $db->transaction(function () use ($db, $observer, &$committed) {
        $db->update('items', ['qty' => 6], ['name' => 'Hammer']);
        \Zero\Extensions::afterCommit(function () use ($observer, &$committed) {
            $committed[] = 'inner:' . $observer->query("SELECT qty FROM items WHERE name = 'Hammer'")->fetchColumn();
        });
    });
    eq('nested transaction defers callbacks until the outer commit', $committed, []);
});
eq('both callbacks see the committed row in registration order', $committed, ['outer:6', 'inner:6']);
problem('outer rollback discards callbacks registered by a nested write', function () use ($db, &$committed) {
    $db->transaction(function () use ($db, &$committed) {
        $db->transaction(function () use ($db, &$committed) {
            $db->update('items', ['qty' => 99], ['name' => 'Hammer']);
            \Zero\Extensions::afterCommit(function () use (&$committed) { $committed[] = 'rolled back'; });
        });
        throw new JsError('rollback');
    });
}, 422, 'rejected');
// A post-commit failure cannot roll back durable data or undo callbacks already applied.
problem('post-commit exception propagates', function () use ($db, $root) {
    $db->transaction(function () use ($db, $root) {
        file_put_contents("$root/committed-file", 'durable');
        $db->store()->onRollback(static fn () => unlink("$root/committed-file"));
        $db->update('items', ['qty' => 5], ['name' => 'Hammer']);
        \Zero\Extensions::afterCommit(static fn () => throw new JsError('after commit'));
    });
}, 422, 'rejected');
eq('post-commit failure never undoes committed filesystem effects', is_file("$root/committed-file"), true);
\Zero\Extensions::afterCommit(function () use (&$committed) { $committed[] = 'immediate'; });
eq('rollback and post-commit failure leave no stale callbacks', [$observer->query("SELECT qty FROM items WHERE name = 'Hammer'")->fetchColumn(), $committed], [5, ['outer:6', 'inner:6', 'immediate']]);

$before = $logCount();
$db->transaction(fn () => $db->insert('logs', ['message' => 'loop:8']));
eq('8 levels of nested hook writes are allowed', $logCount(), $before + 9);
problem('a 9th level → hook_recursion', fn () => $db->transaction(fn () => $db->insert('logs', ['message' => 'loop:9'])), 500, 'hook_recursion');
eq('hook_recursion rolled back everything', $logCount(), $before + 9);

$deleted = $db->delete('items', ['name' => 'Box'], true);
eq('delete returns pre-delete rows', names($deleted), ['Box']);
$db->delete('locations', ['id' => $attic['id']]);
eq('runtime FK cascade is on', $db->findFirst('items', ['where' => ['id' => $lamp['id']]]), null);

// ================================================================ migrations: rebuild + integrity guard

$cli = function (string ...$args) use ($root): array {
    exec('ZERO_DEBUG=1 ' . escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg("$root/zero/bin/zero.php") . ' ' . implode(' ', array_map('escapeshellarg', $args)) . ' 2>/dev/null', $out, $code);

    return [$code, json_decode(implode("\n", $out), true)];
};
$childrenBefore = $db->findMany('items', ['where' => ['locationId' => $garage['id']], 'orderBy' => ['id' => 'asc']]);
file_put_contents("$root/zero/app/migrations/0002_rebuild_locations.sql", $rebuild);
eq('CLI migrate applies the rebuild', $cli('migrate'), [0, ['data' => ['applied' => ['0002_rebuild_locations']]]]);
eq('child rows survive a parent rebuild (no cascade fired)', $db->findMany('items', ['where' => ['locationId' => $garage['id']], 'orderBy' => ['id' => 'asc']]), $childrenBefore);
eq('rebuilt table has the new column', array_column($pdo->query('PRAGMA table_info("locations")')->fetchAll(), 'name')[8] ?? null, 'note');
problem('unique index recreated by the rebuild', fn () => $db->insert('locations', ['name' => 'Garage']), 409, 'unique_violation', '/name');

file_put_contents("$root/zero/app/migrations/0003_orphan.sql", "DELETE FROM \"locations\" WHERE \"name\" = 'Garage';\n--> statement-breakpoint\nSELECT 1;");
[$code, $out] = $cli('migrate');
check('migration leaving broken FKs fails and names the table', $code === 1 && str_contains($out['error']['detail'] ?? '', 'items -> locations'), $out);
eq('failed migration rolled back and not recorded', [count($db->findMany('locations', ['where' => ['name' => 'Garage']])), $pdo->query("SELECT COUNT(*) FROM __zero_migrations WHERE id = '0003_orphan'")->fetchColumn()], [1, 0]);
check('foreign keys back on after a failed migration', (int) $pdo->query('PRAGMA foreign_keys')->fetchColumn() === 1);
[$code, $out] = $cli('insert', 'items', '{"name":"ghost"}');
check('CLI auto-migrate refuses to run past a broken migration', $code === 1 && ($out['error']['code'] ?? null) === 'internal', $out);
unlink("$root/zero/app/migrations/0003_orphan.sql");

// ================================================================ CLI

[$code, $out] = $cli('find', 'items', '{"where":{"name":{"like":"Ham%"}},"columns":{"name":true}}');
eq('CLI find', [$code, $out], [0, ['data' => [['name' => 'Hammer']]]]);
[$code, $out] = $cli('insert', 'items', '{"name":"cli","qty":"x"}');
eq('CLI error envelope + exit 1', [$code, $out['error']['code'] ?? null, $out['error']['pointer'] ?? null], [1, 'invalid_input', '/qty']);
[$code, $out] = $cli('update', 'items', '{"name":"Hammer"}', '{"qty":-3}');
eq('CLI runs in a transaction', [$code, $out['error']['code'] ?? null, $db->findFirst('items', ['where' => ['name' => 'Hammer']])['qty']], [1, 'rejected', 5]);
[$code, $out] = $cli('action', 'restock', json_encode(['itemId' => $hammer['id'], 'amount' => 2]));
eq('CLI action', [$code, $out['data']['qty'] ?? null], [0, 7]);
eq('CLI usage error', $cli('frobnicate')[0], 1);

// ================================================================ HTTP

$port = (static function (): int {
    $s = stream_socket_server('tcp://127.0.0.1:0');
    $port = (int) substr(strrchr(stream_socket_get_name($s, false), ':'), 1);
    fclose($s);

    return $port;
})();
$GLOBALS['server'] = proc_open(
    [PHP_BINARY, '-S', "127.0.0.1:$port", "$root/public/index.php"],
    [0 => ['file', '/dev/null', 'r'], 1 => ['file', "$root/server.log", 'a'], 2 => ['file', "$root/server.log", 'a']],
    $pipes,
    $root,
);

function stopServer(): void
{
    if (is_resource($GLOBALS['server'] ?? null)) {
        proc_terminate($GLOBALS['server']);
        proc_close($GLOBALS['server']);
    }
}

/** @return array{status: int, headers: array<string, string>, body: string, json: mixed} */
function http(string $method, string $path, mixed $body = null, ?string $raw = null): array
{
    global $port;
    $ch = curl_init("http://127.0.0.1:$port$path");
    $headers = [];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$headers) {
            if (str_contains($line, ':')) {
                [$k, $v] = explode(':', $line, 2);
                $headers[strtolower(trim($k))] = trim($v);
            }
            return strlen($line);
        },
    ]);
    if ($raw !== null || $body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $raw ?? json_encode($body));
    }
    $res = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);

    return ['status' => $status, 'headers' => $headers, 'body' => (string) $res, 'json' => is_string($res) ? json_decode($res, true) : null];
}

// Poll until the server answers; no fixed sleep.
$deadline = microtime(true) + 10;
do {
    $ready = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.2);
    if (!$ready) {
        usleep(10_000);
    }
} while (!$ready && microtime(true) < $deadline);
check('server started', (bool) $ready, @file_get_contents("$root/server.log"));
$ready && fclose($ready);

$isProblem = function (string $label, array $r, int $status, string $code, ?string $pointer = null): void {
    $j = $r['json'];
    check(
        "$label → $status $code",
        $r['status'] === $status && str_starts_with($r['headers']['content-type'] ?? '', 'application/problem+json')
            && ($j['type'] ?? null) === 'about:blank' && ($j['status'] ?? null) === $status && ($j['code'] ?? null) === $code
            && is_string($j['title'] ?? null) && is_string($j['detail'] ?? null) && ($j['pointer'] ?? null) === $pointer
            && ($r['headers']['access-control-allow-origin'] ?? null) === '*',
        $r,
    );
};

$r = http('OPTIONS', '/api/items');
eq('OPTIONS preflight', [$r['status'], $r['headers']['access-control-allow-origin'] ?? null, $r['headers']['access-control-allow-methods'] ?? null, $r['headers']['access-control-allow-headers'] ?? null, $r['headers']['access-control-expose-headers'] ?? null],
    [204, '*', 'GET, POST, PATCH, DELETE, OPTIONS', 'content-type, authorization, idempotency-key', 'Idempotent-Replayed']);

$r = http('GET', '/api/_schema');
check('GET /api/_schema', $r['status'] === 200 && $r['json']['data']['collections']['items']['columns']['qty']['type'] === 'integer'
    && isset($r['json']['data']['actions']['restock']['input']['amount']), $r);
check('schema exposes no function names', !str_contains($r['body'], '__') && !str_contains($r['body'], 'hooks') && !str_contains($r['body'], 'handler'), $r['body']);

$r = http('POST', '/api/items', ['name' => 'widget', 'price' => 2.0, 'locationId' => $garage['id']]);
$widget = $r['json']['data'] ?? [];
check('POST → 201 {data} with hook applied', $r['status'] === 201 && ($widget['name'] ?? null) === 'Widget' && str_starts_with($r['headers']['content-type'] ?? '', 'application/json')
    && ($r['headers']['access-control-allow-origin'] ?? null) === '*', $r);
check('integral float printed without .0', str_contains($r['body'], '"price":2,'), $r['body']);

$r = http('GET', '/api/items?' . http_build_query(['where' => json_encode(['locationId' => $garage['id']]), 'orderBy' => '-qty,name', 'limit' => 2, 'with' => 'location']));
eq('GET list: where + orderBy + limit + with', [$r['status'], array_column($r['json']['data'] ?? [], 'name'), $r['json']['data'][0]['location']['name'] ?? null], [200, ['Hammer', 'Nails'], 'Garage']);
eq('GET list offset', array_column(http('GET', '/api/items?orderBy=-id&offset=1&limit=1')['json']['data'] ?? [], 'name'), ['Nails']);
$isProblem('bad where JSON', http('GET', '/api/items?where=%7Bbad'), 400, 'invalid_query', '/where');
$isProblem('unknown where column', http('GET', '/api/items?where=' . rawurlencode('{"nope":1}')), 400, 'invalid_query', '/where/nope');
$isProblem('bad limit', http('GET', '/api/items?limit=-1'), 400, 'invalid_query', '/limit');

$r = http('GET', "/api/items/{$widget['id']}?with=location");
eq('GET by id with relation', [$r['status'], $r['json']['data']['location']['code'] ?? null], [200, 'GAR']);
$isProblem('GET missing id', http('GET', '/api/items/999999'), 404, 'not_found');
$isProblem('GET non-integer id', http('GET', '/api/items/abc'), 404, 'not_found');
$isProblem('unknown collection', http('GET', '/api/widgets'), 404, 'not_found');
$isProblem('route outside /api', http('GET', '/nope'), 404, 'not_found');

$isProblem('invalid JSON body', http('POST', '/api/items', raw: '{"name":'), 400, 'invalid_json');
$isProblem('coercion error with pointer', http('POST', '/api/items', ['name' => 'x', 'qty' => 'lots']), 422, 'invalid_input', '/qty');
$isProblem('missing required', http('POST', '/api/items', ['qty' => 1]), 422, 'invalid_input', '/name');
$isProblem('unique violation', http('POST', '/api/locations', ['name' => 'Garage']), 409, 'unique_violation', '/name');
$isProblem('reference violation', http('POST', '/api/items', ['name' => 'x', 'locationId' => 424242]), 409, 'reference_violation', '/locationId');

$r = http('PATCH', "/api/items/{$widget['id']}", ['qty' => 7]);
eq('PATCH', [$r['status'], $r['json']['data']['qty'] ?? null], [200, 7]);
$isProblem('PATCH missing', http('PATCH', '/api/items/999999', ['qty' => 1]), 404, 'not_found');
$isProblem('PATCH array body', http('PATCH', "/api/items/{$widget['id']}", [1, 2]), 422, 'invalid_input', '');

$logsBefore = count(http('GET', '/api/logs?limit=200')['json']['data']);
$r = http('PATCH', "/api/items/{$widget['id']}", ['qty' => -5]);
$isProblem('hook throws JsError mid-request', $r, 422, 'rejected');
eq('rejected detail is the JsError message', $r['json']['detail'] ?? null, 'qty cannot go negative');
eq('request rolled back: row unchanged, hook insert undone',
    [http('GET', "/api/items/{$widget['id']}")['json']['data']['qty'], count(http('GET', '/api/logs?limit=200')['json']['data'])], [7, $logsBefore]);

$r = http('POST', '/api/actions/restock', ['itemId' => $widget['id']]);
eq('action with default input', [$r['status'], $r['json']['data']['qty'] ?? null], [200, 12]);
$isProblem('action input coercion', http('POST', '/api/actions/restock', ['itemId' => 'x']), 422, 'invalid_input', '/itemId');
$isProblem('action unknown input key', http('POST', '/api/actions/restock', ['itemId' => 1, 'extra' => 1]), 422, 'invalid_input', '/extra');
$isProblem('action HttpError from handler', http('POST', '/api/actions/restock', ['itemId' => 999999]), 404, 'not_found');
$isProblem('unknown action', http('POST', '/api/actions/nope', []), 404, 'not_found');

$isProblem('api flag disables create', http('POST', '/api/logs', ['message' => 'x']), 405, 'method_not_allowed');
$isProblem('api flag disables delete', http('DELETE', '/api/logs/1'), 405, 'method_not_allowed');
$isProblem('unsupported method', http('PUT', '/api/items'), 405, 'method_not_allowed');

$r = http('DELETE', "/api/items/{$widget['id']}");
eq('DELETE returns the deleted row', [$r['status'], $r['json']['data']['name'] ?? null, $r['json']['data']['qty'] ?? null], [200, 'Widget', 12]);
$isProblem('deleted row is gone', http('GET', "/api/items/{$widget['id']}"), 404, 'not_found');

stopServer();

// ================================================================ relation filters respect the target's read access

// A relation filter is an oracle over the target's columns, so it may only see target rows a direct
// read would return: an unreadable target is denied like `with`, a draft target matches nothing.
(static function (): void {
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
    $status = ['type' => 'text', 'notNull' => true, 'enum' => ['draft', 'published', 'scheduled'], 'default' => ['value' => 'published'], 'system' => true];
    $one = static fn (string $c, string $from) => ['kind' => 'one', 'collection' => $c, 'from' => $from, 'to' => 'id'];
    $schema = new \Zero\Schema(['version' => 3, 'runtime' => '0.2', 'collections' => [
        'accounts' => ['primaryKey' => 'id', 'access' => ['read' => ['role' => 'admin']],
            'columns' => ['id' => $id, 'apiKey' => ['type' => 'text', 'notNull' => true]]],
        'articles' => ['primaryKey' => 'id', 'drafts' => true,
            'columns' => ['id' => $id, 'secret' => ['type' => 'text'], 'ownerId' => ['type' => 'integer'], 'status' => $status, 'publishedAt' => ['type' => 'timestamp', 'system' => true]],
            'relations' => ['owner' => $one('accounts', 'ownerId')]],
        'comments' => ['primaryKey' => 'id',
            'columns' => ['id' => $id, 'articleId' => ['type' => 'integer'], 'ownerId' => ['type' => 'integer']],
            'relations' => ['article' => $one('articles', 'articleId'), 'owner' => $one('accounts', 'ownerId')]],
    ]]);
    $pdo = \Zero\Store\SqliteStore::connect(':memory:');
    $pdo->exec('CREATE TABLE "accounts" ("id" integer PRIMARY KEY, "apiKey" text NOT NULL); CREATE TABLE "articles" ("id" integer PRIMARY KEY, "secret" text, "ownerId" integer, "status" text NOT NULL, "publishedAt" text); CREATE TABLE "comments" ("id" integer PRIMARY KEY, "articleId" integer, "ownerId" integer)');
    $pdo->exec("INSERT INTO accounts VALUES (1, 'sk_live_7x'); INSERT INTO articles VALUES (1, 'price=42', NULL, 'draft', NULL), (2, 'open', 1, 'published', '2026-01-01T00:00:00.000Z'); INSERT INTO comments VALUES (1, 1, 1), (2, 2, NULL)");
    $store = new \Zero\Store\SqliteStore($pdo, $schema);
    $db = new \Zero\Db($store, $schema, new \Zero\Store\SqliteMedia($store, sys_get_temp_dir()));
    $anon = new \Zero\Viewer(null, 'standalone');
    $editor = new \Zero\Viewer(['id' => 1, 'name' => 'ed', 'role' => 'editor'], 'standalone');
    $admin = new \Zero\Viewer(['id' => 2, 'name' => 'root', 'role' => 'admin'], 'standalone');
    $ids = static fn (string $c, array $where, ?\Zero\Viewer $v) => array_column($db->findMany($c, ['where' => $where, 'orderBy' => ['id' => 'asc']], $v), 'id');
    $key = ['owner' => ['apiKey' => ['like' => 'sk_live_7%']]];

    problem('an unreadable relation target is denied like `with` (anonymous → 401)', fn () => $ids('comments', $key, $anon), 401, 'unauthenticated');
    problem('… and like `with` for a signed-in viewer below the rule (403)', fn () => $ids('comments', $key, $editor), 403, 'forbidden');
    problem('nested: the denial reaches through a readable relation', fn () => $ids('comments', ['article' => $key], $anon), 401, 'unauthenticated');
    eq('a reader of the target filters through it', $ids('comments', $key, $admin), [1]);
    eq('a draft target matches nothing for a viewer who can\'t see drafts', [
        $ids('comments', ['article' => ['secret' => ['like' => 'price=4%']]], $anon),
        $ids('comments', ['article' => true], $anon),
        $ids('comments', ['article' => false], $anon),
    ], [[], [2], [1]]);
    eq('editors see drafts through relation filters; trusted reads see everything', [
        $ids('comments', ['article' => ['secret' => ['like' => 'price=4%']]], $editor),
        $ids('comments', $key + ['article' => ['secret' => 'price=42']], null),
    ], [[1], [1]]);
})();

finish('db_test');
