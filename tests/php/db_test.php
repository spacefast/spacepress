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
                // ---- lane B: field access
                'teams' => [
                    'primaryKey' => 'id',
                    'columns' => [
                        'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                        'name' => ['type' => 'text', 'notNull' => true],
                        'budget' => ['type' => 'integer', 'access' => ['read' => ['role' => 'admin'], 'update' => ['role' => 'admin']]],
                    ],
                    'relations' => ['members' => ['kind' => 'many', 'collection' => 'profiles', 'from' => 'id', 'to' => 'teamId']],
                    'access' => $open,
                    'api' => ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true],
                ],
                'profiles' => [
                    'primaryKey' => 'id',
                    'revisions' => true,
                    'columns' => [
                        'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                        'name' => ['type' => 'text', 'notNull' => true],
                        'email' => ['type' => 'email', 'access' => ['read' => ['role' => 'editor']]],
                        'ownerId' => ['type' => 'integer'],
                        'salary' => ['type' => 'integer', 'access' => ['read' => ['fn' => 'profiles__field__salary__read'], 'update' => ['role' => 'admin']]],
                        'approved' => ['type' => 'boolean', 'notNull' => true, 'default' => ['value' => false], 'access' => ['create' => ['role' => 'editor'], 'update' => ['role' => 'editor']]],
                        'notes' => ['type' => 'group', 'fields' => [
                            'public' => ['type' => 'text'],
                            'private' => ['type' => 'text', 'access' => ['read' => ['role' => 'editor']]],
                            'flag' => ['type' => 'boolean', 'access' => ['read' => ['role' => 'editor'], 'update' => ['role' => 'editor']]],
                            'pinned' => ['type' => 'boolean', 'notNull' => true, 'default' => ['value' => true]],
                            'tag' => ['type' => 'text', 'access' => ['create' => ['fn' => 'profiles__field__notes__tag__create'], 'update' => ['fn' => 'profiles__field__notes__tag__update']]],
                        ]],
                        'blocks' => ['type' => 'blocks', 'layouts' => [
                            'memo' => ['text' => ['type' => 'text', 'access' => ['update' => ['role' => 'editor']]]],
                            'link' => ['href' => ['type' => 'text']],
                        ]],
                        'mentorId' => ['type' => 'integer', 'access' => ['read' => ['role' => 'editor']]],
                        'stamp' => ['type' => 'group', 'fields' => [
                            'n' => ['type' => 'integer', 'default' => ['fn' => 'profiles__stamp__n__default']],
                            'note' => ['type' => 'text', 'access' => ['create' => ['fn' => 'profiles__field__stamp__note__create']]],
                        ]],
                        'pairs' => ['type' => 'repeater', 'fields' => [
                            'label' => ['type' => 'text'],
                            'details' => ['type' => 'group', 'fields' => ['secret' => ['type' => 'text', 'access' => ['read' => ['role' => 'admin'], 'update' => ['role' => 'admin']]]]],
                        ]],
                        'rounds' => ['type' => 'repeater', 'fields' => [
                            'n' => ['type' => 'integer', 'default' => ['fn' => 'profiles__stamp__n__default']],
                            'note' => ['type' => 'text', 'access' => ['update' => ['fn' => 'profiles__field__rounds__note__update']]],
                        ]],
                        'fixed' => ['type' => 'group', 'access' => ['update' => ['allow' => false]], 'fields' => ['a' => ['type' => 'text'], 'b' => ['type' => 'text']]],
                        'gated' => ['type' => 'group', 'fields' => [
                            'gate' => ['type' => 'boolean', 'default' => ['value' => true], 'access' => ['read' => ['role' => 'editor'], 'update' => ['role' => 'editor']]],
                            'door' => ['type' => 'text', 'access' => ['update' => ['fn' => 'profiles__field__gated__door__update']]],
                        ]],
                        'seeded' => ['type' => 'repeater', 'fields' => [
                            'label' => ['type' => 'text'],
                            'origin' => ['type' => 'text', 'default' => ['value' => 'api'], 'access' => ['create' => ['allow' => false], 'update' => ['allow' => false]]],
                        ]],
                        // door is declared before the group whose hidden value its rule reads.
                        'vault' => ['type' => 'group', 'fields' => [
                            'door' => ['type' => 'text', 'access' => ['update' => ['fn' => 'profiles__field__vault__door__update']]],
                            'config' => ['type' => 'group', 'fields' => ['locked' => ['type' => 'boolean', 'access' => ['read' => ['role' => 'editor'], 'update' => ['role' => 'editor']]]]],
                        ]],
                        'seen' => ['type' => 'group', 'access' => ['update' => ['allow' => false]], 'fields' => [
                            'x' => ['type' => 'text', 'access' => ['read' => ['fn' => 'profiles__field__seen__x__read']]],
                        ]],
                        // Hidden containers holding unwritable fields (round-11 review).
                        'locker' => ['type' => 'group', 'access' => ['read' => ['role' => 'editor']], 'fields' => [
                            'pin' => ['type' => 'text', 'access' => ['update' => ['role' => 'editor']]],
                        ]],
                        'diary' => ['type' => 'repeater', 'access' => ['read' => ['role' => 'editor']], 'fields' => [
                            'label' => ['type' => 'text'],
                            'secret' => ['type' => 'text', 'access' => ['read' => ['role' => 'admin']]],
                        ]],
                        'entries' => ['type' => 'repeater', 'access' => ['read' => ['role' => 'editor']], 'fields' => [
                            'v' => ['type' => 'text', 'access' => ['update' => ['role' => 'editor']]],
                        ]],
                        'cleared' => ['type' => 'boolean', 'access' => ['update' => ['fn' => 'profiles__field__cleared__update']]],
                        'meta' => ['type' => 'json', 'access' => ['update' => ['allow' => false]]],
                        'checks' => ['type' => 'repeater', 'fields' => [
                            'open' => ['type' => 'boolean'],
                            'note' => ['type' => 'text', 'access' => ['update' => ['fn' => 'profiles__field__checks__note__update']]],
                        ]],
                        'tasks' => ['type' => 'repeater', 'fields' => [
                            'label' => ['type' => 'text'],
                            'rate' => ['type' => 'integer', 'access' => ['update' => ['role' => 'editor']]],
                            'secret' => ['type' => 'text', 'access' => ['read' => ['allow' => false]]],
                        ]],
                        'teamId' => ['type' => 'integer', 'references' => ['collection' => 'teams', 'column' => 'id', 'onDelete' => 'set null']],
                    ],
                    'relations' => [
                        'team' => ['kind' => 'one', 'collection' => 'teams', 'from' => 'teamId', 'to' => 'id', 'optional' => true],
                        'mentor' => ['kind' => 'one', 'collection' => 'profiles', 'from' => 'mentorId', 'to' => 'id', 'optional' => true],
                        'mentees' => ['kind' => 'many', 'collection' => 'profiles', 'from' => 'id', 'to' => 'mentorId'],
                    ],
                    'access' => ['read' => ['role' => 'anyone'], 'create' => ['role' => 'author'], 'update' => ['fn' => 'profiles__access__update'], 'delete' => ['role' => 'editor']],
                    'api' => ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true],
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

        // ---- lane B: field access. Owners and editors see the salary; owners update their own row.
        function profiles__field__salary__read($ctx)
        {
            return $ctx['user'] !== null && ($ctx['user']['role'] === 'editor' || $ctx['user']['role'] === 'admin' || $ctx['data']['ownerId'] === $ctx['user']['id']);
        }

        // Sub-field rules see the enclosing item after its defaults.
        function profiles__field__notes__tag__create($ctx)
        {
            return $ctx['data']['pinned'] === true;
        }

        function profiles__field__checks__note__update($ctx)
        {
            return ($ctx['data']['open'] ?? null) === true;
        }

        // Counts its calls: the value a rule saw must be the value stored, so it may run once per item.
        function profiles__stamp__n__default()
        {
            return ++$GLOBALS['stampCalls'];
        }

        function profiles__field__rounds__note__update($ctx)
        {
            return $ctx['data']['n'] === 1;
        }

        function profiles__field__gated__door__update($ctx)
        {
            return $ctx['data']['gate'] === true;
        }

        function profiles__field__vault__door__update($ctx)
        {
            return ($ctx['data']['config']['locked'] ?? null) !== true;
        }

        function profiles__field__seen__x__read($ctx)
        {
            return $ctx['user'] !== null;
        }

        // Reads another column's incoming value: only a supplied notes.flag === false allows it.
        function profiles__field__cleared__update($ctx)
        {
            return ($ctx['data']['notes']['flag'] ?? null) === false;
        }

        function profiles__field__stamp__note__create($ctx)
        {
            return $ctx['data']['n'] === 1;
        }

        // A tag may change only while the note stays pinned.
        function profiles__field__notes__tag__update($ctx)
        {
            return ($ctx['data']['pinned'] ?? null) === true;
        }

        function profiles__access__update($ctx)
        {
            return in_array($ctx['user']['role'] ?? null, ['editor', 'admin'], true) ? true : ['ownerId' => $ctx['user']['id'] ?? -1];
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
        --> statement-breakpoint
        CREATE TABLE "teams" (
        	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        	"name" text NOT NULL,
        	"budget" integer
        );
        --> statement-breakpoint
        CREATE TABLE "profiles" (
        	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
        	"name" text NOT NULL,
        	"email" text,
        	"ownerId" integer,
        	"salary" integer,
        	"approved" integer DEFAULT 0 NOT NULL,
        	"notes" text,
        	"blocks" text,
        	"mentorId" integer,
        	"stamp" text,
        	"pairs" text,
        	"rounds" text,
        	"fixed" text,
        	"gated" text,
        	"seeded" text,
        	"vault" text,
        	"seen" text,
        	"locker" text,
        	"entries" text,
        	"diary" text,
        	"cleared" integer,
        	"meta" text,
        	"checks" text,
        	"tasks" text,
        	"teamId" integer REFERENCES "teams"("id") ON DELETE set null
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
// PHP's own parser understands relative dates; timestamps accept complete ISO 8601 text only.
foreach (['tomorrow', '2026-01-01 tomorrow', '2026-01-01T00:00:00Z +1 year'] as $relative) {
    problem("relative timestamp text: $relative", fn () => $db->insert('items', ['name' => 'x', 'seenAt' => $relative]), 422, 'invalid_input', '/seenAt');
}
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
// That holds for the row selector of a viewer's update/delete as much as for a read.
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
        'comments' => ['primaryKey' => 'id', 'access' => ['update' => ['role' => 'anyone'], 'delete' => ['role' => 'anyone']],
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
    problem('a viewer\'s update selector is denied the unreadable target', fn () => $db->update('comments', ['ownerId' => 1], $key, true, $anon), 401, 'unauthenticated');
    eq('… and a viewer\'s delete selector matches no draft target', $db->delete('comments', ['article' => ['secret' => ['like' => 'price=4%']]], true, $anon), []);
})();

// ================================================================ field access (lane B, phase 2 §4)

$ids = $app->identity();
$fa = [];
foreach (['fa_alice' => 'author', 'fa_bob' => 'author', 'fa_ed' => 'editor', 'fa_admin' => 'admin'] as $name => $role) {
    $fa[$name] = ['user' => $ids->addUser($name, $role, null), 'token' => $ids->createToken($name, null)['token']];
}
/** In-process API call as one of the field-access users (null = anonymous); returns [status, data or problem]. */
$as = function (?string $who, string $method, string $path, mixed $body = null, array $query = []) use ($app, &$fa): array {
    $headers = $who === null ? [] : ['authorization' => 'Bearer ' . $fa[$who]['token']];
    [$status, , $out] = $app->handle($method, $path, $query, $body === null ? '' : json_encode($body), $headers);
    $json = json_decode($out, true);

    return [$status, $status < 300 ? $json['data'] : $json];
};
$faProblem = function (string $label, array $r, int $status, string $code, ?string $pointer): void {
    check("$label → $status $code $pointer", $r[0] === $status && ($r[1]['code'] ?? null) === $code && ($r[1]['pointer'] ?? null) === $pointer, $r[1]);
};
$aliceId = $fa['fa_alice']['user']['id'];
$team = $db->insert('teams', ['name' => 'Core', 'budget' => 1000], true)[0];
[$mine, $theirs] = $db->insert('profiles', [
    ['name' => 'Alice', 'email' => 'alice@example.test', 'ownerId' => $aliceId, 'salary' => 10, 'notes' => ['public' => 'hi', 'private' => 'secret', 'flag' => true],
        'tasks' => [['label' => 'a', 'rate' => 1], ['label' => 'b', 'rate' => 2]], 'blocks' => [['layout' => 'memo', 'text' => 'kept']], 'teamId' => $team['id']],
    ['name' => 'Bob', 'email' => 'bob@example.test', 'ownerId' => $fa['fa_bob']['user']['id'], 'salary' => 20, 'teamId' => $team['id']],
], true);
$byName = static fn (array $rows) => array_column($rows, null, 'name');

// read: shorthand rules once per page, function rules per row; hidden keys are removed, not nulled.
$anon = $byName($as(null, 'GET', '/profiles')[1]);
eq('anonymous rows lack every column it may not read, at every level', [array_keys($anon['Alice']), $anon['Alice']['notes']], [['id', 'name', 'ownerId', 'approved', 'notes', 'blocks', 'stamp', 'pairs', 'rounds', 'fixed', 'gated', 'seeded', 'vault', 'seen', 'cleared', 'meta', 'checks', 'tasks', 'teamId'], ['public' => 'hi', 'pinned' => true, 'tag' => null]]);
$alice = $byName($as('fa_alice', 'GET', '/profiles')[1]);
eq('a function read rule runs per row (author sees only her own salary)', [$alice['Alice']['salary'] ?? 'hidden', $alice['Bob']['salary'] ?? 'hidden', isset($alice['Alice']['email'])], [10, 'hidden', false]);
$editor = $as('fa_ed', 'GET', "/profiles/{$theirs['id']}")[1];
eq('editors read everything the rules allow them', [$editor['email'], $editor['salary']], ['bob@example.test', 20]);
eq('trusted reads see every column', $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['notes'], ['public' => 'hi', 'private' => 'secret', 'flag' => true, 'pinned' => true, 'tag' => null]);

// `with` rows go through the same strip, in both directions of a relation.
$withTeam = $as('fa_ed', 'GET', "/profiles/{$mine['id']}", query: ['with' => 'team'])[1];
eq('with-loaded parent strips its hidden column (budget is admin-only)', [$withTeam['team']['name'], array_key_exists('budget', $withTeam['team'])], ['Core', false]);
$withMembers = $as(null, 'GET', "/teams/{$team['id']}", query: ['with' => 'members'])[1];
eq('with-loaded children are stripped per row', array_map(static fn ($m) => array_key_exists('email', $m) || array_key_exists('salary', $m), $withMembers['members']), [false, false]);
eq('an admin sees the with-loaded column', $as('fa_admin', 'GET', "/profiles/{$mine['id']}", query: ['with' => 'team'])[1]['team']['budget'], 1000);

// Filters, sorts and selections can't name a column the viewer may not read, at any depth.
$faProblem('where on a hidden column', $as(null, 'GET', '/profiles', query: ['where' => '{"email":{"like":"a%"}}']), 403, 'forbidden', '/where/email');
$faProblem('where on a hidden column inside OR', $as(null, 'GET', '/profiles', query: ['where' => '{"OR":[{"name":"x"},{"email":"a"}]}']), 403, 'forbidden', '/where/OR/1/email');
$faProblem('where on a column with a per-row rule', $as('fa_alice', 'GET', '/profiles', query: ['where' => '{"salary":{"gt":15}}']), 403, 'forbidden', '/where/salary');
$faProblem('where on a group holding a hidden sub-field', $as(null, 'GET', '/profiles', query: ['where' => '{"notes":{"isNull":true}}']), 403, 'forbidden', '/where/notes');
$faProblem('relation filter probing a hidden column of the target', $as('fa_ed', 'GET', '/profiles', query: ['where' => '{"team":{"budget":{"gt":500}}}']), 403, 'forbidden', '/where/team/budget');
$faProblem('relation filter from the other side', $as('fa_alice', 'GET', '/teams', query: ['where' => '{"members":{"salary":{"gt":15}}}']), 403, 'forbidden', '/where/members/salary');
$faProblem('nested with filter', $as(null, 'GET', '/teams', query: ['with' => '{"members":{"where":{"email":"a"}}}']), 403, 'forbidden', '/with/members/where/email');
$faProblem('with across a hidden link column (source end)', $as('fa_alice', 'GET', '/profiles', query: ['with' => 'mentor']), 403, 'forbidden', '/with/mentor');
$faProblem('with across a hidden link column (target end)', $as('fa_alice', 'GET', '/profiles', query: ['with' => 'mentees']), 403, 'forbidden', '/with/mentees');
$faProblem('relation filter across a hidden link column (target end)', $as('fa_alice', 'GET', '/profiles', query: ['where' => '{"mentees":{"name":"Bob"}}']), 403, 'forbidden', '/where/mentees');
eq('editors may follow the link', $as('fa_ed', 'GET', "/profiles/{$mine['id']}", query: ['with' => 'mentor'])[1]['mentor'], null);
$faProblem('orderBy on a hidden column', $as(null, 'GET', '/profiles', query: ['orderBy' => '-email']), 403, 'forbidden', '/orderBy/email');
problem('columns selecting a hidden column', fn () => $db->findMany('profiles', ['columns' => ['email' => true]], new \Zero\Viewer(null, 'standalone')), 403, 'forbidden', '/columns/email');
problem('columns selecting a column with a per-row rule', fn () => $db->findMany('profiles', ['columns' => ['salary' => true]], new \Zero\Viewer($fa['fa_alice']['user'], 'standalone')), 403, 'forbidden', '/columns/salary');
eq('excluding a hidden column is allowed', array_keys($db->findMany('profiles', ['columns' => ['email' => false], 'limit' => 1], new \Zero\Viewer(null, 'standalone'))[0]), ['id', 'name', 'ownerId', 'approved', 'notes', 'blocks', 'stamp', 'pairs', 'rounds', 'fixed', 'gated', 'seeded', 'vault', 'seen', 'cleared', 'meta', 'checks', 'tasks', 'teamId']);
eq('a readable column filters normally; trusted filters see everything', [
    array_column($as('fa_ed', 'GET', '/profiles', query: ['where' => '{"email":"bob@example.test"}'])[1], 'name'),
    array_column($db->findMany('teams', ['where' => ['budget' => 1000]]), 'name'),
], [['Bob'], ['Core']]);

// Writes: a supplied key the viewer can't set → 403 at its pointer. Defaults and hooks are trusted.
$faProblem('update rule (admin) refuses the owner', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['salary' => 99]), 403, 'forbidden', '/salary');
eq('the refused update persisted nothing', $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['salary'], 10);
$faProblem('anonymous: 401, as for collection rules', $as(null, 'PATCH', "/teams/{$team['id']}", ['budget' => 1]), 401, 'unauthenticated', '/budget');
$faProblem('create rule refuses an author setting approved', $as('fa_alice', 'POST', '/profiles', ['name' => 'Self-approved', 'approved' => true]), 403, 'forbidden', '/approved');
[$s, $created] = $as('fa_alice', 'POST', '/profiles', ['name' => 'Plain', 'ownerId' => $aliceId]);
eq('the default for a guarded column is not the viewer\'s input', [$s, $created['approved']], [201, false]);
eq('an editor may set it', $as('fa_ed', 'PATCH', "/profiles/{$created['id']}", ['approved' => true])[1]['approved'], true);
[$s, $resent] = $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['name' => 'Alice B', 'salary' => 10, 'approved' => false]);
eq('resending readable values unchanged is not a write to them (read-modify-write)', [$s, $resent['name']], [200, 'Alice B']);
[$s, $patched] = $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['notes' => ['public' => 'edited']]);
eq('replacing a group keeps the sub-field the viewer cannot see', [$s, $patched['notes'], $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['notes']], [200, ['public' => 'edited', 'pinned' => true, 'tag' => null], ['public' => 'edited', 'private' => 'secret', 'flag' => true, 'pinned' => true, 'tag' => null]]);
eq('an empty group patch keeps omitted hidden sub-fields', [$as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['notes' => new \stdClass()])[0], $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['notes']['private']], [200, 'secret']);
// A rule over sibling data is judged on the incoming item too: unpinning while omitting the tag keeps it.
$db->update('profiles', ['notes' => ['public' => 'p', 'pinned' => true, 'tag' => 'kept', 'private' => 'secret', 'flag' => true]], ['id' => $mine['id']]);
[$s] = $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['notes' => ['public' => 'p', 'pinned' => false]]);
eq('omitting a field whose rule the new item fails keeps it', [$s, $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['notes']['tag']], [200, 'kept']);
$faProblem('… and supplying it is refused', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['notes' => ['pinned' => false, 'tag' => null]]), 403, 'forbidden', '/notes/tag');
$faProblem('a hidden sub-field can\'t be probed: its stored value is refused too', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['notes' => ['public' => 'edited', 'flag' => true]]), 403, 'forbidden', '/notes/flag');
$faProblem('… and so is the other value', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['notes' => ['public' => 'edited', 'flag' => false]]), 403, 'forbidden', '/notes/flag');
eq('a sub-field rule sees the item after its defaults', $as('fa_alice', 'POST', '/profiles', ['name' => 'Tagged', 'notes' => ['tag' => 'x']])[0], 201);
$GLOBALS['stampCalls'] = 0;
[$s, $stamped] = $as('fa_alice', 'POST', '/profiles', ['name' => 'Stamped', 'stamp' => ['note' => 'x']]);
eq('a dynamic sub-field default is generated once: the value the rule saw is stored', [$s, $stamped['stamp'] ?? null, $GLOBALS['stampCalls']], [201, ['n' => 1, 'note' => 'x'], 1]);
$faProblem('a null group would erase the hidden sub-field', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['notes' => null]), 403, 'forbidden', '/notes');
// Repeater items have no identity: protected values must be resent unchanged in place, never moved or dropped.
$faProblem('an emptied repeater would drop protected values', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => []]), 403, 'forbidden', '/tasks/0');
$faProblem('reordered items would move protected values', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => [['label' => 'b'], ['label' => 'a']]]), 403, 'forbidden', '/tasks/0');
$faProblem('changing a protected sub-field in an item', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => [['label' => 'a', 'rate' => 9, 'secret' => null], ['label' => 'b', 'rate' => 2]]]), 403, 'forbidden', '/tasks/0/rate');
// Editing an item that holds a field she can't see means supplying it (write-only) and resending the
// value she can't set unchanged; items left as she sees them, and new items, need nothing more.
[$s, $tasks] = $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => [['label' => 'a!', 'rate' => 1, 'secret' => null], ['label' => 'b', 'rate' => 2], ['label' => 'new']]]);
eq('editing visible sub-fields and appending items is allowed', [$s, $tasks['tasks'] ?? null], [200, [['label' => 'a!', 'rate' => 1], ['label' => 'b', 'rate' => 2], ['label' => 'new', 'rate' => null]]]);
eq('an editor may rewrite the repeater', $as('fa_ed', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => []])[1]['tasks'], []);
// A write-only sub-field (read: false, update allowed) may be changed inside a repeater item.
$db->update('profiles', ['tasks' => [['label' => 'w', 'secret' => 'old']]], ['id' => $mine['id']]);
[$s, $writeOnly] = $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => [['label' => 'w', 'rate' => null, 'secret' => 'new']]]);
eq('a write-only sub-field can be replaced, and stays hidden', [$s, $writeOnly['tasks'], $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['tasks'][0]['secret']], [200, [['label' => 'w', 'rate' => null]], 'new']);
$db->update('profiles', ['checks' => [['open' => true, 'note' => 'n']]], ['id' => $mine['id']]);
$faProblem('closing a repeater item while omitting a field its rule then protects is refused', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['checks' => [['open' => false]]]), 403, 'forbidden', '/checks/0');
eq('… and storage is unchanged', $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['checks'][0]['note'], 'n');
$db->update('profiles', ['pairs' => [['label' => 'x', 'details' => ['secret' => 'sx']], ['label' => 'y', 'details' => ['secret' => 'sy']]]], ['id' => $mine['id']]);
$faProblem('swapping items while a nested group omits the hidden value is refused', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['pairs' => [['label' => 'y', 'details' => new \stdClass()], ['label' => 'x', 'details' => new \stdClass()]]]), 403, 'forbidden', '/pairs/0');
eq('… and the pairs are intact', $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['pairs'], [['label' => 'x', 'details' => ['secret' => 'sx']], ['label' => 'y', 'details' => ['secret' => 'sy']]]);
// A list item's defaults are generated once: the value its rules saw is the value stored.
$db->update('profiles', ['rounds' => [['n' => 1, 'note' => 'protected']]], ['id' => $mine['id']]);
$GLOBALS['stampCalls'] = 0;
$faProblem('an item leaving out a function-ruled field must match what she sees', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['rounds' => [new \stdClass()]]), 403, 'forbidden', '/rounds/0');
eq('… so the protected value survives', $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['rounds'][0]['note'], 'protected');
$GLOBALS['stampCalls'] = 0;
[$s] = $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['rounds' => [['n' => 1, 'note' => 'protected'], ['note' => 'new']]]);
eq('a new item\'s default is generated once: the n its rule allowed is the n stored', [$s, $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['rounds'], $GLOBALS['stampCalls']], [200, [['n' => 1, 'note' => 'protected'], ['n' => 1, 'note' => 'new']], 1]);
// Unchanged-value resends compare structure, not key order.
$db->update('profiles', ['fixed' => ['a' => 'A', 'b' => 'B']], ['id' => $mine['id']]);
eq('a readable group she can\'t set may be resent with its keys reordered', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['fixed' => ['b' => 'B', 'a' => 'A']])[0], 200);
// Rules see the effective item: a kept hidden value, not the default that would have filled it.
$db->update('profiles', ['gated' => ['gate' => false, 'door' => 'shut']], ['id' => $mine['id']]);
$faProblem('a rule reads the kept hidden value, not its default', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['gated' => ['door' => 'open']]), 403, 'forbidden', '/gated/door');
// Defaults are trusted, in list items as in groups.
[$s, $seeded] = $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['seeded' => [['label' => 'new']]]);
eq('a list-item default under a create: false rule is not input', [$s, $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['seeded']], [200, [['label' => 'new', 'origin' => 'api']]]);
// Rules see the whole resolved item, whatever order its fields are declared in.
$db->update('profiles', ['vault' => ['door' => 'shut', 'config' => ['locked' => true]]], ['id' => $mine['id']]);
$faProblem('a rule reads a kept nested hidden value declared after it', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['vault' => ['door' => 'open', 'config' => new \stdClass()]]), 403, 'forbidden', '/vault/door');
// Replacing with null is refused from the rules alone: same answer for either hidden value.
$faProblem('null over a group with a function rule (hidden lock on)', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['vault' => null]), 403, 'forbidden', '/vault');
$db->update('profiles', ['vault' => ['door' => 'shut', 'config' => ['locked' => false]]], ['id' => $mine['id']]);
$faProblem('… and with it off', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['vault' => null]), 403, 'forbidden', '/vault');
// A group she reads in full may be resent unchanged even under a function read rule.
$db->update('profiles', ['seen' => ['x' => 'v']], ['id' => $mine['id']]);
eq('a fully visible group resends unchanged', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['seen' => $as('fa_alice', 'GET', "/profiles/{$mine['id']}")[1]['seen']])[0], 200);
// Under a hidden container, nothing about its contents can be learned by writing: right or wrong
// guesses, empty or populated lists, all refused the same way.
$db->update('profiles', ['locker' => ['pin' => '1234'], 'entries' => []], ['id' => $mine['id']]);
$faProblem('right guess of a pin inside a hidden group', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['locker' => ['pin' => '1234']]), 403, 'forbidden', '/locker');
$faProblem('wrong guess, same answer', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['locker' => ['pin' => '0000']]), 403, 'forbidden', '/locker');
$faProblem('emptying a hidden list that is empty', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['entries' => []]), 403, 'forbidden', '/entries');
$db->update('profiles', ['entries' => [['v' => 'x']]], ['id' => $mine['id']]);
$faProblem('… and one that is not', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['entries' => []]), 403, 'forbidden', '/entries');
// The same for a hidden list whose children are writable but include one hidden from the viewer.
$db->update('profiles', ['diary' => [['label' => 'real', 'secret' => 's']]], ['id' => $mine['id']]);
$faProblem('right guess of a label in a hidden list', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['diary' => [['label' => 'real']]]), 403, 'forbidden', '/diary');
$faProblem('wrong guess, same answer', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['diary' => [['label' => 'nope']]]), 403, 'forbidden', '/diary');
// Top-level rules see the incoming patch as sent, not a sibling group already merged with hidden values.
$db->update('profiles', ['notes' => ['public' => 'p', 'flag' => false], 'cleared' => false], ['id' => $mine['id']]);
$faProblem('a merged hidden value is not incoming data (group first)', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['notes' => ['public' => 'n'], 'cleared' => true]), 403, 'forbidden', '/cleared');
$faProblem('… nor with the keys reversed', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['cleared' => true, 'notes' => ['public' => 'n']]), 403, 'forbidden', '/cleared');
eq('… and nothing was stored', $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['cleared'], false);
// Update/delete selectors run as the viewer: they can't filter on a column hidden from it.
$aliceViewer = new \Zero\Viewer($fa['fa_alice']['user'], 'standalone');
problem('an update selector on a hidden column is refused', fn () => $db->update('profiles', ['name' => 'x'], ['email' => 'alice@example.test'], true, $aliceViewer), 403, 'forbidden', '/where/email');
problem('… and a delete selector', fn () => $db->delete('profiles', ['salary' => -1], true, new \Zero\Viewer($fa['fa_ed']['user'], 'standalone')), 403, 'forbidden', '/where/salary');
// An unchanged resend must be the same value: a list resent as an object is a change.
$db->update('profiles', ['meta' => ['a', 'b']], ['id' => $mine['id']]);
$faProblem('a list resent as an object with numeric keys is refused', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['meta' => ['1' => 'b', '0' => 'a']]), 403, 'forbidden', '/meta');
eq('… the stored list is untouched, and the true resend passes', [$db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['meta'], $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['meta' => ['a', 'b']])[0]], [['a', 'b'], 200]);
// Carrying an omitted protected value forward compares only what the viewer sees: any hidden value
// in that item is refused alike, right guess or wrong.
$db->update('profiles', ['tasks' => [['label' => 'w', 'rate' => 5, 'secret' => 'old']]], ['id' => $mine['id']]);
$faProblem('right guess of a hidden value while carrying a protected one', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => [['label' => 'w', 'secret' => 'old']]]), 403, 'forbidden', '/tasks/0');
$faProblem('wrong guess, same answer', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => [['label' => 'w', 'secret' => 'nope']]]), 403, 'forbidden', '/tasks/0');
$faProblem('an item edited while leaving out what she can\'t see is refused', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => [['label' => 'w!', 'rate' => 5]]]), 403, 'forbidden', '/tasks/0');
$faProblem('so is a partial resend', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => [[]]]), 403, 'forbidden', '/tasks/0');
eq('resending the item as she sees it keeps the stored item whole', [$as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => [['label' => 'w', 'rate' => 5]]])[0], $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['tasks']], [200, [['label' => 'w', 'rate' => 5, 'secret' => 'old']]]);
// Group null and item removal are refused from the rules alone: the same answer whether or not a
// hidden value is stored, so a destructive write can't test for presence.
$db->update('profiles', ['notes' => ['public' => 'x', 'flag' => null]], ['id' => $mine['id']]);
$faProblem('a null group is refused even when the hidden sub-field is empty', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['notes' => null]), 403, 'forbidden', '/notes');
$faProblem('an unchanged group resend can\'t confirm a hidden value', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['notes' => $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['notes']]), 403, 'forbidden', '/notes/flag');
$faProblem('switching a block\'s layout would erase its protected value', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['blocks' => [['layout' => 'link', 'href' => 'x']]]), 403, 'forbidden', '/blocks/0');
eq('the refused layout switch kept the stored block', $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['blocks'], [['layout' => 'memo', 'text' => 'kept']]);
$faProblem('a malformed layout is the validator\'s to report', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['blocks' => [['layout' => 'memo', 'text' => 'kept'], ['layout' => ['memo']]]]), 422, 'invalid_input', '/blocks/1/layout');

