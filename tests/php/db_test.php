<?php

declare(strict_types=1);

/*
 * Db + write pipeline + CLI + REST on WordPress, in-process (tests/php/wp.php): a hand-written app
 * plugin (what `spacepress build` emits) on a fresh WordPress-on-SQLite site. The collections here are
 * custom tables (`editor: false`); post-backed collections are proven by the blog suite and tests/wp.
 */

use SpacePress\HttpError;
use SpacePress\JsError;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

// ================================================================ fixture app

$now = ['now' => true];
$open = ['read' => ['role' => 'anyone'], 'create' => ['role' => 'anyone'], 'update' => ['role' => 'anyone'], 'delete' => ['role' => 'anyone']];
$schema = [
    'name' => 'dbtest',
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
                // A function default between the two `now` defaults that moves the clock.
                'tick' => ['type' => 'text', 'default' => ['fn' => 'locations__tick']],
                'audit' => ['type' => 'group', 'fields' => ['at' => ['type' => 'timestamp', 'default' => $now]], 'default' => ['value' => []]],
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
                    'secret' => ['type' => 'text', 'access' => ['read' => ['allow' => false], 'update' => ['allow' => true]]],
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
        // ---- ref(labels).many(): what `spacepress build` emits (tests/compiler.rs owns that shape)
        'labels' => [
            'primaryKey' => 'id',
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'name' => ['type' => 'text', 'notNull' => true],
                'secret' => ['type' => 'boolean', 'notNull' => true, 'default' => ['value' => false]],
            ],
            'relations' => [
                'cards' => ['kind' => 'many', 'collection' => 'cards', 'from' => 'id', 'to' => 'id', 'optional' => false, 'through' => ['table' => 'cards_labels', 'from' => 'target_id', 'to' => 'owner_id']],
                'pinnedBy' => ['kind' => 'many', 'collection' => 'cards', 'from' => 'id', 'to' => 'id', 'optional' => false, 'through' => ['table' => 'cards_pinned', 'from' => 'target_id', 'to' => 'owner_id']],
            ],
            'access' => ['read' => ['fn' => 'labels__access__read'], 'create' => ['role' => 'anyone'], 'update' => ['role' => 'anyone'], 'delete' => ['role' => 'anyone']],
            'api' => ['list' => true, 'get' => true, 'create' => true, 'update' => true, 'delete' => true],
        ],
        'cards' => [
            'primaryKey' => 'id',
            'columns' => [
                'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                'title' => ['type' => 'text', 'notNull' => true],
                'labels' => ['type' => 'refList', 'notNull' => true, 'references' => ['collection' => 'labels', 'column' => 'id', 'onDelete' => 'cascade', 'join' => 'cards_labels']],
                'pinned' => ['type' => 'refList', 'references' => ['collection' => 'labels', 'column' => 'id', 'onDelete' => 'restrict', 'join' => 'cards_pinned']],
            ],
            'relations' => [
                'labels' => ['kind' => 'many', 'collection' => 'labels', 'from' => 'id', 'to' => 'id', 'optional' => false, 'through' => ['table' => 'cards_labels', 'from' => 'owner_id', 'to' => 'target_id']],
                'pinned' => ['kind' => 'many', 'collection' => 'labels', 'from' => 'id', 'to' => 'id', 'optional' => false, 'through' => ['table' => 'cards_pinned', 'from' => 'owner_id', 'to' => 'target_id']],
            ],
            'access' => $open,
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

$functions = <<<'PHP'
    use SpacePress\HttpError;
    use SpacePress\JsError;
    use SpacePress\Js;
    use function SpacePress\db;

    // A compiled before-hook mutates its handle without returning a replacement.
    // Advances a pinned clock by a second while a row's defaults are being generated.
    function locations__tick()
    {
        if (($pinned = getenv('SP_NOW')) !== false && $pinned !== '') {
            putenv('SP_NOW=' . Js::iso(Js::now() + 1000));
        }
        return null;
    }

    function locations__beforeCreate(\SpacePress\JsObject $data)
    {
        $data->p['name'] = Js::trim($data->p['name'] ?? null);
        if ($data->p['name'] !== 'forget-code') {
            $data->p['code'] = strtoupper(Js::slice($data->p['name'], 0, 3));
        }
    }

    function items__beforeCreate($data)
    {
        if (!array_key_exists('name', $data->p)) {
            throw new \LogicException('beforeCreate ran without a required field');
        }
        return new \SpacePress\JsObject([...$data->p, 'name' => ucfirst($data->p['name'])]);
    }

    function items__afterUpdate($row, $previous)
    {
        db()->insert('logs', ['message' => "item {$row->p['id']} qty {$previous->p['qty']}->{$row->p['qty']}"]);
        if ($row->p['qty'] < 0) {
            throw new JsError('qty cannot go negative');
        }
    }

    // Self-recursive: "loop:N" writes "loop:N-1" until 0.
    function logs__afterCreate($row)
    {
        if (preg_match('/^loop:(\d+)$/', $row->p['message'], $m) && (int) $m[1] > 0) {
            db()->insert('logs', ['message' => 'loop:' . ((int) $m[1] - 1)]);
        }
    }

    // ---- lane B: field access. Owners and editors see the salary; owners update their own row.
    function profiles__field__salary__read($ctx)
    {
        return $ctx->p['user'] !== null && ($ctx->p['user']->p['role'] === 'editor' || $ctx->p['user']->p['role'] === 'admin' || $ctx->p['data']->p['ownerId'] === $ctx->p['user']->p['id']);
    }

    // Sub-field rules see the enclosing item after its defaults.
    function profiles__field__notes__tag__create($ctx)
    {
        return $ctx->p['data']->p['pinned'] === true;
    }

    function profiles__field__checks__note__update($ctx)
    {
        return ($ctx->p['data']->p['open'] ?? null) === true;
    }

    // Counts its calls: the value a rule saw must be the value stored, so it may run once per item.
    function profiles__stamp__n__default()
    {
        return ++$GLOBALS['stampCalls'];
    }

    function profiles__field__rounds__note__update($ctx)
    {
        return $ctx->p['data']->p['n'] === 1;
    }

    function profiles__field__gated__door__update($ctx)
    {
        return $ctx->p['data']->p['gate'] === true;
    }

    function profiles__field__vault__door__update($ctx)
    {
        return ($ctx->p['data']->p['config']->p['locked'] ?? null) !== true;
    }

    function profiles__field__seen__x__read($ctx)
    {
        return $ctx->p['user'] !== null;
    }

    // Reads another column's incoming value: only a supplied notes.flag === false allows it.
    function profiles__field__cleared__update($ctx)
    {
        return ($ctx->p['data']->p['notes']->p['flag'] ?? null) === false;
    }

    function profiles__field__stamp__note__create($ctx)
    {
        return $ctx->p['data']->p['n'] === 1;
    }

    // A tag may change only while the note stays pinned.
    function profiles__field__notes__tag__update($ctx)
    {
        return ($ctx->p['data']->p['pinned'] ?? null) === true;
    }

    function profiles__access__update($ctx)
    {
        return in_array($ctx->p['user']->p['role'] ?? null, ['editor', 'admin'], true) ? true : ['ownerId' => $ctx->p['user']->p['id'] ?? -1];
    }

    // Secret labels are hidden from guests.
    function labels__access__read($ctx)
    {
        return ($ctx->p['user'] ?? null) === null ? ['secret' => false] : true;
    }

    function action__restock($input)
    {
        $item = db()->findFirst('items', ['where' => ['id' => $input->p['itemId']]])
            ?? throw new HttpError(404, 'not_found', 'No such item');
        return db()->update('items', ['qty' => $item['qty'] + $input->p['amount']], ['id' => $item['id']], true)[0];
    }
    PHP;

$wp = wpSite('db', ['schema' => $schema, 'functions' => $functions, 'users' => ['fa_alice' => 'author', 'fa_bob' => 'author', 'fa_ed' => 'editor', 'fa_admin' => 'admin']]);
$db = \SpacePress\db();
$app = $wp->app();

function names(array $rows): array
{
    return array_column($rows, 'name');
}

// ================================================================ boot + migrate

eq('activation applied the init migration and recorded it in the per-app ledger',
    $wp->sql('SELECT `id` FROM {prefix}sp__migrations WHERE `app` = ? ORDER BY `id`', ['dbtest']), [['id' => '20261121000000_000000_init']]);
eq('the app plugin is active with current storage', [$wp->plugin()->unavailable(), $wp->plugin()->pendingMigrations()], [null, []]);
eq('the runtime describes its database as SQLite through the official plugin', \SpacePress\Wp\Platform::versions()['database']['kind'], 'sqlite');
eq('platform problems accept SQLite Database Integration', \SpacePress\Wp\Platform::problems(), []);
// Akismet isn't a platform plugin: this site has none, and the app mounted. Two Factor counts when loaded,
// not when stored as active: the host's v2 scope activates it per request.
eq('the app mounted with no Akismet installed', [is_dir(WP_PLUGIN_DIR . '/akismet'), class_exists('Akismet', false), \SpacePress\Wp\Platform::versions()['akismet'], \SpacePress\Wp\Platform::versions()['twoFactor']],
    [false, false, ['version' => null, 'spamChecks' => false], '0.17.0']);
$stored = get_option('active_plugins');
add_filter('pre_option_active_plugins', static fn (): array => array_values(array_diff($stored, ['two-factor/two-factor.php'])));
eq('platform problems read the loaded plugins, not the stored active list', \SpacePress\Wp\Platform::problems(), []);
remove_all_filters('pre_option_active_plugins');

// ================================================================ write pipeline: create


$tsPattern = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/';
putenv('SP_NOW=2026-01-01T00:00:00.000Z');
$garage = $db->insert('locations', ['name' => '  Garage  ', 'meta' => ['floor' => 1, 'tags' => ['a/b', 'é']]], true)[0];
putenv('SP_NOW');
eq('by-ref beforeCreate mutation is kept (trim + fill)', [$garage['name'], $garage['code']], ['Garage', 'GAR']);
eq('defaults: enum value + boolean', [$garage['kind'], $garage['active']], ['shelf', true]);
eq('default now: one instant per write, nested defaults included, even when the clock moves between defaults',
    [$garage['createdAt'], $garage['updatedAt'], $garage['audit']['at'] ?? null], array_fill(0, 3, '2026-01-01T00:00:00.000Z'));
eq('json column round-trips', \SpacePress\Js::jsonStringify($garage['meta']), '{"floor":1,"tags":["a/b","é"]}');
eq('json stored with unescaped slashes/unicode', $wp->scalar('SELECT `meta` FROM {prefix}sp_locations WHERE `name` = ?', ['Garage']), '{"floor":1,"tags":["a/b","é"]}');

[$attic, $basement] = $db->insert('locations', [
    ['name' => 'Attic', 'kind' => 'bin', 'active' => false, 'updatedAt' => '2000-01-01T00:00:00Z'],
    ['name' => 'Basement'],
], true);
eq('multi-row insert + explicit timestamp normalized', $attic['updatedAt'], '2000-01-01T00:00:00.000Z');

$items = $db->insert('items', [
    ['name' => 'hammer', 'qty' => 2, 'price' => 9.5, 'locationId' => $garage['id']],
    ['name' => 'nails', 'qty' => 100, 'price' => 2, 'locationId' => $garage['id'], 'seenAt' => 0],
    ['name' => 'box', 'price' => \SpacePress\Js::undefined(), 'seenAt' => \SpacePress\Js::undefined()],
    ['name' => 'lamp', 'qty' => 3.0, 'locationId' => $attic['id'], 'seenAt' => '2024-03-01T01:30:00+02:00', 'bestBefore' => '2024-02-29'],
], true);
[$hammer, $nails, $box, $lamp] = $items;
eq('beforeCreate return value replaces data', names($items), ['Hammer', 'Nails', 'Box', 'Lamp']);
eq('every column key present, nulls included', array_keys($box), ['id', 'name', 'qty', 'price', 'seenAt', 'bestBefore', 'locationId']);
eq('default value + nullable columns', [$box['qty'], $box['price'], $box['locationId']], [1, null, null]);
eq('explicit undefined persists as SQL null', $db->findFirst('items', ['where' => ['id' => $box['id']]])['price'], null);
check('integral float accepted for integer, int for real', $lamp['qty'] === 3 && $nails['price'] === 2.0, [$lamp['qty'], $nails['price']]);
eq('timestamp from epoch ms and from offset string (normalized back onto a leap day)', [$nails['seenAt'], $lamp['seenAt']], ['1970-01-01T00:00:00.000Z', '2024-02-29T23:30:00.000Z']);
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

// ================================================================ reads

$find = fn (array $opts, string $c = 'items') => $db->findMany($c, $opts);
eq('gt + orderBy', names($find(['where' => ['qty' => ['gt' => 2]], 'orderBy' => ['name' => 'asc']])), ['Lamp', 'Nails']);
eq('top-level OR', names($find(['where' => ['OR' => [['name' => 'Box'], ['qty' => ['gte' => 100]]]], 'orderBy' => ['id' => 'asc']])), ['Nails', 'Box']);
eq('top-level NOT with null', names($find(['where' => ['NOT' => ['locationId' => null]], 'orderBy' => ['id' => 'asc']])), ['Hammer', 'Nails', 'Lamp']);
eq('in / notIn', [names($find(['where' => ['name' => ['in' => ['Lamp', 'Hammer']]], 'orderBy' => ['id' => 'asc']])), count($find(['where' => ['name' => ['notIn' => ['Lamp']]]]))], [['Hammer', 'Lamp'], 3]);
eq('empty in matches nothing', $find(['where' => ['id' => ['in' => []]]]), []);
eq('like is case-sensitive, ilike is not', [names($find(['where' => ['name' => ['like' => 'ha%']]])), names($find(['where' => ['name' => ['ilike' => 'ha%']]]))], [[], ['Hammer']]);
eq('notIlike', names($find(['where' => ['name' => ['notIlike' => '%A%']]])), ['Box']);
$db->insert('items', [['name' => 'Été', 'qty' => 1], ['name' => 'ΟΔΥΣΣΕΥΣ', 'qty' => 1], ['name' => 'İ', 'qty' => 1]]);
// Rows the items hook would reshape (it trims and capitalizes) go in as stored values.
$wp->exec('INSERT INTO {prefix}sp_items (`name`, `qty`) VALUES (?, 1), (?, 1)', ["Hammer\n", 'abc\\']);
eq('ilike folds case beyond ASCII', names($find(['where' => ['name' => ['ilike' => 'été']]])), ['Été']);
eq('ilike folds a final sigma onto its capital', names($find(['where' => ['name' => ['ilike' => 'οδυσσευς']]])), ['ΟΔΥΣΣΕΥΣ']);
eq('ilike `_` is one character, whatever its case folding expands to', names($find(['where' => ['name' => ['ilike' => '_']]])), ['İ']);
eq('ilike matches the whole value: a trailing newline is not ignored', names($find(['where' => ['name' => ['ilike' => 'hammer']]])), ['Hammer']);
eq('ilike keeps a trailing backslash as a literal', names($find(['where' => ['name' => ['ilike' => 'ABC\\']]])), ['abc\\']);
eq('like is exact', names($find(['where' => ['name' => ['like' => 'été']]])), []);
$db->delete('items', ['name' => ['in' => ['Été', 'ΟΔΥΣΣΕΥΣ', 'İ', "Hammer\n", 'abc\\']]]);
eq('like escapes and _', names($find(['where' => ['name' => ['like' => '_ox']]])), ['Box']);
eq('field-level OR + several operators ANDed', names($find(['where' => ['qty' => ['OR' => [['lt' => 3], ['gt' => 50]], 'ne' => 1], 'price' => ['isNotNull' => true]], 'orderBy' => ['id' => 'asc']])), ['Hammer', 'Nails']);
eq('field-level NOT', names($find(['where' => ['qty' => ['NOT' => ['lte' => 3]]]])), ['Nails']);
eq('isNull', names($find(['where' => ['seenAt' => ['isNull' => true]], 'orderBy' => ['id' => 'asc']])), ['Hammer', 'Box']);
eq('relation one: filter', names($find(['where' => ['location' => ['name' => 'Garage']], 'orderBy' => ['id' => 'asc']])), ['Hammer', 'Nails']);
eq('relation one: exists', count($find(['where' => ['location' => true]])), 3);
eq('relation many: NOT exists', names($find(['where' => ['NOT' => ['items' => true]]], 'locations')), ['Basement']);
// JSON-text list and object columns on a custom table (the postmeta forms are proven in tests/wp).
$db->update('locations', ['meta' => ['tags' => ['news', 'guide'], 'ids' => [3, 12]]], ['id' => $garage['id']]);
eq('json whole-value eq compares the stored text: the same document matches, a different one does not', [
    names($find(['where' => ['meta' => ['tags' => ['news', 'guide'], 'ids' => [3, 12]]]], 'locations')),
    names($find(['where' => ['meta' => ['tags' => ['news'], 'ids' => [3, 12]]]], 'locations')),
    names($find(['where' => ['meta' => ['ne' => ['tags' => ['news', 'guide'], 'ids' => [3, 12]], 'isNotNull' => true]]], 'locations')),
], [['Garage'], [], []]);

// List columns stored as JSON text on a custom table: `has` matches one whole element (an id of 12
// is not found by 120, nor "news" by "new"), `eq: []` matches only the empty list, and a NULL list
// is neither empty nor a member of anything.
(static function (): void {
    $wp = $GLOBALS['wp'];
    $schema = new \SpacePress\Schema(['version' => 5, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => ['listed' => [
        'primaryKey' => 'id', 'editor' => false, 'table' => 'first_listed',
        'columns' => [
            'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
            'tags' => ['type' => 'select', 'multiple' => true, 'enum' => ['news', 'new', 'guide']],
            'photos' => ['type' => 'mediaList'],
        ],
    ]]]);
    $wp->exec('CREATE TABLE {prefix}first_listed (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `tags` LONGTEXT, `photos` LONGTEXT, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $wp->exec('INSERT INTO {prefix}first_listed (`id`, `tags`, `photos`) VALUES (1, \'["news","guide"]\', \'[12,7]\'), (2, \'["new"]\', \'[120]\'), (3, \'[]\', \'[]\'), (4, NULL, NULL)');
    $db = new \SpacePress\Db(\SpacePress\Wp\CompositeStore::create($schema, $wp->connection()), $schema, \SpacePress\db()->media());
    $ids = static fn (array $where): array => array_column($db->findMany('listed', ['where' => $where, 'orderBy' => ['id' => 'asc']]), 'id');
    eq('has on a media list matches the whole id 12, not 120', $ids(['photos' => ['has' => 12]]), [1]);
    eq('has on a select list matches the whole string "new", not "news"', $ids(['tags' => ['has' => 'new']]), [2]);
    eq('eq [] matches the empty list only, never the NULL list', $ids(['tags' => []]), [3]);
    eq('isNull on a list is the NULL row only; isNotNull includes the empty list', [$ids(['photos' => ['isNull' => true]]), $ids(['photos' => ['isNotNull' => true]])], [[4], [1, 2, 3]]);
})();
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
$observer = new PDO('sqlite:' . DB_PATH);
$items = $wp->connection()->prefix() . 'sp_items';
$committed = [];
$db->transaction(function () use ($db, $observer, $items, &$committed) {
    \SpacePress\Extensions::afterCommit(function () use ($observer, $items, &$committed) {
        $committed[] = 'outer:' . (int) $observer->query("SELECT qty FROM $items WHERE name = 'Hammer'")->fetchColumn();
    });
    $db->transaction(function () use ($db, $observer, $items, &$committed) {
        $db->update('items', ['qty' => 6], ['name' => 'Hammer']);
        \SpacePress\Extensions::afterCommit(function () use ($observer, $items, &$committed) {
            $committed[] = 'inner:' . (int) $observer->query("SELECT qty FROM $items WHERE name = 'Hammer'")->fetchColumn();
        });
    });
    eq('nested transaction defers callbacks until the outer commit', $committed, []);
});
eq('both callbacks see the committed row in registration order', $committed, ['outer:6', 'inner:6']);
problem('outer rollback discards callbacks registered by a nested write', function () use ($db, &$committed) {
    $db->transaction(function () use ($db, &$committed) {
        $db->transaction(function () use ($db, &$committed) {
            $db->update('items', ['qty' => 99], ['name' => 'Hammer']);
            \SpacePress\Extensions::afterCommit(function () use (&$committed) { $committed[] = 'rolled back'; });
        });
        throw new JsError('rollback');
    });
}, 422, 'rejected');
// Catching an inner failure cannot make its partial writes durable.
$beforeInnerFailure = $committed;
try {
    $db->transaction(function () use ($db, &$committed): void {
        $db->update('items', ['qty' => 77], ['name' => 'Hammer']);
        try {
            $db->transaction(function () use ($db, &$committed): void {
                $db->insert('logs', ['message' => 'caught-inner-write']);
                \SpacePress\Extensions::afterCommit(function () use (&$committed) { $committed[] = 'must not run'; });
                throw new RuntimeException('inner failure');
            });
        } catch (RuntimeException) {
            $db->insert('logs', ['message' => 'after-caught-inner']);
        }
    });
    check('rollback-only commit throws', false);
} catch (RuntimeException $e) {
    eq('rollback-only commit throws', $e->getMessage(), 'Cannot commit: a joined transaction failed');
}
eq('caught inner failure rolls back the whole transaction and discards callbacks', [
    $db->findFirst('items', ['where' => ['name' => 'Hammer']])['qty'],
    $db->findMany('logs', ['where' => ['message' => ['in' => ['caught-inner-write', 'after-caught-inner']]]]),
    $committed,
], [6, [], $beforeInnerFailure]);
// A post-commit failure cannot roll back durable data or undo callbacks already applied.
problem('post-commit exception propagates', function () use ($db, $wp) {
    $db->transaction(function () use ($db, $wp) {
        file_put_contents($wp->dir . '/committed-file', 'durable');
        $wp->connection()->onRollback(static fn () => unlink($wp->dir . '/committed-file'));
        $db->update('items', ['qty' => 5], ['name' => 'Hammer']);
        \SpacePress\Extensions::afterCommit(static fn () => throw new JsError('after commit'));
    });
}, 422, 'rejected');
eq('post-commit failure never undoes committed filesystem effects', is_file($wp->dir . '/committed-file'), true);
\SpacePress\Extensions::afterCommit(function () use (&$committed) { $committed[] = 'immediate'; });
eq('rollback and post-commit failure leave no stale callbacks', [(int) $observer->query("SELECT qty FROM $items WHERE name = 'Hammer'")->fetchColumn(), $committed], [5, ['outer:6', 'inner:6', 'immediate']]);

// A reading transaction tells the database nothing until something writes. `open` is whether the
// database itself has a transaction; `sent` is what ended it.
$sent = [];
$spy = static function (mixed $sql) use (&$sent): mixed {
    if (is_string($sql) && preg_match('/^\s*(START TRANSACTION|COMMIT|ROLLBACK)\b/i', $sql, $m) === 1) {
        $sent[] = strtoupper($m[1]);
    }

    return $sql;
};
add_filter('query', $spy);
$open = static fn (): bool => $wp->connection()->wpdb()->dbh->inTransaction();
$queries = static fn (): int => (int) $wp->connection()->wpdb()->num_queries;
$during = [];
$after = [];
$counted = $queries();
$found = $db->reading(function () use ($db, $wp, $open, &$during, &$after): array {
    $during = [$wp->connection()->inTransaction(), $open()];
    \SpacePress\Extensions::afterCommit(static function () use (&$after): void {
        $after[] = 'ran';
    });

    return $db->findMany('items', ['where' => ['name' => 'Hammer']]);
});
eq('a reading transaction that only reads sends neither START TRANSACTION nor COMMIT', [names($found), $sent, $during, $after, $open(), $queries() - $counted],
    [['Hammer'], [], [true, false], ['ran'], false, 0]);
$counted = $queries();
$db->reading(function () use ($db, $open, &$during): void {
    $db->findMany('items', ['where' => ['name' => 'Hammer']]);
    $during = [$open()];
    $db->update('items', ['qty' => 7], ['name' => 'Hammer']);
    $during[] = $open();
});
eq('its first write starts the transaction, and the end commits it', [$sent, $during, $open(), (int) $observer->query("SELECT qty FROM $items WHERE name = 'Hammer'")->fetchColumn()], [['COMMIT'], [false, true], false, 7]);
check('… both counted as statements, as an ordinary transaction\'s are', $queries() - $counted >= 2, $queries() - $counted);
$sent = [];
problem('a throw after a write rolls the write back', fn () => $db->reading(function () use ($db): void {
    $db->update('items', ['qty' => 9], ['name' => 'Hammer']);
    throw new JsError('no');
}), 422, 'rejected');
eq('… with one ROLLBACK', [$sent, $open(), (int) $observer->query("SELECT qty FROM $items WHERE name = 'Hammer'")->fetchColumn()], [['ROLLBACK'], false, 7]);
$sent = [];
$ran = [];
problem('a throw before any write', fn () => $db->reading(function () use (&$ran): void {
    \SpacePress\Extensions::afterCommit(static function () use (&$ran): void {
        $ran[] = 'after';
    });
    throw new JsError('no');
}), 422, 'rejected');
eq('… sends nothing and drops its afterCommit callbacks', [$sent, $ran, $wp->connection()->inTransaction()], [[], [], false]);
$sent = [];
$db->reading(static function () use ($open, &$during): void {
    get_option('sp_reading_probe'); // core's read: still no transaction
    $during = [$open()];
    update_option('sp_reading_probe', 'core write', false);
    $during[] = $open();
});
eq('a write through $wpdb (core\'s, another plugin\'s) starts it too', [$sent, $during, get_option('sp_reading_probe')], [['COMMIT'], [false, true], 'core write']);
$sent = [];
problem('… and rolls back with it', fn () => $db->reading(static function (): void {
    update_option('sp_reading_probe', 'rolled back', false);
    throw new JsError('no');
}), 422, 'rejected');
wp_cache_delete('sp_reading_probe', 'options');
eq('… leaving what was committed', [$sent, get_option('sp_reading_probe')], [['ROLLBACK'], 'core write']);
$sent = [];
$db->reading(static function () use ($wp, $items, $open, &$during): void {
    $wp->connection()->run("SELECT id FROM $items WHERE name = ? FOR UPDATE", ['Hammer']);
    $during = [$open()];
});
eq('a locking read starts it, like a write', [$sent, $during], [['COMMIT'], [true]]);
$sent = [];
$db->transaction(fn () => $db->reading(fn () => $db->findMany('items', ['limit' => 1])));
eq('inside an open transaction it joins that one', $sent, ['START TRANSACTION', 'COMMIT']);
$sent = [];
$db->reading(fn () => $db->transaction(fn () => $db->findMany('items', ['limit' => 1])));
eq('a transaction opened inside it joins it, and stays unsent while it only reads', $sent, []);
$sent = [];
$db->transaction(fn () => $db->findMany('items', ['limit' => 1]));
eq('an ordinary transaction starts at once, as before', $sent, ['START TRANSACTION', 'COMMIT']);
remove_filter('query', $spy);
delete_option('sp_reading_probe');
$db->update('items', ['qty' => 5], ['name' => 'Hammer']);

$before = $logCount();
$db->transaction(fn () => $db->insert('logs', ['message' => 'loop:8']));
eq('8 levels of nested hook writes are allowed', $logCount(), $before + 9);
problem('a 9th level → hook_recursion', fn () => $db->transaction(fn () => $db->insert('logs', ['message' => 'loop:9'])), 500, 'hook_recursion');
eq('hook_recursion rolled back everything', $logCount(), $before + 9);

$deleted = $db->delete('items', ['name' => 'Box'], true);
eq('delete returns pre-delete rows', names($deleted), ['Box']);
$db->delete('locations', ['id' => $attic['id']]);
eq('runtime FK cascade is on', $db->findFirst('items', ['where' => ['id' => $lamp['id']]]), null);

// ================================================================ migrations: a later file, the ledger, a failing statement

// An app update ships a second sortable folder migration: adding a column to a table with rows.
$writeMig = static function (string $id, string $sql) use ($wp): void {
    $dir = $wp->plugin()->dir . "/sp/app/migrations/$id";
    if (!is_dir($dir)) {
        mkdir($dir, 0777, true);
    }
    file_put_contents("$dir/migration.sql", $sql);
};
$rmMig = static function (string $id) use ($wp): void {
    $dir = $wp->plugin()->dir . "/sp/app/migrations/$id";
    @unlink("$dir/migration.sql");
    @unlink("$dir/ops.json");
    @rmdir($dir);
};
$childrenBefore = $db->findMany('items', ['where' => ['locationId' => $garage['id']], 'orderBy' => ['id' => 'asc']]);
// A compiled baseline can still carry the SQL and hash from before the rename.
$legacySql = 'ALTER TABLE `{prefix}tp_locations` ADD COLUMN `note` LONGTEXT;';
$writeMig('20261121000001_000001_note', $legacySql);
eq('`wp spacepress migrate` applies the pending folder', $wp->wpCli(['migrate']), [0, ['data' => ['applied' => ['20261121000001_000001_note']]]]);
eq('replaying old SQL records the original file hash', $wp->scalar('SELECT `sql` FROM {prefix}sp__migrations WHERE `app` = ? AND `id` = ?', ['dbtest', '20261121000001_000001_note']), hash('sha256', $legacySql));
eq('child rows survive the parent change (no cascade fired)', $db->findMany('items', ['where' => ['locationId' => $garage['id']], 'orderBy' => ['id' => 'asc']]), $childrenBefore);
eq('the table has the new column and the ledger the migration', [
    $wp->scalar('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$wp->connection()->prefix() . 'sp_locations', 'note']),
    array_column($wp->sql('SELECT `id` FROM {prefix}sp__migrations WHERE `app` = ? ORDER BY `id`', ['dbtest']), 'id'),
], [1, ['20261121000000_000000_init', '20261121000001_000001_note']]);
problem('the unique index still holds', fn () => $db->insert('locations', ['name' => 'Garage']), 409, 'unique_violation', '/name');
// Migration text is SQL as the compiler or an operator writes it: a leading comment, a `?` inside a
// literal default, and a constraint over rows that break it.
$migrate = static function (string $id, string $sql) use ($wp, $writeMig): ?array {
    $writeMig($id, $sql);

    return $wp->wpCli(['migrate'])[1]['data']['applied'] ?? null;
};
// Statement text as the compiler or an operator writes it, read as the driver reads it. Each ALTER
// is a plain Connection::run on a parent table with children (the migration path above proves the
// same statement reaching it through a file); the children must survive the driver's table rebuild.
$wp->exec('CREATE TABLE {prefix}sp_rf_parent (`id` BIGINT UNSIGNED NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB');
$wp->exec('CREATE TABLE {prefix}sp_rf_child (`id` BIGINT UNSIGNED NOT NULL, `pid` BIGINT UNSIGNED, PRIMARY KEY (`id`), CONSTRAINT `sp_rf_child_pid_fk` FOREIGN KEY (`pid`) REFERENCES {prefix}sp_rf_parent (`id`) ON DELETE CASCADE) ENGINE=InnoDB');
$wp->exec('INSERT INTO {prefix}sp_rf_parent VALUES (1)');
$wp->exec('INSERT INTO {prefix}sp_rf_child VALUES (1, 1)');
$column = static fn (string $name): int => (int) $wp->scalar('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$wp->connection()->prefix() . 'sp_rf_parent', $name]);
$children = static fn (): int => (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}sp_rf_child');
$alter = static function (string $sql, string $column) use ($wp, $children): array {
    $wp->exec($sql);

    return [$children(), $column === '' ? null : (int) $wp->scalar('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$wp->connection()->prefix() . 'sp_rf_parent', $column])];
};
eq('a leading block comment and a literal `?` default', $alter("/* adds a prompt */ ALTER TABLE `{prefix}sp_rf_parent` ADD COLUMN `prompt` VARCHAR(191) DEFAULT 'Continue?'", 'prompt'), [1, 1]);
eq('a comment between the keywords', $alter('ALTER /* inline */ TABLE `{prefix}sp_rf_parent` ADD COLUMN `c2` LONGTEXT', 'c2'), [1, 1]);
eq('a line comment ending in a carriage return', $alter("-- note\rALTER TABLE `{prefix}sp_rf_parent` ADD COLUMN `c3` LONGTEXT", 'c3'), [1, 1]);
eq('an executable comment this server\'s version satisfies is the statement', $alter('/*!80000 ALTER TABLE `{prefix}sp_rf_parent` ADD COLUMN `c4` LONGTEXT */', 'c4'), [1, 1]);
eq('an executable comment for a newer server is a comment, and the ALTER behind it still keeps the children', $alter('/*!99999 SELECT 1 */ ALTER TABLE `{prefix}sp_rf_parent` ADD COLUMN `c5` LONGTEXT', 'c5'), [1, 1]);
eq('a migration file carrying such a statement reaches the same path', [$migrate('20261121000002_000002_commented', "/* adds */ ALTER /* inline */ TABLE `{prefix}sp_locations` ADD COLUMN `prompt` VARCHAR(191) DEFAULT 'Continue?';"), $db->findMany('items', ['where' => ['locationId' => $garage['id']], 'orderBy' => ['id' => 'asc']]) === $childrenBefore, $wp->scalar('SELECT `prompt` FROM {prefix}sp_locations WHERE `name` = ?', ['Garage'])], [['20261121000002_000002_commented'], true, 'Continue?']);
eq('`--` without a space is subtraction', $wp->sql('SELECT 1--? AS n', [1])[0]['n'], 2);
eq('a parameter inside an executable comment this server reads is bound', $wp->sql('SELECT /*!80000 ? */ AS n', [42])[0]['n'], 42);
eq('a `?` inside an executable comment for a newer server is text, not a parameter', $wp->sql('SELECT 3 AS n /*!99999 , ? AS m */')[0], ['n' => 3]);
eq('a token-merging executable comment is read as the server reads it', $wp->sql('/*!80000 SELECT*/1 AS n')[0]['n'], 1);
eq('a quoted `*/` inside executable SQL does not end the comment', $wp->sql("SELECT /*!80000 '*/?' AS s, ? AS n */", [42])[0], ['s' => '*/?', 'n' => 42]);
eq('an odd run of backslashes escapes the quote: the `?` inside stays text', $wp->sql("SELECT 'it''s a \\\\\\'?' AS s, ? AS n", [7])[0], ['s' => "it's a \\'?", 'n' => 7]);
$wp->exec('INSERT INTO {prefix}sp_logs (`message`, `at`) VALUES (?, ?)', ['orphan', '2026-01-01T00:00:00.000Z']);
$wp->exec('ALTER TABLE {prefix}sp_logs ADD COLUMN `itemId` BIGINT UNSIGNED');
$wp->exec('UPDATE {prefix}sp_logs SET `itemId` = 424242 WHERE `message` = ?', ['orphan']);
$writeMig('20261121000003_000003_fk', 'ALTER TABLE `{prefix}sp_logs` ADD CONSTRAINT `sp_logs_itemId_fk` FOREIGN KEY (`itemId`) REFERENCES `{prefix}sp_items` (`id`) ON DELETE SET NULL;');
putenv('SP_DEBUG=1');
[$code, $out] = $wp->wpCli(['migrate']);
putenv('SP_DEBUG');
check('a constraint added over rows that break it fails the migration and changes nothing', $code === 1 && str_contains($out['error']['detail'] ?? '', 'foreign key constraint fails')
    && $wp->scalar('SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?', [$wp->connection()->prefix() . 'sp_logs', 'sp_logs_itemId_fk']) === 0, $out);
$wp->exec('DELETE FROM {prefix}sp_logs WHERE `message` = ?', ['orphan']);
eq('with the orphan gone the same file applies', $wp->wpCli(['migrate'])[1]['data']['applied'] ?? null, ['20261121000003_000003_fk']);
// Migrations run under one site-wide lock across processes: while this process holds it, another
// process can't take it (and gives up at its timeout); once released, it can.
file_put_contents($wp->dir . '/lock.php', <<<'PHP'
    <?php
    require $argv[1];
    wpLoad($argv[2]);
    try {
        echo \SpacePress\Wp\Runtime::plugin()->connection()->locked('first:test', 1, static fn () => 'held');
    } catch (\SpacePress\Wp\LockBusy $e) {
        echo 'refused';
    }
    PHP);
$other = static fn (): string => trim((string) shell_exec(escapeshellarg(PHP_BINARY) . ' -d memory_limit=512M ' . escapeshellarg($wp->dir . '/lock.php') . ' ' . escapeshellarg(__DIR__ . '/wp.php') . ' ' . escapeshellarg($wp->dir) . ' 2>/dev/null'));
$whileHeld = $wp->connection()->locked('first:test', 1, $other);
eq('a second process can\'t take a held migration lock, and can once it is released', [$whileHeld, $other()], ['refused', 'held']);
eq('the lock is per name', $wp->connection()->locked('first:other', 1, $other), 'held');

// A statement that fails stops the file; what ran before it is recorded step by step, nothing after it runs.
$writeMig('20261121000004_000004_broken', "DELETE FROM `{prefix}sp_logs` WHERE `message` = 'hello';\n--> statement-breakpoint\nALTER TABLE `{prefix}sp_nope` ADD COLUMN `x` LONGTEXT;\n--> statement-breakpoint\nDELETE FROM `{prefix}sp_logs`;");
putenv('SP_DEBUG=1');
[$code, $out] = $wp->wpCli(['migrate']);
putenv('SP_DEBUG');
check('a failing statement fails the command and names its position', $code === 1 && str_contains($out['error']['detail'] ?? '', '20261121000004_000004_broken failed at statement 2'), $out);
eq('the statements before it ran and are recorded; the ones after it did not run', [
    count($db->findMany('logs', ['where' => ['message' => 'hello']])), count($db->findMany('logs')) > 0,
    array_column($wp->sql('SELECT `id` FROM {prefix}sp__migrations WHERE `app` = ? AND `id` LIKE ? ORDER BY `id`', ['dbtest', '20261121000004%']), 'id'),
], [0, true, ['20261121000004_000004_broken:1']]);
$rmMig('20261121000004_000004_broken');
$wp->exec('DELETE FROM {prefix}sp__migrations WHERE `app` = ? AND `id` LIKE ?', ['dbtest', '20261121000004%']);
eq('with the folder gone, migrate is a no-op and the CLI serves again', [$wp->wpCli(['migrate'])[1], $wp->wpCli(['find', 'items', '{"where":{"name":"Hammer"},"columns":{"name":true}}'])[1]],
    [['data' => ['applied' => []]], ['data' => [['name' => 'Hammer']]]]);

// ================================================================ forward-only runtime guard & unified audit ledger

$writeMig('20261121000005_000005_drop', 'ALTER TABLE `{prefix}sp_locations` DROP COLUMN `note`;');
putenv('SP_DEBUG=1');
[$code, $out] = $wp->wpCli(['migrate']);
putenv('SP_DEBUG');
check('core Migrator refuses destructive DROP COLUMN in forward-only schema migrations',
    $code === 1 && str_contains($out['error']['detail'] ?? '', 'Refusing destructive DDL'), $out);
$rmMig('20261121000005_000005_drop');
$migrator = new \SpacePress\Wp\Migrator($wp->connection(), $wp->plugin()->dir . '/sp/app/migrations', $wp->plugin()->schema);
$migrator->recordAudit('20261121000006_000006_purge', 'destructive', str_repeat('a', 64), 'admin', 'cleanup retired column', 0);
$audit = $wp->sql('SELECT `kind`, `actor`, `reason`, `rows_affected` FROM {prefix}sp__migrations WHERE `app` = ? AND `id` = ?', ['dbtest', '20261121000006_000006_purge']);
eq('unified ledger records destructive audit metadata', $audit, [['kind' => 'destructive', 'actor' => 'admin', 'reason' => 'cleanup retired column', 'rows_affected' => 0]]);
$wp->exec('DELETE FROM {prefix}sp__migrations WHERE `app` = ? AND `id` = ?', ['dbtest', '20261121000006_000006_purge']);

// ================================================================ CLI

$cli = fn (string ...$args) => $wp->cli(...$args);

[$code, $out] = $cli('find', 'items', '{"where":{"name":{"like":"Ham%"}},"columns":{"name":true}}');
eq('CLI find', [$code, $out], [0, ['data' => [['name' => 'Hammer']]]]);
[$code, $out] = $cli('insert', 'items', '{"name":"cli","qty":"x"}');
eq('CLI error envelope + exit 1', [$code, $out['error']['code'] ?? null, $out['error']['pointer'] ?? null], [1, 'invalid_input', '/qty']);
[$code, $out] = $cli('insert', 'items', '{}');
eq('CLI insert {} is one row with no fields (it reaches the pipeline)', [$code, $out['error']['pointer'] ?? null], [1, '/name']);
[$code, $out] = $cli('update', 'items', '{"name":"Hammer"}', '{"qty":-3}');
eq('CLI runs in a transaction', [$code, $out['error']['code'] ?? null, $db->findFirst('items', ['where' => ['name' => 'Hammer']])['qty']], [1, 'rejected', 5]);
[$code, $out] = $cli('action', 'restock', json_encode(['itemId' => $hammer['id'], 'amount' => 2]));
eq('CLI action', [$code, $out['data']['qty'] ?? null], [0, 7]);
eq('CLI usage error', $cli('frobnicate')[0], 1);

// ================================================================ HTTP: SpacePress's API on WordPress

// Through the web server (php -S on this site), as a client sees it: /wp-json/spacepress/v1 answers with
// SpacePress's envelopes, problem documents and headers.
$port = $wp->startServer();
$base = "http://127.0.0.1:$port/wp-json/spacepress/v1";

/** @return array{status: int, headers: array<string, string>, body: string, json: mixed} */
function http(string $method, string $path, mixed $body = null, ?string $raw = null, array $headers = []): array
{
    global $base;
    $ch = curl_init($base . $path);
    $out = [];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_NOBODY => $method === 'HEAD',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', ...$headers],
        CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$out) {
            if (str_contains($line, ':')) {
                [$k, $v] = explode(':', $line, 2);
                $out[strtolower(trim($k))] = trim($v);
            }
            return strlen($line);
        },
    ]);
    if ($raw !== null || $body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $raw ?? json_encode($body));
    }
    $res = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);

    return ['status' => $status, 'headers' => $out, 'body' => (string) $res, 'json' => is_string($res) ? json_decode($res, true) : null];
}

$isProblem = function (string $label, array $r, int $status, string $code, ?string $pointer = null): void {
    $j = $r['json'];
    check(
        "$label → $status $code",
        $r['status'] === $status && str_starts_with($r['headers']['content-type'] ?? '', 'application/problem+json')
            && ($j['type'] ?? null) === 'about:blank' && ($j['status'] ?? null) === $status && ($j['code'] ?? null) === $code
            && is_string($j['title'] ?? null) && is_string($j['detail'] ?? null) && ($j['pointer'] ?? null) === $pointer,
        $r,
    );
};

$r = http('GET', '');
check('GET /wp-json/spacepress/v1 (the schema)', $r['status'] === 200 && $r['json']['data']['kinds']['items']['columns']['qty']['type'] === 'integer'
    && isset($r['json']['data']['actions']['restock']['input']['amount']), $r);
check('schema exposes no function names', !str_contains($r['body'], '__') && !str_contains($r['body'], 'hooks') && !str_contains($r['body'], 'handler'), $r['body']);
eq('the runtime reports the WordPress platform in the schema', [$r['json']['data']['runtime']['wp']['database']['kind'], $r['json']['data']['runtime']['wp']['incompatibleTables']], ['sqlite', []]);

$r = http('POST', '/items', ['name' => 'widget', 'price' => 2.0, 'locationId' => $garage['id']]);
$widget = $r['json']['data'] ?? [];
check('POST → 201 {data} with hook applied', $r['status'] === 201 && ($widget['name'] ?? null) === 'Widget' && str_starts_with($r['headers']['content-type'] ?? '', 'application/json'), $r);
check('integral float printed without .0', str_contains($r['body'], '"price":2,'), $r['body']);

$r = http('GET', '/items?' . http_build_query(['where' => json_encode(['locationId' => $garage['id']]), 'orderBy' => '-qty,name', 'limit' => 2, 'with' => 'location']));
eq('GET list: where + orderBy + limit + with', [$r['status'], array_column($r['json']['data'] ?? [], 'name'), $r['json']['data'][0]['location']['name'] ?? null], [200, ['Hammer', 'Nails'], 'Garage']);
eq('GET list offset', array_column(http('GET', '/items?orderBy=-id&offset=1&limit=1')['json']['data'] ?? [], 'name'), ['Nails']);
$isProblem('bad where JSON', http('GET', '/items?where=%7Bbad'), 400, 'invalid_query', '/where');
$isProblem('unknown where column', http('GET', '/items?where=' . rawurlencode('{"nope":1}')), 400, 'invalid_query', '/where/nope');
$isProblem('bad limit', http('GET', '/items?limit=-1'), 400, 'invalid_query', '/limit');

$r = http('GET', "/items/{$widget['id']}?with=location");
eq('GET by id with relation', [$r['status'], $r['json']['data']['location']['code'] ?? null], [200, 'GAR']);
$isProblem('GET missing id', http('GET', '/items/999999'), 404, 'not_found');
$isProblem('GET non-integer id', http('GET', '/items/abc'), 404, 'not_found');
$isProblem('unknown collection', http('GET', '/widgets'), 404, 'not_found');

// A malformed JSON body is refused before anything runs: the API's own parser answers invalid_json.
eq('invalid JSON body is refused', [http('POST', '/items', raw: '{"name":')['status'], http('POST', '/items', raw: '{"name":')['json']['code'] ?? null], [400, 'invalid_json']);
eq('… and by SpacePress itself', [$wp->call('POST', '/items', '{"name":')[0], $wp->call('POST', '/items', '{"name":')[1]['code'] ?? null], [400, 'invalid_json']);
// The API is a route on WordPress's REST server: core's transport works on it as on any route.
$r = http('GET', '');
eq('the namespace itself is the app schema, not core\'s namespace index', [$r['status'], isset($r['json']['data']['kinds']['items']), isset($r['json']['routes'])], [200, true, false]);
$r = http('OPTIONS', '/items', headers: ['Origin: https://elsewhere.test', 'Access-Control-Request-Method: POST']);
eq('a preflight is core\'s, with the API\'s own headers allowed', [$r['status'] < 300, str_contains($r['headers']['access-control-allow-headers'] ?? '', 'Idempotency-Key')], [true, true]);
eq('HEAD answers the status and no body', [http('HEAD', '/items')['status'], http('HEAD', '/items')['body']], [200, '']);
$r = http('POST', '/items/' . $widget['id'] . '?_method=PATCH', ['qty' => 7]);
eq('_method turns a POST into the PATCH it names, as on every REST route', [$r['status'], $r['json']['data']['qty'] ?? null], [200, 7]);
$r = http('GET', '/items', headers: ['Cookie: wordpress_logged_in_x=y', 'X-WP-Nonce: nope']);
// Core's refusal (rest_cookie_invalid_nonce), mapped as every core refusal of a signed-out caller is.
$isProblem('a bad nonce is core\'s refusal, as a problem document', $r, 401, 'unauthenticated');
// Application passwords are core's too, under core's own rule: on a request WordPress serves from the
// REST API, and on no other, whatever its URL starts with.
$basic = static fn (string $user, ?string $password = null): array => ['Authorization: Basic ' . base64_encode($password === null ? $wp->appPassword($user) : "$user:$password")];
$origin = "http://127.0.0.1:$port";
/** One request to the site with its path sent exactly as written (dot segments kept). */
$sent = static function (string $method, string $target, array $headers = [], ?string $body = null) use ($origin): array {
    $ch = curl_init($origin . $target);
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_PATH_AS_IS => true, CURLOPT_HTTPHEADER => $headers]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $res = (string) curl_exec($ch);

    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), $res];
};
eq('an application password signs in on the API', [http('GET', '/me', headers: $basic('fa_ed'))['status'], http('GET', '/me', headers: $basic('fa_ed'))['json']['data']['role'] ?? null], [200, 'editor']);
eq('… and as ?rest_route=', json_decode($sent('GET', '/?rest_route=/spacepress/v1/me', $basic('fa_ed'))[1], true)['data']['role'] ?? null, 'editor');
$isProblem('a wrong application password is refused, not a visitor', http('GET', '/me', headers: $basic('fa_ed', 'abcd efgh ijkl mnop qrst uvwx')), 401, 'incorrect_password');
$isProblem('… on a public list too', http('GET', '/items', headers: $basic('fa_ed', 'abcd efgh ijkl mnop qrst uvwx')), 401, 'incorrect_password');
// `rest_route` in the query or the body replaces the route in the path: emptied, the request is a page.
$form = ['Content-Type: application/x-www-form-urlencoded'];
$pages = [
    'a page' => $sent('GET', '/', $basic('fa_admin')),
    'the API path with ?rest_route= emptied' => $sent('GET', '/wp-json/spacepress/v1/me/?rest_route=', $basic('fa_admin')),
    'the API path with rest_route= emptied in the body' => $sent('POST', '/wp-json/spacepress/v1/me', [...$basic('fa_admin'), ...$form], 'rest_route='),
];
foreach ($pages as $label => [$status, $page]) {
    check("an application password signs nobody in on $label", !str_starts_with(ltrim($page), '{') && !str_contains($page, 'wpadminbar') && preg_match('/<body[^>]*\blogged-in\b/', $page) !== 1, [$status, substr($page, 0, 200)]);
}
// A path decoded once, however it was sent: WordPress keeps the pretty path as sent, PHP decodes ?rest_route=.
foreach (['/%69tems/' . $widget['id'] => 200, '/items/%3' . substr((string) $widget['id'], 0, 1) . substr((string) $widget['id'], 1) => 200,
    '/items/slug%3Anope' => 404, '/it%20ems' => 404, '/it%C3%A9ms' => 404, '/it%2520ems' => 404, '/%2569tems' => 404, '/it%27s%22a%5Cb' => 404] as $encoded => $expect) {
    $pretty = http('GET', $encoded);
    [$status, $body] = $sent('GET', '/?rest_route=/spacepress/v1' . $encoded);
    eq("$encoded answers the same under /wp-json and as ?rest_route=", [$pretty['status'], $pretty['json']], [$status, json_decode($body, true)]);
    eq("$encoded → $expect", $pretty['status'], $expect);
}
eq('an encoded space, a non-ASCII letter and a literal %20 reach the API as that text', [
    http('GET', '/it%20ems')['json']['detail'] ?? null, http('GET', '/it%C3%A9ms')['json']['detail'] ?? null, http('GET', '/it%2520ems')['json']['detail'] ?? null, http('GET', '/%2569tems')['json']['detail'] ?? null,
    http('GET', '/it%27s%22a%5Cb')['json']['detail'] ?? null,
], ["Unknown kind 'it ems'", "Unknown kind 'itéms'", "Unknown kind 'it%20ems'", "Unknown kind '%69tems'", "Unknown kind 'it's\"a\\b'"]);
$r = http('GET', '/items');
eq('every answer is private', [$r['headers']['cache-control'] ?? null, str_contains($r['headers']['vary'] ?? '', 'Authorization')], ['private, no-store', true]);
$plain = (function () use ($base): array {
    $ch = curl_init(str_replace('/wp-json/spacepress/v1', '/?rest_route=/spacepress/v1/items', $base));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    $body = (string) curl_exec($ch);
    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), is_array(json_decode($body, true)['data'] ?? null)];
})();
eq('?rest_route= reaches the API too', $plain, [200, true]);
$isProblem('coercion error with pointer', http('POST', '/items', ['name' => 'x', 'qty' => 'lots']), 422, 'invalid_input', '/qty');
$isProblem('missing required', http('POST', '/items', ['qty' => 1]), 422, 'invalid_input', '/name');
$isProblem('unique violation', http('POST', '/locations', ['name' => 'Garage']), 409, 'unique_violation', '/name');
$r = http('POST', '/locations', raw: '{"name":"Empty","meta":{"a":{},"b":[]}}');
eq('a json column keeps {} apart from [] through storage and the API', [$r['status'], str_contains($r['body'], '"meta":{"a":{},"b":[]}'),
    str_contains(http('GET', '/locations/' . ($r['json']['data']['id'] ?? 0))['body'], '"meta":{"a":{},"b":[]}')], [201, true, true]);
