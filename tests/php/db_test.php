<?php

declare(strict_types=1);

/*
 * Db + write pipeline + CLI + REST on WordPress, in-process (tests/php/wp.php): a hand-written app
 * plugin (what `zero build` emits) on a fresh WordPress-on-SQLite site. The collections here are
 * custom tables (`editor: false`); post-backed collections are proven by the blog suite and tests/wp.
 */

use Zero\HttpError;
use Zero\JsError;

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
    use Zero\HttpError;
    use Zero\JsError;
    use Zero\Js;
    use function Zero\db;

    // A compiled before-hook mutates its handle without returning a replacement.
    // Advances a pinned clock by a second while a row's defaults are being generated.
    function locations__tick()
    {
        if (($pinned = getenv('ZERO_NOW')) !== false && $pinned !== '') {
            putenv('ZERO_NOW=' . Js::iso(Js::now() + 1000));
        }
        return null;
    }

    function locations__beforeCreate(\Zero\JsObject $data)
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
        return new \Zero\JsObject([...$data->p, 'name' => ucfirst($data->p['name'])]);
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

    function action__restock($input)
    {
        $item = db()->findFirst('items', ['where' => ['id' => $input->p['itemId']]])
            ?? throw new HttpError(404, 'not_found', 'No such item');
        return db()->update('items', ['qty' => $item['qty'] + $input->p['amount']], ['id' => $item['id']], true)[0];
    }
    PHP;

$wp = wpSite('db', ['schema' => $schema, 'functions' => $functions, 'users' => ['fa_alice' => 'author', 'fa_bob' => 'author', 'fa_ed' => 'editor', 'fa_admin' => 'admin']]);
$db = \Zero\db();
$app = $wp->app();

function names(array $rows): array
{
    return array_column($rows, 'name');
}

// ================================================================ boot + migrate

eq('activation applied the init migration and recorded it in the per-app ledger',
    $wp->sql('SELECT `id` FROM {prefix}zero__migrations WHERE `app` = ? ORDER BY `id`', ['dbtest']), [['id' => '0001_init']]);
eq('the app plugin is active with current storage', [$wp->plugin()->unavailable(), $wp->plugin()->pendingMigrations()], [null, []]);
eq('the runtime describes its database as SQLite through the official plugin', \Zero\Wp\Platform::versions()['database']['kind'], 'sqlite');
eq('platform problems accept SQLite Database Integration', \Zero\Wp\Platform::problems(), []);
// Akismet and Two Factor count when loaded, not when stored as active, and Akismet needs no key: the
// host's v2 scope activates them per request, and a Space without an Akismet key still mounts.
eq('the app mounted with Akismet and Two Factor loaded and no Akismet key', [defined('WPCOM_API_KEY'), (bool) \Akismet::get_api_key(), \Zero\Wp\Platform::versions()['akismet'], \Zero\Wp\Platform::versions()['twoFactor']],
    [false, false, '5.7.2', '0.17.0']);
$stored = get_option('active_plugins');
add_filter('pre_option_active_plugins', static fn (): array => array_values(array_diff($stored, ['akismet/akismet.php', 'two-factor/two-factor.php'])));
eq('platform problems read the loaded plugins, not the stored active list', \Zero\Wp\Platform::problems(), []);
remove_all_filters('pre_option_active_plugins');
eq('an Akismet check without a key passes the comment through unchanged', \Akismet::auto_check_comment(['comment_content' => 'x', 'comment_post_ID' => 1]), ['comment_content' => 'x', 'comment_post_ID' => 1]);

// ================================================================ write pipeline: create


$tsPattern = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/';
putenv('ZERO_NOW=2026-01-01T00:00:00.000Z');
$garage = $db->insert('locations', ['name' => '  Garage  ', 'meta' => ['floor' => 1, 'tags' => ['a/b', 'é']]], true)[0];
putenv('ZERO_NOW');
eq('by-ref beforeCreate mutation is kept (trim + fill)', [$garage['name'], $garage['code']], ['Garage', 'GAR']);
eq('defaults: enum value + boolean', [$garage['kind'], $garage['active']], ['shelf', true]);
eq('default now: one instant per write, nested defaults included, even when the clock moves between defaults',
    [$garage['createdAt'], $garage['updatedAt'], $garage['audit']['at'] ?? null], array_fill(0, 3, '2026-01-01T00:00:00.000Z'));
eq('json column round-trips', \Zero\Js::jsonStringify($garage['meta']), '{"floor":1,"tags":["a/b","é"]}');
eq('json stored with unescaped slashes/unicode', $wp->scalar('SELECT `meta` FROM {prefix}zero_locations WHERE `name` = ?', ['Garage']), '{"floor":1,"tags":["a/b","é"]}');

[$attic, $basement] = $db->insert('locations', [
    ['name' => 'Attic', 'kind' => 'bin', 'active' => false, 'updatedAt' => '2000-01-01T00:00:00Z'],
    ['name' => 'Basement'],
], true);
eq('multi-row insert + explicit timestamp normalized', $attic['updatedAt'], '2000-01-01T00:00:00.000Z');