// Revisions are read through the same strip.
$rev = $db->revisions('profiles', $mine['id'])[0]['id'];
$revRow = $as('fa_alice', 'GET', "/profiles/{$mine['id']}/revisions/$rev")[1];
eq('a revision hides what the live row hides', [array_key_exists('email', $revRow), $revRow['salary'], $revRow['notes']], [false, 10, ['public' => 'x', 'pinned' => true, 'tag' => null]]);
// Restore replays every user column as a patch: readable values she can't set pass unchanged, but a
// value she can neither read nor set is refused whatever it is (an update must not probe hidden values).
$faProblem('an owner can\'t restore over a value hidden from her', $as('fa_alice', 'POST', "/profiles/{$mine['id']}/revisions/$rev/restore"), 403, 'forbidden', '/notes/flag');
eq('an admin restores the same revision', $as('fa_admin', 'POST', "/profiles/{$mine['id']}/revisions/$rev/restore")[0], 200);

// /_schema reports per-column summaries (no function names).
$described = $as(null, 'GET', '/_schema')[1]['collections']['profiles'];
eq('/_schema access.fields summaries', $described['access']['fields'], ['email' => ['read' => 'editor'], 'salary' => ['read' => 'rule', 'update' => 'admin'], 'approved' => ['create' => 'editor', 'update' => 'editor'], 'mentorId' => ['read' => 'editor'], 'fixed' => ['update' => false], 'seen' => ['update' => false], 'locker' => ['read' => 'editor'], 'diary' => ['read' => 'editor'], 'entries' => ['read' => 'editor'], 'cleared' => ['update' => 'rule'], 'meta' => ['update' => false]]);