$r = http('POST', '/locations', raw: '{"name":"Bare","meta":{}}');
eq('… a json value that is {} itself, too', [$r['status'], str_contains($r['body'], '"meta":{}')], [201, true]);
$isProblem('reference violation', http('POST', '/items', ['name' => 'x', 'locationId' => 424242]), 409, 'reference_violation', '/locationId');

$r = http('PATCH', "/items/{$widget['id']}", ['qty' => 7]);
eq('PATCH', [$r['status'], $r['json']['data']['qty'] ?? null], [200, 7]);
$isProblem('PATCH missing', http('PATCH', '/items/999999', ['qty' => 1]), 404, 'not_found');
$isProblem('PATCH array body', http('PATCH', "/items/{$widget['id']}", [1, 2]), 422, 'invalid_input', '');

$logsBefore = count(http('GET', '/logs?limit=200')['json']['data']);
$r = http('PATCH', "/items/{$widget['id']}", ['qty' => -5]);
$isProblem('hook throws JsError mid-request', $r, 422, 'rejected');
eq('rejected detail is the JsError message', $r['json']['detail'] ?? null, 'qty cannot go negative');
eq('request rolled back: row unchanged, hook insert undone',
    [http('GET', "/items/{$widget['id']}")['json']['data']['qty'], count(http('GET', '/logs?limit=200')['json']['data'])], [7, $logsBefore]);