$items = $db->insert('items', [
    ['name' => 'hammer', 'qty' => 2, 'price' => 9.5, 'locationId' => $garage['id']],
    ['name' => 'nails', 'qty' => 100, 'price' => 2, 'locationId' => $garage['id'], 'seenAt' => 0],
    ['name' => 'box', 'price' => \Zero\Js::undefined(), 'seenAt' => \Zero\Js::undefined()],
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
$wp->exec('INSERT INTO {prefix}zero_items (`name`, `qty`) VALUES (?, 1), (?, 1)', ["Hammer\n", 'abc\\']);
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
    $schema = new \Zero\Schema(['version' => 3, 'runtime' => \Zero\Schema::SERIES, 'collections' => ['listed' => [
        'primaryKey' => 'id', 'editor' => false, 'table' => 'zero_listed',
        'columns' => [
            'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
            'tags' => ['type' => 'select', 'multiple' => true, 'enum' => ['news', 'new', 'guide']],
            'photos' => ['type' => 'mediaList'],
        ],
    ]]]);
    $wp->exec('CREATE TABLE {prefix}zero_listed (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `tags` LONGTEXT, `photos` LONGTEXT, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $wp->exec('INSERT INTO {prefix}zero_listed (`id`, `tags`, `photos`) VALUES (1, \'["news","guide"]\', \'[12,7]\'), (2, \'["new"]\', \'[120]\'), (3, \'[]\', \'[]\'), (4, NULL, NULL)');
    $db = new \Zero\Db(\Zero\Wp\CompositeStore::create($schema, $wp->connection()), $schema, \Zero\db()->media());
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
$items = $wp->connection()->prefix() . 'zero_items';
$committed = [];
$db->transaction(function () use ($db, $observer, $items, &$committed) {
    \Zero\Extensions::afterCommit(function () use ($observer, $items, &$committed) {
        $committed[] = 'outer:' . (int) $observer->query("SELECT qty FROM $items WHERE name = 'Hammer'")->fetchColumn();
    });
    $db->transaction(function () use ($db, $observer, $items, &$committed) {
        $db->update('items', ['qty' => 6], ['name' => 'Hammer']);
        \Zero\Extensions::afterCommit(function () use ($observer, $items, &$committed) {
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
            \Zero\Extensions::afterCommit(function () use (&$committed) { $committed[] = 'rolled back'; });
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
                \Zero\Extensions::afterCommit(function () use (&$committed) { $committed[] = 'must not run'; });
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
        \Zero\Extensions::afterCommit(static fn () => throw new JsError('after commit'));
    });
}, 422, 'rejected');
eq('post-commit failure never undoes committed filesystem effects', is_file($wp->dir . '/committed-file'), true);
\Zero\Extensions::afterCommit(function () use (&$committed) { $committed[] = 'immediate'; });
eq('rollback and post-commit failure leave no stale callbacks', [(int) $observer->query("SELECT qty FROM $items WHERE name = 'Hammer'")->fetchColumn(), $committed], [5, ['outer:6', 'inner:6', 'immediate']]);

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

// An app update ships 0002: adding a column to a table with rows. `wp zero migrate` applies it in
// order, records it per app, and the next request sees current storage.
$childrenBefore = $db->findMany('items', ['where' => ['locationId' => $garage['id']], 'orderBy' => ['id' => 'asc']]);
file_put_contents($wp->plugin()->dir . '/zero/app/migrations/0002_note.sql', 'ALTER TABLE `{prefix}zero_locations` ADD COLUMN `note` LONGTEXT;');
eq('`wp zero migrate` applies the pending file', $wp->wpCli(['migrate']), [0, ['data' => ['applied' => ['0002_note']]]]);
eq('child rows survive the parent change (no cascade fired)', $db->findMany('items', ['where' => ['locationId' => $garage['id']], 'orderBy' => ['id' => 'asc']]), $childrenBefore);
eq('the table has the new column and the ledger the file', [
    $wp->scalar('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$wp->connection()->prefix() . 'zero_locations', 'note']),
    array_column($wp->sql('SELECT `id` FROM {prefix}zero__migrations WHERE `app` = ? ORDER BY `id`', ['dbtest']), 'id'),
], [1, ['0001_init', '0002_note']]);
problem('the unique index still holds', fn () => $db->insert('locations', ['name' => 'Garage']), 409, 'unique_violation', '/name');
// Migration text is SQL as the compiler or an operator writes it: a leading comment, a `?` inside a
// literal default, and a constraint over rows that break it.
$migrate = static function (string $id, string $sql) use ($wp): ?array {
    file_put_contents($wp->plugin()->dir . "/zero/app/migrations/$id.sql", $sql);

    return $wp->wpCli(['migrate'])[1]['data']['applied'] ?? null;
};
// Statement text as the compiler or an operator writes it, read as the driver reads it. Each ALTER
// is a plain Connection::run on a parent table with children (the migration path above proves the
// same statement reaching it through a file); the children must survive the driver's table rebuild.
$wp->exec('CREATE TABLE {prefix}zero_rf_parent (`id` BIGINT UNSIGNED NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB');
$wp->exec('CREATE TABLE {prefix}zero_rf_child (`id` BIGINT UNSIGNED NOT NULL, `pid` BIGINT UNSIGNED, PRIMARY KEY (`id`), CONSTRAINT `zero_rf_child_pid_fk` FOREIGN KEY (`pid`) REFERENCES {prefix}zero_rf_parent (`id`) ON DELETE CASCADE) ENGINE=InnoDB');
$wp->exec('INSERT INTO {prefix}zero_rf_parent VALUES (1)');
$wp->exec('INSERT INTO {prefix}zero_rf_child VALUES (1, 1)');
$column = static fn (string $name): int => (int) $wp->scalar('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$wp->connection()->prefix() . 'zero_rf_parent', $name]);
$children = static fn (): int => (int) $wp->scalar('SELECT COUNT(*) FROM {prefix}zero_rf_child');
$alter = static function (string $sql, string $column) use ($wp, $children): array {
    $wp->exec($sql);

    return [$children(), $column === '' ? null : (int) $wp->scalar('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$wp->connection()->prefix() . 'zero_rf_parent', $column])];
};
eq('a leading block comment and a literal `?` default', $alter("/* adds a prompt */ ALTER TABLE `{prefix}zero_rf_parent` ADD COLUMN `prompt` VARCHAR(191) DEFAULT 'Continue?'", 'prompt'), [1, 1]);
eq('a comment between the keywords', $alter('ALTER /* inline */ TABLE `{prefix}zero_rf_parent` ADD COLUMN `c2` LONGTEXT', 'c2'), [1, 1]);
eq('a line comment ending in a carriage return', $alter("-- note\rALTER TABLE `{prefix}zero_rf_parent` ADD COLUMN `c3` LONGTEXT", 'c3'), [1, 1]);
eq('an executable comment this server\'s version satisfies is the statement', $alter('/*!80000 ALTER TABLE `{prefix}zero_rf_parent` ADD COLUMN `c4` LONGTEXT */', 'c4'), [1, 1]);
eq('an executable comment for a newer server is a comment, and the ALTER behind it still keeps the children', $alter('/*!99999 SELECT 1 */ ALTER TABLE `{prefix}zero_rf_parent` ADD COLUMN `c5` LONGTEXT', 'c5'), [1, 1]);
eq('a migration file carrying such a statement reaches the same path', [$migrate('0002b_commented', "/* adds */ ALTER /* inline */ TABLE `{prefix}zero_locations` ADD COLUMN `prompt` VARCHAR(191) DEFAULT 'Continue?';"), $db->findMany('items', ['where' => ['locationId' => $garage['id']], 'orderBy' => ['id' => 'asc']]) === $childrenBefore, $wp->scalar('SELECT `prompt` FROM {prefix}zero_locations WHERE `name` = ?', ['Garage'])], [['0002b_commented'], true, 'Continue?']);
eq('`--` without a space is subtraction', $wp->sql('SELECT 1--? AS n', [1])[0]['n'], 2);
eq('a parameter inside an executable comment this server reads is bound', $wp->sql('SELECT /*!80000 ? */ AS n', [42])[0]['n'], 42);
eq('a `?` inside an executable comment for a newer server is text, not a parameter', $wp->sql('SELECT 3 AS n /*!99999 , ? AS m */')[0], ['n' => 3]);
eq('a token-merging executable comment is read as the server reads it', $wp->sql('/*!80000 SELECT*/1 AS n')[0]['n'], 1);
eq('a quoted `*/` inside executable SQL does not end the comment', $wp->sql("SELECT /*!80000 '*/?' AS s, ? AS n */", [42])[0], ['s' => '*/?', 'n' => 42]);
eq('an odd run of backslashes escapes the quote: the `?` inside stays text', $wp->sql("SELECT 'it''s a \\\\\\'?' AS s, ? AS n", [7])[0], ['s' => "it's a \\'?", 'n' => 7]);
$wp->exec('INSERT INTO {prefix}zero_logs (`message`, `at`) VALUES (?, ?)', ['orphan', '2026-01-01T00:00:00.000Z']);
$wp->exec('ALTER TABLE {prefix}zero_logs ADD COLUMN `itemId` BIGINT UNSIGNED');
$wp->exec('UPDATE {prefix}zero_logs SET `itemId` = 424242 WHERE `message` = ?', ['orphan']);
file_put_contents($wp->plugin()->dir . '/zero/app/migrations/0002c_fk.sql', 'ALTER TABLE `{prefix}zero_logs` ADD CONSTRAINT `zero_logs_itemId_fk` FOREIGN KEY (`itemId`) REFERENCES `{prefix}zero_items` (`id`) ON DELETE SET NULL;');
putenv('ZERO_DEBUG=1');
[$code, $out] = $wp->wpCli(['migrate']);
putenv('ZERO_DEBUG');
check('a constraint added over rows that break it fails the migration and changes nothing', $code === 1 && str_contains($out['error']['detail'] ?? '', 'foreign key constraint fails')
    && $wp->scalar('SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?', [$wp->connection()->prefix() . 'zero_logs', 'zero_logs_itemId_fk']) === 0, $out);
$wp->exec('DELETE FROM {prefix}zero_logs WHERE `message` = ?', ['orphan']);
eq('with the orphan gone the same file applies', $wp->wpCli(['migrate'])[1]['data']['applied'] ?? null, ['0002c_fk']);
// Migrations run under one site-wide lock across processes: while this process holds it, another
// process can't take it (and gives up at its timeout); once released, it can.
file_put_contents($wp->dir . '/lock.php', <<<'PHP'
    <?php
    require $argv[1];
    wpLoad($argv[2]);
    try {
        echo \Zero\Wp\Runtime::plugin()->connection()->locked('zero:test', 1, static fn () => 'held');
    } catch (\Zero\Wp\LockBusy $e) {
        echo 'refused';
    }
    PHP);
$other = static fn (): string => trim((string) shell_exec(escapeshellarg(PHP_BINARY) . ' -d memory_limit=512M ' . escapeshellarg($wp->dir . '/lock.php') . ' ' . escapeshellarg(__DIR__ . '/wp.php') . ' ' . escapeshellarg($wp->dir) . ' 2>/dev/null'));
$whileHeld = $wp->connection()->locked('zero:test', 1, $other);
eq('a second process can\'t take a held migration lock, and can once it is released', [$whileHeld, $other()], ['refused', 'held']);
eq('the lock is per name', $wp->connection()->locked('zero:other', 1, $other), 'held');

// A statement that fails stops the file; what ran before it is recorded step by step, nothing after it runs.
file_put_contents($wp->plugin()->dir . '/zero/app/migrations/0003_broken.sql', "DELETE FROM `{prefix}zero_logs` WHERE `message` = 'hello';\n--> statement-breakpoint\nALTER TABLE `{prefix}zero_nope` ADD COLUMN `x` LONGTEXT;\n--> statement-breakpoint\nDELETE FROM `{prefix}zero_logs`;");
putenv('ZERO_DEBUG=1'); // the problem's detail carries the migration's own message, as the operator sees it in the log
[$code, $out] = $wp->wpCli(['migrate']);
putenv('ZERO_DEBUG');
check('a failing statement fails the command and names its position', $code === 1 && str_contains($out['error']['detail'] ?? '', '0003_broken failed at statement 2'), $out);
eq('the statements before it ran and are recorded; the ones after it did not run', [
    count($db->findMany('logs', ['where' => ['message' => 'hello']])), count($db->findMany('logs')) > 0,
    array_column($wp->sql('SELECT `id` FROM {prefix}zero__migrations WHERE `app` = ? AND `id` LIKE ? ORDER BY `id`', ['dbtest', '0003%']), 'id'),
], [0, true, ['0003_broken:1']]);
unlink($wp->plugin()->dir . '/zero/app/migrations/0003_broken.sql');
$wp->exec('DELETE FROM {prefix}zero__migrations WHERE `app` = ? AND `id` LIKE ?', ['dbtest', '0003%']);
eq('with the file gone, migrate is a no-op and the CLI serves again', [$wp->wpCli(['migrate'])[1], $wp->wpCli(['find', 'items', '{"where":{"name":"Hammer"},"columns":{"name":true}}'])[1]],
    [['data' => ['applied' => []]], ['data' => [['name' => 'Hammer']]]]);

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

// ================================================================ REST: the WordPress route

// Through the web server (php -S on this site), as a client sees it: /wp-json/zero/v1 answers with
// Zero's envelopes, problem documents and headers.
$port = $wp->startServer();
$base = "http://127.0.0.1:$port/wp-json/zero/v1";

/** @return array{status: int, headers: array<string, string>, body: string, json: mixed} */
function http(string $method, string $path, mixed $body = null, ?string $raw = null, array $headers = []): array
{
    global $base;
    $ch = curl_init($base . $path);
    $out = [];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
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

$r = http('GET', '/_schema');
check('GET /_schema', $r['status'] === 200 && $r['json']['data']['collections']['items']['columns']['qty']['type'] === 'integer'
    && isset($r['json']['data']['actions']['restock']['input']['amount']), $r);
check('schema exposes no function names', !str_contains($r['body'], '__') && !str_contains($r['body'], 'hooks') && !str_contains($r['body'], 'handler'), $r['body']);
eq('the runtime reports the WordPress platform in /_schema', [$r['json']['data']['runtime']['wp']['database']['kind'], $r['json']['data']['runtime']['wp']['incompatibleTables']], ['sqlite', []]);

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

// A malformed JSON body is refused by WordPress's REST server before Zero runs (rest_invalid_json);
// in-process, Zero's own parser answers invalid_json.
eq('invalid JSON body is refused by the REST server', [http('POST', '/items', raw: '{"name":')['status'], http('POST', '/items', raw: '{"name":')['json']['code'] ?? null], [400, 'rest_invalid_json']);
eq('… and by Zero itself', [$wp->call('POST', '/items', '{"name":')[0], $wp->call('POST', '/items', '{"name":')[1]['code'] ?? null], [400, 'invalid_json']);
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

// ================================================================ relation filters respect the target's read access

// A relation filter is an oracle over the target's columns, so it may only see target rows a direct
// read would return: an unreadable target is denied like `with`, a draft target matches nothing.
// That holds for the row selector of a viewer's update/delete as much as for a read.
(static function (): void {
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
    $status = ['type' => 'text', 'notNull' => true, 'enum' => ['draft', 'published', 'scheduled'], 'default' => ['value' => 'published'], 'system' => true];
    $one = static fn (string $c, string $from) => ['kind' => 'one', 'collection' => $c, 'from' => $from, 'to' => 'id'];
    $schema = new \Zero\Schema(['version' => 3, 'runtime' => \Zero\Schema::SERIES, 'collections' => [
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
    $raw = ['version' => 3, 'runtime' => \Zero\Schema::SERIES, 'collections' => []];
    foreach (['accounts', 'articles', 'comments'] as $t) {
        $raw['collections'][$t] = $schema->collection($t) + ['editor' => false, 'table' => "zero_rf_$t"];
    }
    $schema = new \Zero\Schema($raw);
    $wp->exec('CREATE TABLE {prefix}zero_rf_accounts (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `apiKey` LONGTEXT NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}zero_rf_articles (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `secret` LONGTEXT, `ownerId` BIGINT, `status` VARCHAR(191) NOT NULL, `publishedAt` CHAR(24), PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}zero_rf_comments (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `articleId` BIGINT, `ownerId` BIGINT, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $wp->exec("INSERT INTO {prefix}zero_rf_accounts VALUES (1, 'sk_live_7x')");
    $wp->exec("INSERT INTO {prefix}zero_rf_articles VALUES (1, 'price=42', NULL, 'draft', NULL), (2, 'open', 1, 'published', '2026-01-01T00:00:00.000Z')");
    $wp->exec('INSERT INTO {prefix}zero_rf_comments VALUES (1, 1, 1), (2, 2, NULL)');
    $store = \Zero\Wp\CompositeStore::create($schema, $wp->connection());
    $db = new \Zero\Db($store, $schema, \Zero\db()->media());
    $anon = new \Zero\Viewer(null);
    $editor = new \Zero\Viewer(['id' => 1, 'name' => 'ed', 'role' => 'editor']);
    $admin = new \Zero\Viewer(['id' => 2, 'name' => 'root', 'role' => 'admin']);
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

// ================================================================ field access (lane B, phase 2 §4)

// The field-access users are WordPress users (created at install); rules see them as Zero maps them.
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
problem('columns selecting a hidden column', fn () => $db->findMany('profiles', ['columns' => ['email' => true]], new \Zero\Viewer(null)), 403, 'forbidden', '/columns/email');
problem('columns selecting a column with a per-row rule', fn () => $db->findMany('profiles', ['columns' => ['salary' => true]], new \Zero\Viewer($fa['fa_alice']['user'])), 403, 'forbidden', '/columns/salary');
eq('excluding a hidden column is allowed', array_keys($db->findMany('profiles', ['columns' => ['email' => false], 'limit' => 1], new \Zero\Viewer(null))[0]), ['id', 'name', 'ownerId', 'approved', 'notes', 'blocks', 'stamp', 'pairs', 'rounds', 'fixed', 'gated', 'seeded', 'vault', 'seen', 'cleared', 'meta', 'checks', 'tasks', 'teamId']);
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
$aliceViewer = new \Zero\Viewer($fa['fa_alice']['user']);
problem('an update selector on a hidden column is refused', fn () => $db->update('profiles', ['name' => 'x'], ['email' => 'alice@example.test'], true, $aliceViewer), 403, 'forbidden', '/where/email');
problem('… and a delete selector', fn () => $db->delete('profiles', ['salary' => -1], true, new \Zero\Viewer($fa['fa_ed']['user'])), 403, 'forbidden', '/where/salary');
// An unchanged resend must be the same value: a list resent as an object is a change.
$db->update('profiles', ['meta' => ['a', 'b']], ['id' => $mine['id']]);
$faProblem('a list resent as an object with numeric keys is refused', $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['meta' => ['1' => 'b', '0' => 'a']]), 403, 'forbidden', '/meta');
eq('… the stored list is untouched, and the true resend passes', [\Zero\Seam::toWire($db->findFirst('profiles', ['where' => ['id' => $mine['id']]])['meta']), $as('fa_alice', 'PATCH', "/profiles/{$mine['id']}", ['meta' => ['a', 'b']])[0]], [['a', 'b'], 200]);
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
// Restore replays every user column as a patch: readable values she can't set pass unchanged, but a
// value she can neither read nor set is refused whatever it is (an update must not probe hidden values).
// (email, hidden from her too, is the first column the replay would overwrite)
$faProblem('an owner can\'t restore over a value hidden from her', $as('fa_alice', 'POST', "/profiles/{$mine['id']}/revisions/$rev/restore"), 403, 'forbidden', '/email');
eq('an admin restores the same revision', $as('fa_admin', 'POST', "/profiles/{$mine['id']}/revisions/$rev/restore")[0], 200);

// /_schema reports per-column summaries (no function names).
$described = $as(null, 'GET', '/_schema')[1]['collections']['profiles'];
eq('/_schema access.fields summaries', $described['access']['fields'], ['email' => ['read' => 'editor'], 'salary' => ['read' => 'rule', 'update' => 'admin'], 'approved' => ['create' => 'editor', 'update' => 'editor'], 'mentorId' => ['read' => 'editor'], 'fixed' => ['update' => false], 'seen' => ['update' => false], 'locker' => ['read' => 'editor'], 'diary' => ['read' => 'editor'], 'entries' => ['read' => 'editor'], 'cleared' => ['update' => 'rule'], 'meta' => ['update' => false]]);

// ================================================================ globals: one instant per update

// ================================================================ globals: one instant per update

// A global update fills never-written `now` fields and the patch's nested defaults at one instant,
// although every clock read here moves the pinned clock a millisecond (ZERO_NOW_STEP).
(static function (): void {
    $now = ['now' => true];
    $wp = $GLOBALS['wp'];
    $schema = new \Zero\Schema(['version' => 3, 'runtime' => \Zero\Schema::SERIES, 'collections' => [], 'globals' => ['site' => [
        'label' => 'site', 'agents' => true, 'access' => ['read' => ['role' => 'anyone'], 'update' => ['role' => 'editor']],
        'wp' => ['postId' => 'zero_global_site', 'menuSlug' => 'zero-global-site', 'groupKey' => 'group_zero_global_site', 'fieldKeyPrefix' => 'field_zero_global_site_', 'optionPrefix' => 'zero_global_site_'],
        'fields' => [
            'createdAt' => ['type' => 'timestamp', 'default' => $now],
            'audit' => ['type' => 'group', 'fields' => ['at' => ['type' => 'timestamp', 'default' => $now]]],
        ],
    ]]]);
    // Globals are SCF option fields: SCF must know this global's fields to write them.
    \Zero\Wp\Scf::register($schema);
    $store = \Zero\Wp\CompositeStore::create($schema, $wp->connection());
    $db = new \Zero\Db($store, $schema, \Zero\db()->media());
    putenv('ZERO_NOW=2030-01-01T00:00:00.000Z');
    putenv('ZERO_NOW_STEP=1');
    try {
        $site = $db->globalUpdate('site', ['audit' => []]);
    } finally {
        putenv('ZERO_NOW_STEP');
        putenv('ZERO_NOW');
    }
    eq('a global update stores its now defaults at one instant', [$site['createdAt'], $site['audit']['at']], ['2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z']);
})();

// ================================================================ JSON identity at query boundaries

// An access rule sees a list-typed patch as a handle; JSON columns retain nested object shape.
(static function (): void {
    eval('namespace ZeroApp; function marked__update($ctx) { return !\Zero\Js::includes($ctx->p["data"]->p["tags"], "locked"); }');
    // A read rule returning a filter that contains an empty object: compiled `{ AND: [{}] }`.
    eval('namespace ZeroApp; function marked__read($ctx) { return ["AND" => [new \\Zero\\JsObject()]]; }');
    $schema = new \Zero\Schema(['version' => 3, 'runtime' => \Zero\Schema::SERIES, 'collections' => ['marked' => [
        'primaryKey' => 'id', 'editor' => false, 'table' => 'zero_marked', 'access' => ['read' => ['fn' => 'marked__read'], 'update' => ['fn' => 'marked__update']],
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
    $wp->exec('CREATE TABLE {prefix}zero_marked (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `tags` LONGTEXT, `meta` LONGTEXT, `info` LONGTEXT, `parentId` BIGINT, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $store = \Zero\Wp\CompositeStore::create($schema, $wp->connection());
    $db = new \Zero\Db($store, $schema, \Zero\db()->media());
    $previous = \Zero\Db::instance();
    \Zero\Db::setInstance($db); // registered extensions read the active Db's schema
    try {
        $row = $db->insert('marked', ['tags' => ['open']], true)[0];
        $viewer = new \Zero\Viewer(['id' => 1, 'name' => 'ed', 'role' => 'editor']);
        $patch = \Zero\Js::decodeJson('{"tags":[],"meta":{"a":{}}}');
        try {
            $updated = $db->update('marked', $patch, ['id' => $row['id']], true, $viewer)[0];
            $got = [$updated['tags'], \Zero\Js::jsonStringify($updated['meta'])];
        } catch (\Throwable $e) {
            $got = $e::class . ': ' . $e->getMessage();
        }
        eq('an update rule gets list handles; the json() value keeps {}', $got, [[], '{"a":{}}']);
        // A json() filter operand keeps `{}`: deleting rows whose meta is {} leaves the one holding [].
        $db->insert('marked', [['meta' => \Zero\Js::decodeJson('{}')], ['meta' => []]]);
        $db->delete('marked', \Zero\Js::decodeJson('{"meta":{"eq":{}}}'));
        eq('a json() filter compares {} and [] as different values', array_map(static fn ($r) => \Zero\Js::jsonStringify($r['meta']),
            $db->findMany('marked', ['orderBy' => ['id' => 'asc']])), ['{"a":{}}', '[]']);
        // The same holds in nested `with` options, in a json() sub-field of a structured filter, and
        // under a viewer whose read rule returns a filter containing {} (all flattened by schema).
        $parent = $db->findFirst('marked', ['orderBy' => ['id' => 'asc']]);
        $db->insert('marked', [['parentId' => $parent['id'], 'meta' => \Zero\Js::decodeJson('{}'), 'info' => ['extra' => \Zero\Js::decodeJson('{}')]],
            ['parentId' => $parent['id'], 'meta' => [], 'info' => ['extra' => []]]]);
        $kids = $db->findFirst('marked', \Zero\Js::decodeJson('{"where":{"id":' . $parent['id'] . '},"with":{"kids":{"where":{"meta":{"eq":{}}}}}}'))['kids'];
        $byInfo = $db->findMany('marked', \Zero\Js::decodeJson('{"where":{"info":{"eq":{"extra":{}}}}}'));
        $asViewer = $db->findMany('marked', [], new \Zero\Viewer(null));
        eq('permission checks run a rule filter holding {} like reads do', [
            $db->permits('marked', 'read', $parent['id'], new \Zero\Viewer(null)),
            count($db->permittedKeys('marked', 'read', new \Zero\Viewer(null)) ?? []),
        ], [true, 4]);
        eq('json() operands keep {} in with, in structured filters, and beside rule filters', [
            array_map(static fn ($r) => \Zero\Js::jsonStringify($r['meta']), $kids),
            array_map(static fn ($r) => \Zero\Js::jsonStringify($r['info']['extra']), $byInfo),
            count($asViewer),
        ], [['{}'], ['{}'], 4]);
    } finally {
        \Zero\Db::setInstance($previous);
    }
})();

// ================================================================ callback ownership and JSON boundaries
(static function (): void {
    eval(<<<'CODE'
    namespace ZeroApp;
    function refs__before($data, $ctx) {
        if ($data !== $ctx->p['data']) throw new \RuntimeException('before alias');
        if ($data->p['meta'] instanceof \Zero\JsObject && isset($data->p['meta']->p['x'])) $data->p['meta']->p['x'] = 2;
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
        if ($row->p['meta'] instanceof \Zero\JsObject && isset($row->p['meta']->p['x'])) $row->p['meta']->p['x'] = 100;
    }
    function refs__input($input, $ctx) { return $input->p['info']->p['extra']; }
    CODE);
    $columns = [
        'id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true],
        'meta' => ['type' => 'json', 'rules' => ['validate' => 'refs__validate'], 'access' => ['update' => ['allow' => false]]],
        'info' => ['type' => 'group', 'fields' => ['extra' => ['type' => 'json', 'default' => ['json' => '{"1":1,"0":2}']]], 'default' => ['json' => '{}']],
    ];
    $schema = new \Zero\Schema(['version' => 3, 'runtime' => \Zero\Schema::SERIES, 'collections' => ['refs' => [
        'primaryKey' => 'id', 'editor' => false, 'table' => 'zero_refs', 'columns' => $columns,
        'access' => ['read' => ['allow' => true], 'update' => ['allow' => true]],
        'hooks' => ['beforeCreate' => 'refs__before', 'afterCreate' => 'refs__after'],
        'relations' => ['self' => ['kind' => 'one', 'collection' => 'refs', 'from' => 'id', 'to' => 'id']],
    ]]]);
    $wp = $GLOBALS['wp'];
    $wp->exec('CREATE TABLE {prefix}zero_refs (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `meta` LONGTEXT, `info` LONGTEXT, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $db = new \Zero\Db(\Zero\Wp\CompositeStore::create($schema, $wp->connection()), $schema, \Zero\db()->media());
    $previous = \Zero\Db::instance();
    \Zero\Db::setInstance($db);
    $seen = null;
    \Zero\Extensions::onWrite(static function (string $op, string $collection, array &$data) use (&$seen): void {
        if ($collection === 'refs') $seen = is_array($data);
    });
    try {
        $source = new \Zero\JsObject(['x' => 1]);
        $GLOBALS['refsCaptured'] = $source;
        $row = $db->insert('refs', new \Zero\JsObject(['meta' => $source]), true)[0];
        eq('before mutations persist; validator, capture and after mutations are isolated', [
            $seen, $row['meta']->p['x'], $db->findFirst('refs')['meta']->p['x'], $source->p['x'],
        ], [true, 2, 2, 99]);
        eq('a group default fills nested JSON defaults as objects', \Zero\Js::jsonStringify($row['info']), '{"extra":{"0":2,"1":1}}');
        foreach (['{}', '[]', '{"1":1,"0":2}', '{"\u0000":1}'] as $json) {
            $value = \Zero\Js::decodeJson($json);
            $created = $db->insert('refs', ['meta' => $value, 'info' => []], true)[0];
            $read = $db->findFirst('refs', ['where' => ['id' => $created['id']]]);
            eq("JSON insert/read/response: $json", \Zero\Js::jsonStringify($read['meta']), \Zero\Js::jsonStringify($value));
        }
        $protected = $db->insert('refs', ['meta' => \Zero\Js::decodeJson('{"a":1,"b":{"n":2}}')], true)[0];
        $viewer = new \Zero\Viewer(['id' => 1, 'name' => 'Ed', 'role' => 'editor']);
        $same = $db->update('refs', ['meta' => \Zero\Js::decodeJson('{"b":{"n":2},"a":1}')], ['id' => $protected['id']], true, $viewer)[0];
        eq('a protected JSON echo compares object keys structurally', $same['meta']->p['b']->p['n'], 2);
        problem('a nested JSON change is a protected write', fn () => $db->update('refs', ['meta' => \Zero\Js::decodeJson('{"b":{"n":3},"a":1}')], ['id' => $protected['id']], true, $viewer), 403, 'forbidden', '/meta');
        eq('sameJson detects a nested handle change', \Zero\Js::sameJson($same['meta'], \Zero\Js::decodeJson('{"b":{"n":3},"a":1}')), false);
        $jsRow = \Zero\Seam::findFirst('refs', ['where' => ['id' => $row['id']], 'with' => ['self' => true]]);
        eq('row handles enumerate columns and attached relations', [\Zero\Js::keys($jsRow)->a, $jsRow->p['self']->p['id']], [[...array_keys($columns), 'self'], $row['id']]);
        problem('cyclic write inputs are a validation error', static function () use ($db): void {
            $cycle = new \Zero\JsObject(); $cycle->p['self'] = $cycle;
            $db->insert('refs', ['meta' => $cycle]);
        }, 422, 'invalid_input');
    } finally { \Zero\Db::setInstance($previous); unset($GLOBALS['refsCaptured']); }
})();

// ================================================================ a second Db keeps its own rules

// Extensions (field access, sync, locales, files…) reach the schema through db(): that must be the
// Db running the operation, not the booted app's, or a second Db silently loses its field rules.
(static function (): void {
    $wp = $GLOBALS['wp'];
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
    eval('namespace ZeroApp; function scoped__rule($ctx) { return \\Zero\\db()->schema()->hasCollection("people"); } function scoped__default() { return \\Zero\\db()->schema()->hasCollection("people") ? "secondary" : "booted"; }');
    $schema = new \Zero\Schema(['version' => 3, 'runtime' => \Zero\Schema::SERIES, 'collections' => [
        'people' => ['primaryKey' => 'id', 'editor' => false, 'table' => 'zero_scoped_people', 'revisions' => true, 'access' => ['read' => ['fn' => 'scoped__rule'], 'update' => ['fn' => 'scoped__rule']],
            'columns' => ['id' => $id, 'name' => ['type' => 'text', 'notNull' => true], 'ssn' => ['type' => 'text', 'access' => ['read' => ['role' => 'admin']]]]],
    ], 'globals' => ['scope' => ['label' => 'scope', 'agents' => true, 'fields' => ['name' => ['type' => 'text', 'default' => ['fn' => 'scoped__default']]], 'access' => ['read' => ['fn' => 'scoped__rule'], 'update' => ['fn' => 'scoped__rule']],
        'wp' => ['postId' => 'zero_global_scope', 'menuSlug' => 'zero-global-scope', 'groupKey' => 'group_zero_global_scope', 'fieldKeyPrefix' => 'field_zero_global_scope_', 'optionPrefix' => 'zero_global_scope_']]]]);
    \Zero\Wp\Scf::register($schema);
    $wp->exec('CREATE TABLE {prefix}zero_scoped_people (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `name` LONGTEXT NOT NULL, `ssn` LONGTEXT, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $store = \Zero\Wp\CompositeStore::create($schema, $wp->connection());
    $db = new \Zero\Db($store, $schema, \Zero\db()->media());
    $db->insert('people', ['name' => 'p', 'ssn' => '123-45-6789']);
    eq('field rules of a second Db apply to it', array_key_exists('ssn', $db->findFirst('people', [], new \Zero\Viewer(null))), false);
    eq('… and its trusted reads see the column', $db->findFirst('people')['ssn'], '123-45-6789');
    $viewer = new \Zero\Viewer(['id' => 1, 'role' => 'admin']);
    eq('direct permission rules query the secondary schema', [$db->permits('people', 'read', 1, $viewer), $db->permittedKeys('people', 'update', $viewer)], [true, null]);
    $revisions = $db->revisions('people', 1, $viewer);
    eq('revision authorization queries the secondary schema', count($revisions), 1);
    eq('revision restore authorization keeps the secondary schema', $db->restoreRevision('people', 1, $revisions[0]['id'], $viewer)['name'], 'p');
    \Zero\Extensions::beforeRead(static function (string $collection, array &$opts): void {
        if ($collection === 'people' && !\Zero\db()->schema()->hasCollection('people')) {
            throw new \RuntimeException('wrong query Db');
        }
    }, constraintSafe: true);
    eq('editor captures dispatch query extensions in their own Db', $db->editorRow('people', 1)['name'], 'p');
    eq('global rules and default generators use the secondary schema', $db->globalGet('scope', $viewer)['name'], 'secondary');
    eq('global update authorization uses the secondary schema', $db->globalUpdate('scope', ['name' => 'saved'], $viewer)['name'], 'saved');
    $shared = new \Zero\Db($store, new \Zero\Schema(['version' => 3, 'runtime' => \Zero\Schema::SERIES, 'collections' => []]), $db->media());
    $committed = [];
    $shared->transaction(function () use ($db, &$committed): void {
        $db->transaction(function () use ($db, &$committed): void {
            \Zero\Extensions::afterCommit(function () use (&$committed): void {
                $committed[] = \Zero\db()->schema()->hasCollection('people');
            });
        });
        eq('a secondary Db callback waits for the shared outer commit', $committed, []);
    });
    eq('deferred callbacks retain the registering Db', $committed, [true]);
    eq('the booted app\'s db() is back afterwards', \Zero\db()->schema()->hasCollection('profiles'), true);
})();

// ================================================================ write errors don't reveal what the viewer can't read

// A unique conflict or a dangling reference is an answer about stored rows. Writes may only get one
// about rows the viewer could read anyway (review: field-unique-oracle, ref-existence-oracle).
(static function (): void {
    $wp = $GLOBALS['wp'];
    $id = ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true];
    $anyone = ['role' => 'anyone'];
    $table = static fn (string $name, array $access, array $columns): array => ['primaryKey' => 'id', 'editor' => false, 'table' => "zero_$name", 'access' => $access, 'columns' => ['id' => $id] + $columns];
    $schema = new \Zero\Schema(['version' => 3, 'runtime' => \Zero\Schema::SERIES, 'collections' => [
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
    ]]);
    $wp->exec('CREATE TABLE {prefix}zero_subscribers (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `email` VARCHAR(191) NOT NULL, `note` LONGTEXT, PRIMARY KEY (`id`), UNIQUE KEY `email_unique` (`email`)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}zero_people (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `name` LONGTEXT NOT NULL, `ssn` VARCHAR(191), PRIMARY KEY (`id`), UNIQUE KEY `ssn_unique` (`ssn`)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}zero_notes (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `body` LONGTEXT NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB');
    $wp->exec('CREATE TABLE {prefix}zero_tags (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `name` LONGTEXT NOT NULL, `noteId` BIGINT UNSIGNED, PRIMARY KEY (`id`), CONSTRAINT `zero_tags_noteId_fk` FOREIGN KEY (`noteId`) REFERENCES {prefix}zero_notes (`id`)) ENGINE=InnoDB');
    $store = \Zero\Wp\CompositeStore::create($schema, $wp->connection());
    $db = new \Zero\Db($store, $schema, \Zero\db()->media());
    $previous = \Zero\Db::instance();
    \Zero\Db::setInstance($db); // registered extensions read the active Db's schema
    $anon = new \Zero\Viewer(null);
    $sub = new \Zero\Viewer(['id' => 5, 'name' => 'sub', 'role' => 'subscriber']);
    $admin = new \Zero\Viewer(['id' => 2, 'name' => 'root', 'role' => 'admin']);
    $editor = new \Zero\Viewer(['id' => 3, 'name' => 'ed', 'role' => 'editor']);
    $count = static fn (string $c) => (int) $wp->scalar("SELECT COUNT(*) FROM {prefix}zero_$c");
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
                return \Zero\App::problem($e);
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
        $unreferenced = $db->insert('notes', ['body' => 'no children'], true)[0];
        foreach ([$note, $unreferenced] as $parent) {
            problem('unreadable restrictive children refuse deletion whether present or absent', fn () => $db->delete('notes', ['id' => $parent['id']], true, $editor), 409, 'reference_violation');
        }
        eq('refused deletes preserve both parents', $count('notes'), 2);
        eq('trusted writes (hooks, CLI) check existence only', $db->insert('tags', ['name' => 'w', 'noteId' => $note['id']], true)[0]['noteId'], $note['id']);
    } finally {
        \Zero\Db::setInstance($previous);
    }
})();

finish('db_test');