// ================================================================ lane G: media sizes + focal (phase 2 §7.2)

// A second app root whose schema configures sizes. Booting it replaces the Db singleton, so the
// section restores the previous one for whatever sections follow.
(static function () use ($root): void {
    $previous = \Zero\db();
    try {
        $mediaRoot = "$root/media-app";
        copyRuntime($mediaRoot);
        @mkdir("$mediaRoot/zero/app/migrations", 0777, true);
        file_put_contents("$mediaRoot/zero/app/schema.php", '<?php return ' . var_export([
            'version' => 3, 'runtime' => '0.2', 'collections' => [],
            'media' => ['sizes' => [
                'thumb' => ['width' => 100, 'height' => 100, 'fit' => 'cover'],
                'wide' => ['width' => 200, 'height' => null, 'fit' => 'inside'],
                'huge' => ['width' => 4000, 'height' => null, 'fit' => 'inside'],
            ]],
        ], true) . ';');
        $mediaApp = App::boot($mediaRoot);
        $mediaApp->identity()->addUser('mediaEditor', 'editor', null);
        $mediaApp->identity()->addUser('mediaAuthor', 'author', null);
        $bearer = static fn (string $name) => ['authorization' => 'Bearer ' . $mediaApp->identity()->createToken($name, null)['token']];
        $asEditor = $bearer('mediaEditor');
        $asAuthor = $bearer('mediaAuthor');
        $mediaReq = static function (string $method, string $path, array $headers, string $body = '', array $files = [], array $query = []) use ($mediaApp): array {
            [$status, , $out] = $mediaApp->handle($method, $path, $query, $body, $headers, $files);
            $json = json_decode($out, true);

            return [$status, $status < 300 ? $json['data'] : $json];
        };
        $png = static function (int $w, int $h): string {
            $file = tempnam(sys_get_temp_dir(), 'zimg');
            $im = imagecreatetruecolor($w, $h);
            imagefilledrectangle($im, 0, 0, intdiv($w, 2) - 1, $h - 1, imagecolorallocate($im, 255, 0, 0));
            imagefilledrectangle($im, intdiv($w, 2), 0, $w - 1, $h - 1, imagecolorallocate($im, 0, 0, 255));
            imagepng($im, $file);

            return $file;
        };
        $post = static fn (string $file, string $name) => $mediaReq('POST', '/media', $asAuthor, '', ['file' => ['name' => $name, 'tmp_name' => $file, 'error' => UPLOAD_ERR_OK]]);

        [$s, $img] = $post($png(400, 200), 'wide.png');
        $base = substr($img['url'], 0, -4);
        eq('upload returns every configured size; a size the original fits is the original', [$s, array_map(static fn ($z) => [$z['width'], $z['height']], $img['sizes']), $img['sizes']['huge']['url'], $img['focal']],
            [201, ['thumb' => [100, 100], 'wide' => [200, 100], 'huge' => [400, 200]], $img['url'], null]);
        check('size files sit next to the original as <uuid>-<size>-…', str_starts_with($img['sizes']['thumb']['url'], "$base-thumb-") && str_starts_with($img['sizes']['wide']['url'], "$base-wide-"));
        $dims = static fn (string $url) => array_slice(getimagesize("$mediaRoot/public$url") ?: [], 0, 2);
        eq('size files exist with their dimensions', [$dims($img['sizes']['thumb']['url']), $dims($img['sizes']['wide']['url'])], [[100, 100], [200, 100]]);
        $thumbBytes = file_get_contents("$mediaRoot/public{$img['sizes']['thumb']['url']}");
        $wideBytes = file_get_contents("$mediaRoot/public{$img['sizes']['wide']['url']}");

        $focal = json_encode(['focal' => ['x' => 0, 'y' => 0.5], 'alt' => 'Left']);
        check('PATCH /media needs editor', $mediaReq('PATCH', "/media/{$img['id']}", $asAuthor, $focal)[0] === 403);
        [$s, $patched] = $mediaReq('PATCH', "/media/{$img['id']}", $asEditor, $focal);
        eq('PATCH sets focal + alt; inside sizes keep their file', [$s, $patched['focal'], $patched['alt'], $patched['sizes']['wide']], [200, ['x' => 0, 'y' => 0.5], 'Left', $img['sizes']['wide']]);
        check('changing focal regenerates the cover size (different bytes) and removes the old crop after commit',
            file_get_contents("$mediaRoot/public{$patched['sizes']['thumb']['url']}") !== $thumbBytes
            && !is_file("$mediaRoot/public{$img['sizes']['thumb']['url']}")
            && file_get_contents("$mediaRoot/public{$img['sizes']['wide']['url']}") === $wideBytes);
        $t = imagecreatefrompng("$mediaRoot/public{$patched['sizes']['thumb']['url']}");
        $red = imagecolorsforindex($t, imagecolorat($t, 50, 50));
        eq('the regenerated crop follows the focal point (left half is red)', [$red['red'], $red['blue']], [255, 0]);
        eq('GET returns the stored focal', $mediaReq('GET', "/media/{$img['id']}", [])[1]['focal'], ['x' => 0, 'y' => 0.5]);
        check('focal is validated with a pointer', ($mediaReq('PATCH', "/media/{$img['id']}", $asEditor, '{"focal":{"x":2,"y":0}}')[1]['pointer'] ?? null) === '/focal/x');
        check('PATCH unknown media → 404', $mediaReq('PATCH', '/media/999999', $asEditor, '{"alt":"x"}')[0] === 404);

        $txt = tempnam(sys_get_temp_dir(), 'ztxt');
        file_put_contents($txt, 'plain text');
        $doc = $post($txt, 'a.txt')[1];
        check('a non-image has sizes: {} on the wire', str_contains($mediaApp->handle('GET', "/media/{$doc['id']}", [], '', [])[2], '"sizes":{}') && $doc['focal'] === null);

        // Rows from before sizes existed get every size the first time their focal point is set.
        $legacy = $post($png(300, 300), 'old.png')[1];
        $mediaApp->store->run('UPDATE "__zero_media" SET "sizes" = \'{}\' WHERE "id" = ?', [$legacy['id']]);
        $upgraded = $mediaReq('PATCH', "/media/{$legacy['id']}", $asEditor, '{"focal":{"x":0.5,"y":0.5}}')[1];
        eq('a row uploaded before sizes were configured gets every size on its first focal change', array_keys($upgraded['sizes']), ['thumb', 'wide', 'huge']);
        eq('internal media fields are not queryable at any depth', array_map(
            static fn (string $w) => $mediaReq('GET', '/media', [], query: ['where' => $w])[0],
            ['{"focal":null}', '{"OR":[{"sizes":{"isNull":true}}]}', '{"NOT":{"path":"x"}}'],
        ), [400, 400, 400]);

        // Focal A → B → A inside one transaction: rollback keeps the committed crop, commit the final one.
        $sequence = static function (bool $rollback) use ($img, $mediaRoot, $base): array {
            try {
                \Zero\db()->transaction(static function () use ($img, $rollback): void {
                    \Zero\db()->media()->update($img['id'], ['focal' => ['x' => 1, 'y' => 0.5]]);
                    \Zero\db()->media()->update($img['id'], ['focal' => ['x' => 0, 'y' => 0.5]]);
                    if ($rollback) {
                        throw new \RuntimeException('roll back');
                    }
                });
            } catch (\RuntimeException) {
            }

            return glob("$mediaRoot/public$base-thumb-*");
        };
        $committed = $mediaReq('GET', "/media/{$img['id']}", [])[1]['sizes']['thumb']['url'];
        eq('A → B → A rolled back: only the committed crop remains', $sequence(true), ["$mediaRoot/public$committed"]);
        $files = $sequence(false);
        $final = $mediaReq('GET', "/media/{$img['id']}", [])[1]['sizes']['thumb']['url'];
        eq('A → B → A committed: exactly the final crop remains, and the row points at it', $files, ["$mediaRoot/public$final"]);

        // A size configured after the upload is filled in on the next focal change.
        $mediaApp->store->run('UPDATE "__zero_media" SET "sizes" = json_remove("sizes", \'$.wide\') WHERE "id" = ?', [$img['id']]);
        $filled = $mediaReq('PATCH', "/media/{$img['id']}", $asEditor, '{"focal":{"x":0.5,"y":0.5}}')[1];
        eq('a size missing from the row is rendered on the next focal change', [$filled['sizes']['wide']['width'], $filled['sizes']['wide']['height']], [200, 100]);

        // A size the original now fits (config changed) drops its old rendition: file and row entry.
        $small = $post($png(80, 80), 'small.png')[1];
        $staleRel = substr($small['url'], strlen('/uploads/'), -4) . '-thumb-stale.png';
        copy("$mediaRoot/public{$small['url']}", "$mediaRoot/public/uploads/$staleRel");
        $mediaApp->store->run('UPDATE "__zero_media" SET "sizes" = json_set("sizes", \'$.thumb\', json(?)) WHERE "id" = ?', [json_encode(['file' => $staleRel, 'width' => 50, 'height' => 50]), $small['id']]);
        $refit = $mediaReq('PATCH', "/media/{$small['id']}", $asEditor, '{"focal":{"x":0.5,"y":0.5}}')[1];
        eq('a size the original now fits is served by the original and its old file is gone', [$refit['sizes']['thumb']['url'], is_file("$mediaRoot/public/uploads/$staleRel")], [$small['url'], false]);

        $final = $mediaReq('GET', "/media/{$img['id']}", [])[1];
        $mediaReq('DELETE', "/media/{$img['id']}", $asEditor);
        check('deleting media removes the size files after commit', !is_file("$mediaRoot/public{$final['sizes']['thumb']['url']}") && !is_file("$mediaRoot/public$base.png"));
    } finally {
        \Zero\Db::setInstance($previous);
    }
})();

finish('db_test');