$r = http('POST', '/actions/restock', ['itemId' => $widget['id']]);
eq('action with default input', [$r['status'], $r['json']['data']['qty'] ?? null], [200, 12]);
$isProblem('action input coercion', http('POST', '/actions/restock', ['itemId' => 'x']), 422, 'invalid_input', '/itemId');
$isProblem('action unknown input key', http('POST', '/actions/restock', ['itemId' => 1, 'extra' => 1]), 422, 'invalid_input', '/extra');
$isProblem('action HttpError from handler', http('POST', '/actions/restock', ['itemId' => 999999]), 404, 'not_found');
$isProblem('unknown action', http('POST', '/actions/nope', []), 404, 'not_found');

$isProblem('api flag disables create', http('POST', '/logs', ['message' => 'x']), 405, 'method_not_allowed');
$isProblem('api flag disables delete', http('DELETE', '/logs/1'), 405, 'method_not_allowed');

$r = http('DELETE', "/items/{$widget['id']}");
eq('DELETE returns the deleted row', [$r['status'], $r['json']['data']['name'] ?? null, $r['json']['data']['qty'] ?? null], [200, 'Widget', 12]);
$isProblem('deleted row is gone', http('GET', "/items/{$widget['id']}"), 404, 'not_found');

// ================================================================ afterPublish (spec §2.8)

// A collection's item became published: created published, updated from a draft, or its scheduled
// time came. Updating an already-published item, or a draft, doesn't run it.
(static function (): void {
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
    $status = ['type' => 'text', 'notNull' => true, 'enum' => ['draft', 'published', 'scheduled'], 'default' => ['value' => 'published'], 'system' => true];
    $seen = [];
    $raw = ['version' => 5, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => [
        'bulletins' => ['primaryKey' => 'id', 'drafts' => true, 'editor' => false, 'table' => 'sp_ap_bulletins',
            'hooks' => ['afterPublish' => static function (array $row) use (&$seen): void { $seen[] = $row['title']; }],
            'columns' => ['id' => $id, 'title' => ['type' => 'text', 'notNull' => true], 'status' => $status, 'publishedAt' => ['type' => 'timestamp', 'system' => true]]],
    ]];
    $schema = new \SpacePress\Schema($raw);
    $wp = $GLOBALS['wp'];
    $wp->exec('CREATE TABLE {prefix}sp_ap_bulletins (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `title` LONGTEXT NOT NULL, `status` VARCHAR(191) NOT NULL, `publishedAt` CHAR(24), PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $db = new \SpacePress\Db(\SpacePress\Wp\CompositeStore::create($schema, $wp->connection()), $schema, \SpacePress\db()->media());
    $db->insert('bulletins', ['title' => 'live']);
    $draft = $db->insert('bulletins', ['title' => 'draft', 'status' => 'draft'], true)[0];
    $db->update('bulletins', ['title' => 'draft, edited'], ['id' => $draft['id']]);
    $db->update('bulletins', ['status' => 'published'], ['id' => $draft['id']]);
    $db->update('bulletins', ['title' => 'published, edited'], ['id' => $draft['id']]);
    $later = $db->insert('bulletins', ['title' => 'later', 'status' => 'scheduled', 'publishedAt' => gmdate('Y-m-d\\TH:i:s.000\\Z', time() + 3600)], true)[0];
    $db->promoteDue();
    $wp->exec("UPDATE {prefix}sp_ap_bulletins SET `publishedAt` = '" . gmdate('Y-m-d\\TH:i:s.000\\Z', time() - 60) . "' WHERE `id` = " . (int) $later['id']);
    $db->promoteDue();
    eq('afterPublish runs once per item that became published, scheduled ones when they come due', $seen, ['live', 'draft, edited', 'later']);
})();

// ================================================================ relation filters respect the target's read access

// A relation filter is an oracle over the target's columns, so it may only see target rows a direct
// read would return: an unreadable target is denied like `with`, a draft target matches nothing.
// That holds for the row selector of a viewer's update/delete as much as for a read.
(static function (): void {
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
    $status = ['type' => 'text', 'notNull' => true, 'enum' => ['draft', 'published', 'scheduled'], 'default' => ['value' => 'published'], 'system' => true];
    $one = static fn (string $c, string $from) => ['kind' => 'one', 'collection' => $c, 'from' => $from, 'to' => 'id'];
    $schema = new \SpacePress\Schema(['version' => 5, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => [
        'accounts' => ['primaryKey' => 'id', 'access' => ['read' => ['role' => 'admin']],
            'columns' => ['id' => $id, 'apiKey' => ['type' => 'text', 'notNull' => true]]],
        'articles' => ['primaryKey' => 'id', 'drafts' => true,
            'columns' => ['id' => $id, 'secret' => ['type' => 'text'], 'ownerId' => ['type' => 'integer'], 'status' => $status, 'publishedAt' => ['type' => 'timestamp', 'system' => true]],
            'relations' => ['owner' => $one('accounts', 'ownerId')]],
        'comments' => ['primaryKey' => 'id', 'access' => ['update' => ['role' => 'anyone'], 'delete' => ['role' => 'anyone']],
            'columns' => ['id' => $id, 'articleId' => ['type' => 'integer'], 'ownerId' => ['type' => 'integer']],
            'relations' => ['article' => $one('articles', 'articleId'), 'owner' => $one('accounts', 'ownerId')]],
    ]]);
    // Its own custom tables on the site, read through a Db over the same connection.
    $wp = $GLOBALS['wp'];
    $raw = ['version' => 5, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => []];
    foreach (['accounts', 'articles', 'comments'] as $t) {
        $raw['collections'][$t] = $schema->collection($t) + ['editor' => false, 'table' => "sp_rf_$t"];
    }
    $schema = new \SpacePress\Schema($raw);
    $wp->exec('CREATE TABLE {prefix}sp_rf_accounts (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `apiKey` LONGTEXT NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_rf_articles (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `secret` LONGTEXT, `ownerId` BIGINT, `status` VARCHAR(191) NOT NULL, `publishedAt` CHAR(24), PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_rf_comments (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `articleId` BIGINT, `ownerId` BIGINT, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $wp->exec("INSERT INTO {prefix}sp_rf_accounts VALUES (1, 'sk_live_7x')");
    $wp->exec("INSERT INTO {prefix}sp_rf_articles VALUES (1, 'price=42', NULL, 'draft', NULL), (2, 'open', 1, 'published', '2026-01-01T00:00:00.000Z')");
    $wp->exec('INSERT INTO {prefix}sp_rf_comments VALUES (1, 1, 1), (2, 2, NULL)');
    $store = \SpacePress\Wp\CompositeStore::create($schema, $wp->connection());
    $db = new \SpacePress\Db($store, $schema, \SpacePress\db()->media());
    $anon = new \SpacePress\Viewer(null);
    $editor = new \SpacePress\Viewer(['id' => 1, 'name' => 'ed', 'role' => 'editor']);
    $admin = new \SpacePress\Viewer(['id' => 2, 'name' => 'root', 'role' => 'admin']);
    $ids = static fn (string $c, array $where, ?\SpacePress\Viewer $v) => array_column($db->findMany($c, ['where' => $where, 'orderBy' => ['id' => 'asc']], $v), 'id');
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
    // A render binds its visitor (Seam::asViewer): compiled reads then skip drafts, also after an
    // await inside an async body, which resumes after asViewer itself has returned.
    $titles = static fn (): array => array_map(static fn ($row) => $row->p['secret'], \SpacePress\Seam::findMany('articles', ['orderBy' => ['id' => 'asc']])->a);
    eq('compiled reads see drafts when trusted and skip them for a bound visitor', $db->current(static fn () => [
        $titles(),
        \SpacePress\Seam::asViewer($anon, $titles),
        \SpacePress\Seam::asViewer($editor, $titles),
    ]), [['price=42', 'open'], ['open'], ['price=42', 'open']]);
    $render = \SpacePress\JsJobs::asyncFunction(static function () use ($titles): array {
        $before = $titles();
        \SpacePress\JsJobs::await(\SpacePress\JsPromise::from(1));
        $after = $titles();
        $inner = \SpacePress\Seam::asViewer(null, static function () use ($titles): array {
            \SpacePress\JsJobs::await(\SpacePress\JsPromise::from(2));
            return $titles();
        });
        return [$before, $after, \SpacePress\JsJobs::await($inner), $titles()];
    });
    eq('an async render keeps its visitor across awaits, and a nested binding only inside', $db->current(static fn () => \SpacePress\JsJobs::run(
        static fn () => \SpacePress\Seam::asViewer($anon, $render),
        [],
    )), [['open'], ['open'], ['price=42', 'open'], ['open']]);
    eq('nothing stays bound after the render', \SpacePress\Seam::viewer(), null);
    // Promise reactions and timers read as the viewer bound where they were registered, even when
    // the queue drains after asViewer has returned.
    $seen = [];
    $db->current(static function () use ($anon, $titles, &$seen): void { \SpacePress\JsJobs::run(static function () use ($anon, $titles, &$seen): \SpacePress\JsPromise {
        return \SpacePress\Seam::asViewer($anon, static function () use ($titles, &$seen): \SpacePress\JsPromise {
            $done = new \SpacePress\JsPromise();
            \SpacePress\JsPromise::from(1)->then(static function () use ($titles, &$seen) { $seen['then'] = $titles(); return 1; });
            \SpacePress\Timers::set(static function () use ($titles, &$seen, $done): void { $seen['timer'] = $titles(); $done->resolve(1); }, 1);
            return $done;
        });
    }, []); });
    eq('a reaction and a timer registered under a visitor read as that visitor', $seen, ['then' => ['open'], 'timer' => ['open']]);
    $trusted = [];
    $db->current(static function () use ($titles, &$trusted): void { \SpacePress\JsJobs::run(static function () use ($titles, &$trusted): \SpacePress\JsPromise {
        $done = new \SpacePress\JsPromise();
        \SpacePress\JsPromise::from(1)->then(static function () use ($titles, &$trusted) { $trusted[] = $titles(); return 1; });
        \SpacePress\Timers::set(static function () use ($titles, &$trusted, $done): void { $trusted[] = $titles(); $done->resolve(1); }, 1);
        return $done;
    }, []); });
    eq('… and registered outside any render they stay trusted', $trusted, [['price=42', 'open'], ['price=42', 'open']]);
    problem('a viewer\'s update selector is denied the unreadable target', fn () => $db->update('comments', ['ownerId' => 1], $key, true, $anon), 401, 'unauthenticated');
    eq('… and a viewer\'s delete selector matches no draft target', $db->delete('comments', ['article' => ['secret' => ['like' => 'price=4%']]], true, $anon), []);
})();

// ================================================================ field access (lane B, phase 2 §4)

// ================================================================ field access (lane B, phase 2 §4)

// The field-access users are WordPress users (created at install); rules see them as SpacePress maps them.
$fa = [];
foreach (['fa_alice', 'fa_bob', 'fa_ed', 'fa_admin'] as $name) {
    $fa[$name] = ['user' => $wp->user($name)];
}
/** In-process API call as one of the field-access users (null = anonymous); returns [status, data or problem]. */
$as = function (?string $who, string $method, string $path, mixed $body = null, array $query = []) use ($wp): array {
    [$status, $data] = $wp->call($method, $path, $body, $who, $query);

    return [$status, $data];
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
eq('anonymous rows lack every column it may not read, at every level', [array_keys($anon['Alice']), $anon['Alice']['notes']], [['id', 'name', 'ownerId', 'approved', 'notes', 'blocks', 'stamp', 'pairs', 'rounds', 'fixed', 'gated', 'seeded', 'vault', 'seen', 'cleared', 'meta', 'checks', 'tasks', 'teamId', '_rev'], ['public' => 'hi', 'pinned' => true, 'tag' => null]]);
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
problem('columns selecting a hidden column', fn () => $db->findMany('profiles', ['columns' => ['email' => true]], new \SpacePress\Viewer(null)), 403, 'forbidden', '/columns/email');
problem('columns selecting a column with a per-row rule', fn () => $db->findMany('profiles', ['columns' => ['salary' => true]], new \SpacePress\Viewer($fa['fa_alice']['user'])), 403, 'forbidden', '/columns/salary');
eq('excluding a hidden column is allowed', array_keys($db->findMany('profiles', ['columns' => ['email' => false], 'limit' => 1], new \SpacePress\Viewer(null))[0]), ['id', 'name', 'ownerId', 'approved', 'notes', 'blocks', 'stamp', 'pairs', 'rounds', 'fixed', 'gated', 'seeded', 'vault', 'seen', 'cleared', 'meta', 'checks', 'tasks', 'teamId']);
eq('a readable column filters normally; trusted filters see everything', [
    array_column($as('fa_ed', 'GET', '/profiles', query: ['where' => '{"email":"bob@example.test"}'])[1], 'name'),
    array_column($db->findMany('teams', ['where' => ['budget' => 1000]]), 'name'),
], [['Bob'], ['Core']]);

// Compiled reads (Seam) are trusted unless a caller binds a visitor, as a page render does.
$hasEmail = static fn (): array => array_values(array_unique(array_map(static fn ($row) => array_key_exists('email', $row->p), \SpacePress\Seam::findMany('profiles')->a)));
$editor = new \SpacePress\Viewer(['id' => 1, 'name' => 'ed', 'role' => 'editor']);
eq('Seam reads are trusted outside asViewer', [\SpacePress\Seam::viewer(), $hasEmail()], [null, [true]]);
eq('asViewer binds an anonymous visitor: hidden fields stay out', \SpacePress\Seam::asViewer(new \SpacePress\Viewer(null), static fn () => [
    array_key_exists('email', \SpacePress\Seam::findFirst('profiles')->p),
    $hasEmail(),
]), [false, [false]]);
eq('asViewer binds an editor, who reads the field', \SpacePress\Seam::asViewer($editor, $hasEmail), [true]);
problem('a visitor-bound read refuses a hidden column', fn () => \SpacePress\Seam::asViewer(new \SpacePress\Viewer(null), static fn () => \SpacePress\Seam::findMany('profiles', ['columns' => ['email' => true]])), 403, 'forbidden', '/columns/email');
eq('the previous viewer is restored after a throw', \SpacePress\Seam::viewer(), null);
eq('nested asViewer restores the outer viewer', \SpacePress\Seam::asViewer($editor, static fn () => [\SpacePress\Seam::asViewer(null, static fn () => \SpacePress\Seam::viewer()), \SpacePress\Seam::viewer() === $editor]), [null, true]);

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
$aliceViewer = new \SpacePress\Viewer($fa['fa_alice']['user']);
problem('an update selector on a hidden column is refused', fn () => $db->update('profiles', ['name' => 'x'], ['email' => 'alice@example.test'], true, $aliceViewer), 403, 'forbidden', '/where/email');
problem('… and a delete selector', fn () => $db->delete('profiles', ['salary' => -1], true, new \SpacePress\Viewer($fa['fa_ed']['user'])), 403, 'forbidden', '/where/salary');
// An unchanged resend must be the same value: a list resent as an object is a change.
$db->update('profiles', ['meta' => ['a', 'b']], ['id' => $mine['id']]);
$faProblem('a list resent as an object with numeric keys is refused', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['meta' => ['1' => 'b', '0' => 'a']]), 403, 'forbidden', '/meta');
eq('… the stored list is untouched, and the true resend passes', [\SpacePress\Seam::toWire($db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['meta']), $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['meta' => ['a', 'b']])[0]], [['a', 'b'], 200]);
// Carrying an omitted protected value forward compares only what the viewer sees: any hidden value
// in that item is refused alike, right guess or wrong.
$db->update('profiles', ['tasks' => [['label' => 'w', 'rate' => 5, 'secret' => 'old']]], ['id' => $mine['id']]);
$faProblem('right guess of a hidden value while carrying a protected one', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => [['label' => 'w', 'secret' => 'old']]]), 403, 'forbidden', '/tasks/0');
$faProblem('wrong guess, same answer', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => [['label' => 'w', 'secret' => 'nope']]]), 403, 'forbidden', '/tasks/0');
$faProblem('an item edited while leaving out what she can\'t see is refused', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => [['label' => 'w!', 'rate' => 5]]]), 403, 'forbidden', '/tasks/0');
$faProblem('so is a partial resend', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => [(object) []]]), 403, 'forbidden', '/tasks/0');
eq('resending the item as she sees it keeps the stored item whole', [$as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['tasks' => [['label' => 'w', 'rate' => 5]]])[0], $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['tasks']], [200, [['label' => 'w', 'rate' => 5, 'secret' => 'old']]]);
// Group null and item removal are refused from the rules alone: the same answer whether or not a
// hidden value is stored, so a destructive write can't test for presence.
$db->update('profiles', ['notes' => ['public' => 'x', 'flag' => null]], ['id' => $mine['id']]);
$faProblem('a null group is refused even when the hidden sub-field is empty', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['notes' => null]), 403, 'forbidden', '/notes');
$faProblem('a nested hidden field without an update rule cannot be overwritten', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['notes' => ['private' => 'changed']]), 403, 'forbidden', '/notes/private');
$faProblem('an unchanged group resend can\'t confirm a hidden value', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['notes' => $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['notes']]), 403, 'forbidden', '/notes/private');
// A column hidden from the viewer can't be overwritten either, whatever is sent: a write is only for
// those who can see the value (review: field-write-hidden). A declared update rule makes it write-only.
$faProblem('an author can\'t overwrite a value she can\'t read', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['email' => 'mine@x.test']), 403, 'forbidden', '/email');
eq('… and nothing changed', $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['email'], 'alice@example.test');
eq('an editor, who reads it, may', $as('fa_ed', 'PATCH', "/profiles/{$mine['id']}", ['email' => 'alice@example.test'])[0], 200);
$faProblem('switching a block\'s layout would erase its protected value', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['blocks' => [['layout' => 'link', 'href' => 'x']]]), 403, 'forbidden', '/blocks/0');
eq('the refused layout switch kept the stored block', $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['blocks'], [['layout' => 'memo', 'text' => 'kept']]);
$faProblem('a malformed layout is the validator\'s to report', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['blocks' => [['layout' => 'memo', 'text' => 'kept'], ['layout' => ['memo']]]]), 422, 'invalid_input', '/blocks/1/layout');

// Revisions are read through the same strip.
$rev = $db->revisions('profiles', $mine['id'])[0]['id'];
$revRow = $as('fa_alice', 'GET', "/profiles/{$mine['id']}/revisions/$rev")[1];
eq('a revision hides what the live row hides', [array_key_exists('email', $revRow), $revRow['salary'], $revRow['notes']], [false, 10, ['public' => 'x', 'pinned' => true, 'tag' => null]]);
// Restore puts back the whole revision as stored: what she can read through her rules, and what is
// hidden from her (email) as trusted values she never sent, so nothing about them is probed or returned.
$db->update('profiles', ['email' => 'later@example.test'], ['id' => $mine['id']]);
[$restoredStatus, $restoredRow] = $as('fa_alice', 'POST', "/profiles/{$mine['id']}/revisions/$rev/restore");
eq('an owner restores a revision, hidden fields included, and the answer hides them', [$restoredStatus, array_key_exists('email', $restoredRow ?? []), $db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['email']], [200, false, 'alice@example.test']);
eq('an admin restores the same revision', $as('fa_admin', 'POST', "/profiles/{$mine['id']}/revisions/$rev/restore")[0], 200);

// /_schema reports per-column summaries (no function names).
$described = $as(null, 'GET', '/_schema')[1]['collections']['profiles'];
eq('/_schema access.fields summaries', $described['access']['fields'], ['email' => ['read' => 'editor'], 'salary' => ['read' => 'rule', 'update' => 'admin'], 'approved' => ['create' => 'editor', 'update' => 'editor'], 'mentorId' => ['read' => 'editor'], 'fixed' => ['update' => false], 'seen' => ['update' => false], 'locker' => ['read' => 'editor'], 'diary' => ['read' => 'editor'], 'entries' => ['read' => 'editor'], 'cleared' => ['update' => 'rule'], 'meta' => ['update' => false]]);

// ================================================================ globals: one instant per update

// ================================================================ globals: one instant per update

// A global update fills never-written `now` fields and the patch's nested defaults at one instant,
// although every clock read here moves the pinned clock a millisecond (SP_NOW_STEP).
(static function (): void {
    $now = ['now' => true];
    $wp = $GLOBALS['wp'];
    $schema = new \SpacePress\Schema(['version' => 5, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => [], 'globals' => ['site' => [
        'label' => 'site', 'agents' => true, 'access' => ['read' => ['role' => 'anyone'], 'update' => ['role' => 'editor']],
        'wp' => ['postId' => 'sp_global_site', 'menuSlug' => 'spacepress-global-site', 'groupKey' => 'group_sp_global_site', 'fieldKeyPrefix' => 'field_sp_global_site_', 'optionPrefix' => 'sp_global_site_'],
        'fields' => [
            'createdAt' => ['type' => 'timestamp', 'default' => $now],
            'audit' => ['type' => 'group', 'fields' => ['at' => ['type' => 'timestamp', 'default' => $now]]],
        ],
    ]]]);
    // Globals are SCF option fields: SCF must know this global's fields to write them.
    \SpacePress\Wp\Scf::register($schema);
    $store = \SpacePress\Wp\CompositeStore::create($schema, $wp->connection());
    $db = new \SpacePress\Db($store, $schema, \SpacePress\db()->media());
    putenv('SP_NOW=2030-01-01T00:00:00.000Z');
    putenv('SP_NOW_STEP=1');
    try {
        $site = $db->globalUpdate('site', ['audit' => []]);
    } finally {
        putenv('SP_NOW_STEP');
        putenv('SP_NOW');
    }
    eq('a global update stores its now defaults at one instant', [$site['createdAt'], $site['audit']['at']], ['2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z']);
    // A render's bound visitor applies to compiled global reads too: this global is editor-read.
    $guarded = new \SpacePress\Schema(['version' => 5, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => [], 'globals' => ['desk' => [
        'label' => 'desk', 'agents' => true, 'access' => ['read' => ['role' => 'editor'], 'update' => ['role' => 'editor']],
        'wp' => ['postId' => 'sp_global_desk', 'menuSlug' => 'spacepress-global-desk', 'groupKey' => 'group_sp_global_desk', 'fieldKeyPrefix' => 'field_sp_global_desk_', 'optionPrefix' => 'sp_global_desk_'],
        'fields' => ['note' => ['type' => 'text', 'default' => ['value' => 'shh']]],
    ]]]);
    \SpacePress\Wp\Scf::register($guarded);
    $desk = new \SpacePress\Db(\SpacePress\Wp\CompositeStore::create($guarded, $wp->connection()), $guarded, \SpacePress\db()->media());
    eq('a trusted compiled global read sees an editor-only global', $desk->current(static fn () => \SpacePress\Seam::globalGet('desk')->p['note']), 'shh');
    problem('a visitor-bound compiled global read is refused', static fn () => $desk->current(static fn () => \SpacePress\Seam::asViewer(new \SpacePress\Viewer(null), static fn () => \SpacePress\Seam::globalGet('desk'))), 401, 'unauthenticated');
})();

// ================================================================ JSON identity at query boundaries

// An access rule sees a list-typed patch as a handle; JSON columns retain nested object shape.
(static function (): void {
    eval('namespace SpacePressApp; function marked__update($ctx) { return !\SpacePress\Js::includes($ctx->p["data"]->p["tags"], "locked"); }');
    // A read rule returning a filter that contains an empty object: compiled `{ AND: [{}] }`.
    eval('namespace SpacePressApp; function marked__read($ctx) { return ["AND" => [new \\SpacePress\\JsObject()]]; }');
    $schema = new \SpacePress\Schema(['version' => 5, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => ['marked' => [
        'primaryKey' => 'id', 'editor' => false, 'table' => 'first_marked', 'access' => ['read' => ['fn' => 'marked__read'], 'update' => ['fn' => 'marked__update']],
        'columns' => [
            'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
            'tags' => ['type' => 'select', 'multiple' => true, 'enum' => ['locked', 'open']],
            'meta' => ['type' => 'json'],
            'info' => ['type' => 'group', 'fields' => ['extra' => ['type' => 'json']]],
            'parentId' => ['type' => 'integer'],
        ],
        'relations' => ['kids' => ['kind' => 'many', 'collection' => 'marked', 'from' => 'id', 'to' => 'parentId']],
    ]]]);
    $wp = $GLOBALS['wp'];
    $wp->exec('CREATE TABLE {prefix}first_marked (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `tags` LONGTEXT, `meta` LONGTEXT, `info` LONGTEXT, `parentId` BIGINT, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $store = \SpacePress\Wp\CompositeStore::create($schema, $wp->connection());
    $db = new \SpacePress\Db($store, $schema, \SpacePress\db()->media());
    $previous = \SpacePress\Db::instance();
    \SpacePress\Db::setInstance($db); // registered extensions read the active Db's schema
    try {
        $row = $db->insert('marked', ['tags' => ['open']], true)[0];
        $viewer = new \SpacePress\Viewer(['id' => 1, 'name' => 'ed', 'role' => 'editor']);
        $patch = \SpacePress\Js::decodeJson('{"tags":[],"meta":{"a":{}}}');
        try {
            $updated = $db->update('marked', $patch, ['id' => $row['id']], true, $viewer)[0];
            $got = [$updated['tags'], \SpacePress\Js::jsonStringify($updated['meta'])];
        } catch (\Throwable $e) {
            $got = $e::class . ': ' . $e->getMessage();
        }
        eq('an update rule gets list handles; the json() value keeps {}', $got, [[], '{"a":{}}']);
        // A json() filter operand keeps `{}`: deleting rows whose meta is {} leaves the one holding [].
        $db->insert('marked', [['meta' => \SpacePress\Js::decodeJson('{}')], ['meta' => []]]);
        $db->delete('marked', \SpacePress\Js::decodeJson('{"meta":{"eq":{}}}'));
        eq('a json() filter compares {} and [] as different values', array_map(static fn ($r) => \SpacePress\Js::jsonStringify($r['meta']),
            $db->findMany('marked', ['orderBy' => ['id' => 'asc']])), ['{"a":{}}', '[]']);
        // The same holds in nested `with` options, in a json() sub-field of a structured filter, and
        // under a viewer whose read rule returns a filter containing {} (all flattened by schema).
        $parent = $db->findFirst('marked', ['orderBy' => ['id' => 'asc']]);
        $db->insert('marked', [['parentId' => $parent['id'], 'meta' => \SpacePress\Js::decodeJson('{}'), 'info' => ['extra' => \SpacePress\Js::decodeJson('{}')]],
            ['parentId' => $parent['id'], 'meta' => [], 'info' => ['extra' => []]]]);
        $kids = $db->findFirst('marked', \SpacePress\Js::decodeJson('{"where":{"id":' . $parent['id'] . '},"with":{"kids":{"where":{"meta":{"eq":{}}}}}}'))['kids'];
        $byInfo = $db->findMany('marked', \SpacePress\Js::decodeJson('{"where":{"info":{"eq":{"extra":{}}}}}'));
        $asViewer = $db->findMany('marked', [], new \SpacePress\Viewer(null));
        eq('permission checks run a rule filter holding {} like reads do', [
            $db->permits('marked', 'read', $parent['id'], new \SpacePress\Viewer(null)),
            count($db->permittedKeys('marked', 'read', new \SpacePress\Viewer(null)) ?? []),
        ], [true, 4]);
        eq('json() operands keep {} in with, in structured filters, and beside rule filters', [
            array_map(static fn ($r) => \SpacePress\Js::jsonStringify($r['meta']), $kids),
            array_map(static fn ($r) => \SpacePress\Js::jsonStringify($r['info']['extra']), $byInfo),
            count($asViewer),
        ], [['{}'], ['{}'], 4]);
    } finally {
        \SpacePress\Db::setInstance($previous);
    }
})();

// ================================================================ callback ownership and JSON boundaries
(static function (): void {
    eval(<<<'CODE'
    namespace SpacePressApp;
    function refs__before($data, $ctx) {
        if ($data !== $ctx->p['data']) throw new \RuntimeException('before alias');
        if ($data->p['meta'] instanceof \SpacePress\JsObject && isset($data->p['meta']->p['x'])) $data->p['meta']->p['x'] = 2;
    }
    function refs__validate($value, $ctx) {
        if ($value !== $ctx->p['data']->p['meta']) return 'validator alias';
        if (isset($value->p['x'])) {
            $ctx->p['data']->p['meta']->p['x'] = 8;
            if ($value->p['x'] !== 8) return 'validator graph';
            $GLOBALS['refsCaptured']->p['x'] = 99;
        }
        return true;
    }
    function refs__after($row) {
        if ($row->p['meta'] instanceof \SpacePress\JsObject && isset($row->p['meta']->p['x'])) $row->p['meta']->p['x'] = 100;
    }
    function refs__input($input, $ctx) { return $input->p['info']->p['extra']; }
    CODE);
    $columns = [
        'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
        'meta' => ['type' => 'json', 'rules' => ['validate' => 'refs__validate'], 'access' => ['update' => ['allow' => false]]],
        'info' => ['type' => 'group', 'fields' => ['extra' => ['type' => 'json', 'default' => ['json' => '{"1":1,"0":2}']]], 'default' => ['json' => '{}']],
    ];
    $schema = new \SpacePress\Schema(['version' => 5, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => ['refs' => [
        'primaryKey' => 'id', 'editor' => false, 'table' => 'sp_refs', 'columns' => $columns,
        'access' => ['read' => ['allow' => true], 'update' => ['allow' => true]],
        'hooks' => ['beforeCreate' => 'refs__before', 'afterCreate' => 'refs__after'],
        'relations' => ['self' => ['kind' => 'one', 'collection' => 'refs', 'from' => 'id', 'to' => 'id']],
    ]]]);
    $wp = $GLOBALS['wp'];
    $wp->exec('CREATE TABLE {prefix}sp_refs (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `meta` LONGTEXT, `info` LONGTEXT, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $db = new \SpacePress\Db(\SpacePress\Wp\CompositeStore::create($schema, $wp->connection()), $schema, \SpacePress\db()->media());
    $previous = \SpacePress\Db::instance();
    \SpacePress\Db::setInstance($db);
    $seen = null;
    \SpacePress\Extensions::onWrite(static function (string $op, string $collection, array &$data) use (&$seen): void {
        if ($collection === 'refs') $seen = is_array($data);
    });
    try {
        $source = new \SpacePress\JsObject(['x' => 1]);
        $GLOBALS['refsCaptured'] = $source;
        $row = $db->insert('refs', new \SpacePress\JsObject(['meta' => $source]), true)[0];
        eq('before mutations persist; validator, capture and after mutations are isolated', [
            $seen, $row['meta']->p['x'], $db->findFirst('refs')['meta']->p['x'], $source->p['x'],
        ], [true, 2, 2, 99]);
        eq('a group default fills nested JSON defaults as objects', \SpacePress\Js::jsonStringify($row['info']), '{"extra":{"0":2,"1":1}}');
        foreach (['{}', '[]', '{"1":1,"0":2}', '{"\u0000":1}'] as $json) {
            $value = \SpacePress\Js::decodeJson($json);
            $created = $db->insert('refs', ['meta' => $value, 'info' => []], true)[0];
            $read = $db->findFirst('refs', ['where' => ['id' => $created['id']]]);
            eq("JSON insert/read/response: $json", \SpacePress\Js::jsonStringify($read['meta']), \SpacePress\Js::jsonStringify($value));
        }
        $protected = $db->insert('refs', ['meta' => \SpacePress\Js::decodeJson('{"a":1,"b":{"n":2}}')], true)[0];
        $viewer = new \SpacePress\Viewer(['id' => 1, 'name' => 'Ed', 'role' => 'editor']);
        $same = $db->update('refs', ['meta' => \SpacePress\Js::decodeJson('{"b":{"n":2},"a":1}')], ['id' => $protected['id']], true, $viewer)[0];
        eq('a protected JSON echo compares object keys structurally', $same['meta']->p['b']->p['n'], 2);
        problem('a nested JSON change is a protected write', fn () => $db->update('refs', ['meta' => \SpacePress\Js::decodeJson('{"b":{"n":3},"a":1}')], ['id' => $protected['id']], true, $viewer), 403, 'forbidden', '/meta');
        eq('sameJson detects a nested handle change', \SpacePress\Js::sameJson($same['meta'], \SpacePress\Js::decodeJson('{"b":{"n":3},"a":1}')), false);
        $jsRow = \SpacePress\Seam::findFirst('refs', ['where' => ['id' => $row['id']], 'with' => ['self' => true]]);
        eq('row handles enumerate columns and attached relations', [\SpacePress\Js::keys($jsRow)->a, $jsRow->p['self']->p['id']], [[...array_keys($columns), 'self'], $row['id']]);
        problem('cyclic write inputs are a validation error', static function () use ($db): void {
            $cycle = new \SpacePress\JsObject(); $cycle->p['self'] = $cycle;
            $db->insert('refs', ['meta' => $cycle]);
        }, 422, 'invalid_input');
    } finally { \SpacePress\Db::setInstance($previous); unset($GLOBALS['refsCaptured']); }
})();

// ================================================================ a second Db keeps its own rules

// Extensions (field access, sync, locales, files…) reach the schema through db(): that must be the
// Db running the operation, not the booted app's, or a second Db silently loses its field rules.
(static function (): void {
    $wp = $GLOBALS['wp'];
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
    eval('namespace SpacePressApp; function scoped__rule($ctx) { return \\SpacePress\\db()->schema()->hasCollection("people"); } function scoped__default() { return \\SpacePress\\db()->schema()->hasCollection("people") ? "secondary" : "booted"; }');
    $schema = new \SpacePress\Schema(['version' => 5, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => [
        'people' => ['primaryKey' => 'id', 'editor' => false, 'table' => 'sp_scoped_people', 'revisions' => true, 'access' => ['read' => ['fn' => 'scoped__rule'], 'update' => ['fn' => 'scoped__rule']],
            'columns' => ['id' => $id, 'name' => ['type' => 'text', 'notNull' => true], 'ssn' => ['type' => 'text', 'access' => ['read' => ['role' => 'admin']]]]],
    ], 'globals' => ['scope' => ['label' => 'scope', 'agents' => true, 'fields' => ['name' => ['type' => 'text', 'default' => ['fn' => 'scoped__default']]], 'access' => ['read' => ['fn' => 'scoped__rule'], 'update' => ['fn' => 'scoped__rule']],
        'wp' => ['postId' => 'sp_global_scope', 'menuSlug' => 'spacepress-global-scope', 'groupKey' => 'group_sp_global_scope', 'fieldKeyPrefix' => 'field_sp_global_scope_', 'optionPrefix' => 'sp_global_scope_']]]]);
    \SpacePress\Wp\Scf::register($schema);
    $wp->exec('CREATE TABLE {prefix}sp_scoped_people (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `name` LONGTEXT NOT NULL, `ssn` LONGTEXT, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $store = \SpacePress\Wp\CompositeStore::create($schema, $wp->connection());
    $db = new \SpacePress\Db($store, $schema, \SpacePress\db()->media());
    $db->insert('people', ['name' => 'p', 'ssn' => '123-45-6789']);
    eq('field rules of a second Db apply to it', array_key_exists('ssn', $db->findFirst('people', [], new \SpacePress\Viewer(null))), false);
    eq('… and its trusted reads see the column', $db->findFirst('people')['ssn'], '123-45-6789');
    $viewer = new \SpacePress\Viewer(['id' => 1, 'role' => 'admin']);
    eq('direct permission rules query the secondary schema', [$db->permits('people', 'read', 1, $viewer), $db->permittedKeys('people', 'update', $viewer)], [true, null]);
    $revisions = $db->revisions('people', 1, $viewer);
    eq('revision authorization queries the secondary schema', count($revisions), 1);
    eq('revision restore authorization keeps the secondary schema', $db->restoreRevision('people', 1, $revisions[0]['id'], $viewer)['name'], 'p');
    \SpacePress\Extensions::beforeRead(static function (string $collection, array &$opts): void {
        if ($collection === 'people' && !\SpacePress\db()->schema()->hasCollection('people')) {
            throw new \RuntimeException('wrong query Db');
        }
    }, constraintSafe: true);
    eq('editor captures dispatch query extensions in their own Db', $db->editorRow('people', 1)['name'], 'p');
    eq('global rules and default generators use the secondary schema', $db->globalGet('scope', $viewer)['name'], 'secondary');
    eq('global update authorization uses the secondary schema', $db->globalUpdate('scope', ['name' => 'saved'], $viewer)['name'], 'saved');
    $shared = new \SpacePress\Db($store, new \SpacePress\Schema(['version' => 5, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => []]), $db->media());
    $committed = [];
    $shared->transaction(function () use ($db, &$committed): void {
        $db->transaction(function () use ($db, &$committed): void {
            \SpacePress\Extensions::afterCommit(function () use (&$committed): void {
                $committed[] = \SpacePress\db()->schema()->hasCollection('people');
            });
        });
        eq('a secondary Db callback waits for the shared outer commit', $committed, []);
    });
    eq('deferred callbacks retain the registering Db', $committed, [true]);
    eq('the booted app\'s db() is back afterwards', \SpacePress\db()->schema()->hasCollection('profiles'), true);
})();

// ================================================================ self-referencing and cyclic cascades (#524)

(static function () use ($wp): void {
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
    $open = ['read' => ['role' => 'anyone'], 'create' => ['role' => 'anyone'], 'update' => ['role' => 'anyone'], 'delete' => ['role' => 'anyone']];
    $before = [];
    $after = [];
    $schema = new \SpacePress\Schema([
        'name' => 'cycles',
        'collections' => [
            'nodes' => [
                'primaryKey' => 'id',
                'editor' => false,
                'access' => $open,
                'hooks' => [
                    'beforeDelete' => static function (array $row) use (&$before): void {
                        $before[] = $row['id'];
                    },
                    'afterDelete' => static function (array $row) use (&$after): void {
                        $after[] = $row['id'];
                    },
                ],
                'columns' => [
                    'id' => $id,
                    'label' => ['type' => 'text', 'notNull' => true],
                    'parentId' => ['type' => 'integer', 'references' => ['collection' => 'nodes', 'column' => 'id', 'onDelete' => 'cascade']],
                ],
            ],
        ],
    ]);
    $wp->exec('CREATE TABLE {prefix}sp_nodes (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `label` LONGTEXT NOT NULL, `parentId` BIGINT UNSIGNED NULL, PRIMARY KEY (`id`), CONSTRAINT `sp_nodes_parentId_fk` FOREIGN KEY (`parentId`) REFERENCES {prefix}sp_nodes (`id`) ON DELETE CASCADE) ENGINE=InnoDB');
    $store = \SpacePress\Wp\CompositeStore::create($schema, $wp->connection());
    $cycleDb = new \SpacePress\Db($store, $schema, \SpacePress\db()->media());
    $viewer = new \SpacePress\Viewer(['id' => 1, 'name' => 'owner', 'role' => 'subscriber']);
    $previous = \SpacePress\Db::instance();
    \SpacePress\Db::setInstance($cycleDb);
    try {
        // Self-referencing row: deleted once, hooks run once each, no hook_recursion.
        $self = $cycleDb->insert('nodes', ['label' => 'self'], true)[0];
        $cycleDb->update('nodes', ['parentId' => $self['id']], ['id' => $self['id']]);
        $cycleDb->delete('nodes', ['id' => $self['id']], false, $viewer);
        eq('self-referencing cascade deletes the row once and runs hooks once', [
            $cycleDb->findMany('nodes'),
            $before,
            $after,
        ], [[], [$self['id']], [$self['id']]]);

        // Both roots of a two-row cycle are selected. The cascade must not repeat a root's hooks.
        $before = [];
        $after = [];
        [$a, $b] = $cycleDb->insert('nodes', [['label' => 'a'], ['label' => 'b']], true);
        $cycleDb->update('nodes', ['parentId' => $b['id']], ['id' => $a['id']]);
        $cycleDb->update('nodes', ['parentId' => $a['id']], ['id' => $b['id']]);
        $cycleDb->delete('nodes', ['id' => ['in' => [$a['id'], $b['id']]]], false, $viewer);
        eq('two-row cascade cycle deletes both rows once and runs hooks once per row', [
            $cycleDb->findMany('nodes'),
            $before,
            $after,
        ], [[], [$a['id'], $b['id']], [$b['id'], $a['id']]]);
    } finally {
        \SpacePress\Db::setInstance($previous);
    }
})();

// ================================================================ write errors don't reveal what the viewer can't read

// A unique conflict or a dangling reference is an answer about stored rows. Writes may only get one
// about rows the viewer could read anyway (review: field-unique-oracle, ref-existence-oracle).
(static function (): void {
    $wp = $GLOBALS['wp'];
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
    $anyone = ['role' => 'anyone'];
    $table = static fn (string $name, array $access, array $columns): array => ['primaryKey' => 'id', 'editor' => false, 'table' => "sp_$name", 'access' => $access, 'columns' => ['id' => $id] + $columns];
    $schema = new \SpacePress\Schema(['version' => 5, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => [
        // Anyone signs up; only admins see who did.
        'subscribers' => $table('subscribers', ['read' => ['role' => 'admin'], 'create' => $anyone],
            ['email' => ['type' => 'text', 'notNull' => true, 'unique' => true], 'note' => ['type' => 'text', 'default' => ['value' => 'welcome']]]),
        // Anyone reads people; the ssn column is admin-only.
        'people' => $table('people', ['read' => $anyone, 'create' => $anyone, 'update' => $anyone],
            ['name' => ['type' => 'text', 'notNull' => true], 'ssn' => ['type' => 'text', 'unique' => true, 'access' => ['read' => ['role' => 'admin'], 'update' => $anyone]]]),
        // Notes are editor-readable; private tags may point at a note.
        'notes' => $table('notes', ['read' => ['role' => 'editor'], 'create' => $anyone, 'delete' => $anyone],
            ['body' => ['type' => 'text', 'notNull' => true]]),
        'tags' => $table('tags', ['read' => ['role' => 'admin'], 'create' => $anyone, 'update' => $anyone],
            ['name' => ['type' => 'text', 'notNull' => true], 'noteId' => ['type' => 'integer', 'references' => ['collection' => 'notes', 'column' => 'id']]]),
        // A reference to a unique key that isn't `id`: only 0.3.0 captures still declare one
        // (docs/decisions/2026-11-11-authoring-surface.md, rulings 21 and 22). `badge` is admin-only.
        'badges' => $table('badges', ['read' => $anyone, 'create' => $anyone, 'update' => $anyone, 'delete' => $anyone],
            ['code' => ['type' => 'integer', 'unique' => true], 'badge' => ['type' => 'integer', 'unique' => true, 'access' => ['read' => ['role' => 'admin'], 'update' => $anyone]]]),
        'holders' => $table('holders', ['read' => ['role' => 'admin'], 'create' => $anyone, 'update' => $anyone],
            ['code' => ['type' => 'integer', 'references' => ['collection' => 'badges', 'column' => 'code']],
             'badge' => ['type' => 'integer', 'references' => ['collection' => 'badges', 'column' => 'badge']]]),
    ]]);
    $wp->exec('CREATE TABLE {prefix}sp_subscribers (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `email` VARCHAR(191) NOT NULL, `note` LONGTEXT, PRIMARY KEY (`id`), UNIQUE KEY `email_unique` (`email`)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_people (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `name` LONGTEXT NOT NULL, `ssn` VARCHAR(191), PRIMARY KEY (`id`), UNIQUE KEY `ssn_unique` (`ssn`)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_notes (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `body` LONGTEXT NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_tags (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `name` LONGTEXT NOT NULL, `noteId` BIGINT UNSIGNED, PRIMARY KEY (`id`), CONSTRAINT `sp_tags_noteId_fk` FOREIGN KEY (`noteId`) REFERENCES {prefix}sp_notes (`id`)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_badges (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `code` BIGINT, `badge` BIGINT, PRIMARY KEY (`id`), UNIQUE KEY `code_unique` (`code`), UNIQUE KEY `badge_unique` (`badge`)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_holders (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `code` BIGINT, `badge` BIGINT, PRIMARY KEY (`id`), CONSTRAINT `sp_holders_code_fk` FOREIGN KEY (`code`) REFERENCES {prefix}sp_badges (`code`), CONSTRAINT `sp_holders_badge_fk` FOREIGN KEY (`badge`) REFERENCES {prefix}sp_badges (`badge`)) ENGINE=InnoDB');
    $store = \SpacePress\Wp\CompositeStore::create($schema, $wp->connection());
    $db = new \SpacePress\Db($store, $schema, \SpacePress\db()->media());
    $previous = \SpacePress\Db::instance();
    \SpacePress\Db::setInstance($db); // registered extensions read the active Db's schema
    $anon = new \SpacePress\Viewer(null);
    $sub = new \SpacePress\Viewer(['id' => 5, 'name' => 'sub', 'role' => 'subscriber']);
    $admin = new \SpacePress\Viewer(['id' => 2, 'name' => 'root', 'role' => 'admin']);
    $editor = new \SpacePress\Viewer(['id' => 3, 'name' => 'ed', 'role' => 'editor']);
    $count = static fn (string $c) => (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}sp_$c");
    try {
        // Unique writes require visibility across the collection, before any value is looked up.
        $db->insert('subscribers', ['email' => 'a@x.test'], true, $admin);
        problem('a private unique value is refused when taken', fn () => $db->insert('subscribers', ['email' => 'a@x.test'], true, $anon), 401, 'unauthenticated', '/email');
        problem('a private unique value is refused when free', fn () => $db->insert('subscribers', ['email' => 'b@x.test'], true, $anon), 401, 'unauthenticated', '/email');
        eq('rejected creates persist nothing', $count('subscribers'), 1);
        problem('readers retain normal unique conflicts', fn () => $db->insert('subscribers', ['email' => 'a@x.test'], true, $admin), 409, 'unique_violation', '/email');

        // A unique column the viewer can't read: refused before any lookup, whatever the value.
        $person = $db->insert('people', ['name' => 'p', 'ssn' => '123-45-6789'], true)[0];
        problem('setting a hidden unique column is refused when the value exists…', fn () => $db->insert('people', ['name' => 'q', 'ssn' => '123-45-6789'], true, $anon), 401, 'unauthenticated', '/ssn');
        problem('… and the same when it doesn\'t', fn () => $db->insert('people', ['name' => 'q', 'ssn' => '000-00-0000'], true, $anon), 401, 'unauthenticated', '/ssn');
        problem('a write-only unique value cannot be tested through an update', fn () => $db->update('people', ['ssn' => '123-45-6789'], ['id' => $person['id']], true, $sub), 403, 'forbidden', '/ssn');
        problem('a free write-only unique value is equally refused', fn () => $db->update('people', ['ssn' => '000-00-0000'], ['id' => $person['id']], true, $sub), 403, 'forbidden', '/ssn');
        eq('a create that leaves it out is fine', $db->insert('people', ['name' => 'r'], true, $anon)[0]['name'], 'r');
        eq('an admin sets it', $db->insert('people', ['name' => 's', 'ssn' => '111-11-1111'], true, $admin)[0]['ssn'], '111-11-1111');

        // A reference must name a row the viewer may read: unreadable and missing answer alike.
        $note = $db->insert('notes', ['body' => 'private'], true)[0];
        $missing = $note['id'] + 100;
        $failure = static function (callable $write): array {
            try {
                $write();

                return ['status' => 200, 'code' => 'unexpected_success', 'pointer' => null, 'detail' => ''];
            } catch (\Throwable $e) {
                return \SpacePress\App::problem($e);
            }
        };
        foreach ([$note['id'], $missing] as $value) {
            $error = $failure(fn () => $db->insert('tags', ['name' => 't', 'noteId' => $value], true, $sub));
            eq('unreadable and absent references answer identically',
                [$error['status'], $error['code'], $error['pointer'], $error['detail']],
                [409, 'reference_violation', '/noteId', 'No referenced notes row for noteId']);
        }
        $tag = $db->insert('tags', ['name' => 'u'], true, $sub)[0];
        problem('updates are held to it too', fn () => $db->update('tags', ['noteId' => $note['id']], ['id' => $tag['id']], true, $sub), 409, 'reference_violation', '/noteId');
        eq('a viewer who can read the target references it', $db->insert('tags', ['name' => 'v', 'noteId' => $note['id']], true, $admin)[0]['noteId'], $note['id']);
        // Deletes look at the rows that reference this row only
        // (docs/decisions/2026-11-16-per-row-delete-visibility.md).
        $unreferenced = $db->insert('notes', ['body' => 'no children'], true)[0];
        $where = ['noteId' => $note['id']];
        $mysqlStore = new \SpacePress\Wp\CompositeStore($schema, $store->db, $store->posts,
            new \SpacePress\Wp\WpTableStore($store->db, $schema, \SpacePress\Dialect::mysql()));
        $mysqlDb = new \SpacePress\Db($mysqlStore, $schema, $db->media());
        $inner = 'SELECT t0.`id` AS `id` FROM `' . $store->db->prefix() . 'sp_tags` t0 WHERE t0.`noteId` = ?';
        eq('MySQL locks the rows counted by delete preflight', $mysqlDb->countQuery('tags', $where, forUpdate: true), [
            'sql' => "SELECT COUNT(*) AS n FROM ($inner FOR UPDATE) first_count", 'params' => [$note['id']],
        ]);
        $statements = [];
        \SpacePress\Wp\Connection::$observer = static function (string $sql) use (&$statements): void { $statements[] = $sql; };
        try {
            problem('a hidden referencing row refuses the delete', fn () => $db->delete('notes', ['id' => $note['id']], true, $editor), 409, 'reference_violation');
        } finally {
            \SpacePress\Wp\Connection::$observer = null;
        }
        check('SQLite delete preflight runs the count without a lock clause', in_array("SELECT COUNT(*) AS n FROM ($inner) first_count", $statements, true), $statements);
        eq('the refused delete keeps the parent', $count('notes'), 2);
        $db->insert('tags', ['name' => 'second hidden', 'noteId' => $note['id']], true);
        $one = $failure(fn () => $db->delete('notes', ['id' => $note['id']], true, $editor));
        $db->insert('tags', ['name' => 'third hidden', 'noteId' => $note['id']], true);
        eq('one or many hidden rows answer the same body', $failure(fn () => $db->delete('notes', ['id' => $note['id']], true, $editor)), $one);
        eq('the generic body names no row', [$one['status'], $one['code'], $one['pointer'] ?? null, $one['detail']], [409, 'reference_violation', null, "Rows you can't read may reference this row"]);
        eq('a row nothing references deletes', $db->delete('notes', ['id' => $unreferenced['id']], true, $editor)[0]['id'], $unreferenced['id']);
        eq('trusted writes (hooks, CLI) check existence only', $db->insert('tags', ['name' => 'w', 'noteId' => $note['id']], true)[0]['noteId'], $note['id']);
        eq('hidden referencing rows are untouched by refused deletes', (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}sp_tags WHERE noteId = {$note['id']}"), 4);

        // References to a key other than `id` (0.3.0 captures only).
        [$b1, $b2] = $db->insert('badges', [['code' => 701001, 'badge' => 889001], ['code' => 701002, 'badge' => 889002]], true);
        eq('a reference to a non-id unique key links by that key', $db->insert('holders', ['code' => 701001], true, $admin)[0]['code'], 701001);
        problem('a missing non-id key is a reference violation', fn () => $db->insert('holders', ['code' => 709999], true, $anon), 409, 'reference_violation', '/code');
        foreach ([889001, 889999] as $badge) {
            problem('a key the viewer can\'t read refuses alike whether it exists or not', fn () => $db->insert('holders', ['badge' => $badge], true, $anon), 409, 'reference_violation', '/badge');
        }
        eq('readers of the key link by it', $db->insert('holders', ['badge' => 889002], true, $admin)[0]['badge'], 889002);
        // Holders are admin-only: an editor can't tell referenced keys from free ones, so neither changes.
        $db->update('holders', ['code' => null], ['code' => 701001], true);
        foreach ([$b1, $b2] as $parent) {
            problem('changing a referenced non-id key is refused, children or not', fn () => $db->update('badges', ['code' => $parent['code'] + 10], ['id' => $parent['id']], true, $editor), 409, 'reference_violation');
        }
        eq('refused key changes keep both keys', array_column($db->findMany('badges', ['orderBy' => ['id' => 'asc']]), 'code'), [701001, 701002]);
        // A delete can't tell whether a referenced key the viewer can't read is null: `badge` is
        // admin-only, so deleting a badge refuses alike whether it holds one or not, before any count.
        [$nullBadge, $setBadge] = $db->insert('badges', [['code' => 701003, 'badge' => null], ['code' => 701004, 'badge' => 889004]], true);
        $answers = [];
        foreach ([$nullBadge, $setBadge] as $parent) {
            $answers[] = $failure(fn () => $db->delete('badges', ['id' => $parent['id']], true, $anon));
        }
        eq('a hidden referenced key refuses the delete whether it is null or not', $answers[0], $answers[1]);
        eq('… with the one body', [$answers[0]['status'], $answers[0]['code'], $answers[0]['detail']], [409, 'reference_violation', "Rows you can't read may reference this row"]);
        eq('a reader of the key deletes the badge whose key is null', $db->delete('badges', ['id' => $nullBadge['id']], true, $admin)[0]['id'], $nullBadge['id']);
    } finally {
        \SpacePress\Db::setInstance($previous);
    }
})();

// Owner-scoped apps (examples/pet-food, stuff-drawer, subscriptions, drive-locker): every table reads
// `{ ownerId: user.id }`. A delete checks only the rows that reference this row: an owner deletes
// their own rows and applies onDelete to their own children; another owner's row pointing here (which
// an app hook should prevent, but the database allows) refuses with the generic 409, untouched.
(static function (): void {
    $wp = $GLOBALS['wp'];
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
    $owned = ['fn' => static fn (array $ctx) => $ctx['user'] === null ? false : ['ownerId' => $ctx['user']['id']]];
    $access = ['read' => $owned, 'create' => ['role' => 'authenticated'], 'update' => $owned, 'delete' => $owned];
    $owner = ['ownerId' => ['type' => 'integer', 'notNull' => true]];
    $table = static fn (string $name, array $columns): array => ['primaryKey' => 'id', 'editor' => false, 'table' => "sp_$name", 'access' => $access, 'columns' => ['id' => $id] + $owner + $columns];
    $ref = static fn (string $to, string $onDelete, bool $notNull = true): array => ['type' => 'integer', 'notNull' => $notNull, 'references' => ['collection' => $to, 'column' => 'id', 'onDelete' => $onDelete]];
    $schema = new \SpacePress\Schema(['version' => 3, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => [
        'bins' => $table('bins', []),
        'things' => $table('things', ['binId' => $ref('bins', 'set null', false)]),
        'loans' => $table('loans', ['thingId' => $ref('things', 'restrict')]),
        'charges' => $table('charges', ['thingId' => $ref('things', 'cascade')]),
        'receipts' => $table('receipts', ['chargeId' => $ref('charges', 'cascade')]),
    ]]);
    $fk = static fn (string $t, string $c, string $to, string $on): string => "CONSTRAINT `sp_{$t}_{$c}_fk` FOREIGN KEY (`$c`) REFERENCES {prefix}sp_$to (`id`) ON DELETE $on";
    $wp->exec('CREATE TABLE {prefix}sp_bins (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `ownerId` BIGINT NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_things (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `ownerId` BIGINT NOT NULL, `binId` BIGINT UNSIGNED, PRIMARY KEY (`id`), ' . $fk('things', 'binId', 'bins', 'SET NULL') . ') ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_loans (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `ownerId` BIGINT NOT NULL, `thingId` BIGINT UNSIGNED NOT NULL, PRIMARY KEY (`id`), ' . $fk('loans', 'thingId', 'things', 'RESTRICT') . ') ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_charges (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `ownerId` BIGINT NOT NULL, `thingId` BIGINT UNSIGNED NOT NULL, PRIMARY KEY (`id`), ' . $fk('charges', 'thingId', 'things', 'CASCADE') . ') ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_receipts (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `ownerId` BIGINT NOT NULL, `chargeId` BIGINT UNSIGNED NOT NULL, PRIMARY KEY (`id`), ' . $fk('receipts', 'chargeId', 'charges', 'CASCADE') . ') ENGINE=InnoDB');
    $store = \SpacePress\Wp\CompositeStore::create($schema, $wp->connection());
    $db = new \SpacePress\Db($store, $schema, \SpacePress\db()->media());
    $previous = \SpacePress\Db::instance();
    \SpacePress\Db::setInstance($db);
    $me = new \SpacePress\Viewer(['id' => 7, 'name' => 'me', 'role' => 'subscriber']);
    $other = 8;
    $count = static fn (string $t) => (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}sp_$t");
    $failure = static function (callable $write): array {
        try {
            $write();

            return ['status' => 200, 'code' => 'unexpected_success', 'pointer' => null, 'detail' => ''];
        } catch (\Throwable $e) {
            return \SpacePress\App::problem($e);
        }
    };
    $insert = static fn (string $t, array $row) => $db->insert($t, $row, true)[0];
    try {
        $empty = $insert('bins', ['ownerId' => 7]);
        eq('an owner deletes an empty parent of an owner-filtered table', $db->delete('bins', ['id' => $empty['id']], true, $me)[0]['id'], $empty['id']);

        $bin = $insert('bins', ['ownerId' => 7]);
        $thing = $insert('things', ['ownerId' => 7, 'binId' => $bin['id']]);
        $db->delete('bins', ['id' => $bin['id']], false, $me);
        eq('set null applies to the owner\'s own children', $db->findFirst('things', ['where' => ['id' => $thing['id']]])['binId'], null);

        $charge = $insert('charges', ['ownerId' => 7, 'thingId' => $thing['id']]);
        $insert('receipts', ['ownerId' => 7, 'chargeId' => $charge['id']]);
        $loan = $insert('loans', ['ownerId' => 7, 'thingId' => $thing['id']]);
        problem('restrict still refuses on visible rows', fn () => $db->delete('things', ['id' => $thing['id']], true, $me), 409, 'reference_violation');
        $db->delete('loans', ['id' => $loan['id']], false, $me);
        $db->delete('things', ['id' => $thing['id']], false, $me);
        eq('cascade removes the owner\'s own children and grandchildren', [$count('things'), $count('charges'), $count('receipts')], [0, 0, 0]);

        // Another owner's rows point at mine: refused alike at any depth, nothing written or read back.
        $mine = $insert('things', ['ownerId' => 7]);
        $theirs = $insert('loans', ['ownerId' => $other, 'thingId' => $mine['id']]);
        $direct = $failure(fn () => $db->delete('things', ['id' => $mine['id']], true, $me));
        eq('a hidden restrict child refuses with the generic body', [$direct['status'], $direct['code'], $direct['detail']], [409, 'reference_violation', "Rows you can't read may reference this row"]);
        $db->delete('loans', ['id' => $theirs['id']], false);
        $myCharge = $insert('charges', ['ownerId' => 7, 'thingId' => $mine['id']]);
        $insert('receipts', ['ownerId' => $other, 'chargeId' => $myCharge['id']]);
        $deep = $failure(fn () => $db->delete('things', ['id' => $mine['id']], true, $me));
        eq('a hidden grandchild under a visible cascade refuses the whole delete, with the same body: no table or depth', $deep, $direct);
        eq('the refused cascade rolled back nothing it should keep', [$count('things'), $count('charges'), $count('receipts')], [1, 1, 1]);
        $theirBin = $insert('bins', ['ownerId' => $other]);
        $insert('things', ['ownerId' => 7, 'binId' => $theirBin['id']]);
        eq('another owner\'s parent is not selected by my delete', $db->delete('bins', ['id' => $theirBin['id']], true, $me), []);
        eq('so it stays', $count('bins'), 1);
    } finally {
        \SpacePress\Db::setInstance($previous);
    }
})();

// A referential write is the viewer's own: cascade needs their delete rule on every child, set null
// their update rule; a branch with no rows runs no generator.
(static function () use ($db): void {
    $wp = $GLOBALS['wp'];
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
    $any = ['role' => 'anyone'];
    $open = ['read' => $any, 'create' => $any, 'update' => $any, 'delete' => $any];
    $owned = ['fn' => static fn (array $ctx) => $ctx['user'] === null ? false : ['ownerId' => $ctx['user']['id']]];
    $table = static fn (string $name, array $cols, array $access): array => ['primaryKey' => 'id', 'editor' => false, 'table' => "sp_rw_$name", 'columns' => ['id' => $id] + $cols, 'access' => $access];
    $ref = static fn (string $to, string $on, array $extra = []): array => ['type' => 'integer', 'references' => ['collection' => $to, 'column' => 'id', 'onDelete' => $on]] + $extra;
    $schema = new \SpacePress\Schema(['version' => 3, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => [
        'rw_parents' => $table('parents', ['ownerId' => ['type' => 'integer']], ['read' => $owned, 'delete' => $owned] + $open),
        'rw_kids' => $table('kids', ['ownerId' => ['type' => 'integer'], 'parentId' => $ref('rw_parents', 'cascade')], ['read' => $owned, 'delete' => ['role' => 'admin']] + $open),
        'rw_refs' => $table('refs', ['ownerId' => ['type' => 'integer'], 'parentId' => $ref('rw_parents', 'set null')], ['read' => $owned, 'update' => ['role' => 'admin']] + $open),
        'rw_secret' => $table('secret', ['blocked' => ['type' => 'boolean']], ['read' => ['role' => 'admin']] + $open),
        'rw_defaults' => $table('defaults', ['parentId' => $ref('rw_parents', 'set default', ['default' => ['fn' => static function () {
            $GLOBALS['rw_generated'] = ($GLOBALS['rw_generated'] ?? 0) + 1;
            return null;
        }]])], $open),
    ]]);
    foreach (['parents' => 'ownerId BIGINT', 'kids' => 'ownerId BIGINT, parentId BIGINT', 'refs' => 'ownerId BIGINT, parentId BIGINT', 'secret' => 'blocked TINYINT', 'defaults' => 'parentId BIGINT'] as $name => $cols) {
        $wp->exec("CREATE TABLE {prefix}sp_rw_$name (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, $cols, PRIMARY KEY(id)) ENGINE=InnoDB");
    }
    $probe = new \SpacePress\Db(\SpacePress\Wp\CompositeStore::create($schema, $wp->connection()), $schema, $db->media());
    $previous = \SpacePress\Db::instance();
    \SpacePress\Db::setInstance($probe);
    $me = new \SpacePress\Viewer(['id' => 7, 'name' => 'me', 'role' => 'subscriber']);
    try {
        $parent = $probe->insert('rw_parents', ['ownerId' => 7], true)[0];
        $kid = $probe->insert('rw_kids', ['ownerId' => 7, 'parentId' => $parent['id']], true)[0];
        problem('a child the viewer may read but not delete', fn () => $probe->delete('rw_kids', ['id' => $kid['id']], false, $me), 403, 'forbidden');
        problem('… so its parent\'s cascade, that viewer\'s delete of it, refuses with the one body', fn () => $probe->delete('rw_parents', ['id' => $parent['id']], false, $me), 409, 'reference_violation');
        eq('… and both rows stay', [$probe->findFirst('rw_parents', ['where' => ['id' => $parent['id']]]) !== null, $probe->findFirst('rw_kids', ['where' => ['id' => $kid['id']]]) !== null], [true, true]);
        $probe->delete('rw_kids', ['id' => $kid['id']]);
        $ref = $probe->insert('rw_refs', ['ownerId' => 7, 'parentId' => $parent['id']], true)[0];
        problem('set null on a child the viewer may not update refuses', fn () => $probe->delete('rw_parents', ['id' => $parent['id']], false, $me), 409, 'reference_violation');
        eq('… and keeps its reference', $probe->findFirst('rw_refs', ['where' => ['id' => $ref['id']]])['parentId'], $parent['id']);
        $probe->delete('rw_refs', ['id' => $ref['id']]);
        $GLOBALS['rw_generated'] = 0;
        $probe->delete('rw_parents', ['id' => $parent['id']], false, $me);
        eq('a set default branch with no rows runs no generator', $GLOBALS['rw_generated'], 0);
    } finally {
        \SpacePress\Db::setInstance($previous);
        unset($GLOBALS['rw_generated']);
    }
})();

// Fourth review of #516: after the viewer's own writes nothing trusted runs, so a row or link a hook
// created or kept still refuses the delete; an app hook's JavaScript Error is the one refusal too.
(static function () use ($db, $wp): void {
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true];
    $any = ['role' => 'anyone'];
    $open = ['read' => $any, 'create' => $any, 'update' => $any, 'delete' => $any];
    $table = static fn ($name, $cols, $access = [], $hooks = []) => ['editor' => false, 'primaryKey' => 'id', 'table' => 'sp_q516_'.$name, 'columns' => ['id' => $id] + $cols, 'access' => $access + $open, 'hooks' => $hooks];
    $ref = ['type' => 'integer', 'references' => ['collection' => 'q516_parent', 'column' => 'id', 'onDelete' => 'set null']];
    $schema = new \SpacePress\Schema(['collections' => [
        'q516_parent' => $table('parent', ['name' => ['type' => 'text']]),
        // This branch is inspected before the trigger branch. A trusted app hook creates a new row later.
        'q516_protected' => $table('protected', ['parentId' => ['type' => 'integer', 'references' => ['collection' => 'q516_parent', 'column' => 'id', 'onDelete' => 'cascade']]], ['read' => ['role' => 'admin'], 'delete' => ['role' => 'admin']], ['beforeDelete' => static function (): void { $GLOBALS['q516_deleted']++; }]),
        'q516_trigger' => $table('trigger', ['parentId' => $ref], [], ['afterUpdate' => static function (array $row, array $previous): void {
            if ($previous['parentId'] !== null) {
                $GLOBALS['q516_new'] = \SpacePress\Db::instance()->insert('q516_protected', ['parentId' => $previous['parentId']], true)[0]['id'];
            }
        }]),
        'q516_error' => $table('error', ['parentId' => $ref, 'secret' => ['type' => 'text', 'access' => ['read' => ['role' => 'admin']]]], [], ['beforeUpdate' => static function (array $patch, array $existing): array { throw new \SpacePress\JsError('secret=' . $existing['secret']); }]),
        'q516_tag' => $table('tag', ['name' => ['type' => 'text']]),
        'q516_card' => $table('card', ['locked' => ['type' => 'boolean'], 'tags' => ['type' => 'refList', 'references' => ['collection' => 'q516_tag', 'column' => 'id', 'onDelete' => 'cascade', 'join' => 'q516_card_tags']]], ['update' => ['fn' => static fn () => ['locked' => false]]], ['beforeUpdate' => static function (array $patch, array $existing): array {
            $patch['locked'] = true;
            $patch['tags'] = $existing['tags']; // Keep mandatory assignment; direct updates can't remove it.
            return $patch;
        }]) + ['relations' => ['tags' => ['kind' => 'many', 'collection' => 'q516_tag', 'from' => 'id', 'to' => 'id', 'through' => ['table' => 'q516_card_tags', 'from' => 'owner_id', 'to' => 'target_id']]]],
    ]]);
    foreach (['parent' => 'name LONGTEXT', 'protected' => 'parentId BIGINT', 'trigger' => 'parentId BIGINT', 'error' => 'parentId BIGINT, secret LONGTEXT', 'tag' => 'name LONGTEXT', 'card' => 'locked TINYINT'] as $name => $cols) {
        $wp->exec("CREATE TABLE {prefix}sp_q516_$name (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, $cols, PRIMARY KEY(id)) ENGINE=InnoDB");
    }
    $wp->exec('CREATE TABLE {prefix}sp__join_q516_card_tags (owner_id BIGINT UNSIGNED NOT NULL, target_id BIGINT UNSIGNED NOT NULL, position INT NOT NULL, PRIMARY KEY(owner_id,target_id)) ENGINE=InnoDB');
    $probe = new \SpacePress\Db(\SpacePress\Wp\CompositeStore::create($schema, $wp->connection()), $schema, $db->media());
    $previous = \SpacePress\Db::instance();
    \SpacePress\Db::setInstance($probe);
    $viewer = new \SpacePress\Viewer(['id' => 7, 'role' => 'subscriber', 'name' => 'me']);
    try {
        $parent = $probe->insert('q516_parent', ['name' => 'root'], true)[0];
        $probe->insert('q516_trigger', ['parentId' => $parent['id']], true);
        $GLOBALS['q516_deleted'] = 0;
        problem('newly created protected cascade must refuse', fn () => $probe->delete('q516_parent', ['id' => $parent['id']], false, $viewer), 409, 'reference_violation');
        eq('no protected-row delete hook may run', $GLOBALS['q516_deleted'], 0);

        $tag = $probe->insert('q516_tag', ['name' => 'mandatory'], true)[0];
        $card = $probe->insert('q516_card', ['locked' => false, 'tags' => [$tag['id']]], true)[0];
        $control = $probe->insert('q516_card', ['locked' => false, 'tags' => [$tag['id']]], true)[0];
        $probe->update('q516_card', ['tags' => []], ['id' => $control['id']], false, $viewer);
        eq('direct unlink preserves assignment', $probe->findFirst('q516_card', ['where' => ['id' => $control['id']]])['tags'], [$tag['id']]);
        // Remove control from this scenario using a trusted write so it cannot itself block deletion.
        $probe->delete('q516_card', ['id' => $control['id']]);
        problem('preserved mandatory link must refuse parent deletion', fn () => $probe->delete('q516_tag', ['id' => $tag['id']], false, $viewer), 409, 'reference_violation');
        $after = $probe->findFirst('q516_card', ['where' => ['id' => $card['id']]]);
        eq('viewer delete must preserve mandatory link', $after['tags'], [$tag['id']]);
        foreach (['alpha', 'beta'] as $secret) {
            $parent = $probe->insert('q516_parent', ['name' => 'error parent'], true)[0];
            $probe->insert('q516_error', ['parentId' => $parent['id'], 'secret' => $secret], true);
            $e = problem('a child hook\'s JavaScript Error is the one refusal', fn () => $probe->delete('q516_parent', ['id' => $parent['id']], false, $viewer), 409, 'reference_violation');
            eq('… and its message, which holds a hidden value, is not passed on', \SpacePress\App::problem($e)['detail'], "Rows you can't read may reference this row");
        }
    } finally { \SpacePress\Db::setInstance($previous); }
})();

// Third review of #516: delete side effects are the viewer's own writes, so a data-dependent update
// rule, a field update rule, a link owner's update rule and an extension-written value all hold.
(static function () use ($db): void {
    $wp = $GLOBALS['wp'];
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
    $any = ['role' => 'anyone'];
    $open = ['read' => $any, 'create' => $any, 'update' => $any, 'delete' => $any];
    $table = static fn (string $name, array $cols, array $access = [], array $hooks = []): array => ['primaryKey' => 'id', 'editor' => false, 'table' => "sp_rv_$name", 'columns' => ['id' => $id] + $cols, 'access' => $access + $open, 'hooks' => $hooks];
    $ref = ['type' => 'integer', 'references' => ['collection' => 'rv_parents', 'column' => 'id', 'onDelete' => 'set null']];
    $owned = ['fn' => static fn (array $ctx) => ['ownerId' => 7]];
    $schema = new \SpacePress\Schema(['version' => 3, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => [
        'rv_parents' => $table('parents', ['ownerId' => ['type' => 'integer']], ['read' => $owned]),
        'rv_data' => $table('data', ['parentId' => $ref], ['update' => ['fn' => static fn (array $ctx) => $ctx['data'] === null || !array_key_exists('parentId', $ctx['data'])]]),
        'rv_field' => $table('field', ['parentId' => $ref + ['access' => ['update' => ['role' => 'admin']]]]),
        'rv_tags' => $table('tags', ['name' => ['type' => 'text']]),
        'rv_cards' => $table('cards', ['name' => ['type' => 'text'], 'tags' => ['type' => 'refList', 'references' => ['collection' => 'rv_tags', 'column' => 'id', 'onDelete' => 'cascade', 'join' => 'rv_cards_tags']]], ['update' => ['role' => 'admin']]) + ['relations' => ['tags' => ['kind' => 'many', 'collection' => 'rv_tags', 'from' => 'id', 'to' => 'id', 'through' => ['table' => 'rv_cards_tags', 'from' => 'owner_id', 'to' => 'target_id']]]],
        'rv_extension' => $table('extension', ['parentId' => $ref, 'backupId' => ['type' => 'integer', 'access' => ['read' => ['role' => 'admin']]]]),
    ]]);
    foreach (['parents' => 'ownerId BIGINT', 'data' => 'parentId BIGINT', 'field' => 'parentId BIGINT', 'tags' => 'name LONGTEXT', 'cards' => 'name LONGTEXT', 'extension' => 'parentId BIGINT, backupId BIGINT'] as $name => $cols) {
        $wp->exec("CREATE TABLE {prefix}sp_rv_$name (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, " . ($cols === '' ? '' : "$cols, ") . 'PRIMARY KEY(id)) ENGINE=InnoDB');
    }
    $wp->exec('CREATE TABLE {prefix}sp__join_rv_cards_tags (owner_id BIGINT UNSIGNED NOT NULL, target_id BIGINT UNSIGNED NOT NULL, position INT NOT NULL, PRIMARY KEY(owner_id,target_id)) ENGINE=InnoDB');
    $probe = new \SpacePress\Db(\SpacePress\Wp\CompositeStore::create($schema, $wp->connection()), $schema, $db->media());
    $previous = \SpacePress\Db::instance();
    \SpacePress\Db::setInstance($probe);
    $me = new \SpacePress\Viewer(['id' => 7, 'name' => 'me', 'role' => 'subscriber']);
    $answer = static function (callable $write): array {
        try { $write(); return ['status' => 200]; }
        catch (\Throwable $e) { return \SpacePress\App::problem($e); }
    };
    try {
        $parent = $probe->insert('rv_parents', ['ownerId' => 7], true)[0];
        $kid = $probe->insert('rv_data', ['parentId' => $parent['id']], true)[0];
        problem('direct set-null is denied by the data-dependent update rule', fn () => $probe->update('rv_data', ['parentId' => null], ['id' => $kid['id']], false, $me), 403, 'forbidden');
        $deleted = $answer(fn () => $probe->delete('rv_parents', ['id' => $parent['id']], false, $me));
        $value = $probe->findFirst('rv_data', ['where' => ['id' => $kid['id']]])['parentId'];
        eq('deleting parent must enforce actual patch in child update rule', [$deleted['status'], $value], [409, $parent['id']]);

        $parent = $probe->insert('rv_parents', ['ownerId' => 7], true)[0];
        $kid = $probe->insert('rv_field', ['parentId' => $parent['id']], true)[0];
        problem('direct set-null is denied by field update rule', fn () => $probe->update('rv_field', ['parentId' => null], ['id' => $kid['id']], false, $me), 403, 'forbidden', '/parentId');
        $deleted = $answer(fn () => $probe->delete('rv_parents', ['id' => $parent['id']], false, $me));
        $value = $probe->findFirst('rv_field', ['where' => ['id' => $kid['id']]])['parentId'];
        eq('deleting parent must enforce child field update rule', [$deleted['status'], $value], [409, $parent['id']]);

        $tag = $probe->insert('rv_tags', ['name' => 'review'], true)[0];
        $card = $probe->insert('rv_cards', ['name' => 'review', 'tags' => [$tag['id']]], true)[0];
        problem('direct unlink is denied by owner row update rule', fn () => $probe->update('rv_cards', ['tags' => []], ['id' => $card['id']], false, $me), 403, 'forbidden');
        $deleted = $answer(fn () => $probe->delete('rv_tags', ['id' => $tag['id']], false, $me));
        $links = $probe->findFirst('rv_cards', ['where' => ['id' => $card['id']]])['tags'];
        eq('deleting target must enforce link owner update rule', [$deleted['status'], $links], [409, [$tag['id']]]);

        \SpacePress\Extensions::onWrite(static function (string $op, string $collection, array &$patch, ?array $existing): void {
            if ($op === 'update' && $collection === 'rv_extension') {
                $GLOBALS['rv_write_runs'] = ($GLOBALS['rv_write_runs'] ?? 0) + 1;
                $patch['parentId'] = $existing['backupId'];
            }
        });
        \SpacePress\Extensions::onWritten(static function (string $op, string $collection): void {
            if ($op === 'update' && $collection === 'rv_extension') { $GLOBALS['rv_written_runs'] = ($GLOBALS['rv_written_runs'] ?? 0) + 1; }
        });
        $hiddenParent = $probe->insert('rv_parents', ['ownerId' => 8], true)[0];
        $answers = [];
        foreach ([null, $hiddenParent['id']] as $backup) {
            $parent = $probe->insert('rv_parents', ['ownerId' => 7], true)[0];
            $probe->insert('rv_extension', ['parentId' => $parent['id'], 'backupId' => $backup], true);
            $GLOBALS['rv_write_runs'] = $GLOBALS['rv_written_runs'] = 0;
            $answers[] = [$answer(fn () => $probe->delete('rv_parents', ['id' => $parent['id']], false, $me)), $GLOBALS['rv_write_runs'], $GLOBALS['rv_written_runs']];
        }
        // An extension that writes a hidden value into a reference discloses it on a direct update too;
        // the delete's set null is that same update, with the same listeners, refused with the one body.
        eq('an extension-written reference answers as the viewer\'s own update does, with the same listeners', [$answers[0][0]['status'], $answers[0][2], $answers[1][0]['status'], $answers[1][0]['detail'] ?? null, $answers[1][2]], [200, 1, 409, "Rows you can't read may reference this row", 0]);
    } finally { \SpacePress\Db::setInstance($previous); }
})();


// A hidden nondefault-locale child refuses before any hook; a visible one cascades and runs its hook.
(static function () use ($db): void {
    $wp = $GLOBALS['wp'];
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true];
    $any = ['role' => 'anyone'];
    $open = ['read' => $any, 'create' => $any, 'update' => $any, 'delete' => $any];
    $schema = new \SpacePress\Schema(['locales' => ['default' => 'en', 'all' => ['en', 'fr'], 'fallback' => true], 'collections' => [
        'rv_lparent' => ['editor' => false, 'primaryKey' => 'id', 'table' => 'sp_rv_lparent', 'columns' => ['id' => $id, 'name' => ['type' => 'text']], 'access' => $open],
        'rv_lchild' => ['editor' => false, 'localized' => true, 'primaryKey' => 'id', 'table' => 'sp_rv_lchild', 'columns' => [
            'id' => $id, 'ownerId' => ['type' => 'integer'], 'locale' => ['type' => 'text', 'system' => true],
            'translationGroup' => ['type' => 'text', 'system' => true, 'hidden' => true],
            'translations' => ['type' => 'json', 'system' => true, 'derived' => true],
            'parentId' => ['type' => 'integer', 'references' => ['collection' => 'rv_lparent', 'column' => 'id', 'onDelete' => 'cascade']]],
            'access' => ['read' => ['fn' => static fn () => ['ownerId' => 7]]] + $open,
            'hooks' => ['beforeDelete' => static function (): void { $GLOBALS['rv_child_before']++; }]],
    ]]);
    $wp->exec('CREATE TABLE {prefix}sp_rv_lparent (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, name LONGTEXT, PRIMARY KEY(id)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_rv_lchild (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ownerId BIGINT, locale LONGTEXT, translationGroup LONGTEXT, parentId BIGINT, PRIMARY KEY(id)) ENGINE=InnoDB');
    $probe = new \SpacePress\Db(\SpacePress\Wp\CompositeStore::create($schema, $wp->connection()), $schema, $db->media());
    $viewer = new \SpacePress\Viewer(['id' => 7, 'name' => 'me', 'role' => 'subscriber']);
    $parent = $probe->insert('rv_lparent', ['name' => 'localized control'], true)[0];
    $wp->connection()->run('INSERT INTO wp_sp_rv_lchild (ownerId, locale, parentId) VALUES (8, ?, ?)', ['fr', $parent['id']]);
    $GLOBALS['rv_child_before'] = 0;
    problem('hidden nondefault-locale cascade child refuses', fn () => $probe->delete('rv_lparent', ['id' => $parent['id']], false, $viewer), 409, 'reference_violation');
    eq('no hidden child beforeDelete hook ran', $GLOBALS['rv_child_before'], 0);
    $wp->connection()->run('UPDATE wp_sp_rv_lchild SET ownerId = 7 WHERE parentId = ?', [$parent['id']]);
    $probe->delete('rv_lparent', ['id' => $parent['id']], false, $viewer);
    eq('visible nondefault-locale cascade runs its hook', $GLOBALS['rv_child_before'], 1);
    eq('visible nondefault-locale cascade removes child', $probe->findMany('rv_lchild'), []);
})();

// ================================================================ Slice 2: Soft deletes, retention, strict undefined filters, system fields
(static function (): void {
    $wp = $GLOBALS['wp'];
    $now = ['now' => true];
    $purgedLog = [];
    $restoredLog = [];
    $sdSchema = new \SpacePress\Schema([
        'version' => 5,
        'runtime' => \SpacePress\Schema::SERIES,
        'retention' => ['deletedSeconds' => 86400, 'revisions' => null],
        'collections' => [
            'sd_parents' => [
                'primaryKey' => 'id', 'editor' => false, 'softDelete' => true, 'table' => 'sp_sd_parents',
                'access' => ['read' => ['role' => 'anyone'], 'create' => ['role' => 'editor'], 'update' => ['role' => 'editor'], 'delete' => ['role' => 'editor']],
                'hooks' => [
                    'afterRestore' => static function (array $row) use (&$restoredLog): void { $restoredLog[] = $row['email']; },
                    'afterPurge' => static function (array $row) use (&$purgedLog): void { $purgedLog[] = $row['email']; },
                ],
                'columns' => [
                    'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                    'email' => ['type' => 'email', 'notNull' => true, 'unique' => true],
                    'bio' => ['type' => 'text'],
                    'author' => ['type' => 'integer', 'readOnly' => true, 'system' => true],
                    'createdAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => $now, 'readOnly' => true, 'system' => true],
                    'updatedAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => $now, 'onUpdate' => $now, 'readOnly' => true, 'system' => true],
                    'deletedAt' => ['type' => 'timestamp', 'readOnly' => true, 'system' => true],
                    'deletedBy' => ['type' => 'integer', 'readOnly' => true, 'system' => true],
                    'deletedGroup' => ['type' => 'text', 'rules' => ['max' => 36], 'hidden' => true, 'readOnly' => true, 'system' => true],
                    '_live' => ['type' => 'boolean', 'default' => ['value' => true], 'hidden' => true, 'readOnly' => true, 'system' => true],
                ],
            ],
            'sd_children' => [
                'primaryKey' => 'id', 'editor' => false, 'softDelete' => true, 'table' => 'sp_sd_children',
                'access' => ['read' => ['role' => 'anyone'], 'create' => ['role' => 'editor'], 'update' => ['role' => 'editor'], 'delete' => ['role' => 'editor']],
                'columns' => [
                    'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                    'parentId' => ['type' => 'integer', 'notNull' => true, 'references' => ['collection' => 'sd_parents', 'column' => 'id', 'onDelete' => 'cascade']],
                    'note' => ['type' => 'text', 'notNull' => true],
                    'author' => ['type' => 'integer', 'readOnly' => true, 'system' => true],
                    'createdAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => $now, 'readOnly' => true, 'system' => true],
                    'updatedAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => $now, 'onUpdate' => $now, 'readOnly' => true, 'system' => true],
                    'deletedAt' => ['type' => 'timestamp', 'readOnly' => true, 'system' => true],
                    'deletedBy' => ['type' => 'integer', 'readOnly' => true, 'system' => true],
                    'deletedGroup' => ['type' => 'text', 'rules' => ['max' => 36], 'hidden' => true, 'readOnly' => true, 'system' => true],
                    '_live' => ['type' => 'boolean', 'default' => ['value' => true], 'hidden' => true, 'readOnly' => true, 'system' => true],
                ],
            ],
            'sd_articles' => [
                'primaryKey' => 'id', 'editor' => true, 'drafts' => true, 'revisions' => true, 'softDelete' => true,
                'title' => 'title', 'slug' => 'slug', 'wp' => ['postType' => 'sp_sd_articles', 'metaPrefix' => 'sp_', 'fieldKeyPrefix' => 'field_sp_sd_articles_'],
                'access' => ['read' => ['role' => 'anyone'], 'create' => ['role' => 'editor'], 'update' => ['role' => 'editor'], 'delete' => ['role' => 'editor']],
                'columns' => [
                    'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                    'title' => ['type' => 'text', 'notNull' => true],
                    'slug' => ['type' => 'slug', 'notNull' => true, 'unique' => true, 'source' => 'title'],
                    'status' => ['type' => 'text', 'notNull' => true, 'enum' => ['draft', 'published', 'scheduled'], 'default' => ['value' => 'published'], 'system' => true],
                    'publishedAt' => ['type' => 'timestamp', 'system' => true],
                    'author' => ['type' => 'integer', 'readOnly' => true, 'system' => true],
                    'createdAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => $now, 'readOnly' => true, 'system' => true],
                    'updatedAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => $now, 'onUpdate' => $now, 'readOnly' => true, 'system' => true],
                    'deletedAt' => ['type' => 'timestamp', 'readOnly' => true, 'system' => true],
                    'deletedBy' => ['type' => 'integer', 'readOnly' => true, 'system' => true],
                    'deletedGroup' => ['type' => 'text', 'rules' => ['max' => 36], 'hidden' => true, 'readOnly' => true, 'system' => true],
                ],
            ],
        ],
    ]);
    register_post_type('sp_sd_articles', ['public' => false, 'supports' => ['title', 'revisions']]);
    $wp->exec('CREATE TABLE {prefix}sp_sd_parents (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `email` VARCHAR(191) NOT NULL, `bio` LONGTEXT, `author` BIGINT, `createdAt` CHAR(24) NOT NULL, `updatedAt` CHAR(24) NOT NULL, `deletedAt` CHAR(24), `deletedBy` BIGINT, `deletedGroup` VARCHAR(36), `_live` TINYINT(1) DEFAULT 1, PRIMARY KEY (`id`), UNIQUE KEY `email_unique` (`email`, `_live`), INDEX `deletedAt_idx` (`deletedAt`)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_sd_children (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `parentId` BIGINT UNSIGNED NOT NULL, `note` LONGTEXT NOT NULL, `author` BIGINT, `createdAt` CHAR(24) NOT NULL, `updatedAt` CHAR(24) NOT NULL, `deletedAt` CHAR(24), `deletedBy` BIGINT, `deletedGroup` VARCHAR(36), `_live` TINYINT(1) DEFAULT 1, PRIMARY KEY (`id`), INDEX `deletedAt_idx` (`deletedAt`)) ENGINE=InnoDB');
    $store = \SpacePress\Wp\CompositeStore::create($sdSchema, $wp->connection());
    $db = new \SpacePress\Db($store, $sdSchema, \SpacePress\db()->media());
    $editor = new \SpacePress\Viewer(['id' => 42, 'name' => 'Ed', 'role' => 'editor']);
    $guest = new \SpacePress\Viewer(null);

    // System fields auto-populated + read-only to callers
    $db->setActor($editor->user);
    problem('read-only system field rejected on create', fn () => $db->insert('sd_parents', ['email' => 'ro@x.test', 'createdAt' => '2020-01-01T00:00:00.000Z'], true), 422, 'invalid_input', '/createdAt');
    $p1 = $db->insert('sd_parents', ['email' => 'alice@x.test', 'bio' => 'hello'], true)[0];
    check('system fields populated on create (author, createdAt, updatedAt, deletedAt=null)', $p1['author'] === 42 && is_string($p1['createdAt']) && is_string($p1['updatedAt']) && $p1['deletedAt'] === null, $p1);
    $c1 = $db->insert('sd_children', ['parentId' => $p1['id'], 'note' => 'child-1'], true)[0];

    // Strict Drizzle 1.0 filter semantics: explicit undefined rejected, update ignores undefined and clears null
    problem('undefined in where filter throws 422 invalid_input', fn () => $db->findMany('sd_parents', ['where' => ['email' => \SpacePress\JsUndefined::Value]]), 422, 'invalid_input', '/where/email');
    problem('undefined in operator object throws 422 invalid_input', fn () => $db->findMany('sd_parents', ['where' => ['email' => ['eq' => \SpacePress\JsUndefined::Value]]]), 422, 'invalid_input', '/where/email/eq');
    problem('undefined in in-list throws 422 invalid_input', fn () => $db->findMany('sd_parents', ['where' => ['id' => ['in' => [\SpacePress\JsUndefined::Value]]]]), 422, 'invalid_input', '/where/id/in/0');
    $u1 = $db->update('sd_parents', ['email' => \SpacePress\JsUndefined::Value, 'bio' => null], ['id' => $p1['id']], true)[0];
    eq('update ignores undefined and clears null', [$u1['email'], $u1['bio']], ['alice@x.test', null]);

    // Soft delete + deletedGroup cascade
    $del = $db->delete('sd_parents', ['id' => $p1['id']], true, $editor)[0];
    check('soft delete sets deletedAt and deletedBy', is_string($del['deletedAt']) && $del['deletedBy'] === 42, $del);
    eq('default list excludes soft-deleted parent and cascaded child', [count($db->findMany('sd_parents')), count($db->findMany('sd_children'))], [0, 0]);
    problem('deleted: only refused to anonymous visitor without restore/delete access', fn () => $db->findMany('sd_parents', ['deleted' => 'only'], $guest), 401, 'unauthenticated');
    eq('deleted: only visible to editor', [count($db->findMany('sd_parents', ['deleted' => 'only'], $editor)), count($db->findMany('sd_children', ['deleted' => 'only'], $editor))], [1, 1]);

    // Active-row unique reuse while soft-deleted + restore 409 collision
    $p2 = $db->insert('sd_parents', ['email' => 'alice@x.test', 'bio' => 'reused'], true, $editor)[0];
    eq('unique email reused while original row is soft-deleted', $p2['email'], 'alice@x.test');
    problem('restore collides with active row holding same unique email (409)', fn () => $db->restore('sd_parents', ['id' => $p1['id']], true, $editor), 409, 'unique_violation', '/email');

    // Delete second row, then restore first -> restores parent AND cascaded child via deletedGroup!
    $db->delete('sd_parents', ['id' => $p2['id']], true, $editor);
    $restored = $db->restore('sd_parents', ['id' => $p1['id']], true, $editor)[0];
    eq('restore clears deletedAt/deletedBy, restores cascaded child, fires afterRestore', [
        $restored['deletedAt'], $restored['deletedBy'], count($db->findMany('sd_children')), $restoredLog,
    ], [null, null, 1, ['alice@x.test']]);

    // Purge: denied to untrusted editor (default "system"), succeeds when trusted, fires afterPurge
    problem('purge denied to untrusted editor by default (system only)', fn () => $db->purge('sd_parents', ['id' => $p2['id']], true, $editor), 403, 'forbidden');
    $db->purge('sd_parents', ['id' => $p2['id']], true);
    eq('trusted purge permanently deletes row and fires afterPurge', [count($db->findMany('sd_parents', ['deleted' => 'include'])), $purgedLog], [1, ['alice@x.test']]);

    // Soft delete on post-backed collection(): WP Trash + restore prior status + purge
    $art = $db->insert('sd_articles', ['title' => 'Hello Trash'], true, $editor)[0];
    eq('post collection system fields populated', [$art['author'], is_string($art['createdAt']), $art['deletedAt']], [42, true, null]);
    $trashed = $db->delete('sd_articles', ['id' => $art['id']], true, $editor)[0];
    eq('post soft delete moves to WP trash with deletedAt/deletedBy', [get_post_status($art['id']), is_string($trashed['deletedAt']), $trashed['deletedBy']], ['trash', true, 42]);
    eq('post list excludes trashed by default, finds with deleted: only', [count($db->findMany('sd_articles')), count($db->findMany('sd_articles', ['deleted' => 'only'], $editor))], [0, 1]);
    $untrashed = $db->restore('sd_articles', ['id' => $art['id']], true, $editor)[0];
    eq('post restore calls wp_untrash_post and restores published status', [$untrashed['status'], $untrashed['deletedAt'], get_post_status($art['id'])], ['published', null, 'publish']);
    $db->purge('sd_articles', ['id' => $art['id']], true);
    eq('post purge permanently deletes post', get_post($art['id']), null);

    // Retention helper: blocks wp_scheduled_delete for SpacePress softDelete post types + reads configured seconds
    eq('Retention blocks wp_scheduled_delete for softDelete post types', \SpacePress\Wp\Retention::blocksWpScheduledDelete($sdSchema, 'sp_sd_articles'), true);
    eq('Retention reads configured deletedSeconds', \SpacePress\Wp\Retention::deletedSeconds($sdSchema, 'sd_parents'), 86400);
    $db->setActor(null);
})();

// ================================================================ Slice 3: native revisions, diff, schema-aware decode, table _rev
(static function () use ($wp): void {
    $revSchema = new \SpacePress\Schema([
        'name' => 'rev_test',
        'collections' => [
            'docs' => [
                'primaryKey' => 'id', 'editor' => false, 'table' => 'sp_rev_docs',
                'revisions' => true, 'softDelete' => true,
                'access' => [
                    'read' => ['role' => 'anyone'],
                    'create' => ['role' => 'anyone'],
                    'update' => ['role' => 'anyone'],
                    'delete' => ['role' => 'anyone'],
                    'restore' => ['role' => 'anyone'],
                    'purge' => ['role' => 'anyone'],
                ],
                'columns' => [
                    'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
                    'summary' => ['type' => 'text', 'notNull' => true, 'column' => 'legacy_title', 'aliases' => ['oldTitle']],
                    'note' => ['type' => 'text', 'default' => ['value' => 'default-note']],
                    'secret' => ['type' => 'text', 'access' => ['read' => ['role' => 'admin']]],
                    'author' => ['type' => 'integer', 'readOnly' => true, 'system' => true],
                    'createdAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => ['now' => true], 'readOnly' => true, 'system' => true],
                    'updatedAt' => ['type' => 'timestamp', 'notNull' => true, 'default' => ['now' => true], 'onUpdate' => ['now' => true], 'readOnly' => true, 'system' => true],
                    'deletedAt' => ['type' => 'timestamp', 'readOnly' => true, 'system' => true],
                    'deletedBy' => ['type' => 'integer', 'readOnly' => true, 'system' => true],
                    'deletedGroup' => ['type' => 'text', 'rules' => ['max' => 36], 'hidden' => true, 'readOnly' => true, 'system' => true],
                    '_live' => ['type' => 'boolean', 'default' => ['value' => true], 'hidden' => true, 'readOnly' => true, 'system' => true],
                ],
                'relations' => [], 'hooks' => [],
            ],
        ],
    ]);
    $wp->exec('DROP TABLE IF EXISTS {prefix}sp_rev_docs');
    $wp->exec("CREATE TABLE {prefix}sp_rev_docs (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `legacy_title` LONGTEXT NOT NULL, `note` LONGTEXT DEFAULT ('default-note'), `secret` LONGTEXT, `author` BIGINT, `createdAt` CHAR(24) NOT NULL, `updatedAt` CHAR(24) NOT NULL, `deletedAt` CHAR(24), `deletedBy` BIGINT, `deletedGroup` VARCHAR(36), `_live` TINYINT(1) DEFAULT 1, PRIMARY KEY (`id`)) ENGINE=InnoDB");
    $wp->exec("DELETE FROM {prefix}sp__migrations WHERE `app` = 'rev_test'");
    $wp->exec("INSERT INTO {prefix}sp__migrations (`app`, `id`, `kind`, `applied_at`) VALUES ('rev_test', '20261121180000_aaaaaa_init', 'schema', '2026-11-21T18:00:00.000Z')");

    $store = \SpacePress\Wp\CompositeStore::create($revSchema, $wp->connection());
    $rdb = new \SpacePress\Db($store, $revSchema, \SpacePress\db()->media());

    // 1. Create -> update -> soft delete -> restore -> purge all emit monotonic versioned revisions with op, changed, schemaMigration.
    $doc = $rdb->insert('docs', ['summary' => 'V1', 'secret' => 's1'], true)[0];
    $rdb->update('docs', ['summary' => 'V2', 'secret' => 's2'], ['id' => $doc['id']], true);
    $rdb->delete('docs', ['id' => $doc['id']], true);
    $rdb->restore('docs', ['id' => $doc['id']], true);

    $list = $rdb->revisions('docs', $doc['id']);
    eq('table revisions record create/update/delete/restore with monotonic versions',
        array_map(static fn (array $r) => [$r['version'], $r['op'], $r['schemaMigration']], $list),
        [
            [4, 'restore', '20261121180000_aaaaaa_init'],
            [3, 'delete', '20261121180000_aaaaaa_init'],
            [2, 'update', '20261121180000_aaaaaa_init'],
            [1, 'create', '20261121180000_aaaaaa_init'],
        ]);
    eq('update revision lists changed non-hidden fields', $list[2]['changed'], ['summary', 'secret']);

    // 2. Diff between v1 and v2 masks hidden fields for non-admin viewer.
    $guest = new \SpacePress\Viewer(null);
    $admin = new \SpacePress\Viewer(['id' => 1, 'role' => 'admin']);
    $diffGuest = $rdb->diffRevisions('docs', $doc['id'], 1, 2, $guest, byVersion: true);
    $diffAdmin = $rdb->diffRevisions('docs', $doc['id'], 1, 2, $admin, byVersion: true);
    eq('diff masks restricted fields from non-admin viewer',
        array_column($diffGuest['changes'], 'field'), ['summary']);
    eq('diff shows all changed fields to admin',
        $diffAdmin['changes'], [
            ['field' => 'summary', 'from' => 'V1', 'to' => 'V2'],
            ['field' => 'secret', 'from' => 's1', 'to' => 's2'],
        ]);

    // 3. Restore by version restores V1 cleanly.
    $restored = $rdb->restoreRevision('docs', $doc['id'], 1, $admin, byVersion: true);
    eq('restoreRevision by version restores v1 values', [$restored['summary'], $restored['secret']], ['V1', 's1']);

    // 4. Schema-aware revision decoding handles aliased column names, physical column names, retired columns, and newly added defaulted columns.
    $decoded = \SpacePress\Db::decodeRevisionPayload($revSchema->collection('docs'), [
        'id' => 99,
        'oldTitle' => 'From Alias',
        'retired_col' => 'should be dropped',
        'createdAt' => '2026-01-01T00:00:00.000Z',
        'updatedAt' => '2026-01-01T00:00:00.000Z',
    ]);
    eq('schema-aware decode resolves alias, fills default for newly added column, and drops retired columns',
        [$decoded['summary'], $decoded['note'], array_key_exists('retired_col', $decoded)],
        ['From Alias', 'default-note', false]);
    $decodedPhys = \SpacePress\Db::decodeRevisionPayload($revSchema->collection('docs'), [
        'id' => 100,
        'legacy_title' => 'From Physical',
        'createdAt' => '2026-01-01T00:00:00.000Z',
        'updatedAt' => '2026-01-01T00:00:00.000Z',
    ]);
    eq('schema-aware decode resolves physical column name to logical field name', $decodedPhys['summary'], 'From Physical');

    // 5. Purge records a final purge revision that survives row deletion.
    $rdb->purge('docs', ['id' => $doc['id']], true);
    $afterPurge = $store->revisions('docs', $doc['id']);
    eq('purge writes a final audit revision in sp__revisions', $afterPurge[0]['op'], 'purge');
})();

// PR #516 review: a referential update on visible rows can't answer with hidden values, a many-ref
// link from a hidden row refuses, hidden volume can't change the answer, and a read extension that may
// hide rows makes every relationship refuse.
(static function () use ($db): void {
    $wp = $GLOBALS['wp'];
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
    $any = ['role' => 'anyone'];
    $open = ['read' => $any, 'create' => $any, 'update' => $any, 'delete' => $any];
    $mine = ['fn' => static fn (array $ctx) => ['ownerId' => 7]];
    $hidden = ['type' => 'integer', 'access' => ['read' => ['role' => 'admin']]];
    $schema = new \SpacePress\Schema(['version' => 3, 'runtime' => \SpacePress\Schema::SERIES, 'collections' => [
        'r_parents' => ['primaryKey' => 'id', 'editor' => false, 'table' => 'sp_r_parents', 'access' => ['read' => $mine] + $open, 'columns' => ['id' => $id, 'ownerId' => ['type' => 'integer']]],
        // A hook copies a hidden column into the reference set null writes.
        'r_hooked' => ['primaryKey' => 'id', 'editor' => false, 'table' => 'sp_r_hooked', 'access' => $open, 'columns' => ['id' => $id,
            'parentId' => ['type' => 'integer', 'references' => ['collection' => 'r_parents', 'column' => 'id', 'onDelete' => 'set null']], 'backupId' => $hidden],
            'hooks' => ['beforeUpdate' => static function (array $data, array $existing): array { $data['parentId'] = $existing['backupId']; return $data; }]],
        // set default writes a generated value.
        'r_defaulted' => ['primaryKey' => 'id', 'editor' => false, 'table' => 'sp_r_defaulted', 'access' => $open, 'columns' => ['id' => $id,
            'parentId' => ['type' => 'integer', 'default' => ['fn' => static fn () => $GLOBALS['r_default'] ?? null], 'references' => ['collection' => 'r_parents', 'column' => 'id', 'onDelete' => 'set default']]]],
        'r_tags' => ['primaryKey' => 'id', 'editor' => false, 'table' => 'sp_r_tags', 'access' => $open, 'columns' => ['id' => $id, 'name' => ['type' => 'text']]],
        'r_cards' => ['primaryKey' => 'id', 'editor' => false, 'table' => 'sp_r_cards', 'access' => ['read' => $mine] + $open, 'columns' => ['id' => $id, 'ownerId' => ['type' => 'integer'],
            'tags' => ['type' => 'refList', 'notNull' => true, 'references' => ['collection' => 'r_tags', 'column' => 'id', 'onDelete' => 'cascade', 'join' => 'r_cards_tags']]],
            'relations' => ['tags' => ['kind' => 'many', 'collection' => 'r_tags', 'from' => 'id', 'to' => 'id', 'optional' => false, 'through' => ['table' => 'r_cards_tags', 'from' => 'owner_id', 'to' => 'target_id']]]],
        'r_bulky' => ['primaryKey' => 'id', 'editor' => false, 'table' => 'sp_r_bulky', 'access' => ['read' => ['role' => 'admin']] + $open, 'columns' => ['id' => $id, 'body' => ['type' => 'text'],
            'tagId' => ['type' => 'integer', 'references' => ['collection' => 'r_tags', 'column' => 'id', 'onDelete' => 'cascade']]]],
    ]]);
    $wp->exec('CREATE TABLE {prefix}sp_r_parents (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ownerId BIGINT, PRIMARY KEY(id)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_r_hooked (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, parentId BIGINT, backupId BIGINT, PRIMARY KEY(id)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_r_defaulted (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, parentId BIGINT, PRIMARY KEY(id)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_r_tags (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, name LONGTEXT, PRIMARY KEY(id)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_r_cards (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ownerId BIGINT, PRIMARY KEY(id)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp__join_r_cards_tags (owner_id BIGINT UNSIGNED NOT NULL, target_id BIGINT UNSIGNED NOT NULL, position INT NOT NULL, PRIMARY KEY(owner_id, target_id)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}sp_r_bulky (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, body LONGTEXT, tagId BIGINT, PRIMARY KEY(id)) ENGINE=InnoDB');
    $probe = new \SpacePress\Db(\SpacePress\Wp\CompositeStore::create($schema, $wp->connection()), $schema, $db->media());
    $previous = \SpacePress\Db::instance();
    \SpacePress\Db::setInstance($probe);
    $me = new \SpacePress\Viewer(['id' => 7, 'name' => 'me', 'role' => 'subscriber']);
    $answer = static function (callable $write): array {
        try {
            $write();

            return ['status' => 200];
        } catch (\Throwable $e) {
            return \SpacePress\App::problem($e);
        }
    };
    try {
        $theirs = $probe->insert('r_parents', ['ownerId' => 8], true)[0];
        $answers = [];
        foreach ([null, $theirs['id']] as $backup) {
            $parent = $probe->insert('r_parents', ['ownerId' => 7], true)[0];
            $probe->insert('r_hooked', ['parentId' => $parent['id'], 'backupId' => $backup], true);
            $answers[] = $answer(fn () => $probe->delete('r_parents', ['id' => $parent['id']], false, $me));
        }
        $direct = [];
        foreach ([null, $theirs['id']] as $backup) {
            $p = $probe->insert('r_parents', ['ownerId' => 7], true)[0];
            $h = $probe->insert('r_hooked', ['parentId' => $p['id'], 'backupId' => $backup], true)[0];
            $direct[] = $answer(fn () => $probe->update('r_hooked', ['parentId' => null], ['id' => $h['id']], false, $me));
        }
        // The app's hook copies a value into a reference the viewer reads: a direct update discloses it
        // through its answer, and a delete's set null, that viewer's update of the same row, answers alike.
        eq('a referential set null answers as the viewer\'s own update of the row does', [$answers[0]['status'], $answers[1]['status']], [$direct[0]['status'], $direct[1]['status'] === 200 ? 200 : 409]);
        eq('… and a refusal is the one body', $answers[1], ['type' => 'about:blank', 'title' => 'Reference violation', 'status' => 409, 'code' => 'reference_violation', 'detail' => "Rows you can't read may reference this row"]);
        $probe->delete('r_hooked', ['parentId' => ['isNull' => false]]);
        $answers = [];
        foreach ([null, $theirs['id']] as $generated) {
            $GLOBALS['r_default'] = $generated;
            $parent = $probe->insert('r_parents', ['ownerId' => 7], true)[0];
            $probe->insert('r_defaulted', ['parentId' => $parent['id']], true);
            $answers[] = $answer(fn () => $probe->delete('r_parents', ['id' => $parent['id']], false, $me));
        }
        eq('set default runs the app\'s generator as the viewer\'s update: a visible target applies, a hidden one refuses with the one body', [$answers[0]['status'], $answers[1]['status'], $answers[1]['detail'] ?? null], [200, 409, "Rows you can't read may reference this row"]);

        $tag = $probe->insert('r_tags', ['name' => 't'], true)[0];
        $probe->insert('r_cards', ['ownerId' => 7, 'tags' => [$tag['id']]], true);
        $hiddenCard = $probe->insert('r_cards', ['ownerId' => 8, 'tags' => [$tag['id']]], true)[0];
        problem('a many-ref link from a row the viewer can\'t read refuses the delete', fn () => $probe->delete('r_tags', ['id' => $tag['id']], false, $me), 409, 'reference_violation');
        eq('… and keeps that row\'s link', $probe->findFirst('r_cards', ['where' => ['id' => $hiddenCard['id']]])['tags'], [$tag['id']]);
        $own = $probe->insert('r_tags', ['name' => 't'], true)[0];
        $probe->insert('r_cards', ['ownerId' => 7, 'tags' => [$own['id']]], true);
        eq('a tag only the viewer\'s rows link to deletes', $answer(fn () => $probe->delete('r_tags', ['id' => $own['id']], false, $me))['status'], 200);

        // Hidden volume: many large hidden rows answer as one does, within the default memory limit.
        $bulk = $probe->insert('r_tags', ['name' => 't'], true)[0];
        $one = $probe->insert('r_tags', ['name' => 't'], true)[0];
        $probe->insert('r_bulky', ['tagId' => $one['id'], 'body' => 'x'], true);
        $payload = str_repeat('x', 2 * 1024 * 1024);
        for ($i = 0; $i < 90; $i++) {
            $wp->connection()->run('INSERT INTO wp_sp_r_bulky (body, tagId) VALUES (?, ?)', [$payload, $bulk['id']]);
        }
        unset($payload);
        $limit = ini_get('memory_limit');
        ini_set('memory_limit', '128M');
        try {
            eq('ninety 2 MiB hidden rows answer like one, without loading them', $answer(fn () => $probe->delete('r_tags', ['id' => $bulk['id']], false, $me)), $answer(fn () => $probe->delete('r_tags', ['id' => $one['id']], false, $me)));
        } finally {
            ini_set('memory_limit', $limit);
        }

        // Many-ref volume: the owners of links are counted in SQL, never listed in PHP.
        $many = $probe->insert('r_tags', ['name' => 't'], true)[0];
        $wp->connection()->run('INSERT INTO wp_sp_r_cards (ownerId) SELECT 8 FROM wp_sp_r_bulky');
        for ($i = 0; $i < 6; $i++) {
            $wp->connection()->run('INSERT INTO wp_sp_r_cards (ownerId) SELECT ownerId FROM wp_sp_r_cards WHERE ownerId = 8');
        }
        $wp->connection()->run('INSERT INTO wp_sp__join_r_cards_tags (owner_id, target_id, position) SELECT id, ?, 0 FROM wp_sp_r_cards WHERE ownerId = 8', [$many['id']]);
        $limit = ini_get('memory_limit');
        ini_set('memory_limit', '128M');
        try {
            eq('thousands of hidden many-ref owners answer like one', $answer(fn () => $probe->delete('r_tags', ['id' => $many['id']], false, $me)), $answer(fn () => $probe->delete('r_tags', ['id' => $one['id']], false, $me)));
        } finally {
            ini_set('memory_limit', $limit);
        }

        // Last, since registrations stay for the rest of the process: a read extension that may hide rows.
        $free = $probe->insert('r_tags', ['name' => 't'], true)[0];
        \SpacePress\Extensions::beforeRead(static function (string $collection, array &$opts): void {
            if ($collection === 'r_cards') {
                $opts['limit'] = 1;
            }
        });
        $limited = $probe->insert('r_tags', ['name' => 't'], true)[0];
        problem('with an unproven read extension, every relationship to the row refuses', fn () => $probe->delete('r_tags', ['id' => $free['id']], false, $me), 409, 'reference_violation');
        eq('trusted deletes are not affected', $answer(fn () => $probe->delete('r_tags', ['id' => $limited['id']]))['status'], 200);
    } finally {
        \SpacePress\Db::setInstance($previous);
        unset($GLOBALS['r_default']);
    }
})();

// ================================================================ ref(labels).many(): links in a join table

(static function () use ($db, $wp): void {
    $anon = new \SpacePress\Viewer(null);
    $member = new \SpacePress\Viewer(['id' => 1, 'name' => 'm', 'role' => 'subscriber']);
    [$red, $green, $blue, $hidden] = $db->insert('labels', [['name' => 'red'], ['name' => 'green'], ['name' => 'blue'], ['name' => 'hidden', 'secret' => true]], true);
    $links = static fn (string $table) => array_map(static fn (array $r) => array_map('intval', $r), $wp->sql("SELECT `owner_id`, `target_id`, `position` FROM {prefix}sp__join_$table ORDER BY `owner_id`, `position`"));

    $card = $db->insert('cards', ['title' => 'one', 'labels' => [$blue['id'], $red['id']]], true)[0];
    eq('a many-ref reads back as its ids in write order; an omitted optional one is []', [$card['labels'], $card['pinned']], [[$blue['id'], $red['id']], []]);
    eq('the links are rows of the join table, positions 0-based in write order', $links('cards_labels'),
        [['owner_id' => $card['id'], 'target_id' => $blue['id'], 'position' => 0], ['owner_id' => $card['id'], 'target_id' => $red['id'], 'position' => 1]]);
    problem('a required many-ref must be given on create', fn () => $db->insert('cards', ['title' => 'none']), 422, 'invalid_input', '/labels');
    eq('[] satisfies a required many-ref', $db->insert('cards', ['title' => 'empty', 'labels' => []], true)[0]['labels'], []);
    problem('duplicates are refused at the repeat', fn () => $db->insert('cards', ['title' => 'dup', 'labels' => [$red['id'], $green['id'], $red['id']]]), 422, 'invalid_input', '/labels/2');
    problem('a missing target is a reference violation at its index', fn () => $db->insert('cards', ['title' => 'gone', 'labels' => [$red['id'], 999999]]), 409, 'reference_violation', '/labels/1');
    problem('a target the writer can\'t read refuses like a missing one', fn () => $db->insert('cards', ['title' => 'peek', 'labels' => [$hidden['id']]], false, $anon), 409, 'reference_violation', '/labels/0');
    eq('a writer who can read the target links it', $db->insert('cards', ['title' => 'seen', 'labels' => [$hidden['id']]], true, $member)[0]['labels'], [$hidden['id']]);

    $updated = $db->update('cards', ['labels' => [$green['id'], $blue['id']]], ['id' => $card['id']], true)[0];
    eq('an update replaces the whole list, in its new order', [$updated['labels'], $updated['title']], [[$green['id'], $blue['id']], 'one']);
    eq('an update without the field keeps its links', $db->update('cards', ['title' => 'uno'], ['id' => $card['id']], true)[0]['labels'], [$green['id'], $blue['id']]);

    $two = $db->insert('cards', ['title' => 'two', 'labels' => [$red['id'], $green['id']], 'pinned' => [$green['id']]], true)[0];
    $titles = static fn (array $opts, ?\SpacePress\Viewer $v = null) => array_column($db->findMany('cards', $opts + ['orderBy' => ['id' => 'asc']], $v), 'title');
    eq('`has` matches rows linked to the id', $titles(['where' => ['labels' => ['has' => $green['id']]]]), ['uno', 'two']);
    eq('NOT has, and eq [] (no links)', [$titles(['where' => ['labels' => ['NOT' => ['has' => $green['id']]]]]), $titles(['where' => ['labels' => []]])], [['empty', 'seen'], ['empty']]);
    eq('a filter on the linked rows means some linked row matches', $titles(['where' => ['labels' => ['name' => 'red']]]), ['two']);
    eq('true / false: some link or none', [$titles(['where' => ['pinned' => true]]), count($titles(['where' => ['pinned' => false]]))], [['two'], 3]);
    eq('relation filters see only rows the viewer may read', $titles(['where' => ['labels' => ['name' => 'hidden']]], $anon), []);
    problem('orderBy on a many-ref is refused', fn () => $db->findMany('cards', ['orderBy' => ['labels' => 'asc']]), 400, 'invalid_query', '/orderBy/labels');

    $loaded = $db->findFirst('cards', ['where' => ['id' => $card['id']], 'with' => ['labels' => true]]);
    eq('with loads the linked rows in position order', array_column($loaded['labels'], 'name'), ['green', 'blue']);
    $sorted = $db->findFirst('cards', ['where' => ['id' => $card['id']], 'with' => ['labels' => ['orderBy' => ['name' => 'asc'], 'columns' => ['name' => true]]]]);
    eq('nested options sort and pick the linked rows', $sorted['labels'], [['name' => 'blue'], ['name' => 'green']]);
    eq('limit applies per row', array_map(static fn ($c) => array_column($c['labels'], 'name'), $db->findMany('cards', ['where' => ['id' => ['in' => [$card['id'], $two['id']]]], 'orderBy' => ['id' => 'asc'], 'with' => ['labels' => ['limit' => 1]]])), [['green'], ['red']]);
    eq('with applies the target\'s read access', array_column($db->findFirst('cards', ['where' => ['title' => 'seen'], 'with' => ['labels' => true]], $anon)['labels'], 'name'), []);
    eq('columns keeps a loaded many-ref', array_keys($db->findFirst('cards', ['where' => ['id' => $card['id']], 'columns' => ['title' => true], 'with' => ['labels' => true]])), ['title', 'labels']);
    $reverse = $db->findFirst('labels', ['where' => ['id' => $green['id']], 'with' => ['cards' => ['columns' => ['title' => true]], 'pinnedBy' => true]]);
    eq('the target lists its linking rows (reverse many)', [array_column($reverse['cards'], 'title'), array_column($reverse['pinnedBy'], 'title')], [['uno', 'two'], ['two']]);
    eq('a filter through the reverse list', array_column($db->findMany('labels', ['where' => ['cards' => ['title' => 'two']], 'orderBy' => ['id' => 'asc']]), 'name'), ['red', 'green']);

    problem('restrict refuses deleting a target that is still linked', fn () => $db->delete('labels', ['id' => $green['id']]), 409, 'reference_violation');
    eq('… and keeps it and its links', [count($db->findMany('labels', ['where' => ['id' => $green['id']]])), $db->findFirst('cards', ['where' => ['id' => $two['id']]])['labels']], [1, [$red['id'], $green['id']]]);
    $db->delete('labels', ['id' => $red['id']]);
    eq('deleting a target removes the links pointing at it', [$db->findFirst('cards', ['where' => ['id' => $two['id']]])['labels'], count($wp->sql('SELECT 1 FROM {prefix}sp__join_cards_labels WHERE `target_id` = ?', [$red['id']]))], [[$green['id']], 0]);
    $db->update('cards', ['pinned' => []], ['id' => $two['id']]);
    $db->delete('cards', ['id' => $two['id']]);
    eq('deleting the owner removes its links', count($wp->sql('SELECT 1 FROM {prefix}sp__join_cards_labels WHERE `owner_id` = ?', [$two['id']])), 0);
    $db->delete('labels', ['id' => $green['id']]);
    eq('with the last link gone, restrict lets the target go', $db->findFirst('cards', ['where' => ['id' => $card['id']]])['labels'], [$blue['id']]);

    $r = http('POST', '/cards', ['title' => 'rest', 'labels' => [$blue['id']]]);
    eq('REST writes and reads a many-ref as ids', [$r['status'], $r['json']['data']['labels'] ?? null], [201, [$blue['id']]]);
    $r = http('GET', '/cards?' . http_build_query(['where' => json_encode(['id' => $card['id']]), 'with' => 'labels']));
    eq('REST with loads the linked rows', [$r['status'], array_column($r['json']['data'][0]['labels'] ?? [], 'name')], [200, ['blue']]);
})();

finish('db_test');
