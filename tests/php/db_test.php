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

$now    = array( 'now' => true );
$open   = array(
	'read'   => array( 'role' => 'anyone' ),
	'create' => array( 'role' => 'anyone' ),
	'update' => array( 'role' => 'anyone' ),
	'delete' => array( 'role' => 'anyone' ),
);
$schema = array(
	'name'        => 'dbtest',
	'collections' => array(
		'locations' => array(
			'primaryKey'        => 'id',
			'columns'           => array(
				'id'        => array(
					'type'          => 'integer',
					'primaryKey'    => true,
					'autoIncrement' => true,
					'notNull'       => true,
				),
				'name'      => array(
					'type'    => 'text',
					'notNull' => true,
					'unique'  => true,
				),
				'code'      => array(
					'type'    => 'text',
					'notNull' => true,
				),
				'kind'      => array(
					'type'    => 'text',
					'notNull' => true,
					'enum'    => array( 'shelf', 'bin' ),
					'default' => array( 'value' => 'shelf' ),
				),
				'active'    => array(
					'type'    => 'boolean',
					'notNull' => true,
					'default' => array( 'value' => true ),
				),
				'meta'      => array( 'type' => 'json' ),
				'createdAt' => array(
					'type'    => 'timestamp',
					'notNull' => true,
					'default' => $now,
				),
				// A function default between the two `now` defaults that moves the clock.
				'tick'      => array(
					'type'    => 'text',
					'default' => array( 'fn' => 'locations__tick' ),
				),
				'audit'     => array(
					'type'    => 'group',
					'fields'  => array(
						'at' => array(
							'type'    => 'timestamp',
							'default' => $now,
						),
					),
					'default' => array( 'value' => array() ),
				),
				'updatedAt' => array(
					'type'     => 'timestamp',
					'notNull'  => true,
					'default'  => $now,
					'onUpdate' => $now,
				),
			),
			'relations'         => array(
				'items' => array(
					'kind'       => 'many',
					'collection' => 'items',
					'from'       => 'id',
					'to'         => 'locationId',
				),
			),
			'hooks'             => array( 'beforeCreate' => 'locations__beforeCreate' ),
			'beforeCreateFills' => array( 'code' ),
			'access'            => $open,
			'api'               => array(
				'list'   => true,
				'get'    => true,
				'create' => true,
				'update' => true,
				'delete' => true,
			),
		),
		'items'     => array(
			'primaryKey' => 'id',
			'columns'    => array(
				'id'         => array(
					'type'          => 'integer',
					'primaryKey'    => true,
					'autoIncrement' => true,
					'notNull'       => true,
				),
				'name'       => array(
					'type'    => 'text',
					'notNull' => true,
				),
				'qty'        => array(
					'type'    => 'integer',
					'notNull' => true,
					'default' => array( 'value' => 1 ),
				),
				'price'      => array( 'type' => 'real' ),
				'seenAt'     => array( 'type' => 'timestamp' ),
				'bestBefore' => array( 'type' => 'date' ),
				'locationId' => array(
					'type'       => 'integer',
					'references' => array(
						'collection' => 'locations',
						'column'     => 'id',
						'onDelete'   => 'cascade',
					),
				),
			),
			'relations'  => array(
				'location' => array(
					'kind'       => 'one',
					'collection' => 'locations',
					'from'       => 'locationId',
					'to'         => 'id',
					'optional'   => true,
				),
			),
			'hooks'      => array(
				'beforeCreate' => 'items__beforeCreate',
				'afterUpdate'  => 'items__afterUpdate',
			),
			'access'     => $open,
			'api'        => array(
				'list'   => true,
				'get'    => true,
				'create' => true,
				'update' => true,
				'delete' => true,
			),
		),
		'logs'      => array(
			'primaryKey' => 'id',
			'columns'    => array(
				'id'      => array(
					'type'          => 'integer',
					'primaryKey'    => true,
					'autoIncrement' => true,
					'notNull'       => true,
				),
				'message' => array(
					'type'    => 'text',
					'notNull' => true,
				),
				'at'      => array(
					'type'    => 'timestamp',
					'notNull' => true,
					'default' => $now,
				),
			),
			'relations'  => array(),
			'hooks'      => array( 'afterCreate' => 'logs__afterCreate' ),
			'access'     => $open,
			'api'        => array(
				'list'   => true,
				'get'    => true,
				'create' => false,
				'update' => false,
				'delete' => false,
			),
		),
		// ---- lane B: field access
		'teams'     => array(
			'primaryKey' => 'id',
			'columns'    => array(
				'id'     => array(
					'type'          => 'integer',
					'primaryKey'    => true,
					'autoIncrement' => true,
					'notNull'       => true,
				),
				'name'   => array(
					'type'    => 'text',
					'notNull' => true,
				),
				'budget' => array(
					'type'   => 'integer',
					'access' => array(
						'read'   => array( 'role' => 'admin' ),
						'update' => array( 'role' => 'admin' ),
					),
				),
			),
			'relations'  => array(
				'members' => array(
					'kind'       => 'many',
					'collection' => 'profiles',
					'from'       => 'id',
					'to'         => 'teamId',
				),
			),
			'access'     => $open,
			'api'        => array(
				'list'   => true,
				'get'    => true,
				'create' => true,
				'update' => true,
				'delete' => true,
			),
		),
		'profiles'  => array(
			'primaryKey' => 'id',
			'revisions'  => true,
			'columns'    => array(
				'id'       => array(
					'type'          => 'integer',
					'primaryKey'    => true,
					'autoIncrement' => true,
					'notNull'       => true,
				),
				'name'     => array(
					'type'    => 'text',
					'notNull' => true,
				),
				'email'    => array(
					'type'   => 'email',
					'access' => array( 'read' => array( 'role' => 'editor' ) ),
				),
				'ownerId'  => array( 'type' => 'integer' ),
				'salary'   => array(
					'type'   => 'integer',
					'access' => array(
						'read'   => array( 'fn' => 'profiles__field__salary__read' ),
						'update' => array( 'role' => 'admin' ),
					),
				),
				'approved' => array(
					'type'    => 'boolean',
					'notNull' => true,
					'default' => array( 'value' => false ),
					'access'  => array(
						'create' => array( 'role' => 'editor' ),
						'update' => array( 'role' => 'editor' ),
					),
				),
				'notes'    => array(
					'type'   => 'group',
					'fields' => array(
						'public'  => array( 'type' => 'text' ),
						'private' => array(
							'type'   => 'text',
							'access' => array( 'read' => array( 'role' => 'editor' ) ),
						),
						'flag'    => array(
							'type'   => 'boolean',
							'access' => array(
								'read'   => array( 'role' => 'editor' ),
								'update' => array( 'role' => 'editor' ),
							),
						),
						'pinned'  => array(
							'type'    => 'boolean',
							'notNull' => true,
							'default' => array( 'value' => true ),
						),
						'tag'     => array(
							'type'   => 'text',
							'access' => array(
								'create' => array( 'fn' => 'profiles__field__notes__tag__create' ),
								'update' => array( 'fn' => 'profiles__field__notes__tag__update' ),
							),
						),
					),
				),
				'blocks'   => array(
					'type'    => 'blocks',
					'layouts' => array(
						'memo' => array(
							'text' => array(
								'type'   => 'text',
								'access' => array( 'update' => array( 'role' => 'editor' ) ),
							),
						),
						'link' => array( 'href' => array( 'type' => 'text' ) ),
					),
				),
				'mentorId' => array(
					'type'   => 'integer',
					'access' => array( 'read' => array( 'role' => 'editor' ) ),
				),
				'stamp'    => array(
					'type'   => 'group',
					'fields' => array(
						'n'    => array(
							'type'    => 'integer',
							'default' => array( 'fn' => 'profiles__stamp__n__default' ),
						),
						'note' => array(
							'type'   => 'text',
							'access' => array( 'create' => array( 'fn' => 'profiles__field__stamp__note__create' ) ),
						),
					),
				),
				'pairs'    => array(
					'type'   => 'repeater',
					'fields' => array(
						'label'   => array( 'type' => 'text' ),
						'details' => array(
							'type'   => 'group',
							'fields' => array(
								'secret' => array(
									'type'   => 'text',
									'access' => array(
										'read'   => array( 'role' => 'admin' ),
										'update' => array( 'role' => 'admin' ),
									),
								),
							),
						),
					),
				),
				'rounds'   => array(
					'type'   => 'repeater',
					'fields' => array(
						'n'    => array(
							'type'    => 'integer',
							'default' => array( 'fn' => 'profiles__stamp__n__default' ),
						),
						'note' => array(
							'type'   => 'text',
							'access' => array( 'update' => array( 'fn' => 'profiles__field__rounds__note__update' ) ),
						),
					),
				),
				'fixed'    => array(
					'type'   => 'group',
					'access' => array( 'update' => array( 'allow' => false ) ),
					'fields' => array(
						'a' => array( 'type' => 'text' ),
						'b' => array( 'type' => 'text' ),
					),
				),
				'gated'    => array(
					'type'   => 'group',
					'fields' => array(
						'gate' => array(
							'type'    => 'boolean',
							'default' => array( 'value' => true ),
							'access'  => array(
								'read'   => array( 'role' => 'editor' ),
								'update' => array( 'role' => 'editor' ),
							),
						),
						'door' => array(
							'type'   => 'text',
							'access' => array( 'update' => array( 'fn' => 'profiles__field__gated__door__update' ) ),
						),
					),
				),
				'seeded'   => array(
					'type'   => 'repeater',
					'fields' => array(
						'label'  => array( 'type' => 'text' ),
						'origin' => array(
							'type'    => 'text',
							'default' => array( 'value' => 'api' ),
							'access'  => array(
								'create' => array( 'allow' => false ),
								'update' => array( 'allow' => false ),
							),
						),
					),
				),
				// door is declared before the group whose hidden value its rule reads.
				'vault'    => array(
					'type'   => 'group',
					'fields' => array(
						'door'   => array(
							'type'   => 'text',
							'access' => array( 'update' => array( 'fn' => 'profiles__field__vault__door__update' ) ),
						),
						'config' => array(
							'type'   => 'group',
							'fields' => array(
								'locked' => array(
									'type'   => 'boolean',
									'access' => array(
										'read'   => array( 'role' => 'editor' ),
										'update' => array( 'role' => 'editor' ),
									),
								),
							),
						),
					),
				),
				'seen'     => array(
					'type'   => 'group',
					'access' => array( 'update' => array( 'allow' => false ) ),
					'fields' => array(
						'x' => array(
							'type'   => 'text',
							'access' => array( 'read' => array( 'fn' => 'profiles__field__seen__x__read' ) ),
						),
					),
				),
				// Hidden containers holding unwritable fields (round-11 review).
				'locker'   => array(
					'type'   => 'group',
					'access' => array( 'read' => array( 'role' => 'editor' ) ),
					'fields' => array(
						'pin' => array(
							'type'   => 'text',
							'access' => array( 'update' => array( 'role' => 'editor' ) ),
						),
					),
				),
				'diary'    => array(
					'type'   => 'repeater',
					'access' => array( 'read' => array( 'role' => 'editor' ) ),
					'fields' => array(
						'label'  => array( 'type' => 'text' ),
						'secret' => array(
							'type'   => 'text',
							'access' => array( 'read' => array( 'role' => 'admin' ) ),
						),
					),
				),
				'entries'  => array(
					'type'   => 'repeater',
					'access' => array( 'read' => array( 'role' => 'editor' ) ),
					'fields' => array(
						'v' => array(
							'type'   => 'text',
							'access' => array( 'update' => array( 'role' => 'editor' ) ),
						),
					),
				),
				'cleared'  => array(
					'type'   => 'boolean',
					'access' => array( 'update' => array( 'fn' => 'profiles__field__cleared__update' ) ),
				),
				'meta'     => array(
					'type'   => 'json',
					'access' => array( 'update' => array( 'allow' => false ) ),
				),
				'checks'   => array(
					'type'   => 'repeater',
					'fields' => array(
						'open' => array( 'type' => 'boolean' ),
						'note' => array(
							'type'   => 'text',
							'access' => array( 'update' => array( 'fn' => 'profiles__field__checks__note__update' ) ),
						),
					),
				),
				'tasks'    => array(
					'type'   => 'repeater',
					'fields' => array(
						'label'  => array( 'type' => 'text' ),
						'rate'   => array(
							'type'   => 'integer',
							'access' => array( 'update' => array( 'role' => 'editor' ) ),
						),
						'secret' => array(
							'type'   => 'text',
							'access' => array(
								'read'   => array( 'allow' => false ),
								'update' => array( 'allow' => true ),
							),
						),
					),
				),
				'teamId'   => array(
					'type'       => 'integer',
					'references' => array(
						'collection' => 'teams',
						'column'     => 'id',
						'onDelete'   => 'set null',
					),
				),
			),
			'relations'  => array(
				'team'    => array(
					'kind'       => 'one',
					'collection' => 'teams',
					'from'       => 'teamId',
					'to'         => 'id',
					'optional'   => true,
				),
				'mentor'  => array(
					'kind'       => 'one',
					'collection' => 'profiles',
					'from'       => 'mentorId',
					'to'         => 'id',
					'optional'   => true,
				),
				'mentees' => array(
					'kind'       => 'many',
					'collection' => 'profiles',
					'from'       => 'id',
					'to'         => 'mentorId',
				),
			),
			'access'     => array(
				'read'   => array( 'role' => 'anyone' ),
				'create' => array( 'role' => 'author' ),
				'update' => array( 'fn' => 'profiles__access__update' ),
				'delete' => array( 'role' => 'editor' ),
			),
			'api'        => array(
				'list'   => true,
				'get'    => true,
				'create' => true,
				'update' => true,
				'delete' => true,
			),
		),
		// ---- ref(labels).many(): what `spacepress build` emits (tests/compiler.rs owns that shape)
		'labels'    => array(
			'primaryKey' => 'id',
			'columns'    => array(
				'id'     => array(
					'type'          => 'integer',
					'primaryKey'    => true,
					'autoIncrement' => true,
					'notNull'       => true,
				),
				'name'   => array(
					'type'    => 'text',
					'notNull' => true,
				),
				'secret' => array(
					'type'    => 'boolean',
					'notNull' => true,
					'default' => array( 'value' => false ),
				),
			),
			'relations'  => array(
				'cards'    => array(
					'kind'       => 'many',
					'collection' => 'cards',
					'from'       => 'id',
					'to'         => 'id',
					'optional'   => false,
					'through'    => array(
						'table' => 'cards_labels',
						'from'  => 'target_id',
						'to'    => 'owner_id',
					),
				),
				'pinnedBy' => array(
					'kind'       => 'many',
					'collection' => 'cards',
					'from'       => 'id',
					'to'         => 'id',
					'optional'   => false,
					'through'    => array(
						'table' => 'cards_pinned',
						'from'  => 'target_id',
						'to'    => 'owner_id',
					),
				),
			),
			'access'     => array(
				'read'   => array( 'fn' => 'labels__access__read' ),
				'create' => array( 'role' => 'anyone' ),
				'update' => array( 'role' => 'anyone' ),
				'delete' => array( 'role' => 'anyone' ),
			),
			'api'        => array(
				'list'   => true,
				'get'    => true,
				'create' => true,
				'update' => true,
				'delete' => true,
			),
		),
		'cards'     => array(
			'primaryKey' => 'id',
			'columns'    => array(
				'id'     => array(
					'type'          => 'integer',
					'primaryKey'    => true,
					'autoIncrement' => true,
					'notNull'       => true,
				),
				'title'  => array(
					'type'    => 'text',
					'notNull' => true,
				),
				'labels' => array(
					'type'       => 'refList',
					'notNull'    => true,
					'references' => array(
						'collection' => 'labels',
						'column'     => 'id',
						'onDelete'   => 'cascade',
						'join'       => 'cards_labels',
					),
				),
				'pinned' => array(
					'type'       => 'refList',
					'references' => array(
						'collection' => 'labels',
						'column'     => 'id',
						'onDelete'   => 'restrict',
						'join'       => 'cards_pinned',
					),
				),
			),
			'relations'  => array(
				'labels' => array(
					'kind'       => 'many',
					'collection' => 'labels',
					'from'       => 'id',
					'to'         => 'id',
					'optional'   => false,
					'through'    => array(
						'table' => 'cards_labels',
						'from'  => 'owner_id',
						'to'    => 'target_id',
					),
				),
				'pinned' => array(
					'kind'       => 'many',
					'collection' => 'labels',
					'from'       => 'id',
					'to'         => 'id',
					'optional'   => false,
					'through'    => array(
						'table' => 'cards_pinned',
						'from'  => 'owner_id',
						'to'    => 'target_id',
					),
				),
			),
			'access'     => $open,
			'api'        => array(
				'list'   => true,
				'get'    => true,
				'create' => true,
				'update' => true,
				'delete' => true,
			),
		),
	),
	'actions'     => array(
		'restock' => array(
			'input'   => array(
				'itemId' => array(
					'type'    => 'integer',
					'notNull' => true,
				),
				'amount' => array(
					'type'    => 'integer',
					'notNull' => true,
					'default' => array( 'value' => 5 ),
				),
			),
			'handler' => 'action__restock',
			'access'  => array( 'role' => 'anyone' ),
		),
	),
);

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

$wp  = wpSite(
	'db',
	array(
		'schema'    => $schema,
		'functions' => $functions,
		'users'     => array(
			'fa_alice' => 'author',
			'fa_bob'   => 'author',
			'fa_ed'    => 'editor',
			'fa_admin' => 'admin',
		),
	)
);
$db  = \SpacePress\db();
$app = $wp->app();

function names( array $rows ): array {
	return array_column( $rows, 'name' );
}

// ================================================================ boot + migrate

eq(
	'activation applied the init migration and recorded it in the per-app ledger',
	$wp->sql( 'SELECT `id` FROM {prefix}sp__migrations WHERE `app` = ? ORDER BY `id`', array( 'dbtest' ) ),
	array( array( 'id' => '20261121000000_000000_init' ) )
);
eq( 'the app plugin is active with current storage', array( $wp->plugin()->unavailable(), $wp->plugin()->pendingMigrations() ), array( null, array() ) );
eq( 'the runtime describes its database as SQLite through the official plugin', \SpacePress\Wp\Platform::versions()['database']['kind'], 'sqlite' );
eq( 'platform problems accept SQLite Database Integration', \SpacePress\Wp\Platform::problems(), array() );
// Akismet isn't a platform plugin: this site has none, and the app mounted. Two Factor counts when loaded,
// not when stored as active: the host's v2 scope activates it per request.
eq(
	'the app mounted with no Akismet installed',
	array( is_dir( WP_PLUGIN_DIR . '/akismet' ), class_exists( 'Akismet', false ), \SpacePress\Wp\Platform::versions()['akismet'], \SpacePress\Wp\Platform::versions()['twoFactor'] ),
	array(
		false,
		false,
		array(
			'version'    => null,
			'spamChecks' => false,
		),
		'0.17.0',
	)
);
$stored = get_option( 'active_plugins' );
add_filter( 'pre_option_active_plugins', static fn (): array => array_values( array_diff( $stored, array( 'two-factor/two-factor.php' ) ) ) );
eq( 'platform problems read the loaded plugins, not the stored active list', \SpacePress\Wp\Platform::problems(), array() );
remove_all_filters( 'pre_option_active_plugins' );

// ================================================================ write pipeline: create


$tsPattern = '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/';
putenv( 'SP_NOW=2026-01-01T00:00:00.000Z' );
$garage = $db->insert(
	'locations',
	array(
		'name' => '  Garage  ',
		'meta' => array(
			'floor' => 1,
			'tags'  => array( 'a/b', 'é' ),
		),
	),
	true
)[0];
putenv( 'SP_NOW' );
eq( 'by-ref beforeCreate mutation is kept (trim + fill)', array( $garage['name'], $garage['code'] ), array( 'Garage', 'GAR' ) );
eq( 'defaults: enum value + boolean', array( $garage['kind'], $garage['active'] ), array( 'shelf', true ) );
eq(
	'default now: one instant per write, nested defaults included, even when the clock moves between defaults',
	array( $garage['createdAt'], $garage['updatedAt'], $garage['audit']['at'] ?? null ),
	array_fill( 0, 3, '2026-01-01T00:00:00.000Z' )
);
eq( 'json column round-trips', \SpacePress\Js::jsonStringify( $garage['meta'] ), '{"floor":1,"tags":["a/b","é"]}' );
eq( 'json stored with unescaped slashes/unicode', $wp->scalar( 'SELECT `meta` FROM {prefix}sp_locations WHERE `name` = ?', array( 'Garage' ) ), '{"floor":1,"tags":["a/b","é"]}' );

[$attic, $basement] = $db->insert(
	'locations',
	array(
		array(
			'name'      => 'Attic',
			'kind'      => 'bin',
			'active'    => false,
			'updatedAt' => '2000-01-01T00:00:00Z',
		),
		array( 'name' => 'Basement' ),
	),
	true
);
eq( 'multi-row insert + explicit timestamp normalized', $attic['updatedAt'], '2000-01-01T00:00:00.000Z' );

$items                         = $db->insert(
	'items',
	array(
		array(
			'name'       => 'hammer',
			'qty'        => 2,
			'price'      => 9.5,
			'locationId' => $garage['id'],
		),
		array(
			'name'       => 'nails',
			'qty'        => 100,
			'price'      => 2,
			'locationId' => $garage['id'],
			'seenAt'     => 0,
		),
		array(
			'name'   => 'box',
			'price'  => \SpacePress\Js::undefined(),
			'seenAt' => \SpacePress\Js::undefined(),
		),
		array(
			'name'       => 'lamp',
			'qty'        => 3.0,
			'locationId' => $attic['id'],
			'seenAt'     => '2024-03-01T01:30:00+02:00',
			'bestBefore' => '2024-02-29',
		),
	),
	true
);
[$hammer, $nails, $box, $lamp] = $items;
eq( 'beforeCreate return value replaces data', names( $items ), array( 'Hammer', 'Nails', 'Box', 'Lamp' ) );
eq( 'every column key present, nulls included', array_keys( $box ), array( 'id', 'name', 'qty', 'price', 'seenAt', 'bestBefore', 'locationId' ) );
eq( 'default value + nullable columns', array( $box['qty'], $box['price'], $box['locationId'] ), array( 1, null, null ) );
eq( 'explicit undefined persists as SQL null', $db->findFirst( 'items', array( 'where' => array( 'id' => $box['id'] ) ) )['price'], null );
check( 'integral float accepted for integer, int for real', 3 === $lamp['qty'] && 2.0 === $nails['price'], array( $lamp['qty'], $nails['price'] ) );
eq( 'timestamp from epoch ms and from offset string (normalized back onto a leap day)', array( $nails['seenAt'], $lamp['seenAt'] ), array( '1970-01-01T00:00:00.000Z', '2024-02-29T23:30:00.000Z' ) );
eq( 'date column', $lamp['bestBefore'], '2024-02-29' );
eq( 'insert without returning → null', $db->insert( 'logs', array( 'message' => 'hello' ) ), null );

// Step 2b: required fields are checked before the hook (the items hook throws LogicException otherwise).
problem( 'missing required field → invalid_input before beforeCreate', fn () => $db->insert( 'items', array( 'qty' => 1 ) ), 422, 'invalid_input', '/name' );
problem( 'missing required on a beforeCreateFills column is left to the hook… which forgot it', fn () => $db->insert( 'locations', array( 'name' => 'forget-code' ) ), 422, 'invalid_input', '/code' );
problem(
	'unknown key',
	fn () => $db->insert(
		'items',
		array(
			'name'  => 'x',
			'bogus' => 1,
		)
	),
	422,
	'invalid_input',
	'/bogus'
);
$e = problem(
	'fractional integer',
	fn () => $db->insert(
		'items',
		array(
			'name' => 'x',
			'qty'  => 1.5,
		)
	),
	422,
	'invalid_input',
	'/qty'
);
check( 'detail names the expected type', null !== $e && str_contains( $e->getMessage(), 'integer' ), $e?->getMessage() );
problem(
	'string for integer',
	fn () => $db->insert(
		'items',
		array(
			'name' => 'x',
			'qty'  => '2',
		)
	),
	422,
	'invalid_input',
	'/qty'
);
problem(
	'enum',
	fn () => $db->insert(
		'locations',
		array(
			'name' => 'Loft',
			'kind' => 'crate',
		)
	),
	422,
	'invalid_input',
	'/kind'
);
problem(
	'boolean',
	fn () => $db->insert(
		'locations',
		array(
			'name'   => 'Loft',
			'active' => 1,
		)
	),
	422,
	'invalid_input',
	'/active'
);
problem(
	'null for notNull',
	fn () => $db->insert(
		'items',
		array(
			'name' => 'x',
			'qty'  => null,
		)
	),
	422,
	'invalid_input',
	'/qty'
);
problem(
	'NaN for real',
	fn () => $db->insert(
		'items',
		array(
			'name'  => 'x',
			'price' => NAN,
		)
	),
	422,
	'invalid_input',
	'/price'
);
problem(
	'bad timestamp',
	fn () => $db->insert(
		'items',
		array(
			'name'   => 'x',
			'seenAt' => 'yesterday-ish',
		)
	),
	422,
	'invalid_input',
	'/seenAt'
);
problem(
	'impossible calendar date',
	fn () => $db->insert(
		'items',
		array(
			'name'       => 'x',
			'bestBefore' => '2023-02-29',
		)
	),
	422,
	'invalid_input',
	'/bestBefore'
);
problem( 'unique_violation with pointer', fn () => $db->insert( 'locations', array( 'name' => 'Garage' ) ), 409, 'unique_violation', '/name' );
problem(
	'reference_violation names the column',
	fn () => $db->insert(
		'items',
		array(
			'name'       => 'x',
			'locationId' => 99999,
		)
	),
	409,
	'reference_violation',
	'/locationId'
);

// ================================================================ reads

// ================================================================ reads

$find = fn ( array $opts, string $c = 'items' ) => $db->findMany( $c, $opts );
eq(
	'gt + orderBy',
	names(
		$find(
			array(
				'where'   => array( 'qty' => array( 'gt' => 2 ) ),
				'orderBy' => array( 'name' => 'asc' ),
			)
		)
	),
	array( 'Lamp', 'Nails' )
);
eq(
	'top-level OR',
	names(
		$find(
			array(
				'where'   => array( 'OR' => array( array( 'name' => 'Box' ), array( 'qty' => array( 'gte' => 100 ) ) ) ),
				'orderBy' => array( 'id' => 'asc' ),
			)
		)
	),
	array( 'Nails', 'Box' )
);
eq(
	'top-level NOT with null',
	names(
		$find(
			array(
				'where'   => array( 'NOT' => array( 'locationId' => null ) ),
				'orderBy' => array( 'id' => 'asc' ),
			)
		)
	),
	array( 'Hammer', 'Nails', 'Lamp' )
);
eq(
	'in / notIn',
	array(
		names(
			$find(
				array(
					'where'   => array( 'name' => array( 'in' => array( 'Lamp', 'Hammer' ) ) ),
					'orderBy' => array( 'id' => 'asc' ),
				)
			)
		),
		count( $find( array( 'where' => array( 'name' => array( 'notIn' => array( 'Lamp' ) ) ) ) ) ),
	),
	array( array( 'Hammer', 'Lamp' ), 3 )
);
eq( 'empty in matches nothing', $find( array( 'where' => array( 'id' => array( 'in' => array() ) ) ) ), array() );
eq( 'like is case-sensitive, ilike is not', array( names( $find( array( 'where' => array( 'name' => array( 'like' => 'ha%' ) ) ) ) ), names( $find( array( 'where' => array( 'name' => array( 'ilike' => 'ha%' ) ) ) ) ) ), array( array(), array( 'Hammer' ) ) );
eq( 'notIlike', names( $find( array( 'where' => array( 'name' => array( 'notIlike' => '%A%' ) ) ) ) ), array( 'Box' ) );
$db->insert(
	'items',
	array(
		array(
			'name' => 'Été',
			'qty'  => 1,
		),
		array(
			'name' => 'ΟΔΥΣΣΕΥΣ',
			'qty'  => 1,
		),
		array(
			'name' => 'İ',
			'qty'  => 1,
		),
	)
);
// Rows the items hook would reshape (it trims and capitalizes) go in as stored values.
$wp->exec( 'INSERT INTO {prefix}sp_items (`name`, `qty`) VALUES (?, 1), (?, 1)', array( "Hammer\n", 'abc\\' ) );
eq( 'ilike folds case beyond ASCII', names( $find( array( 'where' => array( 'name' => array( 'ilike' => 'été' ) ) ) ) ), array( 'Été' ) );
eq( 'ilike folds a final sigma onto its capital', names( $find( array( 'where' => array( 'name' => array( 'ilike' => 'οδυσσευς' ) ) ) ) ), array( 'ΟΔΥΣΣΕΥΣ' ) );
eq( 'ilike `_` is one character, whatever its case folding expands to', names( $find( array( 'where' => array( 'name' => array( 'ilike' => '_' ) ) ) ) ), array( 'İ' ) );
eq( 'ilike matches the whole value: a trailing newline is not ignored', names( $find( array( 'where' => array( 'name' => array( 'ilike' => 'hammer' ) ) ) ) ), array( 'Hammer' ) );
eq( 'ilike keeps a trailing backslash as a literal', names( $find( array( 'where' => array( 'name' => array( 'ilike' => 'ABC\\' ) ) ) ) ), array( 'abc\\' ) );
eq( 'like is exact', names( $find( array( 'where' => array( 'name' => array( 'like' => 'été' ) ) ) ) ), array() );
$db->delete( 'items', array( 'name' => array( 'in' => array( 'Été', 'ΟΔΥΣΣΕΥΣ', 'İ', "Hammer\n", 'abc\\' ) ) ) );
eq( 'like escapes and _', names( $find( array( 'where' => array( 'name' => array( 'like' => '_ox' ) ) ) ) ), array( 'Box' ) );
eq(
	'field-level OR + several operators ANDed',
	names(
		$find(
			array(
				'where'   => array(
					'qty'   => array(
						'OR' => array( array( 'lt' => 3 ), array( 'gt' => 50 ) ),
						'ne' => 1,
					),
					'price' => array( 'isNotNull' => true ),
				),
				'orderBy' => array( 'id' => 'asc' ),
			)
		)
	),
	array( 'Hammer', 'Nails' )
);
eq( 'field-level NOT', names( $find( array( 'where' => array( 'qty' => array( 'NOT' => array( 'lte' => 3 ) ) ) ) ) ), array( 'Nails' ) );
eq(
	'isNull',
	names(
		$find(
			array(
				'where'   => array( 'seenAt' => array( 'isNull' => true ) ),
				'orderBy' => array( 'id' => 'asc' ),
			)
		)
	),
	array( 'Hammer', 'Box' )
);
eq(
	'relation one: filter',
	names(
		$find(
			array(
				'where'   => array( 'location' => array( 'name' => 'Garage' ) ),
				'orderBy' => array( 'id' => 'asc' ),
			)
		)
	),
	array( 'Hammer', 'Nails' )
);
eq( 'relation one: exists', count( $find( array( 'where' => array( 'location' => true ) ) ) ), 3 );
eq( 'relation many: NOT exists', names( $find( array( 'where' => array( 'NOT' => array( 'items' => true ) ) ), 'locations' ) ), array( 'Basement' ) );
// JSON-text list and object columns on a custom table (the postmeta forms are proven in tests/wp).
$db->update(
	'locations',
	array(
		'meta' => array(
			'tags' => array( 'news', 'guide' ),
			'ids'  => array( 3, 12 ),
		),
	),
	array( 'id' => $garage['id'] )
);
eq(
	'json whole-value eq compares the stored text: the same document matches, a different one does not',
	array(
		names(
			$find(
				array(
					'where' => array(
						'meta' => array(
							'tags' => array( 'news', 'guide' ),
							'ids'  => array( 3, 12 ),
						),
					),
				),
				'locations'
			)
		),
		names(
			$find(
				array(
					'where' => array(
						'meta' => array(
							'tags' => array( 'news' ),
							'ids'  => array( 3, 12 ),
						),
					),
				),
				'locations'
			)
		),
		names(
			$find(
				array(
					'where' => array(
						'meta' => array(
							'ne'        => array(
								'tags' => array( 'news', 'guide' ),
								'ids'  => array( 3, 12 ),
							),
							'isNotNull' => true,
						),
					),
				),
				'locations'
			)
		),
	),
	array( array( 'Garage' ), array(), array() )
);

// List columns stored as JSON text on a custom table: `has` matches one whole element (an id of 12
// is not found by 120, nor "news" by "new"), `eq: []` matches only the empty list, and a NULL list
// is neither empty nor a member of anything.
( static function (): void {
	$wp     = $GLOBALS['wp'];
	$schema = new \SpacePress\Schema(
		array(
			'version'     => 5,
			'runtime'     => \SpacePress\Schema::SERIES,
			'collections' => array(
				'listed' => array(
					'primaryKey' => 'id',
					'editor'     => false,
					'table'      => 'first_listed',
					'columns'    => array(
						'id'     => array(
							'type'          => 'integer',
							'primaryKey'    => true,
							'autoIncrement' => true,
							'notNull'       => true,
						),
						'tags'   => array(
							'type'     => 'select',
							'multiple' => true,
							'enum'     => array( 'news', 'new', 'guide' ),
						),
						'photos' => array( 'type' => 'mediaList' ),
					),
				),
			),
		)
	);
	$wp->exec( 'CREATE TABLE {prefix}first_listed (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `tags` LONGTEXT, `photos` LONGTEXT, PRIMARY KEY (`id`)) ENGINE=InnoDB' );
	$wp->exec( 'INSERT INTO {prefix}first_listed (`id`, `tags`, `photos`) VALUES (1, \'["news","guide"]\', \'[12,7]\'), (2, \'["new"]\', \'[120]\'), (3, \'[]\', \'[]\'), (4, NULL, NULL)' );
	$db  = new \SpacePress\Db( \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() ), $schema, \SpacePress\db()->media() );
	$ids = static fn ( array $where ): array => array_column(
		$db->findMany(
			'listed',
			array(
				'where'   => $where,
				'orderBy' => array( 'id' => 'asc' ),
			)
		),
		'id'
	);
	eq( 'has on a media list matches the whole id 12, not 120', $ids( array( 'photos' => array( 'has' => 12 ) ) ), array( 1 ) );
	eq( 'has on a select list matches the whole string "new", not "news"', $ids( array( 'tags' => array( 'has' => 'new' ) ) ), array( 2 ) );
	eq( 'eq [] matches the empty list only, never the NULL list', $ids( array( 'tags' => array() ) ), array( 3 ) );
	eq( 'isNull on a list is the NULL row only; isNotNull includes the empty list', array( $ids( array( 'photos' => array( 'isNull' => true ) ) ), $ids( array( 'photos' => array( 'isNotNull' => true ) ) ) ), array( array( 4 ), array( 1, 2, 3 ) ) );
} )();
eq( 'relation many: filter', names( $find( array( 'where' => array( 'items' => array( 'qty' => array( 'gt' => 50 ) ) ) ), 'locations' ) ), array( 'Garage' ) );
eq( 'boolean filter coerced', names( $find( array( 'where' => array( 'active' => false ) ), 'locations' ) ), array( 'Attic' ) );
eq( 'timestamp filter normalized', count( $find( array( 'where' => array( 'updatedAt' => array( 'lt' => '2001-01-01' ) ) ), 'locations' ) ), 1 );
eq(
	'orderBy desc + limit/offset',
	names(
		$find(
			array(
				'orderBy' => array( 'qty' => 'desc' ),
				'limit'   => 2,
				'offset'  => 1,
			)
		)
	),
	array( 'Lamp', 'Hammer' )
);
eq(
	'columns',
	$find(
		array(
			'columns' => array(
				'id'   => true,
				'name' => true,
			),
			'where'   => array( 'id' => $box['id'] ),
		)
	),
	array(
		array(
			'id'   => $box['id'],
			'name' => 'Box',
		),
	)
);
eq( 'findFirst', $db->findFirst( 'items', array( 'where' => array( 'name' => 'Nails' ) ) )['qty'], 100 );
eq( 'findFirst none', $db->findFirst( 'items', array( 'where' => array( 'name' => 'Nope' ) ) ), null );

$tree = $db->findMany(
	'locations',
	array(
		'orderBy' => array( 'name' => 'asc' ),
		'columns' => array( 'name' => true ),
		'with'    => array(
			'items' => array(
				'orderBy' => array( 'qty' => 'desc' ),
				'limit'   => 1,
				'columns' => array(
					'name' => true,
					'qty'  => true,
				),
				'with'    => array( 'location' => array( 'columns' => array( 'code' => true ) ) ),
			),
		),
	)
);
eq(
	'nested with: per-parent limit, columns, one-in-many',
	$tree,
	array(
		array(
			'name'  => 'Attic',
			'items' => array(
				array(
					'name'     => 'Lamp',
					'qty'      => 3,
					'location' => array( 'code' => 'ATT' ),
				),
			),
		),
		array(
			'name'  => 'Basement',
			'items' => array(),
		),
		array(
			'name'  => 'Garage',
			'items' => array(
				array(
					'name'     => 'Nails',
					'qty'      => 100,
					'location' => array( 'code' => 'GAR' ),
				),
			),
		),
	)
);
$withLocation = array_column(
	$find(
		array(
			'with'    => array( 'location' => array( 'columns' => array( 'name' => true ) ) ),
			'orderBy' => array( 'id' => 'asc' ),
		)
	),
	null,
	'name'
);
eq( 'with one: row or null, key always present', array( $withLocation['Hammer']['location'], array_key_exists( 'location', $withLocation['Box'] ), $withLocation['Box']['location'] ), array( array( 'name' => 'Garage' ), true, null ) );
eq(
	'with many: filtered',
	names(
		$db->findFirst(
			'locations',
			array(
				'where' => array( 'id' => $garage['id'] ),
				'with'  => array( 'items' => array( 'where' => array( 'qty' => array( 'lt' => 10 ) ) ) ),
			)
		)['items']
	),
	array( 'Hammer' )
);

problem( 'unknown column', fn () => $find( array( 'where' => array( 'qtty' => 1 ) ) ), 400, 'invalid_query', '/where/qtty' );
problem( 'unknown operator', fn () => $find( array( 'where' => array( 'qty' => array( 'near' => 1 ) ) ) ), 400, 'invalid_query', '/where/qty/near' );
problem( 'bad filter value', fn () => $find( array( 'where' => array( 'qty' => array( 'gt' => 'x' ) ) ) ), 400, 'invalid_query', '/where/qty/gt' );
problem( 'unknown relation in with', fn () => $find( array( 'with' => array( 'owner' => true ) ) ), 400, 'invalid_query', '/with/owner' );
problem( 'unknown orderBy column', fn () => $find( array( 'orderBy' => array( 'nope' => 'asc' ) ) ), 400, 'invalid_query', '/orderBy/nope' );

// ================================================================ update / delete / hooks

// ================================================================ update / delete / hooks

$updated = $db->update( 'locations', array( 'name' => 'Attic+' ), array( 'id' => $attic['id'] ), true )[0];
check( 'onUpdate now applied when absent from patch', '2000-01-01T00:00:00.000Z' !== $updated['updatedAt'] && preg_match( $tsPattern, $updated['updatedAt'] ) === 1, $updated );
eq( 'createdAt untouched by update', $updated['createdAt'], $attic['createdAt'] );
problem( 'primary key change rejected', fn () => $db->update( 'items', array( 'id' => 999 ), array( 'id' => $box['id'] ) ), 422, 'invalid_input', '/id' );
eq(
	'same primary key value is allowed',
	$db->update(
		'items',
		array(
			'id'  => $box['id'],
			'qty' => 4,
		),
		array( 'id' => $box['id'] ),
		true
	)[0]['qty'],
	4
);

$logsBefore = count( $db->findMany( 'logs' ) );
$rows       = $db->update( 'items', array( 'qty' => 5 ), array( 'locationId' => $garage['id'] ), true );
eq(
	'update every matching row, returning post-write rows',
	array_column( $rows, 'qty', 'name' ),
	array(
		'Hammer' => 5,
		'Nails'  => 5,
	)
);
eq( 'afterUpdate hook inserted into another collection per row', array_column( array_slice( $db->findMany( 'logs', array( 'orderBy' => array( 'id' => 'asc' ) ) ), $logsBefore ), 'message' ), array( "item {$hammer['id']} qty 2->5", "item {$nails['id']} qty 100->5" ) );
eq( 'update matching nothing', $db->update( 'items', array( 'qty' => 1 ), array( 'id' => -1 ), true ), array() );

$logCount = fn () => count( $db->findMany( 'logs' ) );
$before   = $logCount();
$e        = problem( 'JsError from afterUpdate → rejected', fn () => $db->transaction( fn () => $db->update( 'items', array( 'qty' => -1 ), array( 'id' => $hammer['id'] ) ) ), 422, 'rejected' );
check( 'JsError keeps its message', $e instanceof JsError && $e->getMessage() === 'qty cannot go negative' );
eq( 'transaction rolled back the update and the hook insert', array( $db->findFirst( 'items', array( 'where' => array( 'id' => $hammer['id'] ) ) )['qty'], $logCount() ), array( 5, $before ) );

// Callback effects use another connection: they must see committed rows, never uncommitted state.
$observer  = new PDO( 'sqlite:' . DB_PATH );
$items     = $wp->connection()->prefix() . 'sp_items';
$committed = array();
$db->transaction(
	function () use ( $db, $observer, $items, &$committed ) {
		\SpacePress\Extensions::afterCommit(
			function () use ( $observer, $items, &$committed ) {
				$committed[] = 'outer:' . (int) $observer->query( "SELECT qty FROM $items WHERE name = 'Hammer'" )->fetchColumn();
			}
		);
		$db->transaction(
			function () use ( $db, $observer, $items, &$committed ) {
				$db->update( 'items', array( 'qty' => 6 ), array( 'name' => 'Hammer' ) );
				\SpacePress\Extensions::afterCommit(
					function () use ( $observer, $items, &$committed ) {
						$committed[] = 'inner:' . (int) $observer->query( "SELECT qty FROM $items WHERE name = 'Hammer'" )->fetchColumn();
					}
				);
			}
		);
		eq( 'nested transaction defers callbacks until the outer commit', $committed, array() );
	}
);
eq( 'both callbacks see the committed row in registration order', $committed, array( 'outer:6', 'inner:6' ) );
problem(
	'outer rollback discards callbacks registered by a nested write',
	function () use ( $db, &$committed ) {
		$db->transaction(
			function () use ( $db, &$committed ) {
				$db->transaction(
					function () use ( $db, &$committed ) {
						$db->update( 'items', array( 'qty' => 99 ), array( 'name' => 'Hammer' ) );
						\SpacePress\Extensions::afterCommit(
							function () use ( &$committed ) {
								$committed[] = 'rolled back';
							}
						);
					}
				);
				throw new JsError( 'rollback' );
			}
		);
	},
	422,
	'rejected'
);
// Catching an inner failure cannot make its partial writes durable.
$beforeInnerFailure = $committed;
try {
	$db->transaction(
		function () use ( $db, &$committed ): void {
			$db->update( 'items', array( 'qty' => 77 ), array( 'name' => 'Hammer' ) );
			try {
				$db->transaction(
					function () use ( $db, &$committed ): void {
						$db->insert( 'logs', array( 'message' => 'caught-inner-write' ) );
						\SpacePress\Extensions::afterCommit(
							function () use ( &$committed ) {
								$committed[] = 'must not run';
							}
						);
						throw new RuntimeException( 'inner failure' );
					}
				);
			} catch ( RuntimeException ) {
				$db->insert( 'logs', array( 'message' => 'after-caught-inner' ) );
			}
		}
	);
	check( 'rollback-only commit throws', false );
} catch ( RuntimeException $e ) {
	eq( 'rollback-only commit throws', $e->getMessage(), 'Cannot commit: a joined transaction failed' );
}
eq(
	'caught inner failure rolls back the whole transaction and discards callbacks',
	array(
		$db->findFirst( 'items', array( 'where' => array( 'name' => 'Hammer' ) ) )['qty'],
		$db->findMany( 'logs', array( 'where' => array( 'message' => array( 'in' => array( 'caught-inner-write', 'after-caught-inner' ) ) ) ) ),
		$committed,
	),
	array( 6, array(), $beforeInnerFailure )
);
// A post-commit failure cannot roll back durable data or undo callbacks already applied.
problem(
	'post-commit exception propagates',
	function () use ( $db, $wp ) {
		$db->transaction(
			function () use ( $db, $wp ) {
				file_put_contents( $wp->dir . '/committed-file', 'durable' );
				$wp->connection()->onRollback( static fn () => unlink( $wp->dir . '/committed-file' ) );
				$db->update( 'items', array( 'qty' => 5 ), array( 'name' => 'Hammer' ) );
				\SpacePress\Extensions::afterCommit( static fn () => throw new JsError( 'after commit' ) );
			}
		);
	},
	422,
	'rejected'
);
eq( 'post-commit failure never undoes committed filesystem effects', is_file( $wp->dir . '/committed-file' ), true );
\SpacePress\Extensions::afterCommit(
	function () use ( &$committed ) {
		$committed[] = 'immediate';
	}
);
eq( 'rollback and post-commit failure leave no stale callbacks', array( (int) $observer->query( "SELECT qty FROM $items WHERE name = 'Hammer'" )->fetchColumn(), $committed ), array( 5, array( 'outer:6', 'inner:6', 'immediate' ) ) );

// A reading transaction tells the database nothing until something writes. `open` is whether the
// database itself has a transaction; `sent` is what ended it.
$sent = array();
$spy  = static function ( mixed $sql ) use ( &$sent ): mixed {
	if ( is_string( $sql ) && preg_match( '/^\s*(START TRANSACTION|COMMIT|ROLLBACK)\b/i', $sql, $m ) === 1 ) {
		$sent[] = strtoupper( $m[1] );
	}

	return $sql;
};
add_filter( 'query', $spy );
$open    = static fn (): bool => $wp->connection()->wpdb()->dbh->inTransaction();
$queries = static fn (): int => (int) $wp->connection()->wpdb()->num_queries;
$during  = array();
$after   = array();
$counted = $queries();
$found   = $db->reading(
	function () use ( $db, $wp, $open, &$during, &$after ): array {
		$during = array( $wp->connection()->inTransaction(), $open() );
		\SpacePress\Extensions::afterCommit(
			static function () use ( &$after ): void {
				$after[] = 'ran';
			}
		);

		return $db->findMany( 'items', array( 'where' => array( 'name' => 'Hammer' ) ) );
	}
);
eq(
	'a reading transaction that only reads sends neither START TRANSACTION nor COMMIT',
	array( names( $found ), $sent, $during, $after, $open(), $queries() - $counted ),
	array( array( 'Hammer' ), array(), array( true, false ), array( 'ran' ), false, 0 )
);
$counted = $queries();
$db->reading(
	function () use ( $db, $open, &$during ): void {
		$db->findMany( 'items', array( 'where' => array( 'name' => 'Hammer' ) ) );
		$during = array( $open() );
		$db->update( 'items', array( 'qty' => 7 ), array( 'name' => 'Hammer' ) );
		$during[] = $open();
	}
);
eq( 'its first write starts the transaction, and the end commits it', array( $sent, $during, $open(), (int) $observer->query( "SELECT qty FROM $items WHERE name = 'Hammer'" )->fetchColumn() ), array( array( 'COMMIT' ), array( false, true ), false, 7 ) );
check( '… both counted as statements, as an ordinary transaction\'s are', $queries() - $counted >= 2, $queries() - $counted );
$sent = array();
problem(
	'a throw after a write rolls the write back',
	fn () => $db->reading(
		function () use ( $db ): void {
			$db->update( 'items', array( 'qty' => 9 ), array( 'name' => 'Hammer' ) );
			throw new JsError( 'no' );
		}
	),
	422,
	'rejected'
);
eq( '… with one ROLLBACK', array( $sent, $open(), (int) $observer->query( "SELECT qty FROM $items WHERE name = 'Hammer'" )->fetchColumn() ), array( array( 'ROLLBACK' ), false, 7 ) );
$sent = array();
$ran  = array();
problem(
	'a throw before any write',
	fn () => $db->reading(
		function () use ( &$ran ): void {
			\SpacePress\Extensions::afterCommit(
				static function () use ( &$ran ): void {
				$ran[] = 'after';
				}
			);
			throw new JsError( 'no' );
		}
	),
	422,
	'rejected'
);
eq( '… sends nothing and drops its afterCommit callbacks', array( $sent, $ran, $wp->connection()->inTransaction() ), array( array(), array(), false ) );
$sent = array();
$db->reading(
	static function () use ( $open, &$during ): void {
		get_option( 'sp_reading_probe' ); // core's read: still no transaction
		$during = array( $open() );
		update_option( 'sp_reading_probe', 'core write', false );
		$during[] = $open();
	}
);
eq( 'a write through $wpdb (core\'s, another plugin\'s) starts it too', array( $sent, $during, get_option( 'sp_reading_probe' ) ), array( array( 'COMMIT' ), array( false, true ), 'core write' ) );
$sent = array();
problem(
	'… and rolls back with it',
	fn () => $db->reading(
		static function (): void {
		update_option( 'sp_reading_probe', 'rolled back', false );
		throw new JsError( 'no' );
		}
	),
	422,
	'rejected'
);
wp_cache_delete( 'sp_reading_probe', 'options' );
eq( '… leaving what was committed', array( $sent, get_option( 'sp_reading_probe' ) ), array( array( 'ROLLBACK' ), 'core write' ) );
$sent = array();
$db->reading(
	static function () use ( $wp, $items, $open, &$during ): void {
		$wp->connection()->run( "SELECT id FROM $items WHERE name = ? FOR UPDATE", array( 'Hammer' ) );
		$during = array( $open() );
	}
);
eq( 'a locking read starts it, like a write', array( $sent, $during ), array( array( 'COMMIT' ), array( true ) ) );
$sent = array();
$db->transaction( fn () => $db->reading( fn () => $db->findMany( 'items', array( 'limit' => 1 ) ) ) );
eq( 'inside an open transaction it joins that one', $sent, array( 'START TRANSACTION', 'COMMIT' ) );
$sent = array();
$db->reading( fn () => $db->transaction( fn () => $db->findMany( 'items', array( 'limit' => 1 ) ) ) );
eq( 'a transaction opened inside it joins it, and stays unsent while it only reads', $sent, array() );
$sent = array();
$db->transaction( fn () => $db->findMany( 'items', array( 'limit' => 1 ) ) );
eq( 'an ordinary transaction starts at once, as before', $sent, array( 'START TRANSACTION', 'COMMIT' ) );
remove_filter( 'query', $spy );
delete_option( 'sp_reading_probe' );
$db->update( 'items', array( 'qty' => 5 ), array( 'name' => 'Hammer' ) );

$before = $logCount();
$db->transaction( fn () => $db->insert( 'logs', array( 'message' => 'loop:8' ) ) );
eq( '8 levels of nested hook writes are allowed', $logCount(), $before + 9 );
problem( 'a 9th level → hook_recursion', fn () => $db->transaction( fn () => $db->insert( 'logs', array( 'message' => 'loop:9' ) ) ), 500, 'hook_recursion' );
eq( 'hook_recursion rolled back everything', $logCount(), $before + 9 );

$deleted = $db->delete( 'items', array( 'name' => 'Box' ), true );
eq( 'delete returns pre-delete rows', names( $deleted ), array( 'Box' ) );
$db->delete( 'locations', array( 'id' => $attic['id'] ) );
eq( 'runtime FK cascade is on', $db->findFirst( 'items', array( 'where' => array( 'id' => $lamp['id'] ) ) ), null );

// ================================================================ migrations: a later file, the ledger, a failing statement

// An app update ships a second sortable folder migration: adding a column to a table with rows.
$writeMig       = static function ( string $id, string $sql ) use ( $wp ): void {
	$dir = $wp->plugin()->dir . "/sp/app/migrations/$id";
	if ( ! is_dir( $dir ) ) {
		mkdir( $dir, 0777, true );
	}
	file_put_contents( "$dir/migration.sql", $sql );
};
$rmMig          = static function ( string $id ) use ( $wp ): void {
	$dir = $wp->plugin()->dir . "/sp/app/migrations/$id";
	@unlink( "$dir/migration.sql" );
	@unlink( "$dir/ops.json" );
	@rmdir( $dir );
};
$childrenBefore = $db->findMany(
	'items',
	array(
		'where'   => array( 'locationId' => $garage['id'] ),
		'orderBy' => array( 'id' => 'asc' ),
	)
);
// A compiled baseline can still carry the SQL and hash from before the rename.
$legacy_sql = 'ALTER TABLE `{prefix}tp_locations` ADD COLUMN `note` LONGTEXT;';
$writeMig( '20261121000001_000001_note', $legacy_sql );
eq( '`wp spacepress migrate` applies the pending folder', $wp->wpCli( array( 'migrate' ) ), array( 0, array( 'data' => array( 'applied' => array( '20261121000001_000001_note' ) ) ) ) );
eq( 'replaying old SQL records the original file hash', $wp->scalar( 'SELECT `sql` FROM {prefix}sp__migrations WHERE `app` = ? AND `id` = ?', array( 'dbtest', '20261121000001_000001_note' ) ), hash( 'sha256', $legacy_sql ) );
eq(
	'child rows survive the parent change (no cascade fired)',
	$db->findMany(
		'items',
		array(
			'where'   => array( 'locationId' => $garage['id'] ),
			'orderBy' => array( 'id' => 'asc' ),
		)
	),
	$childrenBefore
);
eq(
	'the table has the new column and the ledger the migration',
	array(
		$wp->scalar( 'SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', array( $wp->connection()->prefix() . 'sp_locations', 'note' ) ),
		array_column( $wp->sql( 'SELECT `id` FROM {prefix}sp__migrations WHERE `app` = ? ORDER BY `id`', array( 'dbtest' ) ), 'id' ),
	),
	array( 1, array( '20261121000000_000000_init', '20261121000001_000001_note' ) )
);
problem( 'the unique index still holds', fn () => $db->insert( 'locations', array( 'name' => 'Garage' ) ), 409, 'unique_violation', '/name' );
// Migration text is SQL as the compiler or an operator writes it: a leading comment, a `?` inside a
// literal default, and a constraint over rows that break it.
$migrate = static function ( string $id, string $sql ) use ( $wp, $writeMig ): ?array {
	$writeMig( $id, $sql );

	return $wp->wpCli( array( 'migrate' ) )[1]['data']['applied'] ?? null;
};
// Statement text as the compiler or an operator writes it, read as the driver reads it. Each ALTER
// is a plain Connection::run on a parent table with children (the migration path above proves the
// same statement reaching it through a file); the children must survive the driver's table rebuild.
$wp->exec( 'CREATE TABLE {prefix}sp_rf_parent (`id` BIGINT UNSIGNED NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB' );
$wp->exec( 'CREATE TABLE {prefix}sp_rf_child (`id` BIGINT UNSIGNED NOT NULL, `pid` BIGINT UNSIGNED, PRIMARY KEY (`id`), CONSTRAINT `sp_rf_child_pid_fk` FOREIGN KEY (`pid`) REFERENCES {prefix}sp_rf_parent (`id`) ON DELETE CASCADE) ENGINE=InnoDB' );
$wp->exec( 'INSERT INTO {prefix}sp_rf_parent VALUES (1)' );
$wp->exec( 'INSERT INTO {prefix}sp_rf_child VALUES (1, 1)' );
$column   = static fn ( string $name ): int => (int) $wp->scalar( 'SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', array( $wp->connection()->prefix() . 'sp_rf_parent', $name ) );
$children = static fn (): int => (int) $wp->scalar( 'SELECT COUNT(*) FROM {prefix}sp_rf_child' );
$alter    = static function ( string $sql, string $column ) use ( $wp, $children ): array {
	$wp->exec( $sql );

	return array( $children(), '' === $column ? null : (int) $wp->scalar( 'SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', array( $wp->connection()->prefix() . 'sp_rf_parent', $column ) ) );
};
eq( 'a leading block comment and a literal `?` default', $alter( "/* adds a prompt */ ALTER TABLE `{prefix}sp_rf_parent` ADD COLUMN `prompt` VARCHAR(191) DEFAULT 'Continue?'", 'prompt' ), array( 1, 1 ) );
eq( 'a comment between the keywords', $alter( 'ALTER /* inline */ TABLE `{prefix}sp_rf_parent` ADD COLUMN `c2` LONGTEXT', 'c2' ), array( 1, 1 ) );
eq( 'a line comment ending in a carriage return', $alter( "-- note\rALTER TABLE `{prefix}sp_rf_parent` ADD COLUMN `c3` LONGTEXT", 'c3' ), array( 1, 1 ) );
eq( 'an executable comment this server\'s version satisfies is the statement', $alter( '/*!80000 ALTER TABLE `{prefix}sp_rf_parent` ADD COLUMN `c4` LONGTEXT */', 'c4' ), array( 1, 1 ) );
eq( 'an executable comment for a newer server is a comment, and the ALTER behind it still keeps the children', $alter( '/*!99999 SELECT 1 */ ALTER TABLE `{prefix}sp_rf_parent` ADD COLUMN `c5` LONGTEXT', 'c5' ), array( 1, 1 ) );
eq(
	'a migration file carrying such a statement reaches the same path',
	array(
		$migrate( '20261121000002_000002_commented', "/* adds */ ALTER /* inline */ TABLE `{prefix}sp_locations` ADD COLUMN `prompt` VARCHAR(191) DEFAULT 'Continue?';" ),
		$db->findMany(
			'items',
			array(
				'where'   => array( 'locationId' => $garage['id'] ),
				'orderBy' => array( 'id' => 'asc' ),
			)
		) === $childrenBefore,
		$wp->scalar( 'SELECT `prompt` FROM {prefix}sp_locations WHERE `name` = ?', array( 'Garage' ) ),
	),
	array( array( '20261121000002_000002_commented' ), true, 'Continue?' )
);
eq( '`--` without a space is subtraction', $wp->sql( 'SELECT 1--? AS n', array( 1 ) )[0]['n'], 2 );
eq( 'a parameter inside an executable comment this server reads is bound', $wp->sql( 'SELECT /*!80000 ? */ AS n', array( 42 ) )[0]['n'], 42 );
eq( 'a `?` inside an executable comment for a newer server is text, not a parameter', $wp->sql( 'SELECT 3 AS n /*!99999 , ? AS m */' )[0], array( 'n' => 3 ) );
eq( 'a token-merging executable comment is read as the server reads it', $wp->sql( '/*!80000 SELECT*/1 AS n' )[0]['n'], 1 );
eq(
	'a quoted `*/` inside executable SQL does not end the comment',
	$wp->sql( "SELECT /*!80000 '*/?' AS s, ? AS n */", array( 42 ) )[0],
	array(
		's' => '*/?',
		'n' => 42,
	)
);
eq(
	'an odd run of backslashes escapes the quote: the `?` inside stays text',
	$wp->sql( "SELECT 'it''s a \\\\\\'?' AS s, ? AS n", array( 7 ) )[0],
	array(
		's' => "it's a \\'?",
		'n' => 7,
	)
);
$wp->exec( 'INSERT INTO {prefix}sp_logs (`message`, `at`) VALUES (?, ?)', array( 'orphan', '2026-01-01T00:00:00.000Z' ) );
$wp->exec( 'ALTER TABLE {prefix}sp_logs ADD COLUMN `itemId` BIGINT UNSIGNED' );
$wp->exec( 'UPDATE {prefix}sp_logs SET `itemId` = 424242 WHERE `message` = ?', array( 'orphan' ) );
$writeMig( '20261121000003_000003_fk', 'ALTER TABLE `{prefix}sp_logs` ADD CONSTRAINT `sp_logs_itemId_fk` FOREIGN KEY (`itemId`) REFERENCES `{prefix}sp_items` (`id`) ON DELETE SET NULL;' );
putenv( 'SP_DEBUG=1' );
[$code, $out] = $wp->wpCli( array( 'migrate' ) );
putenv( 'SP_DEBUG' );
check(
	'a constraint added over rows that break it fails the migration and changes nothing',
	1 === $code && str_contains( $out['error']['detail'] ?? '', 'foreign key constraint fails' )
	&& $wp->scalar( 'SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?', array( $wp->connection()->prefix() . 'sp_logs', 'sp_logs_itemId_fk' ) ) === 0,
	$out
);
$wp->exec( 'DELETE FROM {prefix}sp_logs WHERE `message` = ?', array( 'orphan' ) );
eq( 'with the orphan gone the same file applies', $wp->wpCli( array( 'migrate' ) )[1]['data']['applied'] ?? null, array( '20261121000003_000003_fk' ) );
// Migrations run under one site-wide lock across processes: while this process holds it, another
// process can't take it (and gives up at its timeout); once released, it can.
file_put_contents(
	$wp->dir . '/lock.php',
	<<<'PHP'
<?php
require $argv[1];
wpLoad($argv[2]);
try {
    echo \SpacePress\Wp\Runtime::plugin()->connection()->locked('first:test', 1, static fn () => 'held');
} catch (\SpacePress\Wp\LockBusy $e) {
    echo 'refused';
}
PHP
);
$other     = static fn (): string => trim( (string) shell_exec( escapeshellarg( PHP_BINARY ) . ' -d memory_limit=512M ' . escapeshellarg( $wp->dir . '/lock.php' ) . ' ' . escapeshellarg( __DIR__ . '/wp.php' ) . ' ' . escapeshellarg( $wp->dir ) . ' 2>/dev/null' ) );
$whileHeld = $wp->connection()->locked( 'first:test', 1, $other );
eq( 'a second process can\'t take a held migration lock, and can once it is released', array( $whileHeld, $other() ), array( 'refused', 'held' ) );
eq( 'the lock is per name', $wp->connection()->locked( 'first:other', 1, $other ), 'held' );

// A statement that fails stops the file; what ran before it is recorded step by step, nothing after it runs.
$writeMig( '20261121000004_000004_broken', "DELETE FROM `{prefix}sp_logs` WHERE `message` = 'hello';\n--> statement-breakpoint\nALTER TABLE `{prefix}sp_nope` ADD COLUMN `x` LONGTEXT;\n--> statement-breakpoint\nDELETE FROM `{prefix}sp_logs`;" );
putenv( 'SP_DEBUG=1' );
[$code, $out] = $wp->wpCli( array( 'migrate' ) );
putenv( 'SP_DEBUG' );
check( 'a failing statement fails the command and names its position', 1 === $code && str_contains( $out['error']['detail'] ?? '', '20261121000004_000004_broken failed at statement 2' ), $out );
eq(
	'the statements before it ran and are recorded; the ones after it did not run',
	array(
		count( $db->findMany( 'logs', array( 'where' => array( 'message' => 'hello' ) ) ) ),
		count( $db->findMany( 'logs' ) ) > 0,
		array_column( $wp->sql( 'SELECT `id` FROM {prefix}sp__migrations WHERE `app` = ? AND `id` LIKE ? ORDER BY `id`', array( 'dbtest', '20261121000004%' ) ), 'id' ),
	),
	array( 0, true, array( '20261121000004_000004_broken:1' ) )
);
$rmMig( '20261121000004_000004_broken' );
$wp->exec( 'DELETE FROM {prefix}sp__migrations WHERE `app` = ? AND `id` LIKE ?', array( 'dbtest', '20261121000004%' ) );
eq(
	'with the folder gone, migrate is a no-op and the CLI serves again',
	array( $wp->wpCli( array( 'migrate' ) )[1], $wp->wpCli( array( 'find', 'items', '{"where":{"name":"Hammer"},"columns":{"name":true}}' ) )[1] ),
	array( array( 'data' => array( 'applied' => array() ) ), array( 'data' => array( array( 'name' => 'Hammer' ) ) ) )
);

// ================================================================ forward-only runtime guard & unified audit ledger

$writeMig( '20261121000005_000005_drop', 'ALTER TABLE `{prefix}sp_locations` DROP COLUMN `note`;' );
putenv( 'SP_DEBUG=1' );
[$code, $out] = $wp->wpCli( array( 'migrate' ) );
putenv( 'SP_DEBUG' );
check(
	'core Migrator refuses destructive DROP COLUMN in forward-only schema migrations',
	1 === $code && str_contains( $out['error']['detail'] ?? '', 'Refusing destructive DDL' ),
	$out
);
$rmMig( '20261121000005_000005_drop' );
$migrator = new \SpacePress\Wp\Migrator( $wp->connection(), $wp->plugin()->dir . '/sp/app/migrations', $wp->plugin()->schema );
$migrator->recordAudit( '20261121000006_000006_purge', 'destructive', str_repeat( 'a', 64 ), 'admin', 'cleanup retired column', 0 );
$audit = $wp->sql( 'SELECT `kind`, `actor`, `reason`, `rows_affected` FROM {prefix}sp__migrations WHERE `app` = ? AND `id` = ?', array( 'dbtest', '20261121000006_000006_purge' ) );
eq(
	'unified ledger records destructive audit metadata',
	$audit,
	array(
		array(
			'kind'          => 'destructive',
			'actor'         => 'admin',
			'reason'        => 'cleanup retired column',
			'rows_affected' => 0,
		),
	)
);
$wp->exec( 'DELETE FROM {prefix}sp__migrations WHERE `app` = ? AND `id` = ?', array( 'dbtest', '20261121000006_000006_purge' ) );

// ================================================================ CLI

$cli = fn ( string ...$args ) => $wp->cli( ...$args );

[$code, $out] = $cli( 'find', 'items', '{"where":{"name":{"like":"Ham%"}},"columns":{"name":true}}' );
eq( 'CLI find', array( $code, $out ), array( 0, array( 'data' => array( array( 'name' => 'Hammer' ) ) ) ) );
[$code, $out] = $cli( 'insert', 'items', '{"name":"cli","qty":"x"}' );
eq( 'CLI error envelope + exit 1', array( $code, $out['error']['code'] ?? null, $out['error']['pointer'] ?? null ), array( 1, 'invalid_input', '/qty' ) );
[$code, $out] = $cli( 'insert', 'items', '{}' );
eq( 'CLI insert {} is one row with no fields (it reaches the pipeline)', array( $code, $out['error']['pointer'] ?? null ), array( 1, '/name' ) );
[$code, $out] = $cli( 'update', 'items', '{"name":"Hammer"}', '{"qty":-3}' );
eq( 'CLI runs in a transaction', array( $code, $out['error']['code'] ?? null, $db->findFirst( 'items', array( 'where' => array( 'name' => 'Hammer' ) ) )['qty'] ), array( 1, 'rejected', 5 ) );
[$code, $out] = $cli(
	'action',
	'restock',
	json_encode(
		array(
			'itemId' => $hammer['id'],
			'amount' => 2,
		)
	)
);
eq( 'CLI action', array( $code, $out['data']['qty'] ?? null ), array( 0, 7 ) );
eq( 'CLI usage error', $cli( 'frobnicate' )[0], 1 );

// ================================================================ HTTP: SpacePress's API on WordPress

// Through the web server (php -S on this site), as a client sees it: /wp-json/spacepress/v1 answers with
// SpacePress's envelopes, problem documents and headers.
$port = $wp->startServer();
$base = "http://127.0.0.1:$port/wp-json/spacepress/v1";

/** @return array{status: int, headers: array<string, string>, body: string, json: mixed} */
function http( string $method, string $path, mixed $body = null, ?string $raw = null, array $headers = array() ): array {
	global $base;
	$ch  = curl_init( $base . $path );
	$out = array();
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_CUSTOMREQUEST  => $method,
			CURLOPT_NOBODY         => 'HEAD' === $method,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 30,
			CURLOPT_HTTPHEADER     => array( 'Content-Type: application/json', ...$headers ),
			CURLOPT_HEADERFUNCTION => function ( $ch, $line ) use ( &$out ) {
				if ( str_contains( $line, ':' ) ) {
					[$k, $v]                         = explode( ':', $line, 2 );
					$out[ strtolower( trim( $k ) ) ] = trim( $v );
				}
				return strlen( $line );
			},
		)
	);
	if ( null !== $raw || null !== $body ) {
		curl_setopt( $ch, CURLOPT_POSTFIELDS, $raw ?? json_encode( $body ) );
	}
	$res    = curl_exec( $ch );
	$status = (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE );

	return array(
		'status'  => $status,
		'headers' => $out,
		'body'    => (string) $res,
		'json'    => is_string( $res ) ? json_decode( $res, true ) : null,
	);
}

$isProblem = function ( string $label, array $r, int $status, string $code, ?string $pointer = null ): void {
	$j = $r['json'];
	check(
		"$label → $status $code",
		$r['status'] === $status && str_starts_with( $r['headers']['content-type'] ?? '', 'application/problem+json' )
			&& ( $j['type'] ?? null ) === 'about:blank' && ( $j['status'] ?? null ) === $status && ( $j['code'] ?? null ) === $code
			&& is_string( $j['title'] ?? null ) && is_string( $j['detail'] ?? null ) && ( $j['pointer'] ?? null ) === $pointer,
		$r,
	);
};

$r = http( 'GET', '' );
check(
	'GET /wp-json/spacepress/v1 (the schema)',
	200 === $r['status'] && 'integer' === $r['json']['data']['kinds']['items']['columns']['qty']['type']
	&& isset( $r['json']['data']['actions']['restock']['input']['amount'] ),
	$r
);
check( 'schema exposes no function names', ! str_contains( $r['body'], '__' ) && ! str_contains( $r['body'], 'hooks' ) && ! str_contains( $r['body'], 'handler' ), $r['body'] );
eq( 'the runtime reports the WordPress platform in the schema', array( $r['json']['data']['runtime']['wp']['database']['kind'], $r['json']['data']['runtime']['wp']['incompatibleTables'] ), array( 'sqlite', array() ) );

$r      = http(
	'POST',
	'/items',
	array(
		'name'       => 'widget',
		'price'      => 2.0,
		'locationId' => $garage['id'],
	)
);
$widget = $r['json']['data'] ?? array();
check( 'POST → 201 {data} with hook applied', 201 === $r['status'] && ( $widget['name'] ?? null ) === 'Widget' && str_starts_with( $r['headers']['content-type'] ?? '', 'application/json' ), $r );
check( 'integral float printed without .0', str_contains( $r['body'], '"price":2,' ), $r['body'] );

$r = http(
	'GET',
	'/items?' . http_build_query(
		array(
			'where'   => json_encode( array( 'locationId' => $garage['id'] ) ),
			'orderBy' => '-qty,name',
			'limit'   => 2,
			'with'    => 'location',
		)
	)
);
eq( 'GET list: where + orderBy + limit + with', array( $r['status'], array_column( $r['json']['data'] ?? array(), 'name' ), $r['json']['data'][0]['location']['name'] ?? null ), array( 200, array( 'Hammer', 'Nails' ), 'Garage' ) );
eq( 'GET list offset', array_column( http( 'GET', '/items?orderBy=-id&offset=1&limit=1' )['json']['data'] ?? array(), 'name' ), array( 'Nails' ) );
$isProblem( 'bad where JSON', http( 'GET', '/items?where=%7Bbad' ), 400, 'invalid_query', '/where' );
$isProblem( 'unknown where column', http( 'GET', '/items?where=' . rawurlencode( '{"nope":1}' ) ), 400, 'invalid_query', '/where/nope' );
$isProblem( 'bad limit', http( 'GET', '/items?limit=-1' ), 400, 'invalid_query', '/limit' );

$r = http( 'GET', "/items/{$widget['id']}?with=location" );
eq( 'GET by id with relation', array( $r['status'], $r['json']['data']['location']['code'] ?? null ), array( 200, 'GAR' ) );
$isProblem( 'GET missing id', http( 'GET', '/items/999999' ), 404, 'not_found' );
$isProblem( 'GET non-integer id', http( 'GET', '/items/abc' ), 404, 'not_found' );
$isProblem( 'unknown collection', http( 'GET', '/widgets' ), 404, 'not_found' );

// A malformed JSON body is refused before anything runs: the API's own parser answers invalid_json.
eq( 'invalid JSON body is refused', array( http( 'POST', '/items', raw: '{"name":' )['status'], http( 'POST', '/items', raw: '{"name":' )['json']['code'] ?? null ), array( 400, 'invalid_json' ) );
eq( '… and by SpacePress itself', array( $wp->call( 'POST', '/items', '{"name":' )[0], $wp->call( 'POST', '/items', '{"name":' )[1]['code'] ?? null ), array( 400, 'invalid_json' ) );
// The API is a route on WordPress's REST server: core's transport works on it as on any route.
$r = http( 'GET', '' );
eq( 'the namespace itself is the app schema, not core\'s namespace index', array( $r['status'], isset( $r['json']['data']['kinds']['items'] ), isset( $r['json']['routes'] ) ), array( 200, true, false ) );
$r = http( 'OPTIONS', '/items', headers: array( 'Origin: https://elsewhere.test', 'Access-Control-Request-Method: POST' ) );
eq( 'a preflight is core\'s, with the API\'s own headers allowed', array( $r['status'] < 300, str_contains( $r['headers']['access-control-allow-headers'] ?? '', 'Idempotency-Key' ) ), array( true, true ) );
eq( 'HEAD answers the status and no body', array( http( 'HEAD', '/items' )['status'], http( 'HEAD', '/items' )['body'] ), array( 200, '' ) );
$r = http( 'POST', '/items/' . $widget['id'] . '?_method=PATCH', array( 'qty' => 7 ) );
eq( '_method turns a POST into the PATCH it names, as on every REST route', array( $r['status'], $r['json']['data']['qty'] ?? null ), array( 200, 7 ) );
$r = http( 'GET', '/items', headers: array( 'Cookie: wordpress_logged_in_x=y', 'X-WP-Nonce: nope' ) );
// Core's refusal (rest_cookie_invalid_nonce), mapped as every core refusal of a signed-out caller is.
$isProblem( 'a bad nonce is core\'s refusal, as a problem document', $r, 401, 'unauthenticated' );
// Application passwords are core's too, under core's own rule: on a request WordPress serves from the
// REST API, and on no other, whatever its URL starts with.
$basic  = static fn ( string $user, ?string $password = null ): array => array( 'Authorization: Basic ' . base64_encode( null === $password ? $wp->appPassword( $user ) : "$user:$password" ) );
$origin = "http://127.0.0.1:$port";
/** One request to the site with its path sent exactly as written (dot segments kept). */
$sent = static function ( string $method, string $target, array $headers = array(), ?string $body = null ) use ( $origin ): array {
	$ch = curl_init( $origin . $target );
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_CUSTOMREQUEST  => $method,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 30,
			CURLOPT_PATH_AS_IS     => true,
			CURLOPT_HTTPHEADER     => $headers,
		)
	);
	if ( null !== $body ) {
		curl_setopt( $ch, CURLOPT_POSTFIELDS, $body );
	}
	$res = (string) curl_exec( $ch );

	return array( (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE ), $res );
};
eq( 'an application password signs in on the API', array( http( 'GET', '/me', headers: $basic( 'fa_ed' ) )['status'], http( 'GET', '/me', headers: $basic( 'fa_ed' ) )['json']['data']['role'] ?? null ), array( 200, 'editor' ) );
eq( '… and as ?rest_route=', json_decode( $sent( 'GET', '/?rest_route=/spacepress/v1/me', $basic( 'fa_ed' ) )[1], true )['data']['role'] ?? null, 'editor' );
$isProblem( 'a wrong application password is refused, not a visitor', http( 'GET', '/me', headers: $basic( 'fa_ed', 'abcd efgh ijkl mnop qrst uvwx' ) ), 401, 'incorrect_password' );
$isProblem( '… on a public list too', http( 'GET', '/items', headers: $basic( 'fa_ed', 'abcd efgh ijkl mnop qrst uvwx' ) ), 401, 'incorrect_password' );
// `rest_route` in the query or the body replaces the route in the path: emptied, the request is a page.
$form  = array( 'Content-Type: application/x-www-form-urlencoded' );
$pages = array(
	'a page'                                            => $sent( 'GET', '/', $basic( 'fa_admin' ) ),
	'the API path with ?rest_route= emptied'            => $sent( 'GET', '/wp-json/spacepress/v1/me/?rest_route=', $basic( 'fa_admin' ) ),
	'the API path with rest_route= emptied in the body' => $sent( 'POST', '/wp-json/spacepress/v1/me', array( ...$basic( 'fa_admin' ), ...$form ), 'rest_route=' ),
);
foreach ( $pages as $label => [$status, $page] ) {
	check( "an application password signs nobody in on $label", ! str_starts_with( ltrim( $page ), '{' ) && ! str_contains( $page, 'wpadminbar' ) && preg_match( '/<body[^>]*\blogged-in\b/', $page ) !== 1, array( $status, substr( $page, 0, 200 ) ) );
}
// A path decoded once, however it was sent: WordPress keeps the pretty path as sent, PHP decodes ?rest_route=.
foreach ( array(
	'/%69tems/' . $widget['id'] => 200,
	'/items/%3' . substr( (string) $widget['id'], 0, 1 ) . substr( (string) $widget['id'], 1 ) => 200,
	'/items/slug%3Anope'        => 404,
	'/it%20ems'                 => 404,
	'/it%C3%A9ms'               => 404,
	'/it%2520ems'               => 404,
	'/%2569tems'                => 404,
	'/it%27s%22a%5Cb'           => 404,
) as $encoded => $expect ) {
	$pretty          = http( 'GET', $encoded );
	[$status, $body] = $sent( 'GET', '/?rest_route=/spacepress/v1' . $encoded );
	eq( "$encoded answers the same under /wp-json and as ?rest_route=", array( $pretty['status'], $pretty['json'] ), array( $status, json_decode( $body, true ) ) );
	eq( "$encoded → $expect", $pretty['status'], $expect );
}
eq(
	'an encoded space, a non-ASCII letter and a literal %20 reach the API as that text',
	array(
		http( 'GET', '/it%20ems' )['json']['detail'] ?? null,
		http( 'GET', '/it%C3%A9ms' )['json']['detail'] ?? null,
		http( 'GET', '/it%2520ems' )['json']['detail'] ?? null,
		http( 'GET', '/%2569tems' )['json']['detail'] ?? null,
		http( 'GET', '/it%27s%22a%5Cb' )['json']['detail'] ?? null,
	),
	array( "Unknown kind 'it ems'", "Unknown kind 'itéms'", "Unknown kind 'it%20ems'", "Unknown kind '%69tems'", "Unknown kind 'it's\"a\\b'" )
);
$r = http( 'GET', '/items' );
eq( 'every answer is private', array( $r['headers']['cache-control'] ?? null, str_contains( $r['headers']['vary'] ?? '', 'Authorization' ) ), array( 'private, no-store', true ) );
$plain = ( function () use ( $base ): array {
	$ch = curl_init( str_replace( '/wp-json/spacepress/v1', '/?rest_route=/spacepress/v1/items', $base ) );
	curl_setopt( $ch, CURLOPT_RETURNTRANSFER, true );
	$body = (string) curl_exec( $ch );
	return array( (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE ), is_array( json_decode( $body, true )['data'] ?? null ) );
} )();
eq( '?rest_route= reaches the API too', $plain, array( 200, true ) );
$isProblem(
	'coercion error with pointer',
	http(
		'POST',
		'/items',
		array(
			'name' => 'x',
			'qty'  => 'lots',
		)
	),
	422,
	'invalid_input',
	'/qty'
);
$isProblem( 'missing required', http( 'POST', '/items', array( 'qty' => 1 ) ), 422, 'invalid_input', '/name' );
$isProblem( 'unique violation', http( 'POST', '/locations', array( 'name' => 'Garage' ) ), 409, 'unique_violation', '/name' );
$r = http( 'POST', '/locations', raw: '{"name":"Empty","meta":{"a":{},"b":[]}}' );
eq(
	'a json column keeps {} apart from [] through storage and the API',
	array(
		$r['status'],
		str_contains( $r['body'], '"meta":{"a":{},"b":[]}' ),
		str_contains( http( 'GET', '/locations/' . ( $r['json']['data']['id'] ?? 0 ) )['body'], '"meta":{"a":{},"b":[]}' ),
	),
	array( 201, true, true )
);
$r = http( 'POST', '/locations', raw: '{"name":"Bare","meta":{}}' );
eq( '… a json value that is {} itself, too', array( $r['status'], str_contains( $r['body'], '"meta":{}' ) ), array( 201, true ) );
$isProblem(
	'reference violation',
	http(
		'POST',
		'/items',
		array(
			'name'       => 'x',
			'locationId' => 424242,
		)
	),
	409,
	'reference_violation',
	'/locationId'
);

$r = http( 'PATCH', "/items/{$widget['id']}", array( 'qty' => 7 ) );
eq( 'PATCH', array( $r['status'], $r['json']['data']['qty'] ?? null ), array( 200, 7 ) );
$isProblem( 'PATCH missing', http( 'PATCH', '/items/999999', array( 'qty' => 1 ) ), 404, 'not_found' );
$isProblem( 'PATCH array body', http( 'PATCH', "/items/{$widget['id']}", array( 1, 2 ) ), 422, 'invalid_input', '' );

$logsBefore = count( http( 'GET', '/logs?limit=200' )['json']['data'] );
$r          = http( 'PATCH', "/items/{$widget['id']}", array( 'qty' => -5 ) );
$isProblem( 'hook throws JsError mid-request', $r, 422, 'rejected' );
eq( 'rejected detail is the JsError message', $r['json']['detail'] ?? null, 'qty cannot go negative' );
eq(
	'request rolled back: row unchanged, hook insert undone',
	array( http( 'GET', "/items/{$widget['id']}" )['json']['data']['qty'], count( http( 'GET', '/logs?limit=200' )['json']['data'] ) ),
	array( 7, $logsBefore )
);

$r = http( 'POST', '/actions/restock', array( 'itemId' => $widget['id'] ) );
eq( 'action with default input', array( $r['status'], $r['json']['data']['qty'] ?? null ), array( 200, 12 ) );
$isProblem( 'action input coercion', http( 'POST', '/actions/restock', array( 'itemId' => 'x' ) ), 422, 'invalid_input', '/itemId' );
$isProblem(
	'action unknown input key',
	http(
		'POST',
		'/actions/restock',
		array(
			'itemId' => 1,
			'extra'  => 1,
		)
	),
	422,
	'invalid_input',
	'/extra'
);
$isProblem( 'action HttpError from handler', http( 'POST', '/actions/restock', array( 'itemId' => 999999 ) ), 404, 'not_found' );
$isProblem( 'unknown action', http( 'POST', '/actions/nope', array() ), 404, 'not_found' );

$isProblem( 'api flag disables create', http( 'POST', '/logs', array( 'message' => 'x' ) ), 405, 'method_not_allowed' );
$isProblem( 'api flag disables delete', http( 'DELETE', '/logs/1' ), 405, 'method_not_allowed' );

$r = http( 'DELETE', "/items/{$widget['id']}" );
eq( 'DELETE returns the deleted row', array( $r['status'], $r['json']['data']['name'] ?? null, $r['json']['data']['qty'] ?? null ), array( 200, 'Widget', 12 ) );
$isProblem( 'deleted row is gone', http( 'GET', "/items/{$widget['id']}" ), 404, 'not_found' );

// ================================================================ afterPublish (spec §2.8)

// A collection's item became published: created published, updated from a draft, or its scheduled
// time came. Updating an already-published item, or a draft, doesn't run it.
( static function (): void {
	$id     = array(
		'type'          => 'integer',
		'primaryKey'    => true,
		'autoIncrement' => true,
		'notNull'       => true,
	);
	$status = array(
		'type'    => 'text',
		'notNull' => true,
		'enum'    => array( 'draft', 'published', 'scheduled' ),
		'default' => array( 'value' => 'published' ),
		'system'  => true,
	);
	$seen   = array();
	$raw    = array(
		'version'     => 5,
		'runtime'     => \SpacePress\Schema::SERIES,
		'collections' => array(
			'bulletins' => array(
				'primaryKey' => 'id',
				'drafts'     => true,
				'editor'     => false,
				'table'      => 'sp_ap_bulletins',
				'hooks'      => array(
					'afterPublish' => static function ( array $row ) use ( &$seen ): void {
									$seen[] = $row['title']; },
				),
				'columns'    => array(
					'id'          => $id,
					'title'       => array(
						'type'    => 'text',
						'notNull' => true,
					),
					'status'      => $status,
					'publishedAt' => array(
						'type'   => 'timestamp',
						'system' => true,
					),
				),
			),
		),
	);
	$schema = new \SpacePress\Schema( $raw );
	$wp     = $GLOBALS['wp'];
	$wp->exec( 'CREATE TABLE {prefix}sp_ap_bulletins (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `title` LONGTEXT NOT NULL, `status` VARCHAR(191) NOT NULL, `publishedAt` CHAR(24), PRIMARY KEY (`id`)) ENGINE=InnoDB' );
	$db = new \SpacePress\Db( \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() ), $schema, \SpacePress\db()->media() );
	$db->insert( 'bulletins', array( 'title' => 'live' ) );
	$draft = $db->insert(
		'bulletins',
		array(
			'title'  => 'draft',
			'status' => 'draft',
		),
		true
	)[0];
	$db->update( 'bulletins', array( 'title' => 'draft, edited' ), array( 'id' => $draft['id'] ) );
	$db->update( 'bulletins', array( 'status' => 'published' ), array( 'id' => $draft['id'] ) );
	$db->update( 'bulletins', array( 'title' => 'published, edited' ), array( 'id' => $draft['id'] ) );
	$later = $db->insert(
		'bulletins',
		array(
			'title'       => 'later',
			'status'      => 'scheduled',
			'publishedAt' => gmdate( 'Y-m-d\\TH:i:s.000\\Z', time() + 3600 ),
		),
		true
	)[0];
	$db->promoteDue();
	$wp->exec( "UPDATE {prefix}sp_ap_bulletins SET `publishedAt` = '" . gmdate( 'Y-m-d\\TH:i:s.000\\Z', time() - 60 ) . "' WHERE `id` = " . (int) $later['id'] );
	$db->promoteDue();
	eq( 'afterPublish runs once per item that became published, scheduled ones when they come due', $seen, array( 'live', 'draft, edited', 'later' ) );
} )();

// ================================================================ relation filters respect the target's read access

// A relation filter is an oracle over the target's columns, so it may only see target rows a direct
// read would return: an unreadable target is denied like `with`, a draft target matches nothing.
// That holds for the row selector of a viewer's update/delete as much as for a read.
( static function (): void {
	$id     = array(
		'type'          => 'integer',
		'primaryKey'    => true,
		'autoIncrement' => true,
		'notNull'       => true,
	);
	$status = array(
		'type'    => 'text',
		'notNull' => true,
		'enum'    => array( 'draft', 'published', 'scheduled' ),
		'default' => array( 'value' => 'published' ),
		'system'  => true,
	);
	$one    = static fn ( string $c, string $from ) => array(
		'kind'       => 'one',
		'collection' => $c,
		'from'       => $from,
		'to'         => 'id',
	);
	$schema = new \SpacePress\Schema(
		array(
			'version'     => 5,
			'runtime'     => \SpacePress\Schema::SERIES,
			'collections' => array(
				'accounts' => array(
					'primaryKey' => 'id',
					'access'     => array( 'read' => array( 'role' => 'admin' ) ),
					'columns'    => array(
						'id'     => $id,
						'apiKey' => array(
							'type'    => 'text',
							'notNull' => true,
						),
					),
				),
				'articles' => array(
					'primaryKey' => 'id',
					'drafts'     => true,
					'columns'    => array(
						'id'          => $id,
						'secret'      => array( 'type' => 'text' ),
						'ownerId'     => array( 'type' => 'integer' ),
						'status'      => $status,
						'publishedAt' => array(
							'type'   => 'timestamp',
							'system' => true,
						),
					),
					'relations'  => array( 'owner' => $one( 'accounts', 'ownerId' ) ),
				),
				'comments' => array(
					'primaryKey' => 'id',
					'access'     => array(
						'update' => array( 'role' => 'anyone' ),
						'delete' => array( 'role' => 'anyone' ),
					),
					'columns'    => array(
						'id'        => $id,
						'articleId' => array( 'type' => 'integer' ),
						'ownerId'   => array( 'type' => 'integer' ),
					),
					'relations'  => array(
						'article' => $one( 'articles', 'articleId' ),
						'owner'   => $one( 'accounts', 'ownerId' ),
					),
				),
			),
		)
	);
	// Its own custom tables on the site, read through a Db over the same connection.
	$wp  = $GLOBALS['wp'];
	$raw = array(
		'version'     => 5,
		'runtime'     => \SpacePress\Schema::SERIES,
		'collections' => array(),
	);
	foreach ( array( 'accounts', 'articles', 'comments' ) as $t ) {
		$raw['collections'][ $t ] = $schema->collection( $t ) + array(
			'editor' => false,
			'table'  => "sp_rf_$t",
		);
	}
	$schema = new \SpacePress\Schema( $raw );
	$wp->exec( 'CREATE TABLE {prefix}sp_rf_accounts (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `apiKey` LONGTEXT NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_rf_articles (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `secret` LONGTEXT, `ownerId` BIGINT, `status` VARCHAR(191) NOT NULL, `publishedAt` CHAR(24), PRIMARY KEY (`id`)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_rf_comments (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `articleId` BIGINT, `ownerId` BIGINT, PRIMARY KEY (`id`)) ENGINE=InnoDB' );
	$wp->exec( "INSERT INTO {prefix}sp_rf_accounts VALUES (1, 'sk_live_7x')" );
	$wp->exec( "INSERT INTO {prefix}sp_rf_articles VALUES (1, 'price=42', NULL, 'draft', NULL), (2, 'open', 1, 'published', '2026-01-01T00:00:00.000Z')" );
	$wp->exec( 'INSERT INTO {prefix}sp_rf_comments VALUES (1, 1, 1), (2, 2, NULL)' );
	$store  = \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() );
	$db     = new \SpacePress\Db( $store, $schema, \SpacePress\db()->media() );
	$anon   = new \SpacePress\Viewer( null );
	$editor = new \SpacePress\Viewer(
		array(
			'id'   => 1,
			'name' => 'ed',
			'role' => 'editor',
		)
	);
	$admin  = new \SpacePress\Viewer(
		array(
			'id'   => 2,
			'name' => 'root',
			'role' => 'admin',
		)
	);
	$ids    = static fn ( string $c, array $where, ?\SpacePress\Viewer $v ) => array_column(
		$db->findMany(
			$c,
			array(
				'where'   => $where,
				'orderBy' => array( 'id' => 'asc' ),
			),
			$v
		),
		'id'
	);
	$key    = array( 'owner' => array( 'apiKey' => array( 'like' => 'sk_live_7%' ) ) );

	problem( 'an unreadable relation target is denied like `with` (anonymous → 401)', fn () => $ids( 'comments', $key, $anon ), 401, 'unauthenticated' );
	problem( '… and like `with` for a signed-in viewer below the rule (403)', fn () => $ids( 'comments', $key, $editor ), 403, 'forbidden' );
	problem( 'nested: the denial reaches through a readable relation', fn () => $ids( 'comments', array( 'article' => $key ), $anon ), 401, 'unauthenticated' );
	eq( 'a reader of the target filters through it', $ids( 'comments', $key, $admin ), array( 1 ) );
	eq(
		'a draft target matches nothing for a viewer who can\'t see drafts',
		array(
			$ids( 'comments', array( 'article' => array( 'secret' => array( 'like' => 'price=4%' ) ) ), $anon ),
			$ids( 'comments', array( 'article' => true ), $anon ),
			$ids( 'comments', array( 'article' => false ), $anon ),
		),
		array( array(), array( 2 ), array( 1 ) )
	);
	eq(
		'editors see drafts through relation filters; trusted reads see everything',
		array(
			$ids( 'comments', array( 'article' => array( 'secret' => array( 'like' => 'price=4%' ) ) ), $editor ),
			$ids( 'comments', $key + array( 'article' => array( 'secret' => 'price=42' ) ), null ),
		),
		array( array( 1 ), array( 1 ) )
	);
	// A render binds its visitor (Seam::asViewer): compiled reads then skip drafts, also after an
	// await inside an async body, which resumes after asViewer itself has returned.
	$titles = static fn (): array => array_map( static fn ( $row ) => $row->p['secret'], \SpacePress\Seam::findMany( 'articles', array( 'orderBy' => array( 'id' => 'asc' ) ) )->a );
	eq(
		'compiled reads see drafts when trusted and skip them for a bound visitor',
		$db->current(
			static fn () => array(
				$titles(),
				\SpacePress\Seam::asViewer( $anon, $titles ),
				\SpacePress\Seam::asViewer( $editor, $titles ),
			)
		),
		array( array( 'price=42', 'open' ), array( 'open' ), array( 'price=42', 'open' ) )
	);
	$render = \SpacePress\JsJobs::asyncFunction(
		static function () use ( $titles ): array {
			$before = $titles();
			\SpacePress\JsJobs::await( \SpacePress\JsPromise::from( 1 ) );
			$after = $titles();
			$inner = \SpacePress\Seam::asViewer(
				null,
				static function () use ( $titles ): array {
					\SpacePress\JsJobs::await( \SpacePress\JsPromise::from( 2 ) );
					return $titles();
				}
			);
			return array( $before, $after, \SpacePress\JsJobs::await( $inner ), $titles() );
		}
	);
	eq(
		'an async render keeps its visitor across awaits, and a nested binding only inside',
		$db->current(
			static fn () => \SpacePress\JsJobs::run(
				static fn () => \SpacePress\Seam::asViewer( $anon, $render ),
				array(),
			)
		),
		array( array( 'open' ), array( 'open' ), array( 'price=42', 'open' ), array( 'open' ) )
	);
	eq( 'nothing stays bound after the render', \SpacePress\Seam::viewer(), null );
	// Promise reactions and timers read as the viewer bound where they were registered, even when
	// the queue drains after asViewer has returned.
	$seen = array();
	$db->current(
		static function () use ( $anon, $titles, &$seen ): void {
			\SpacePress\JsJobs::run(
				static function () use ( $anon, $titles, &$seen ): \SpacePress\JsPromise {
					return \SpacePress\Seam::asViewer(
						$anon,
						static function () use ( $titles, &$seen ): \SpacePress\JsPromise {
							$done = new \SpacePress\JsPromise();
							\SpacePress\JsPromise::from( 1 )->then(
								static function () use ( $titles, &$seen ) {
									$seen['then'] = $titles();
									return 1;
								}
							);
							\SpacePress\Timers::set(
								static function () use ( $titles, &$seen, $done ): void {
									$seen['timer'] = $titles();
									$done->resolve( 1 );
								},
								1
							);
							return $done;
						}
					);
				},
				array()
			);
		}
	);
	eq(
		'a reaction and a timer registered under a visitor read as that visitor',
		$seen,
		array(
			'then'  => array( 'open' ),
			'timer' => array( 'open' ),
		)
	);
	$trusted = array();
	$db->current(
		static function () use ( $titles, &$trusted ): void {
			\SpacePress\JsJobs::run(
				static function () use ( $titles, &$trusted ): \SpacePress\JsPromise {
					$done = new \SpacePress\JsPromise();
					\SpacePress\JsPromise::from( 1 )->then(
						static function () use ( $titles, &$trusted ) {
							$trusted[] = $titles();
							return 1;
						}
					);
					\SpacePress\Timers::set(
						static function () use ( $titles, &$trusted, $done ): void {
							$trusted[] = $titles();
							$done->resolve( 1 );
						},
						1
					);
					return $done;
				},
				array()
			);
		}
	);
	eq( '… and registered outside any render they stay trusted', $trusted, array( array( 'price=42', 'open' ), array( 'price=42', 'open' ) ) );
	problem( 'a viewer\'s update selector is denied the unreadable target', fn () => $db->update( 'comments', array( 'ownerId' => 1 ), $key, true, $anon ), 401, 'unauthenticated' );
	eq( '… and a viewer\'s delete selector matches no draft target', $db->delete( 'comments', array( 'article' => array( 'secret' => array( 'like' => 'price=4%' ) ) ), true, $anon ), array() );
} )();

// ================================================================ field access (lane B, phase 2 §4)

// ================================================================ field access (lane B, phase 2 §4)

// The field-access users are WordPress users (created at install); rules see them as SpacePress maps them.
$fa = array();
foreach ( array( 'fa_alice', 'fa_bob', 'fa_ed', 'fa_admin' ) as $name ) {
	$fa[ $name ] = array( 'user' => $wp->user( $name ) );
}
/** In-process API call as one of the field-access users (null = anonymous); returns [status, data or problem]. */
$as              = function ( ?string $who, string $method, string $path, mixed $body = null, array $query = array() ) use ( $wp ): array {
	[$status, $data] = $wp->call( $method, $path, $body, $who, $query );

	return array( $status, $data );
};
$faProblem       = function ( string $label, array $r, int $status, string $code, ?string $pointer ): void {
	check( "$label → $status $code $pointer", $r[0] === $status && ( $r[1]['code'] ?? null ) === $code && ( $r[1]['pointer'] ?? null ) === $pointer, $r[1] );
};
$aliceId         = $fa['fa_alice']['user']['id'];
$team            = $db->insert(
	'teams',
	array(
		'name'   => 'Core',
		'budget' => 1000,
	),
	true
)[0];
[$mine, $theirs] = $db->insert(
	'profiles',
	array(
		array(
			'name'    => 'Alice',
			'email'   => 'alice@example.test',
			'ownerId' => $aliceId,
			'salary'  => 10,
			'notes'   => array(
				'public'  => 'hi',
				'private' => 'secret',
				'flag'    => true,
			),
			'tasks'   => array(
				array(
					'label' => 'a',
					'rate'  => 1,
				),
				array(
					'label' => 'b',
					'rate'  => 2,
				),
			),
			'blocks'  => array(
				array(
					'layout' => 'memo',
					'text'   => 'kept',
				),
			),
			'teamId'  => $team['id'],
		),
		array(
			'name'    => 'Bob',
			'email'   => 'bob@example.test',
			'ownerId' => $fa['fa_bob']['user']['id'],
			'salary'  => 20,
			'teamId'  => $team['id'],
		),
	),
	true
);
$byName          = static fn ( array $rows ) => array_column( $rows, null, 'name' );

// read: shorthand rules once per page, function rules per row; hidden keys are removed, not nulled.
$anon = $byName( $as( null, 'GET', '/profiles' )[1] );
eq(
	'anonymous rows lack every column it may not read, at every level',
	array( array_keys( $anon['Alice'] ), $anon['Alice']['notes'] ),
	array(
		array( 'id', 'name', 'ownerId', 'approved', 'notes', 'blocks', 'stamp', 'pairs', 'rounds', 'fixed', 'gated', 'seeded', 'vault', 'seen', 'cleared', 'meta', 'checks', 'tasks', 'teamId', '_rev' ),
		array(
			'public' => 'hi',
			'pinned' => true,
			'tag'    => null,
		),
	)
);
$alice = $byName( $as( 'fa_alice', 'GET', '/profiles' )[1] );
eq( 'a function read rule runs per row (author sees only her own salary)', array( $alice['Alice']['salary'] ?? 'hidden', $alice['Bob']['salary'] ?? 'hidden', isset( $alice['Alice']['email'] ) ), array( 10, 'hidden', false ) );
$editor = $as( 'fa_ed', 'GET', "/profiles/{$theirs['id']}" )[1];
eq( 'editors read everything the rules allow them', array( $editor['email'], $editor['salary'] ), array( 'bob@example.test', 20 ) );
eq(
	'trusted reads see every column',
	$db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['notes'],
	array(
		'public'  => 'hi',
		'private' => 'secret',
		'flag'    => true,
		'pinned'  => true,
		'tag'     => null,
	)
);

// `with` rows go through the same strip, in both directions of a relation.
$withTeam = $as( 'fa_ed', 'GET', "/profiles/{$mine['id']}", query: array( 'with' => 'team' ) )[1];
eq( 'with-loaded parent strips its hidden column (budget is admin-only)', array( $withTeam['team']['name'], array_key_exists( 'budget', $withTeam['team'] ) ), array( 'Core', false ) );
$withMembers = $as( null, 'GET', "/teams/{$team['id']}", query: array( 'with' => 'members' ) )[1];
eq( 'with-loaded children are stripped per row', array_map( static fn ( $m ) => array_key_exists( 'email', $m ) || array_key_exists( 'salary', $m ), $withMembers['members'] ), array( false, false ) );
eq( 'an admin sees the with-loaded column', $as( 'fa_admin', 'GET', "/profiles/{$mine['id']}", query: array( 'with' => 'team' ) )[1]['team']['budget'], 1000 );

// Filters, sorts and selections can't name a column the viewer may not read, at any depth.
$faProblem( 'where on a hidden column', $as( null, 'GET', '/profiles', query: array( 'where' => '{"email":{"like":"a%"}}' ) ), 403, 'forbidden', '/where/email' );
$faProblem( 'where on a hidden column inside OR', $as( null, 'GET', '/profiles', query: array( 'where' => '{"OR":[{"name":"x"},{"email":"a"}]}' ) ), 403, 'forbidden', '/where/OR/1/email' );
$faProblem( 'where on a column with a per-row rule', $as( 'fa_alice', 'GET', '/profiles', query: array( 'where' => '{"salary":{"gt":15}}' ) ), 403, 'forbidden', '/where/salary' );
$faProblem( 'where on a group holding a hidden sub-field', $as( null, 'GET', '/profiles', query: array( 'where' => '{"notes":{"isNull":true}}' ) ), 403, 'forbidden', '/where/notes' );
$faProblem( 'relation filter probing a hidden column of the target', $as( 'fa_ed', 'GET', '/profiles', query: array( 'where' => '{"team":{"budget":{"gt":500}}}' ) ), 403, 'forbidden', '/where/team/budget' );
$faProblem( 'relation filter from the other side', $as( 'fa_alice', 'GET', '/teams', query: array( 'where' => '{"members":{"salary":{"gt":15}}}' ) ), 403, 'forbidden', '/where/members/salary' );
$faProblem( 'nested with filter', $as( null, 'GET', '/teams', query: array( 'with' => '{"members":{"where":{"email":"a"}}}' ) ), 403, 'forbidden', '/with/members/where/email' );
$faProblem( 'with across a hidden link column (source end)', $as( 'fa_alice', 'GET', '/profiles', query: array( 'with' => 'mentor' ) ), 403, 'forbidden', '/with/mentor' );
$faProblem( 'with across a hidden link column (target end)', $as( 'fa_alice', 'GET', '/profiles', query: array( 'with' => 'mentees' ) ), 403, 'forbidden', '/with/mentees' );
$faProblem( 'relation filter across a hidden link column (target end)', $as( 'fa_alice', 'GET', '/profiles', query: array( 'where' => '{"mentees":{"name":"Bob"}}' ) ), 403, 'forbidden', '/where/mentees' );
eq( 'editors may follow the link', $as( 'fa_ed', 'GET', "/profiles/{$mine['id']}", query: array( 'with' => 'mentor' ) )[1]['mentor'], null );
$faProblem( 'orderBy on a hidden column', $as( null, 'GET', '/profiles', query: array( 'orderBy' => '-email' ) ), 403, 'forbidden', '/orderBy/email' );
problem( 'columns selecting a hidden column', fn () => $db->findMany( 'profiles', array( 'columns' => array( 'email' => true ) ), new \SpacePress\Viewer( null ) ), 403, 'forbidden', '/columns/email' );
problem( 'columns selecting a column with a per-row rule', fn () => $db->findMany( 'profiles', array( 'columns' => array( 'salary' => true ) ), new \SpacePress\Viewer( $fa['fa_alice']['user'] ) ), 403, 'forbidden', '/columns/salary' );
eq(
	'excluding a hidden column is allowed',
	array_keys(
		$db->findMany(
			'profiles',
			array(
				'columns' => array( 'email' => false ),
				'limit'   => 1,
			),
			new \SpacePress\Viewer( null )
		)[0]
	),
	array( 'id', 'name', 'ownerId', 'approved', 'notes', 'blocks', 'stamp', 'pairs', 'rounds', 'fixed', 'gated', 'seeded', 'vault', 'seen', 'cleared', 'meta', 'checks', 'tasks', 'teamId' )
);
eq(
	'a readable column filters normally; trusted filters see everything',
	array(
		array_column( $as( 'fa_ed', 'GET', '/profiles', query: array( 'where' => '{"email":"bob@example.test"}' ) )[1], 'name' ),
		array_column( $db->findMany( 'teams', array( 'where' => array( 'budget' => 1000 ) ) ), 'name' ),
	),
	array( array( 'Bob' ), array( 'Core' ) )
);

// Compiled reads (Seam) are trusted unless a caller binds a visitor, as a page render does.
$hasEmail = static fn (): array => array_values( array_unique( array_map( static fn ( $row ) => array_key_exists( 'email', $row->p ), \SpacePress\Seam::findMany( 'profiles' )->a ) ) );
$editor   = new \SpacePress\Viewer(
	array(
		'id'   => 1,
		'name' => 'ed',
		'role' => 'editor',
	)
);
eq( 'Seam reads are trusted outside asViewer', array( \SpacePress\Seam::viewer(), $hasEmail() ), array( null, array( true ) ) );
eq(
	'asViewer binds an anonymous visitor: hidden fields stay out',
	\SpacePress\Seam::asViewer(
		new \SpacePress\Viewer( null ),
		static fn () => array(
			array_key_exists( 'email', \SpacePress\Seam::findFirst( 'profiles' )->p ),
			$hasEmail(),
		)
	),
	array( false, array( false ) )
);
eq( 'asViewer binds an editor, who reads the field', \SpacePress\Seam::asViewer( $editor, $hasEmail ), array( true ) );
problem( 'a visitor-bound read refuses a hidden column', fn () => \SpacePress\Seam::asViewer( new \SpacePress\Viewer( null ), static fn () => \SpacePress\Seam::findMany( 'profiles', array( 'columns' => array( 'email' => true ) ) ) ), 403, 'forbidden', '/columns/email' );
eq( 'the previous viewer is restored after a throw', \SpacePress\Seam::viewer(), null );
eq( 'nested asViewer restores the outer viewer', \SpacePress\Seam::asViewer( $editor, static fn () => array( \SpacePress\Seam::asViewer( null, static fn () => \SpacePress\Seam::viewer() ), \SpacePress\Seam::viewer() === $editor ) ), array( null, true ) );

// Writes: a supplied key the viewer can't set → 403 at its pointer. Defaults and hooks are trusted.
$faProblem( 'update rule (admin) refuses the owner', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'salary' => 99 ) ), 403, 'forbidden', '/salary' );
eq( 'the refused update persisted nothing', $db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['salary'], 10 );
$faProblem( 'anonymous: 401, as for collection rules', $as( null, 'PATCH', "/teams/{$team['id']}", array( 'budget' => 1 ) ), 401, 'unauthenticated', '/budget' );
$faProblem(
	'create rule refuses an author setting approved',
	$as(
		'fa_alice',
		'POST',
		'/profiles',
		array(
			'name'     => 'Self-approved',
			'approved' => true,
		)
	),
	403,
	'forbidden',
	'/approved'
);
[$s, $created] = $as(
	'fa_alice',
	'POST',
	'/profiles',
	array(
		'name'    => 'Plain',
		'ownerId' => $aliceId,
	)
);
eq( 'the default for a guarded column is not the viewer\'s input', array( $s, $created['approved'] ), array( 201, false ) );
eq( 'an editor may set it', $as( 'fa_ed', 'PATCH', "/profiles/{$created['id']}", array( 'approved' => true ) )[1]['approved'], true );
[$s, $resent] = $as(
	'fa_alice',
	'PATCH',
	"/profiles/{$mine['id']}",
	array(
		'name'     => 'Alice B',
		'salary'   => 10,
		'approved' => false,
	)
);
eq( 'resending readable values unchanged is not a write to them (read-modify-write)', array( $s, $resent['name'] ), array( 200, 'Alice B' ) );
[$s, $patched] = $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'notes' => array( 'public' => 'edited' ) ) );
eq(
	'replacing a group keeps the sub-field the viewer cannot see',
	array( $s, $patched['notes'], $db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['notes'] ),
	array(
		200,
		array(
			'public' => 'edited',
			'pinned' => true,
			'tag'    => null,
		),
		array(
			'public'  => 'edited',
			'private' => 'secret',
			'flag'    => true,
			'pinned'  => true,
			'tag'     => null,
		),
	)
);
eq( 'an empty group patch keeps omitted hidden sub-fields', array( $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'notes' => new \stdClass() ) )[0], $db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['notes']['private'] ), array( 200, 'secret' ) );
// A rule over sibling data is judged on the incoming item too: unpinning while omitting the tag keeps it.
$db->update(
	'profiles',
	array(
		'notes' => array(
			'public'  => 'p',
			'pinned'  => true,
			'tag'     => 'kept',
			'private' => 'secret',
			'flag'    => true,
		),
	),
	array( 'id' => $mine['id'] )
);
[$s] = $as(
	'fa_alice',
	'PATCH',
	"/profiles/{$mine['id']}",
	array(
		'notes' => array(
			'public' => 'p',
			'pinned' => false,
		),
	)
);
eq( 'omitting a field whose rule the new item fails keeps it', array( $s, $db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['notes']['tag'] ), array( 200, 'kept' ) );
$faProblem(
	'… and supplying it is refused',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'notes' => array(
				'pinned' => false,
				'tag'    => null,
			),
		)
	),
	403,
	'forbidden',
	'/notes/tag'
);
$faProblem(
	'a hidden sub-field can\'t be probed: its stored value is refused too',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'notes' => array(
				'public' => 'edited',
				'flag'   => true,
			),
		)
	),
	403,
	'forbidden',
	'/notes/flag'
);
$faProblem(
	'… and so is the other value',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'notes' => array(
				'public' => 'edited',
				'flag'   => false,
			),
		)
	),
	403,
	'forbidden',
	'/notes/flag'
);
eq(
	'a sub-field rule sees the item after its defaults',
	$as(
		'fa_alice',
		'POST',
		'/profiles',
		array(
			'name'  => 'Tagged',
			'notes' => array( 'tag' => 'x' ),
		)
	)[0],
	201
);
$GLOBALS['stampCalls'] = 0;
[$s, $stamped]         = $as(
	'fa_alice',
	'POST',
	'/profiles',
	array(
		'name'  => 'Stamped',
		'stamp' => array( 'note' => 'x' ),
	)
);
eq(
	'a dynamic sub-field default is generated once: the value the rule saw is stored',
	array( $s, $stamped['stamp'] ?? null, $GLOBALS['stampCalls'] ),
	array(
		201,
		array(
			'n'    => 1,
			'note' => 'x',
		),
		1,
	)
);
$faProblem( 'a null group would erase the hidden sub-field', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'notes' => null ) ), 403, 'forbidden', '/notes' );
// Repeater items have no identity: protected values must be resent unchanged in place, never moved or dropped.
$faProblem( 'an emptied repeater would drop protected values', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'tasks' => array() ) ), 403, 'forbidden', '/tasks/0' );
$faProblem( 'reordered items would move protected values', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'tasks' => array( array( 'label' => 'b' ), array( 'label' => 'a' ) ) ) ), 403, 'forbidden', '/tasks/0' );
$faProblem(
	'changing a protected sub-field in an item',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'tasks' => array(
				array(
					'label'  => 'a',
					'rate'   => 9,
					'secret' => null,
				),
				array(
					'label' => 'b',
					'rate'  => 2,
				),
			),
		)
	),
	403,
	'forbidden',
	'/tasks/0/rate'
);
// Editing an item that holds a field she can't see means supplying it (write-only) and resending the
// value she can't set unchanged; items left as she sees them, and new items, need nothing more.
[$s, $tasks] = $as(
	'fa_alice',
	'PATCH',
	"/profiles/{$mine['id']}",
	array(
		'tasks' => array(
			array(
				'label'  => 'a!',
				'rate'   => 1,
				'secret' => null,
			),
			array(
				'label' => 'b',
				'rate'  => 2,
			),
			array( 'label' => 'new' ),
		),
	)
);
eq(
	'editing visible sub-fields and appending items is allowed',
	array( $s, $tasks['tasks'] ?? null ),
	array(
		200,
		array(
			array(
				'label' => 'a!',
				'rate'  => 1,
			),
			array(
				'label' => 'b',
				'rate'  => 2,
			),
			array(
				'label' => 'new',
				'rate'  => null,
			),
		),
	)
);
eq( 'an editor may rewrite the repeater', $as( 'fa_ed', 'PATCH', "/profiles/{$mine['id']}", array( 'tasks' => array() ) )[1]['tasks'], array() );
// A write-only sub-field (read: false, update allowed) may be changed inside a repeater item.
$db->update(
	'profiles',
	array(
		'tasks' => array(
			array(
				'label'  => 'w',
				'secret' => 'old',
			),
		),
	),
	array( 'id' => $mine['id'] )
);
[$s, $writeOnly] = $as(
	'fa_alice',
	'PATCH',
	"/profiles/{$mine['id']}",
	array(
		'tasks' => array(
			array(
				'label'  => 'w',
				'rate'   => null,
				'secret' => 'new',
			),
		),
	)
);
eq(
	'a write-only sub-field can be replaced, and stays hidden',
	array( $s, $writeOnly['tasks'], $db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['tasks'][0]['secret'] ),
	array(
		200,
		array(
			array(
				'label' => 'w',
				'rate'  => null,
			),
		),
		'new',
	)
);
$db->update(
	'profiles',
	array(
		'checks' => array(
			array(
				'open' => true,
				'note' => 'n',
			),
		),
	),
	array( 'id' => $mine['id'] )
);
$faProblem( 'closing a repeater item while omitting a field its rule then protects is refused', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'checks' => array( array( 'open' => false ) ) ) ), 403, 'forbidden', '/checks/0' );
eq( '… and storage is unchanged', $db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['checks'][0]['note'], 'n' );
$db->update(
	'profiles',
	array(
		'pairs' => array(
			array(
				'label'   => 'x',
				'details' => array( 'secret' => 'sx' ),
			),
			array(
				'label'   => 'y',
				'details' => array( 'secret' => 'sy' ),
			),
		),
	),
	array( 'id' => $mine['id'] )
);
$faProblem(
	'swapping items while a nested group omits the hidden value is refused',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'pairs' => array(
				array(
					'label'   => 'y',
					'details' => new \stdClass(),
				),
				array(
					'label'   => 'x',
					'details' => new \stdClass(),
				),
			),
		)
	),
	403,
	'forbidden',
	'/pairs/0'
);
eq(
	'… and the pairs are intact',
	$db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['pairs'],
	array(
		array(
			'label'   => 'x',
			'details' => array( 'secret' => 'sx' ),
		),
		array(
			'label'   => 'y',
			'details' => array( 'secret' => 'sy' ),
		),
	)
);
// A list item's defaults are generated once: the value its rules saw is the value stored.
$db->update(
	'profiles',
	array(
		'rounds' => array(
			array(
				'n'    => 1,
				'note' => 'protected',
			),
		),
	),
	array( 'id' => $mine['id'] )
);
$GLOBALS['stampCalls'] = 0;
$faProblem( 'an item leaving out a function-ruled field must match what she sees', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'rounds' => array( new \stdClass() ) ) ), 403, 'forbidden', '/rounds/0' );
eq( '… so the protected value survives', $db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['rounds'][0]['note'], 'protected' );
$GLOBALS['stampCalls'] = 0;
[$s]                   = $as(
	'fa_alice',
	'PATCH',
	"/profiles/{$mine['id']}",
	array(
		'rounds' => array(
			array(
				'n'    => 1,
				'note' => 'protected',
			),
			array( 'note' => 'new' ),
		),
	)
);
eq(
	'a new item\'s default is generated once: the n its rule allowed is the n stored',
	array( $s, $db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['rounds'], $GLOBALS['stampCalls'] ),
	array(
		200,
		array(
			array(
				'n'    => 1,
				'note' => 'protected',
			),
			array(
				'n'    => 1,
				'note' => 'new',
			),
		),
		1,
	)
);
// Unchanged-value resends compare structure, not key order.
$db->update(
	'profiles',
	array(
		'fixed' => array(
			'a' => 'A',
			'b' => 'B',
		),
	),
	array( 'id' => $mine['id'] )
);
eq(
	'a readable group she can\'t set may be resent with its keys reordered',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'fixed' => array(
				'b' => 'B',
				'a' => 'A',
			),
		)
	)[0],
	200
);
// Rules see the effective item: a kept hidden value, not the default that would have filled it.
$db->update(
	'profiles',
	array(
		'gated' => array(
			'gate' => false,
			'door' => 'shut',
		),
	),
	array( 'id' => $mine['id'] )
);
$faProblem( 'a rule reads the kept hidden value, not its default', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'gated' => array( 'door' => 'open' ) ) ), 403, 'forbidden', '/gated/door' );
// Defaults are trusted, in list items as in groups.
[$s, $seeded] = $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'seeded' => array( array( 'label' => 'new' ) ) ) );
eq(
	'a list-item default under a create: false rule is not input',
	array( $s, $db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['seeded'] ),
	array(
		200,
		array(
			array(
				'label'  => 'new',
				'origin' => 'api',
			),
		),
	)
);
// Rules see the whole resolved item, whatever order its fields are declared in.
$db->update(
	'profiles',
	array(
		'vault' => array(
			'door'   => 'shut',
			'config' => array( 'locked' => true ),
		),
	),
	array( 'id' => $mine['id'] )
);
$faProblem(
	'a rule reads a kept nested hidden value declared after it',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'vault' => array(
				'door'   => 'open',
				'config' => new \stdClass(),
			),
		)
	),
	403,
	'forbidden',
	'/vault/door'
);
// Replacing with null is refused from the rules alone: same answer for either hidden value.
$faProblem( 'null over a group with a function rule (hidden lock on)', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'vault' => null ) ), 403, 'forbidden', '/vault' );
$db->update(
	'profiles',
	array(
		'vault' => array(
			'door'   => 'shut',
			'config' => array( 'locked' => false ),
		),
	),
	array( 'id' => $mine['id'] )
);
$faProblem( '… and with it off', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'vault' => null ) ), 403, 'forbidden', '/vault' );
// A group she reads in full may be resent unchanged even under a function read rule.
$db->update( 'profiles', array( 'seen' => array( 'x' => 'v' ) ), array( 'id' => $mine['id'] ) );
eq( 'a fully visible group resends unchanged', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'seen' => $as( 'fa_alice', 'GET', "/profiles/{$mine['id']}" )[1]['seen'] ) )[0], 200 );
// Under a hidden container, nothing about its contents can be learned by writing: right or wrong
// guesses, empty or populated lists, all refused the same way.
$db->update(
	'profiles',
	array(
		'locker'  => array( 'pin' => '1234' ),
		'entries' => array(),
	),
	array( 'id' => $mine['id'] )
);
$faProblem( 'right guess of a pin inside a hidden group', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'locker' => array( 'pin' => '1234' ) ) ), 403, 'forbidden', '/locker' );
$faProblem( 'wrong guess, same answer', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'locker' => array( 'pin' => '0000' ) ) ), 403, 'forbidden', '/locker' );
$faProblem( 'emptying a hidden list that is empty', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'entries' => array() ) ), 403, 'forbidden', '/entries' );
$db->update( 'profiles', array( 'entries' => array( array( 'v' => 'x' ) ) ), array( 'id' => $mine['id'] ) );
$faProblem( '… and one that is not', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'entries' => array() ) ), 403, 'forbidden', '/entries' );
// The same for a hidden list whose children are writable but include one hidden from the viewer.
$db->update(
	'profiles',
	array(
		'diary' => array(
			array(
				'label'  => 'real',
				'secret' => 's',
			),
		),
	),
	array( 'id' => $mine['id'] )
);
$faProblem( 'right guess of a label in a hidden list', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'diary' => array( array( 'label' => 'real' ) ) ) ), 403, 'forbidden', '/diary' );
$faProblem( 'wrong guess, same answer', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'diary' => array( array( 'label' => 'nope' ) ) ) ), 403, 'forbidden', '/diary' );
// Top-level rules see the incoming patch as sent, not a sibling group already merged with hidden values.
$db->update(
	'profiles',
	array(
		'notes'   => array(
			'public' => 'p',
			'flag'   => false,
		),
		'cleared' => false,
	),
	array( 'id' => $mine['id'] )
);
$faProblem(
	'a merged hidden value is not incoming data (group first)',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'notes'   => array( 'public' => 'n' ),
			'cleared' => true,
		)
	),
	403,
	'forbidden',
	'/cleared'
);
$faProblem(
	'… nor with the keys reversed',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'cleared' => true,
			'notes'   => array( 'public' => 'n' ),
		)
	),
	403,
	'forbidden',
	'/cleared'
);
eq( '… and nothing was stored', $db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['cleared'], false );
// Update/delete selectors run as the viewer: they can't filter on a column hidden from it.
$aliceViewer = new \SpacePress\Viewer( $fa['fa_alice']['user'] );
problem( 'an update selector on a hidden column is refused', fn () => $db->update( 'profiles', array( 'name' => 'x' ), array( 'email' => 'alice@example.test' ), true, $aliceViewer ), 403, 'forbidden', '/where/email' );
problem( '… and a delete selector', fn () => $db->delete( 'profiles', array( 'salary' => -1 ), true, new \SpacePress\Viewer( $fa['fa_ed']['user'] ) ), 403, 'forbidden', '/where/salary' );
// An unchanged resend must be the same value: a list resent as an object is a change.
$db->update( 'profiles', array( 'meta' => array( 'a', 'b' ) ), array( 'id' => $mine['id'] ) );
$faProblem(
	'a list resent as an object with numeric keys is refused',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'meta' => array(
				'1' => 'b',
				'0' => 'a',
			),
		)
	),
	403,
	'forbidden',
	'/meta'
);
eq( '… the stored list is untouched, and the true resend passes', array( \SpacePress\Seam::toWire( $db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['meta'] ), $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'meta' => array( 'a', 'b' ) ) )[0] ), array( array( 'a', 'b' ), 200 ) );
// Carrying an omitted protected value forward compares only what the viewer sees: any hidden value
// in that item is refused alike, right guess or wrong.
$db->update(
	'profiles',
	array(
		'tasks' => array(
			array(
				'label'  => 'w',
				'rate'   => 5,
				'secret' => 'old',
			),
		),
	),
	array( 'id' => $mine['id'] )
);
$faProblem(
	'right guess of a hidden value while carrying a protected one',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'tasks' => array(
				array(
					'label'  => 'w',
					'secret' => 'old',
				),
			),
		)
	),
	403,
	'forbidden',
	'/tasks/0'
);
$faProblem(
	'wrong guess, same answer',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'tasks' => array(
				array(
					'label'  => 'w',
					'secret' => 'nope',
				),
			),
		)
	),
	403,
	'forbidden',
	'/tasks/0'
);
$faProblem(
	'an item edited while leaving out what she can\'t see is refused',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'tasks' => array(
				array(
					'label' => 'w!',
					'rate'  => 5,
				),
			),
		)
	),
	403,
	'forbidden',
	'/tasks/0'
);
$faProblem( 'so is a partial resend', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'tasks' => array( (object) array() ) ) ), 403, 'forbidden', '/tasks/0' );
eq(
	'resending the item as she sees it keeps the stored item whole',
	array(
		$as(
			'fa_alice',
			'PATCH',
			"/profiles/{$mine['id']}",
			array(
				'tasks' => array(
					array(
						'label' => 'w',
						'rate'  => 5,
					),
				),
			)
		)[0],
		$db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['tasks'],
	),
	array(
		200,
		array(
			array(
				'label'  => 'w',
				'rate'   => 5,
				'secret' => 'old',
			),
		),
	)
);
// Group null and item removal are refused from the rules alone: the same answer whether or not a
// hidden value is stored, so a destructive write can't test for presence.
$db->update(
	'profiles',
	array(
		'notes' => array(
			'public' => 'x',
			'flag'   => null,
		),
	),
	array( 'id' => $mine['id'] )
);
$faProblem( 'a null group is refused even when the hidden sub-field is empty', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'notes' => null ) ), 403, 'forbidden', '/notes' );
$faProblem( 'a nested hidden field without an update rule cannot be overwritten', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'notes' => array( 'private' => 'changed' ) ) ), 403, 'forbidden', '/notes/private' );
$faProblem( 'an unchanged group resend can\'t confirm a hidden value', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'notes' => $db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['notes'] ) ), 403, 'forbidden', '/notes/private' );
// A column hidden from the viewer can't be overwritten either, whatever is sent: a write is only for
// those who can see the value (review: field-write-hidden). A declared update rule makes it write-only.
$faProblem( 'an author can\'t overwrite a value she can\'t read', $as( 'fa_alice', 'PATCH', "/profiles/{$mine['id']}", array( 'email' => 'mine@x.test' ) ), 403, 'forbidden', '/email' );
eq( '… and nothing changed', $db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['email'], 'alice@example.test' );
eq( 'an editor, who reads it, may', $as( 'fa_ed', 'PATCH', "/profiles/{$mine['id']}", array( 'email' => 'alice@example.test' ) )[0], 200 );
$faProblem(
	'switching a block\'s layout would erase its protected value',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'blocks' => array(
				array(
					'layout' => 'link',
					'href'   => 'x',
				),
			),
		)
	),
	403,
	'forbidden',
	'/blocks/0'
);
eq(
	'the refused layout switch kept the stored block',
	$db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['blocks'],
	array(
		array(
			'layout' => 'memo',
			'text'   => 'kept',
		),
	)
);
$faProblem(
	'a malformed layout is the validator\'s to report',
	$as(
		'fa_alice',
		'PATCH',
		"/profiles/{$mine['id']}",
		array(
			'blocks' => array(
				array(
					'layout' => 'memo',
					'text'   => 'kept',
				),
				array( 'layout' => array( 'memo' ) ),
			),
		)
	),
	422,
	'invalid_input',
	'/blocks/1/layout'
);

// Revisions are read through the same strip.
$rev    = $db->revisions( 'profiles', $mine['id'] )[0]['id'];
$revRow = $as( 'fa_alice', 'GET', "/profiles/{$mine['id']}/revisions/$rev" )[1];
eq(
	'a revision hides what the live row hides',
	array( array_key_exists( 'email', $revRow ), $revRow['salary'], $revRow['notes'] ),
	array(
		false,
		10,
		array(
			'public' => 'x',
			'pinned' => true,
			'tag'    => null,
		),
	)
);
// Restore puts back the whole revision as stored: what she can read through her rules, and what is
// hidden from her (email) as trusted values she never sent, so nothing about them is probed or returned.
$db->update( 'profiles', array( 'email' => 'later@example.test' ), array( 'id' => $mine['id'] ) );
[$restoredStatus, $restoredRow] = $as( 'fa_alice', 'POST', "/profiles/{$mine['id']}/revisions/$rev/restore" );
eq( 'an owner restores a revision, hidden fields included, and the answer hides them', array( $restoredStatus, array_key_exists( 'email', $restoredRow ?? array() ), $db->findFirst( 'profiles', array( 'where' => array( 'id' => $mine['id'] ) ) )['email'] ), array( 200, false, 'alice@example.test' ) );
eq( 'an admin restores the same revision', $as( 'fa_admin', 'POST', "/profiles/{$mine['id']}/revisions/$rev/restore" )[0], 200 );

// /_schema reports per-column summaries (no function names).
$described = $as( null, 'GET', '/_schema' )[1]['collections']['profiles'];
eq(
	'/_schema access.fields summaries',
	$described['access']['fields'],
	array(
		'email'    => array( 'read' => 'editor' ),
		'salary'   => array(
			'read'   => 'rule',
			'update' => 'admin',
		),
		'approved' => array(
			'create' => 'editor',
			'update' => 'editor',
		),
		'mentorId' => array( 'read' => 'editor' ),
		'fixed'    => array( 'update' => false ),
		'seen'     => array( 'update' => false ),
		'locker'   => array( 'read' => 'editor' ),
		'diary'    => array( 'read' => 'editor' ),
		'entries'  => array( 'read' => 'editor' ),
		'cleared'  => array( 'update' => 'rule' ),
		'meta'     => array( 'update' => false ),
	)
);

// ================================================================ globals: one instant per update

// ================================================================ globals: one instant per update

// A global update fills never-written `now` fields and the patch's nested defaults at one instant,
// although every clock read here moves the pinned clock a millisecond (SP_NOW_STEP).
( static function (): void {
	$now    = array( 'now' => true );
	$wp     = $GLOBALS['wp'];
	$schema = new \SpacePress\Schema(
		array(
			'version'     => 5,
			'runtime'     => \SpacePress\Schema::SERIES,
			'collections' => array(),
			'globals'     => array(
				'site' => array(
					'label'  => 'site',
					'agents' => true,
					'access' => array(
						'read'   => array( 'role' => 'anyone' ),
						'update' => array( 'role' => 'editor' ),
					),
					'wp'     => array(
						'postId'         => 'sp_global_site',
						'menuSlug'       => 'spacepress-global-site',
						'groupKey'       => 'group_sp_global_site',
						'fieldKeyPrefix' => 'field_sp_global_site_',
						'optionPrefix'   => 'sp_global_site_',
					),
					'fields' => array(
						'createdAt' => array(
							'type'    => 'timestamp',
							'default' => $now,
						),
						'audit'     => array(
							'type'   => 'group',
							'fields' => array(
								'at' => array(
									'type'    => 'timestamp',
									'default' => $now,
								),
							),
						),
					),
				),
			),
		)
	);
	// Globals are SCF option fields: SCF must know this global's fields to write them.
	\SpacePress\Wp\Scf::register( $schema );
	$store = \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() );
	$db    = new \SpacePress\Db( $store, $schema, \SpacePress\db()->media() );
	putenv( 'SP_NOW=2030-01-01T00:00:00.000Z' );
	putenv( 'SP_NOW_STEP=1' );
	try {
		$site = $db->globalUpdate( 'site', array( 'audit' => array() ) );
	} finally {
		putenv( 'SP_NOW_STEP' );
		putenv( 'SP_NOW' );
	}
	eq( 'a global update stores its now defaults at one instant', array( $site['createdAt'], $site['audit']['at'] ), array( '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z' ) );
	// A render's bound visitor applies to compiled global reads too: this global is editor-read.
	$guarded = new \SpacePress\Schema(
		array(
			'version'     => 5,
			'runtime'     => \SpacePress\Schema::SERIES,
			'collections' => array(),
			'globals'     => array(
				'desk' => array(
					'label'  => 'desk',
					'agents' => true,
					'access' => array(
						'read'   => array( 'role' => 'editor' ),
						'update' => array( 'role' => 'editor' ),
					),
					'wp'     => array(
						'postId'         => 'sp_global_desk',
						'menuSlug'       => 'spacepress-global-desk',
						'groupKey'       => 'group_sp_global_desk',
						'fieldKeyPrefix' => 'field_sp_global_desk_',
						'optionPrefix'   => 'sp_global_desk_',
					),
					'fields' => array(
						'note' => array(
							'type'    => 'text',
							'default' => array( 'value' => 'shh' ),
						),
					),
				),
			),
		)
	);
	\SpacePress\Wp\Scf::register( $guarded );
	$desk = new \SpacePress\Db( \SpacePress\Wp\CompositeStore::create( $guarded, $wp->connection() ), $guarded, \SpacePress\db()->media() );
	eq( 'a trusted compiled global read sees an editor-only global', $desk->current( static fn () => \SpacePress\Seam::globalGet( 'desk' )->p['note'] ), 'shh' );
	problem( 'a visitor-bound compiled global read is refused', static fn () => $desk->current( static fn () => \SpacePress\Seam::asViewer( new \SpacePress\Viewer( null ), static fn () => \SpacePress\Seam::globalGet( 'desk' ) ) ), 401, 'unauthenticated' );
} )();

// ================================================================ JSON identity at query boundaries

// An access rule sees a list-typed patch as a handle; JSON columns retain nested object shape.
( static function (): void {
	eval( 'namespace SpacePressApp; function marked__update($ctx) { return !\SpacePress\Js::includes($ctx->p["data"]->p["tags"], "locked"); }' );
	// A read rule returning a filter that contains an empty object: compiled `{ AND: [{}] }`.
	eval( 'namespace SpacePressApp; function marked__read($ctx) { return ["AND" => [new \\SpacePress\\JsObject()]]; }' );
	$schema = new \SpacePress\Schema(
		array(
			'version'     => 5,
			'runtime'     => \SpacePress\Schema::SERIES,
			'collections' => array(
				'marked' => array(
					'primaryKey' => 'id',
					'editor'     => false,
					'table'      => 'first_marked',
					'access'     => array(
						'read'   => array( 'fn' => 'marked__read' ),
						'update' => array( 'fn' => 'marked__update' ),
					),
					'columns'    => array(
						'id'       => array(
							'type'          => 'integer',
							'primaryKey'    => true,
							'autoIncrement' => true,
							'notNull'       => true,
						),
						'tags'     => array(
							'type'     => 'select',
							'multiple' => true,
							'enum'     => array( 'locked', 'open' ),
						),
						'meta'     => array( 'type' => 'json' ),
						'info'     => array(
							'type'   => 'group',
							'fields' => array( 'extra' => array( 'type' => 'json' ) ),
						),
						'parentId' => array( 'type' => 'integer' ),
					),
					'relations'  => array(
						'kids' => array(
							'kind'       => 'many',
							'collection' => 'marked',
							'from'       => 'id',
							'to'         => 'parentId',
						),
					),
				),
			),
		)
	);
	$wp     = $GLOBALS['wp'];
	$wp->exec( 'CREATE TABLE {prefix}first_marked (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `tags` LONGTEXT, `meta` LONGTEXT, `info` LONGTEXT, `parentId` BIGINT, PRIMARY KEY (`id`)) ENGINE=InnoDB' );
	$store    = \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() );
	$db       = new \SpacePress\Db( $store, $schema, \SpacePress\db()->media() );
	$previous = \SpacePress\Db::instance();
	\SpacePress\Db::setInstance( $db ); // registered extensions read the active Db's schema
	try {
		$row    = $db->insert( 'marked', array( 'tags' => array( 'open' ) ), true )[0];
		$viewer = new \SpacePress\Viewer(
			array(
				'id'   => 1,
				'name' => 'ed',
				'role' => 'editor',
			)
		);
		$patch  = \SpacePress\Js::decodeJson( '{"tags":[],"meta":{"a":{}}}' );
		try {
			$updated = $db->update( 'marked', $patch, array( 'id' => $row['id'] ), true, $viewer )[0];
			$got     = array( $updated['tags'], \SpacePress\Js::jsonStringify( $updated['meta'] ) );
		} catch ( \Throwable $e ) {
			$got = $e::class . ': ' . $e->getMessage();
		}
		eq( 'an update rule gets list handles; the json() value keeps {}', $got, array( array(), '{"a":{}}' ) );
		// A json() filter operand keeps `{}`: deleting rows whose meta is {} leaves the one holding [].
		$db->insert( 'marked', array( array( 'meta' => \SpacePress\Js::decodeJson( '{}' ) ), array( 'meta' => array() ) ) );
		$db->delete( 'marked', \SpacePress\Js::decodeJson( '{"meta":{"eq":{}}}' ) );
		eq(
			'a json() filter compares {} and [] as different values',
			array_map(
				static fn ( $r ) => \SpacePress\Js::jsonStringify( $r['meta'] ),
				$db->findMany( 'marked', array( 'orderBy' => array( 'id' => 'asc' ) ) )
			),
			array( '{"a":{}}', '[]' )
		);
		// The same holds in nested `with` options, in a json() sub-field of a structured filter, and
		// under a viewer whose read rule returns a filter containing {} (all flattened by schema).
		$parent = $db->findFirst( 'marked', array( 'orderBy' => array( 'id' => 'asc' ) ) );
		$db->insert(
			'marked',
			array(
				array(
					'parentId' => $parent['id'],
					'meta'     => \SpacePress\Js::decodeJson( '{}' ),
					'info'     => array( 'extra' => \SpacePress\Js::decodeJson( '{}' ) ),
				),
				array(
					'parentId' => $parent['id'],
					'meta'     => array(),
					'info'     => array( 'extra' => array() ),
				),
			)
		);
		$kids     = $db->findFirst( 'marked', \SpacePress\Js::decodeJson( '{"where":{"id":' . $parent['id'] . '},"with":{"kids":{"where":{"meta":{"eq":{}}}}}}' ) )['kids'];
		$byInfo   = $db->findMany( 'marked', \SpacePress\Js::decodeJson( '{"where":{"info":{"eq":{"extra":{}}}}}' ) );
		$asViewer = $db->findMany( 'marked', array(), new \SpacePress\Viewer( null ) );
		eq(
			'permission checks run a rule filter holding {} like reads do',
			array(
				$db->permits( 'marked', 'read', $parent['id'], new \SpacePress\Viewer( null ) ),
				count( $db->permittedKeys( 'marked', 'read', new \SpacePress\Viewer( null ) ) ?? array() ),
			),
			array( true, 4 )
		);
		eq(
			'json() operands keep {} in with, in structured filters, and beside rule filters',
			array(
				array_map( static fn ( $r ) => \SpacePress\Js::jsonStringify( $r['meta'] ), $kids ),
				array_map( static fn ( $r ) => \SpacePress\Js::jsonStringify( $r['info']['extra'] ), $byInfo ),
				count( $asViewer ),
			),
			array( array( '{}' ), array( '{}' ), 4 )
		);
	} finally {
		\SpacePress\Db::setInstance( $previous );
	}
} )();

// ================================================================ callback ownership and JSON boundaries
( static function (): void {
	eval(
		<<<'CODE'
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
CODE
	);
	$columns = array(
		'id'   => array(
			'type'          => 'integer',
			'primaryKey'    => true,
			'autoIncrement' => true,
			'notNull'       => true,
		),
		'meta' => array(
			'type'   => 'json',
			'rules'  => array( 'validate' => 'refs__validate' ),
			'access' => array( 'update' => array( 'allow' => false ) ),
		),
		'info' => array(
			'type'    => 'group',
			'fields'  => array(
				'extra' => array(
					'type'    => 'json',
					'default' => array( 'json' => '{"1":1,"0":2}' ),
				),
			),
			'default' => array( 'json' => '{}' ),
		),
	);
	$schema  = new \SpacePress\Schema(
		array(
			'version'     => 5,
			'runtime'     => \SpacePress\Schema::SERIES,
			'collections' => array(
				'refs' => array(
					'primaryKey' => 'id',
					'editor'     => false,
					'table'      => 'sp_refs',
					'columns'    => $columns,
					'access'     => array(
						'read'   => array( 'allow' => true ),
						'update' => array( 'allow' => true ),
					),
					'hooks'      => array(
						'beforeCreate' => 'refs__before',
						'afterCreate'  => 'refs__after',
					),
					'relations'  => array(
						'self' => array(
							'kind'       => 'one',
							'collection' => 'refs',
							'from'       => 'id',
							'to'         => 'id',
						),
					),
				),
			),
		)
	);
	$wp      = $GLOBALS['wp'];
	$wp->exec( 'CREATE TABLE {prefix}sp_refs (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `meta` LONGTEXT, `info` LONGTEXT, PRIMARY KEY (`id`)) ENGINE=InnoDB' );
	$db       = new \SpacePress\Db( \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() ), $schema, \SpacePress\db()->media() );
	$previous = \SpacePress\Db::instance();
	\SpacePress\Db::setInstance( $db );
	$seen = null;
	\SpacePress\Extensions::onWrite(
		static function ( string $op, string $collection, array &$data ) use ( &$seen ): void {
			if ( 'refs' === $collection ) {
				$seen = is_array( $data );
			}
		}
	);
	try {
		$source                  = new \SpacePress\JsObject( array( 'x' => 1 ) );
		$GLOBALS['refsCaptured'] = $source;
		$row                     = $db->insert( 'refs', new \SpacePress\JsObject( array( 'meta' => $source ) ), true )[0];
		eq(
			'before mutations persist; validator, capture and after mutations are isolated',
			array(
				$seen,
				$row['meta']->p['x'],
				$db->findFirst( 'refs' )['meta']->p['x'],
				$source->p['x'],
			),
			array( true, 2, 2, 99 )
		);
		eq( 'a group default fills nested JSON defaults as objects', \SpacePress\Js::jsonStringify( $row['info'] ), '{"extra":{"0":2,"1":1}}' );
		foreach ( array( '{}', '[]', '{"1":1,"0":2}', '{"\u0000":1}' ) as $json ) {
			$value   = \SpacePress\Js::decodeJson( $json );
			$created = $db->insert(
				'refs',
				array(
					'meta' => $value,
					'info' => array(),
				),
				true
			)[0];
			$read    = $db->findFirst( 'refs', array( 'where' => array( 'id' => $created['id'] ) ) );
			eq( "JSON insert/read/response: $json", \SpacePress\Js::jsonStringify( $read['meta'] ), \SpacePress\Js::jsonStringify( $value ) );
		}
		$protected = $db->insert( 'refs', array( 'meta' => \SpacePress\Js::decodeJson( '{"a":1,"b":{"n":2}}' ) ), true )[0];
		$viewer    = new \SpacePress\Viewer(
			array(
				'id'   => 1,
				'name' => 'Ed',
				'role' => 'editor',
			)
		);
		$same      = $db->update( 'refs', array( 'meta' => \SpacePress\Js::decodeJson( '{"b":{"n":2},"a":1}' ) ), array( 'id' => $protected['id'] ), true, $viewer )[0];
		eq( 'a protected JSON echo compares object keys structurally', $same['meta']->p['b']->p['n'], 2 );
		problem( 'a nested JSON change is a protected write', fn () => $db->update( 'refs', array( 'meta' => \SpacePress\Js::decodeJson( '{"b":{"n":3},"a":1}' ) ), array( 'id' => $protected['id'] ), true, $viewer ), 403, 'forbidden', '/meta' );
		eq( 'sameJson detects a nested handle change', \SpacePress\Js::sameJson( $same['meta'], \SpacePress\Js::decodeJson( '{"b":{"n":3},"a":1}' ) ), false );
		$jsRow = \SpacePress\Seam::findFirst(
			'refs',
			array(
				'where' => array( 'id' => $row['id'] ),
				'with'  => array( 'self' => true ),
			)
		);
		eq( 'row handles enumerate columns and attached relations', array( \SpacePress\Js::keys( $jsRow )->a, $jsRow->p['self']->p['id'] ), array( array( ...array_keys( $columns ), 'self' ), $row['id'] ) );
		problem(
			'cyclic write inputs are a validation error',
			static function () use ( $db ): void {
				$cycle            = new \SpacePress\JsObject();
				$cycle->p['self'] = $cycle;
				$db->insert( 'refs', array( 'meta' => $cycle ) );
			},
			422,
			'invalid_input'
		);
	} finally {
		\SpacePress\Db::setInstance( $previous );
		unset( $GLOBALS['refsCaptured'] ); }
} )();

// ================================================================ a second Db keeps its own rules

// Extensions (field access, sync, locales, files…) reach the schema through db(): that must be the
// Db running the operation, not the booted app's, or a second Db silently loses its field rules.
( static function (): void {
	$wp = $GLOBALS['wp'];
	$id = array(
		'type'          => 'integer',
		'primaryKey'    => true,
		'autoIncrement' => true,
		'notNull'       => true,
	);
	eval( 'namespace SpacePressApp; function scoped__rule($ctx) { return \\SpacePress\\db()->schema()->hasCollection("people"); } function scoped__default() { return \\SpacePress\\db()->schema()->hasCollection("people") ? "secondary" : "booted"; }' );
	$schema = new \SpacePress\Schema(
		array(
			'version'     => 5,
			'runtime'     => \SpacePress\Schema::SERIES,
			'collections' => array(
				'people' => array(
					'primaryKey' => 'id',
					'editor'     => false,
					'table'      => 'sp_scoped_people',
					'revisions'  => true,
					'access'     => array(
						'read'   => array( 'fn' => 'scoped__rule' ),
						'update' => array( 'fn' => 'scoped__rule' ),
					),
					'columns'    => array(
						'id'   => $id,
						'name' => array(
							'type'    => 'text',
							'notNull' => true,
						),
						'ssn'  => array(
							'type'   => 'text',
							'access' => array( 'read' => array( 'role' => 'admin' ) ),
						),
					),
				),
			),
			'globals'     => array(
				'scope' => array(
					'label'  => 'scope',
					'agents' => true,
					'fields' => array(
						'name' => array(
							'type'    => 'text',
							'default' => array( 'fn' => 'scoped__default' ),
						),
					),
					'access' => array(
						'read'   => array( 'fn' => 'scoped__rule' ),
						'update' => array( 'fn' => 'scoped__rule' ),
					),
					'wp'     => array(
						'postId'         => 'sp_global_scope',
						'menuSlug'       => 'spacepress-global-scope',
						'groupKey'       => 'group_sp_global_scope',
						'fieldKeyPrefix' => 'field_sp_global_scope_',
						'optionPrefix'   => 'sp_global_scope_',
					),
				),
			),
		)
	);
	\SpacePress\Wp\Scf::register( $schema );
	$wp->exec( 'CREATE TABLE {prefix}sp_scoped_people (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `name` LONGTEXT NOT NULL, `ssn` LONGTEXT, PRIMARY KEY (`id`)) ENGINE=InnoDB' );
	$store = \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() );
	$db    = new \SpacePress\Db( $store, $schema, \SpacePress\db()->media() );
	$db->insert(
		'people',
		array(
			'name' => 'p',
			'ssn'  => '123-45-6789',
		)
	);
	eq( 'field rules of a second Db apply to it', array_key_exists( 'ssn', $db->findFirst( 'people', array(), new \SpacePress\Viewer( null ) ) ), false );
	eq( '… and its trusted reads see the column', $db->findFirst( 'people' )['ssn'], '123-45-6789' );
	$viewer = new \SpacePress\Viewer(
		array(
			'id'   => 1,
			'role' => 'admin',
		)
	);
	eq( 'direct permission rules query the secondary schema', array( $db->permits( 'people', 'read', 1, $viewer ), $db->permittedKeys( 'people', 'update', $viewer ) ), array( true, null ) );
	$revisions = $db->revisions( 'people', 1, $viewer );
	eq( 'revision authorization queries the secondary schema', count( $revisions ), 1 );
	eq( 'revision restore authorization keeps the secondary schema', $db->restoreRevision( 'people', 1, $revisions[0]['id'], $viewer )['name'], 'p' );
	\SpacePress\Extensions::beforeRead(
		static function ( string $collection, array &$opts ): void {
			if ( 'people' === $collection && ! \SpacePress\db()->schema()->hasCollection( 'people' ) ) {
				throw new \RuntimeException( 'wrong query Db' );
			}
		},
		constraintSafe: true
	);
	eq( 'editor captures dispatch query extensions in their own Db', $db->editorRow( 'people', 1 )['name'], 'p' );
	eq( 'global rules and default generators use the secondary schema', $db->globalGet( 'scope', $viewer )['name'], 'secondary' );
	eq( 'global update authorization uses the secondary schema', $db->globalUpdate( 'scope', array( 'name' => 'saved' ), $viewer )['name'], 'saved' );
	$shared    = new \SpacePress\Db(
		$store,
		new \SpacePress\Schema(
			array(
				'version'     => 5,
				'runtime'     => \SpacePress\Schema::SERIES,
				'collections' => array(),
			)
		),
		$db->media()
	);
	$committed = array();
	$shared->transaction(
		function () use ( $db, &$committed ): void {
			$db->transaction(
				function () use ( $db, &$committed ): void {
					\SpacePress\Extensions::afterCommit(
						function () use ( &$committed ): void {
							$committed[] = \SpacePress\db()->schema()->hasCollection( 'people' );
						}
					);
				}
			);
			eq( 'a secondary Db callback waits for the shared outer commit', $committed, array() );
		}
	);
	eq( 'deferred callbacks retain the registering Db', $committed, array( true ) );
	eq( 'the booted app\'s db() is back afterwards', \SpacePress\db()->schema()->hasCollection( 'profiles' ), true );
} )();

// ================================================================ self-referencing and cyclic cascades (#524)

( static function () use ( $wp ): void {
	$id     = array(
		'type'          => 'integer',
		'primaryKey'    => true,
		'autoIncrement' => true,
		'notNull'       => true,
	);
	$open   = array(
		'read'   => array( 'role' => 'anyone' ),
		'create' => array( 'role' => 'anyone' ),
		'update' => array( 'role' => 'anyone' ),
		'delete' => array( 'role' => 'anyone' ),
	);
	$before = array();
	$after  = array();
	$schema = new \SpacePress\Schema(
		array(
			'name'        => 'cycles',
			'collections' => array(
				'nodes' => array(
					'primaryKey' => 'id',
					'editor'     => false,
					'access'     => $open,
					'hooks'      => array(
						'beforeDelete' => static function ( array $row ) use ( &$before ): void {
							$before[] = $row['id'];
						},
						'afterDelete'  => static function ( array $row ) use ( &$after ): void {
							$after[] = $row['id'];
						},
					),
					'columns'    => array(
						'id'       => $id,
						'label'    => array(
							'type'    => 'text',
							'notNull' => true,
						),
						'parentId' => array(
							'type'       => 'integer',
							'references' => array(
								'collection' => 'nodes',
								'column'     => 'id',
								'onDelete'   => 'cascade',
							),
						),
					),
				),
			),
		)
	);
	$wp->exec( 'CREATE TABLE {prefix}sp_nodes (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `label` LONGTEXT NOT NULL, `parentId` BIGINT UNSIGNED NULL, PRIMARY KEY (`id`), CONSTRAINT `sp_nodes_parentId_fk` FOREIGN KEY (`parentId`) REFERENCES {prefix}sp_nodes (`id`) ON DELETE CASCADE) ENGINE=InnoDB' );
	$store    = \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() );
	$cycleDb  = new \SpacePress\Db( $store, $schema, \SpacePress\db()->media() );
	$viewer   = new \SpacePress\Viewer(
		array(
			'id'   => 1,
			'name' => 'owner',
			'role' => 'subscriber',
		)
	);
	$previous = \SpacePress\Db::instance();
	\SpacePress\Db::setInstance( $cycleDb );
	try {
		// Self-referencing row: deleted once, hooks run once each, no hook_recursion.
		$self = $cycleDb->insert( 'nodes', array( 'label' => 'self' ), true )[0];
		$cycleDb->update( 'nodes', array( 'parentId' => $self['id'] ), array( 'id' => $self['id'] ) );
		$cycleDb->delete( 'nodes', array( 'id' => $self['id'] ), false, $viewer );
		eq(
			'self-referencing cascade deletes the row once and runs hooks once',
			array(
				$cycleDb->findMany( 'nodes' ),
				$before,
				$after,
			),
			array( array(), array( $self['id'] ), array( $self['id'] ) )
		);

		// Both roots of a two-row cycle are selected. The cascade must not repeat a root's hooks.
		$before  = array();
		$after   = array();
		[$a, $b] = $cycleDb->insert( 'nodes', array( array( 'label' => 'a' ), array( 'label' => 'b' ) ), true );
		$cycleDb->update( 'nodes', array( 'parentId' => $b['id'] ), array( 'id' => $a['id'] ) );
		$cycleDb->update( 'nodes', array( 'parentId' => $a['id'] ), array( 'id' => $b['id'] ) );
		$cycleDb->delete( 'nodes', array( 'id' => array( 'in' => array( $a['id'], $b['id'] ) ) ), false, $viewer );
		eq(
			'two-row cascade cycle deletes both rows once and runs hooks once per row',
			array(
				$cycleDb->findMany( 'nodes' ),
				$before,
				$after,
			),
			array( array(), array( $a['id'], $b['id'] ), array( $b['id'], $a['id'] ) )
		);
	} finally {
		\SpacePress\Db::setInstance( $previous );
	}
} )();

// ================================================================ write errors don't reveal what the viewer can't read

// A unique conflict or a dangling reference is an answer about stored rows. Writes may only get one
// about rows the viewer could read anyway (review: field-unique-oracle, ref-existence-oracle).
( static function (): void {
	$wp     = $GLOBALS['wp'];
	$id     = array(
		'type'          => 'integer',
		'primaryKey'    => true,
		'autoIncrement' => true,
		'notNull'       => true,
	);
	$anyone = array( 'role' => 'anyone' );
	$table  = static fn ( string $name, array $access, array $columns ): array => array(
		'primaryKey' => 'id',
		'editor'     => false,
		'table'      => "sp_$name",
		'access'     => $access,
		'columns'    => array( 'id' => $id ) + $columns,
	);
	$schema = new \SpacePress\Schema(
		array(
			'version'     => 5,
			'runtime'     => \SpacePress\Schema::SERIES,
			'collections' => array(
				// Anyone signs up; only admins see who did.
				'subscribers' => $table(
					'subscribers',
					array(
						'read'   => array( 'role' => 'admin' ),
						'create' => $anyone,
					),
					array(
						'email' => array(
							'type'    => 'text',
							'notNull' => true,
							'unique'  => true,
						),
						'note'  => array(
							'type'    => 'text',
							'default' => array( 'value' => 'welcome' ),
						),
					)
				),
				// Anyone reads people; the ssn column is admin-only.
				'people'      => $table(
					'people',
					array(
						'read'   => $anyone,
						'create' => $anyone,
						'update' => $anyone,
					),
					array(
						'name' => array(
							'type'    => 'text',
							'notNull' => true,
						),
						'ssn'  => array(
							'type'   => 'text',
							'unique' => true,
							'access' => array(
								'read'   => array( 'role' => 'admin' ),
								'update' => $anyone,
							),
						),
					)
				),
				// Notes are editor-readable; private tags may point at a note.
				'notes'       => $table(
					'notes',
					array(
						'read'   => array( 'role' => 'editor' ),
						'create' => $anyone,
						'delete' => $anyone,
					),
					array(
						'body' => array(
							'type'    => 'text',
							'notNull' => true,
						),
					)
				),
				'tags'        => $table(
					'tags',
					array(
						'read'   => array( 'role' => 'admin' ),
						'create' => $anyone,
						'update' => $anyone,
					),
					array(
						'name'   => array(
							'type'    => 'text',
							'notNull' => true,
						),
						'noteId' => array(
							'type'       => 'integer',
							'references' => array(
								'collection' => 'notes',
								'column'     => 'id',
							),
						),
					)
				),
				// A reference to a unique key that isn't `id`: only 0.3.0 captures still declare one
				// (docs/decisions/2026-11-11-authoring-surface.md, rulings 21 and 22). `badge` is admin-only.
				'badges'      => $table(
					'badges',
					array(
						'read'   => $anyone,
						'create' => $anyone,
						'update' => $anyone,
						'delete' => $anyone,
					),
					array(
						'code'  => array(
							'type'   => 'integer',
							'unique' => true,
						),
						'badge' => array(
							'type'   => 'integer',
							'unique' => true,
							'access' => array(
								'read'   => array( 'role' => 'admin' ),
								'update' => $anyone,
							),
						),
					)
				),
				'holders'     => $table(
					'holders',
					array(
						'read'   => array( 'role' => 'admin' ),
						'create' => $anyone,
						'update' => $anyone,
					),
					array(
						'code'  => array(
							'type'       => 'integer',
							'references' => array(
								'collection' => 'badges',
								'column'     => 'code',
							),
						),
						'badge' => array(
							'type'       => 'integer',
							'references' => array(
								'collection' => 'badges',
								'column'     => 'badge',
							),
						),
					)
				),
			),
		)
	);
	$wp->exec( 'CREATE TABLE {prefix}sp_subscribers (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `email` VARCHAR(191) NOT NULL, `note` LONGTEXT, PRIMARY KEY (`id`), UNIQUE KEY `email_unique` (`email`)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_people (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `name` LONGTEXT NOT NULL, `ssn` VARCHAR(191), PRIMARY KEY (`id`), UNIQUE KEY `ssn_unique` (`ssn`)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_notes (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `body` LONGTEXT NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_tags (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `name` LONGTEXT NOT NULL, `noteId` BIGINT UNSIGNED, PRIMARY KEY (`id`), CONSTRAINT `sp_tags_noteId_fk` FOREIGN KEY (`noteId`) REFERENCES {prefix}sp_notes (`id`)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_badges (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `code` BIGINT, `badge` BIGINT, PRIMARY KEY (`id`), UNIQUE KEY `code_unique` (`code`), UNIQUE KEY `badge_unique` (`badge`)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_holders (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `code` BIGINT, `badge` BIGINT, PRIMARY KEY (`id`), CONSTRAINT `sp_holders_code_fk` FOREIGN KEY (`code`) REFERENCES {prefix}sp_badges (`code`), CONSTRAINT `sp_holders_badge_fk` FOREIGN KEY (`badge`) REFERENCES {prefix}sp_badges (`badge`)) ENGINE=InnoDB' );
	$store    = \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() );
	$db       = new \SpacePress\Db( $store, $schema, \SpacePress\db()->media() );
	$previous = \SpacePress\Db::instance();
	\SpacePress\Db::setInstance( $db ); // registered extensions read the active Db's schema
	$anon   = new \SpacePress\Viewer( null );
	$sub    = new \SpacePress\Viewer(
		array(
			'id'   => 5,
			'name' => 'sub',
			'role' => 'subscriber',
		)
	);
	$admin  = new \SpacePress\Viewer(
		array(
			'id'   => 2,
			'name' => 'root',
			'role' => 'admin',
		)
	);
	$editor = new \SpacePress\Viewer(
		array(
			'id'   => 3,
			'name' => 'ed',
			'role' => 'editor',
		)
	);
	$count  = static fn ( string $c ) => (int) $wp->scalar( "SELECT COUNT(*) FROM {prefix}sp_$c" );
	try {
		// Unique writes require visibility across the collection, before any value is looked up.
		$db->insert( 'subscribers', array( 'email' => 'a@x.test' ), true, $admin );
		problem( 'a private unique value is refused when taken', fn () => $db->insert( 'subscribers', array( 'email' => 'a@x.test' ), true, $anon ), 401, 'unauthenticated', '/email' );
		problem( 'a private unique value is refused when free', fn () => $db->insert( 'subscribers', array( 'email' => 'b@x.test' ), true, $anon ), 401, 'unauthenticated', '/email' );
		eq( 'rejected creates persist nothing', $count( 'subscribers' ), 1 );
		problem( 'readers retain normal unique conflicts', fn () => $db->insert( 'subscribers', array( 'email' => 'a@x.test' ), true, $admin ), 409, 'unique_violation', '/email' );

		// A unique column the viewer can't read: refused before any lookup, whatever the value.
		$person = $db->insert(
			'people',
			array(
				'name' => 'p',
				'ssn'  => '123-45-6789',
			),
			true
		)[0];
		problem(
			'setting a hidden unique column is refused when the value exists…',
			fn () => $db->insert(
				'people',
				array(
					'name' => 'q',
					'ssn'  => '123-45-6789',
				),
				true,
				$anon
			),
			401,
			'unauthenticated',
			'/ssn'
		);
		problem(
			'… and the same when it doesn\'t',
			fn () => $db->insert(
				'people',
				array(
					'name' => 'q',
					'ssn'  => '000-00-0000',
				),
				true,
				$anon
			),
			401,
			'unauthenticated',
			'/ssn'
		);
		problem( 'a write-only unique value cannot be tested through an update', fn () => $db->update( 'people', array( 'ssn' => '123-45-6789' ), array( 'id' => $person['id'] ), true, $sub ), 403, 'forbidden', '/ssn' );
		problem( 'a free write-only unique value is equally refused', fn () => $db->update( 'people', array( 'ssn' => '000-00-0000' ), array( 'id' => $person['id'] ), true, $sub ), 403, 'forbidden', '/ssn' );
		eq( 'a create that leaves it out is fine', $db->insert( 'people', array( 'name' => 'r' ), true, $anon )[0]['name'], 'r' );
		eq(
			'an admin sets it',
			$db->insert(
				'people',
				array(
					'name' => 's',
					'ssn'  => '111-11-1111',
				),
				true,
				$admin
			)[0]['ssn'],
			'111-11-1111'
		);

		// A reference must name a row the viewer may read: unreadable and missing answer alike.
		$note    = $db->insert( 'notes', array( 'body' => 'private' ), true )[0];
		$missing = $note['id'] + 100;
		$failure = static function ( callable $write ): array {
			try {
				$write();

				return array(
					'status'  => 200,
					'code'    => 'unexpected_success',
					'pointer' => null,
					'detail'  => '',
				);
			} catch ( \Throwable $e ) {
				return \SpacePress\App::problem( $e );
			}
		};
		foreach ( array( $note['id'], $missing ) as $value ) {
			$error = $failure(
				fn () => $db->insert(
					'tags',
					array(
						'name'   => 't',
						'noteId' => $value,
					),
					true,
					$sub
				)
			);
			eq(
				'unreadable and absent references answer identically',
				array( $error['status'], $error['code'], $error['pointer'], $error['detail'] ),
				array( 409, 'reference_violation', '/noteId', 'No referenced notes row for noteId' )
			);
		}
		$tag = $db->insert( 'tags', array( 'name' => 'u' ), true, $sub )[0];
		problem( 'updates are held to it too', fn () => $db->update( 'tags', array( 'noteId' => $note['id'] ), array( 'id' => $tag['id'] ), true, $sub ), 409, 'reference_violation', '/noteId' );
		eq(
			'a viewer who can read the target references it',
			$db->insert(
				'tags',
				array(
					'name'   => 'v',
					'noteId' => $note['id'],
				),
				true,
				$admin
			)[0]['noteId'],
			$note['id']
		);
		// Deletes look at the rows that reference this row only
		// (docs/decisions/2026-11-16-per-row-delete-visibility.md).
		$unreferenced = $db->insert( 'notes', array( 'body' => 'no children' ), true )[0];
		$where        = array( 'noteId' => $note['id'] );
		$mysqlStore   = new \SpacePress\Wp\CompositeStore(
			$schema,
			$store->db,
			$store->posts,
			new \SpacePress\Wp\WpTableStore( $store->db, $schema, \SpacePress\Dialect::mysql() )
		);
		$mysqlDb      = new \SpacePress\Db( $mysqlStore, $schema, $db->media() );
		$inner        = 'SELECT t0.`id` AS `id` FROM `' . $store->db->prefix() . 'sp_tags` t0 WHERE t0.`noteId` = ?';
		eq(
			'MySQL locks the rows counted by delete preflight',
			$mysqlDb->countQuery( 'tags', $where, forUpdate: true ),
			array(
				'sql'    => "SELECT COUNT(*) AS n FROM ($inner FOR UPDATE) first_count",
				'params' => array( $note['id'] ),
			)
		);
		$statements                          = array();
		\SpacePress\Wp\Connection::$observer = static function ( string $sql ) use ( &$statements ): void {
			$statements[] = $sql;
		};
		try {
			problem( 'a hidden referencing row refuses the delete', fn () => $db->delete( 'notes', array( 'id' => $note['id'] ), true, $editor ), 409, 'reference_violation' );
		} finally {
			\SpacePress\Wp\Connection::$observer = null;
		}
		check( 'SQLite delete preflight runs the count without a lock clause', in_array( "SELECT COUNT(*) AS n FROM ($inner) first_count", $statements, true ), $statements );
		eq( 'the refused delete keeps the parent', $count( 'notes' ), 2 );
		$db->insert(
			'tags',
			array(
				'name'   => 'second hidden',
				'noteId' => $note['id'],
			),
			true
		);
		$one = $failure( fn () => $db->delete( 'notes', array( 'id' => $note['id'] ), true, $editor ) );
		$db->insert(
			'tags',
			array(
				'name'   => 'third hidden',
				'noteId' => $note['id'],
			),
			true
		);
		eq( 'one or many hidden rows answer the same body', $failure( fn () => $db->delete( 'notes', array( 'id' => $note['id'] ), true, $editor ) ), $one );
		eq( 'the generic body names no row', array( $one['status'], $one['code'], $one['pointer'] ?? null, $one['detail'] ), array( 409, 'reference_violation', null, "Rows you can't read may reference this row" ) );
		eq( 'a row nothing references deletes', $db->delete( 'notes', array( 'id' => $unreferenced['id'] ), true, $editor )[0]['id'], $unreferenced['id'] );
		eq(
			'trusted writes (hooks, CLI) check existence only',
			$db->insert(
				'tags',
				array(
					'name'   => 'w',
					'noteId' => $note['id'],
				),
				true
			)[0]['noteId'],
			$note['id']
		);
		eq( 'hidden referencing rows are untouched by refused deletes', (int) $wp->scalar( "SELECT COUNT(*) FROM {prefix}sp_tags WHERE noteId = {$note['id']}" ), 4 );

		// References to a key other than `id` (0.3.0 captures only).
		[$b1, $b2] = $db->insert(
			'badges',
			array(
				array(
					'code'  => 701001,
					'badge' => 889001,
				),
				array(
					'code'  => 701002,
					'badge' => 889002,
				),
			),
			true
		);
		eq( 'a reference to a non-id unique key links by that key', $db->insert( 'holders', array( 'code' => 701001 ), true, $admin )[0]['code'], 701001 );
		problem( 'a missing non-id key is a reference violation', fn () => $db->insert( 'holders', array( 'code' => 709999 ), true, $anon ), 409, 'reference_violation', '/code' );
		foreach ( array( 889001, 889999 ) as $badge ) {
			problem( 'a key the viewer can\'t read refuses alike whether it exists or not', fn () => $db->insert( 'holders', array( 'badge' => $badge ), true, $anon ), 409, 'reference_violation', '/badge' );
		}
		eq( 'readers of the key link by it', $db->insert( 'holders', array( 'badge' => 889002 ), true, $admin )[0]['badge'], 889002 );
		// Holders are admin-only: an editor can't tell referenced keys from free ones, so neither changes.
		$db->update( 'holders', array( 'code' => null ), array( 'code' => 701001 ), true );
		foreach ( array( $b1, $b2 ) as $parent ) {
			problem( 'changing a referenced non-id key is refused, children or not', fn () => $db->update( 'badges', array( 'code' => $parent['code'] + 10 ), array( 'id' => $parent['id'] ), true, $editor ), 409, 'reference_violation' );
		}
		eq( 'refused key changes keep both keys', array_column( $db->findMany( 'badges', array( 'orderBy' => array( 'id' => 'asc' ) ) ), 'code' ), array( 701001, 701002 ) );
		// A delete can't tell whether a referenced key the viewer can't read is null: `badge` is
		// admin-only, so deleting a badge refuses alike whether it holds one or not, before any count.
		[$nullBadge, $setBadge] = $db->insert(
			'badges',
			array(
				array(
					'code'  => 701003,
					'badge' => null,
				),
				array(
					'code'  => 701004,
					'badge' => 889004,
				),
			),
			true
		);
		$answers                = array();
		foreach ( array( $nullBadge, $setBadge ) as $parent ) {
			$answers[] = $failure( fn () => $db->delete( 'badges', array( 'id' => $parent['id'] ), true, $anon ) );
		}
		eq( 'a hidden referenced key refuses the delete whether it is null or not', $answers[0], $answers[1] );
		eq( '… with the one body', array( $answers[0]['status'], $answers[0]['code'], $answers[0]['detail'] ), array( 409, 'reference_violation', "Rows you can't read may reference this row" ) );
		eq( 'a reader of the key deletes the badge whose key is null', $db->delete( 'badges', array( 'id' => $nullBadge['id'] ), true, $admin )[0]['id'], $nullBadge['id'] );
	} finally {
		\SpacePress\Db::setInstance( $previous );
	}
} )();

// Owner-scoped apps (examples/pet-food, stuff-drawer, subscriptions, drive-locker): every table reads
// `{ ownerId: user.id }`. A delete checks only the rows that reference this row: an owner deletes
// their own rows and applies onDelete to their own children; another owner's row pointing here (which
// an app hook should prevent, but the database allows) refuses with the generic 409, untouched.
( static function (): void {
	$wp     = $GLOBALS['wp'];
	$id     = array(
		'type'          => 'integer',
		'primaryKey'    => true,
		'autoIncrement' => true,
		'notNull'       => true,
	);
	$owned  = array( 'fn' => static fn ( array $ctx ) => null === $ctx['user'] ? false : array( 'ownerId' => $ctx['user']['id'] ) );
	$access = array(
		'read'   => $owned,
		'create' => array( 'role' => 'authenticated' ),
		'update' => $owned,
		'delete' => $owned,
	);
	$owner  = array(
		'ownerId' => array(
			'type'    => 'integer',
			'notNull' => true,
		),
	);
	$table  = static fn ( string $name, array $columns ): array => array(
		'primaryKey' => 'id',
		'editor'     => false,
		'table'      => "sp_$name",
		'access'     => $access,
		'columns'    => array( 'id' => $id ) + $owner + $columns,
	);
	$ref    = static fn ( string $to, string $onDelete, bool $notNull = true ): array => array(
		'type'       => 'integer',
		'notNull'    => $notNull,
		'references' => array(
			'collection' => $to,
			'column'     => 'id',
			'onDelete'   => $onDelete,
		),
	);
	$schema = new \SpacePress\Schema(
		array(
			'version'     => 3,
			'runtime'     => \SpacePress\Schema::SERIES,
			'collections' => array(
				'bins'     => $table( 'bins', array() ),
				'things'   => $table( 'things', array( 'binId' => $ref( 'bins', 'set null', false ) ) ),
				'loans'    => $table( 'loans', array( 'thingId' => $ref( 'things', 'restrict' ) ) ),
				'charges'  => $table( 'charges', array( 'thingId' => $ref( 'things', 'cascade' ) ) ),
				'receipts' => $table( 'receipts', array( 'chargeId' => $ref( 'charges', 'cascade' ) ) ),
			),
		)
	);
	$fk     = static fn ( string $t, string $c, string $to, string $on ): string => "CONSTRAINT `sp_{$t}_{$c}_fk` FOREIGN KEY (`$c`) REFERENCES {prefix}sp_$to (`id`) ON DELETE $on";
	$wp->exec( 'CREATE TABLE {prefix}sp_bins (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `ownerId` BIGINT NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_things (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `ownerId` BIGINT NOT NULL, `binId` BIGINT UNSIGNED, PRIMARY KEY (`id`), ' . $fk( 'things', 'binId', 'bins', 'SET NULL' ) . ') ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_loans (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `ownerId` BIGINT NOT NULL, `thingId` BIGINT UNSIGNED NOT NULL, PRIMARY KEY (`id`), ' . $fk( 'loans', 'thingId', 'things', 'RESTRICT' ) . ') ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_charges (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `ownerId` BIGINT NOT NULL, `thingId` BIGINT UNSIGNED NOT NULL, PRIMARY KEY (`id`), ' . $fk( 'charges', 'thingId', 'things', 'CASCADE' ) . ') ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_receipts (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `ownerId` BIGINT NOT NULL, `chargeId` BIGINT UNSIGNED NOT NULL, PRIMARY KEY (`id`), ' . $fk( 'receipts', 'chargeId', 'charges', 'CASCADE' ) . ') ENGINE=InnoDB' );
	$store    = \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() );
	$db       = new \SpacePress\Db( $store, $schema, \SpacePress\db()->media() );
	$previous = \SpacePress\Db::instance();
	\SpacePress\Db::setInstance( $db );
	$me      = new \SpacePress\Viewer(
		array(
			'id'   => 7,
			'name' => 'me',
			'role' => 'subscriber',
		)
	);
	$other   = 8;
	$count   = static fn ( string $t ) => (int) $wp->scalar( "SELECT COUNT(*) FROM {prefix}sp_$t" );
	$failure = static function ( callable $write ): array {
		try {
			$write();

			return array(
				'status'  => 200,
				'code'    => 'unexpected_success',
				'pointer' => null,
				'detail'  => '',
			);
		} catch ( \Throwable $e ) {
			return \SpacePress\App::problem( $e );
		}
	};
	$insert  = static fn ( string $t, array $row ) => $db->insert( $t, $row, true )[0];
	try {
		$empty = $insert( 'bins', array( 'ownerId' => 7 ) );
		eq( 'an owner deletes an empty parent of an owner-filtered table', $db->delete( 'bins', array( 'id' => $empty['id'] ), true, $me )[0]['id'], $empty['id'] );

		$bin   = $insert( 'bins', array( 'ownerId' => 7 ) );
		$thing = $insert(
			'things',
			array(
				'ownerId' => 7,
				'binId'   => $bin['id'],
			)
		);
		$db->delete( 'bins', array( 'id' => $bin['id'] ), false, $me );
		eq( 'set null applies to the owner\'s own children', $db->findFirst( 'things', array( 'where' => array( 'id' => $thing['id'] ) ) )['binId'], null );

		$charge = $insert(
			'charges',
			array(
				'ownerId' => 7,
				'thingId' => $thing['id'],
			)
		);
		$insert(
			'receipts',
			array(
				'ownerId'  => 7,
				'chargeId' => $charge['id'],
			)
		);
		$loan = $insert(
			'loans',
			array(
				'ownerId' => 7,
				'thingId' => $thing['id'],
			)
		);
		problem( 'restrict still refuses on visible rows', fn () => $db->delete( 'things', array( 'id' => $thing['id'] ), true, $me ), 409, 'reference_violation' );
		$db->delete( 'loans', array( 'id' => $loan['id'] ), false, $me );
		$db->delete( 'things', array( 'id' => $thing['id'] ), false, $me );
		eq( 'cascade removes the owner\'s own children and grandchildren', array( $count( 'things' ), $count( 'charges' ), $count( 'receipts' ) ), array( 0, 0, 0 ) );

		// Another owner's rows point at mine: refused alike at any depth, nothing written or read back.
		$mine   = $insert( 'things', array( 'ownerId' => 7 ) );
		$theirs = $insert(
			'loans',
			array(
				'ownerId' => $other,
				'thingId' => $mine['id'],
			)
		);
		$direct = $failure( fn () => $db->delete( 'things', array( 'id' => $mine['id'] ), true, $me ) );
		eq( 'a hidden restrict child refuses with the generic body', array( $direct['status'], $direct['code'], $direct['detail'] ), array( 409, 'reference_violation', "Rows you can't read may reference this row" ) );
		$db->delete( 'loans', array( 'id' => $theirs['id'] ), false );
		$myCharge = $insert(
			'charges',
			array(
				'ownerId' => 7,
				'thingId' => $mine['id'],
			)
		);
		$insert(
			'receipts',
			array(
				'ownerId'  => $other,
				'chargeId' => $myCharge['id'],
			)
		);
		$deep = $failure( fn () => $db->delete( 'things', array( 'id' => $mine['id'] ), true, $me ) );
		eq( 'a hidden grandchild under a visible cascade refuses the whole delete, with the same body: no table or depth', $deep, $direct );
		eq( 'the refused cascade rolled back nothing it should keep', array( $count( 'things' ), $count( 'charges' ), $count( 'receipts' ) ), array( 1, 1, 1 ) );
		$theirBin = $insert( 'bins', array( 'ownerId' => $other ) );
		$insert(
			'things',
			array(
				'ownerId' => 7,
				'binId'   => $theirBin['id'],
			)
		);
		eq( 'another owner\'s parent is not selected by my delete', $db->delete( 'bins', array( 'id' => $theirBin['id'] ), true, $me ), array() );
		eq( 'so it stays', $count( 'bins' ), 1 );
	} finally {
		\SpacePress\Db::setInstance( $previous );
	}
} )();

// A referential write is the viewer's own: cascade needs their delete rule on every child, set null
// their update rule; a branch with no rows runs no generator.
( static function () use ( $db ): void {
	$wp     = $GLOBALS['wp'];
	$id     = array(
		'type'          => 'integer',
		'primaryKey'    => true,
		'autoIncrement' => true,
		'notNull'       => true,
	);
	$any    = array( 'role' => 'anyone' );
	$open   = array(
		'read'   => $any,
		'create' => $any,
		'update' => $any,
		'delete' => $any,
	);
	$owned  = array( 'fn' => static fn ( array $ctx ) => null === $ctx['user'] ? false : array( 'ownerId' => $ctx['user']['id'] ) );
	$table  = static fn ( string $name, array $cols, array $access ): array => array(
		'primaryKey' => 'id',
		'editor'     => false,
		'table'      => "sp_rw_$name",
		'columns'    => array( 'id' => $id ) + $cols,
		'access'     => $access,
	);
	$ref    = static fn ( string $to, string $on, array $extra = array() ): array => array(
		'type'       => 'integer',
		'references' => array(
			'collection' => $to,
			'column'     => 'id',
			'onDelete'   => $on,
		),
	) + $extra;
	$schema = new \SpacePress\Schema(
		array(
			'version'     => 3,
			'runtime'     => \SpacePress\Schema::SERIES,
			'collections' => array(
				'rw_parents'  => $table(
					'parents',
					array( 'ownerId' => array( 'type' => 'integer' ) ),
					array(
						'read'   => $owned,
						'delete' => $owned,
					) + $open
				),
				'rw_kids'     => $table(
					'kids',
					array(
						'ownerId'  => array( 'type' => 'integer' ),
						'parentId' => $ref( 'rw_parents', 'cascade' ),
					),
					array(
						'read'   => $owned,
						'delete' => array( 'role' => 'admin' ),
					) + $open
				),
				'rw_refs'     => $table(
					'refs',
					array(
						'ownerId'  => array( 'type' => 'integer' ),
						'parentId' => $ref( 'rw_parents', 'set null' ),
					),
					array(
						'read'   => $owned,
						'update' => array( 'role' => 'admin' ),
					) + $open
				),
				'rw_secret'   => $table( 'secret', array( 'blocked' => array( 'type' => 'boolean' ) ), array( 'read' => array( 'role' => 'admin' ) ) + $open ),
				'rw_defaults' => $table(
					'defaults',
					array(
						'parentId' => $ref(
							'rw_parents',
							'set default',
							array(
								'default' => array(
									'fn' => static function () {
										$GLOBALS['rw_generated'] = ( $GLOBALS['rw_generated'] ?? 0 ) + 1;
										return null;
									},
								),
							)
						),
					),
					$open
				),
			),
		)
	);
	foreach ( array(
		'parents'  => 'ownerId BIGINT',
		'kids'     => 'ownerId BIGINT, parentId BIGINT',
		'refs'     => 'ownerId BIGINT, parentId BIGINT',
		'secret'   => 'blocked TINYINT',
		'defaults' => 'parentId BIGINT',
	) as $name => $cols ) {
		$wp->exec( "CREATE TABLE {prefix}sp_rw_$name (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, $cols, PRIMARY KEY(id)) ENGINE=InnoDB" );
	}
	$probe    = new \SpacePress\Db( \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() ), $schema, $db->media() );
	$previous = \SpacePress\Db::instance();
	\SpacePress\Db::setInstance( $probe );
	$me = new \SpacePress\Viewer(
		array(
			'id'   => 7,
			'name' => 'me',
			'role' => 'subscriber',
		)
	);
	try {
		$parent = $probe->insert( 'rw_parents', array( 'ownerId' => 7 ), true )[0];
		$kid    = $probe->insert(
			'rw_kids',
			array(
				'ownerId'  => 7,
				'parentId' => $parent['id'],
			),
			true
		)[0];
		problem( 'a child the viewer may read but not delete', fn () => $probe->delete( 'rw_kids', array( 'id' => $kid['id'] ), false, $me ), 403, 'forbidden' );
		problem( '… so its parent\'s cascade, that viewer\'s delete of it, refuses with the one body', fn () => $probe->delete( 'rw_parents', array( 'id' => $parent['id'] ), false, $me ), 409, 'reference_violation' );
		eq( '… and both rows stay', array( $probe->findFirst( 'rw_parents', array( 'where' => array( 'id' => $parent['id'] ) ) ) !== null, $probe->findFirst( 'rw_kids', array( 'where' => array( 'id' => $kid['id'] ) ) ) !== null ), array( true, true ) );
		$probe->delete( 'rw_kids', array( 'id' => $kid['id'] ) );
		$ref = $probe->insert(
			'rw_refs',
			array(
				'ownerId'  => 7,
				'parentId' => $parent['id'],
			),
			true
		)[0];
		problem( 'set null on a child the viewer may not update refuses', fn () => $probe->delete( 'rw_parents', array( 'id' => $parent['id'] ), false, $me ), 409, 'reference_violation' );
		eq( '… and keeps its reference', $probe->findFirst( 'rw_refs', array( 'where' => array( 'id' => $ref['id'] ) ) )['parentId'], $parent['id'] );
		$probe->delete( 'rw_refs', array( 'id' => $ref['id'] ) );
		$GLOBALS['rw_generated'] = 0;
		$probe->delete( 'rw_parents', array( 'id' => $parent['id'] ), false, $me );
		eq( 'a set default branch with no rows runs no generator', $GLOBALS['rw_generated'], 0 );
	} finally {
		\SpacePress\Db::setInstance( $previous );
		unset( $GLOBALS['rw_generated'] );
	}
} )();

// Fourth review of #516: after the viewer's own writes nothing trusted runs, so a row or link a hook
// created or kept still refuses the delete; an app hook's JavaScript Error is the one refusal too.
( static function () use ( $db, $wp ): void {
	$id     = array(
		'type'          => 'integer',
		'primaryKey'    => true,
		'autoIncrement' => true,
	);
	$any    = array( 'role' => 'anyone' );
	$open   = array(
		'read'   => $any,
		'create' => $any,
		'update' => $any,
		'delete' => $any,
	);
	$table  = static fn ( $name, $cols, $access = array(), $hooks = array() ) => array(
		'editor'     => false,
		'primaryKey' => 'id',
		'table'      => 'sp_q516_' . $name,
		'columns'    => array( 'id' => $id ) + $cols,
		'access'     => $access + $open,
		'hooks'      => $hooks,
	);
	$ref    = array(
		'type'       => 'integer',
		'references' => array(
			'collection' => 'q516_parent',
			'column'     => 'id',
			'onDelete'   => 'set null',
		),
	);
	$schema = new \SpacePress\Schema(
		array(
			'collections' => array(
				'q516_parent'    => $table( 'parent', array( 'name' => array( 'type' => 'text' ) ) ),
				// This branch is inspected before the trigger branch. A trusted app hook creates a new row later.
				'q516_protected' => $table(
					'protected',
					array(
						'parentId' => array(
							'type'       => 'integer',
							'references' => array(
								'collection' => 'q516_parent',
								'column'     => 'id',
								'onDelete'   => 'cascade',
							),
						),
					),
					array(
						'read'   => array( 'role' => 'admin' ),
						'delete' => array( 'role' => 'admin' ),
					),
					array(
						'beforeDelete' => static function (): void {
							$GLOBALS['q516_deleted']++; },
					)
				),
				'q516_trigger'   => $table(
					'trigger',
					array( 'parentId' => $ref ),
					array(),
					array(
						'afterUpdate' => static function ( array $row, array $previous ): void {
							if ( null !== $previous['parentId'] ) {
								$GLOBALS['q516_new'] = \SpacePress\Db::instance()->insert( 'q516_protected', array( 'parentId' => $previous['parentId'] ), true )[0]['id'];
							}
						},
					)
				),
				'q516_error'     => $table(
					'error',
					array(
						'parentId' => $ref,
						'secret'   => array(
							'type'   => 'text',
							'access' => array( 'read' => array( 'role' => 'admin' ) ),
						),
					),
					array(),
					array(
						'beforeUpdate' => static function ( array $patch, array $existing ): array {
								throw new \SpacePress\JsError( 'secret=' . $existing['secret'] ); },
					)
				),
				'q516_tag'       => $table( 'tag', array( 'name' => array( 'type' => 'text' ) ) ),
				'q516_card'      => $table(
					'card',
					array(
						'locked' => array( 'type' => 'boolean' ),
						'tags'   => array(
							'type'       => 'refList',
							'references' => array(
								'collection' => 'q516_tag',
								'column'     => 'id',
								'onDelete'   => 'cascade',
								'join'       => 'q516_card_tags',
							),
						),
					),
					array( 'update' => array( 'fn' => static fn () => array( 'locked' => false ) ) ),
					array(
						'beforeUpdate' => static function ( array $patch, array $existing ): array {
							$patch['locked'] = true;
							$patch['tags']   = $existing['tags']; // Keep mandatory assignment; direct updates can't remove it.
							return $patch;
						},
					)
				) + array(
					'relations' => array(
						'tags' => array(
							'kind'       => 'many',
							'collection' => 'q516_tag',
							'from'       => 'id',
							'to'         => 'id',
							'through'    => array(
								'table' => 'q516_card_tags',
								'from'  => 'owner_id',
								'to'    => 'target_id',
							),
						),
					),
				),
			),
		)
	);
	foreach ( array(
		'parent'    => 'name LONGTEXT',
		'protected' => 'parentId BIGINT',
		'trigger'   => 'parentId BIGINT',
		'error'     => 'parentId BIGINT, secret LONGTEXT',
		'tag'       => 'name LONGTEXT',
		'card'      => 'locked TINYINT',
	) as $name => $cols ) {
		$wp->exec( "CREATE TABLE {prefix}sp_q516_$name (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, $cols, PRIMARY KEY(id)) ENGINE=InnoDB" );
	}
	$wp->exec( 'CREATE TABLE {prefix}sp__join_q516_card_tags (owner_id BIGINT UNSIGNED NOT NULL, target_id BIGINT UNSIGNED NOT NULL, position INT NOT NULL, PRIMARY KEY(owner_id,target_id)) ENGINE=InnoDB' );
	$probe    = new \SpacePress\Db( \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() ), $schema, $db->media() );
	$previous = \SpacePress\Db::instance();
	\SpacePress\Db::setInstance( $probe );
	$viewer = new \SpacePress\Viewer(
		array(
			'id'   => 7,
			'role' => 'subscriber',
			'name' => 'me',
		)
	);
	try {
		$parent = $probe->insert( 'q516_parent', array( 'name' => 'root' ), true )[0];
		$probe->insert( 'q516_trigger', array( 'parentId' => $parent['id'] ), true );
		$GLOBALS['q516_deleted'] = 0;
		problem( 'newly created protected cascade must refuse', fn () => $probe->delete( 'q516_parent', array( 'id' => $parent['id'] ), false, $viewer ), 409, 'reference_violation' );
		eq( 'no protected-row delete hook may run', $GLOBALS['q516_deleted'], 0 );

		$tag     = $probe->insert( 'q516_tag', array( 'name' => 'mandatory' ), true )[0];
		$card    = $probe->insert(
			'q516_card',
			array(
				'locked' => false,
				'tags'   => array( $tag['id'] ),
			),
			true
		)[0];
		$control = $probe->insert(
			'q516_card',
			array(
				'locked' => false,
				'tags'   => array( $tag['id'] ),
			),
			true
		)[0];
		$probe->update( 'q516_card', array( 'tags' => array() ), array( 'id' => $control['id'] ), false, $viewer );
		eq( 'direct unlink preserves assignment', $probe->findFirst( 'q516_card', array( 'where' => array( 'id' => $control['id'] ) ) )['tags'], array( $tag['id'] ) );
		// Remove control from this scenario using a trusted write so it cannot itself block deletion.
		$probe->delete( 'q516_card', array( 'id' => $control['id'] ) );
		problem( 'preserved mandatory link must refuse parent deletion', fn () => $probe->delete( 'q516_tag', array( 'id' => $tag['id'] ), false, $viewer ), 409, 'reference_violation' );
		$after = $probe->findFirst( 'q516_card', array( 'where' => array( 'id' => $card['id'] ) ) );
		eq( 'viewer delete must preserve mandatory link', $after['tags'], array( $tag['id'] ) );
		foreach ( array( 'alpha', 'beta' ) as $secret ) {
			$parent = $probe->insert( 'q516_parent', array( 'name' => 'error parent' ), true )[0];
			$probe->insert(
				'q516_error',
				array(
					'parentId' => $parent['id'],
					'secret'   => $secret,
				),
				true
			);
			$e = problem( 'a child hook\'s JavaScript Error is the one refusal', fn () => $probe->delete( 'q516_parent', array( 'id' => $parent['id'] ), false, $viewer ), 409, 'reference_violation' );
			eq( '… and its message, which holds a hidden value, is not passed on', \SpacePress\App::problem( $e )['detail'], "Rows you can't read may reference this row" );
		}
	} finally {
		\SpacePress\Db::setInstance( $previous ); }
} )();

// Third review of #516: delete side effects are the viewer's own writes, so a data-dependent update
// rule, a field update rule, a link owner's update rule and an extension-written value all hold.
( static function () use ( $db ): void {
	$wp     = $GLOBALS['wp'];
	$id     = array(
		'type'          => 'integer',
		'primaryKey'    => true,
		'autoIncrement' => true,
		'notNull'       => true,
	);
	$any    = array( 'role' => 'anyone' );
	$open   = array(
		'read'   => $any,
		'create' => $any,
		'update' => $any,
		'delete' => $any,
	);
	$table  = static fn ( string $name, array $cols, array $access = array(), array $hooks = array() ): array => array(
		'primaryKey' => 'id',
		'editor'     => false,
		'table'      => "sp_rv_$name",
		'columns'    => array( 'id' => $id ) + $cols,
		'access'     => $access + $open,
		'hooks'      => $hooks,
	);
	$ref    = array(
		'type'       => 'integer',
		'references' => array(
			'collection' => 'rv_parents',
			'column'     => 'id',
			'onDelete'   => 'set null',
		),
	);
	$owned  = array( 'fn' => static fn ( array $ctx ) => array( 'ownerId' => 7 ) );
	$schema = new \SpacePress\Schema(
		array(
			'version'     => 3,
			'runtime'     => \SpacePress\Schema::SERIES,
			'collections' => array(
				'rv_parents'   => $table( 'parents', array( 'ownerId' => array( 'type' => 'integer' ) ), array( 'read' => $owned ) ),
				'rv_data'      => $table( 'data', array( 'parentId' => $ref ), array( 'update' => array( 'fn' => static fn ( array $ctx ) => null === $ctx['data'] || ! array_key_exists( 'parentId', $ctx['data'] ) ) ) ),
				'rv_field'     => $table( 'field', array( 'parentId' => $ref + array( 'access' => array( 'update' => array( 'role' => 'admin' ) ) ) ) ),
				'rv_tags'      => $table( 'tags', array( 'name' => array( 'type' => 'text' ) ) ),
				'rv_cards'     => $table(
					'cards',
					array(
						'name' => array( 'type' => 'text' ),
						'tags' => array(
							'type'       => 'refList',
							'references' => array(
								'collection' => 'rv_tags',
								'column'     => 'id',
								'onDelete'   => 'cascade',
								'join'       => 'rv_cards_tags',
							),
						),
					),
					array( 'update' => array( 'role' => 'admin' ) )
				) + array(
					'relations' => array(
						'tags' => array(
							'kind'       => 'many',
							'collection' => 'rv_tags',
							'from'       => 'id',
							'to'         => 'id',
							'through'    => array(
								'table' => 'rv_cards_tags',
								'from'  => 'owner_id',
								'to'    => 'target_id',
							),
						),
					),
				),
				'rv_extension' => $table(
					'extension',
					array(
						'parentId' => $ref,
						'backupId' => array(
							'type'   => 'integer',
							'access' => array( 'read' => array( 'role' => 'admin' ) ),
						),
					)
				),
			),
		)
	);
	foreach ( array(
		'parents'   => 'ownerId BIGINT',
		'data'      => 'parentId BIGINT',
		'field'     => 'parentId BIGINT',
		'tags'      => 'name LONGTEXT',
		'cards'     => 'name LONGTEXT',
		'extension' => 'parentId BIGINT, backupId BIGINT',
	) as $name => $cols ) {
		$wp->exec( "CREATE TABLE {prefix}sp_rv_$name (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, " . ( '' === $cols ? '' : "$cols, " ) . 'PRIMARY KEY(id)) ENGINE=InnoDB' );
	}
	$wp->exec( 'CREATE TABLE {prefix}sp__join_rv_cards_tags (owner_id BIGINT UNSIGNED NOT NULL, target_id BIGINT UNSIGNED NOT NULL, position INT NOT NULL, PRIMARY KEY(owner_id,target_id)) ENGINE=InnoDB' );
	$probe    = new \SpacePress\Db( \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() ), $schema, $db->media() );
	$previous = \SpacePress\Db::instance();
	\SpacePress\Db::setInstance( $probe );
	$me     = new \SpacePress\Viewer(
		array(
			'id'   => 7,
			'name' => 'me',
			'role' => 'subscriber',
		)
	);
	$answer = static function ( callable $write ): array {
		try {
			$write();
			return array( 'status' => 200 ); } catch ( \Throwable $e ) {
			return \SpacePress\App::problem( $e ); }
	};
	try {
		$parent = $probe->insert( 'rv_parents', array( 'ownerId' => 7 ), true )[0];
		$kid    = $probe->insert( 'rv_data', array( 'parentId' => $parent['id'] ), true )[0];
		problem( 'direct set-null is denied by the data-dependent update rule', fn () => $probe->update( 'rv_data', array( 'parentId' => null ), array( 'id' => $kid['id'] ), false, $me ), 403, 'forbidden' );
		$deleted = $answer( fn () => $probe->delete( 'rv_parents', array( 'id' => $parent['id'] ), false, $me ) );
		$value   = $probe->findFirst( 'rv_data', array( 'where' => array( 'id' => $kid['id'] ) ) )['parentId'];
		eq( 'deleting parent must enforce actual patch in child update rule', array( $deleted['status'], $value ), array( 409, $parent['id'] ) );

		$parent = $probe->insert( 'rv_parents', array( 'ownerId' => 7 ), true )[0];
		$kid    = $probe->insert( 'rv_field', array( 'parentId' => $parent['id'] ), true )[0];
		problem( 'direct set-null is denied by field update rule', fn () => $probe->update( 'rv_field', array( 'parentId' => null ), array( 'id' => $kid['id'] ), false, $me ), 403, 'forbidden', '/parentId' );
		$deleted = $answer( fn () => $probe->delete( 'rv_parents', array( 'id' => $parent['id'] ), false, $me ) );
		$value   = $probe->findFirst( 'rv_field', array( 'where' => array( 'id' => $kid['id'] ) ) )['parentId'];
		eq( 'deleting parent must enforce child field update rule', array( $deleted['status'], $value ), array( 409, $parent['id'] ) );

		$tag  = $probe->insert( 'rv_tags', array( 'name' => 'review' ), true )[0];
		$card = $probe->insert(
			'rv_cards',
			array(
				'name' => 'review',
				'tags' => array( $tag['id'] ),
			),
			true
		)[0];
		problem( 'direct unlink is denied by owner row update rule', fn () => $probe->update( 'rv_cards', array( 'tags' => array() ), array( 'id' => $card['id'] ), false, $me ), 403, 'forbidden' );
		$deleted = $answer( fn () => $probe->delete( 'rv_tags', array( 'id' => $tag['id'] ), false, $me ) );
		$links   = $probe->findFirst( 'rv_cards', array( 'where' => array( 'id' => $card['id'] ) ) )['tags'];
		eq( 'deleting target must enforce link owner update rule', array( $deleted['status'], $links ), array( 409, array( $tag['id'] ) ) );

		\SpacePress\Extensions::onWrite(
			static function ( string $op, string $collection, array &$patch, ?array $existing ): void {
				if ( 'update' === $op && 'rv_extension' === $collection ) {
					$GLOBALS['rv_write_runs'] = ( $GLOBALS['rv_write_runs'] ?? 0 ) + 1;
					$patch['parentId']        = $existing['backupId'];
				}
			}
		);
		\SpacePress\Extensions::onWritten(
			static function ( string $op, string $collection ): void {
				if ( 'update' === $op && 'rv_extension' === $collection ) {
					$GLOBALS['rv_written_runs'] = ( $GLOBALS['rv_written_runs'] ?? 0 ) + 1; }
			}
		);
		$hiddenParent = $probe->insert( 'rv_parents', array( 'ownerId' => 8 ), true )[0];
		$answers      = array();
		foreach ( array( null, $hiddenParent['id'] ) as $backup ) {
			$parent = $probe->insert( 'rv_parents', array( 'ownerId' => 7 ), true )[0];
			$probe->insert(
				'rv_extension',
				array(
					'parentId' => $parent['id'],
					'backupId' => $backup,
				),
				true
			);
			$GLOBALS['rv_write_runs'] = $GLOBALS['rv_written_runs'] = 0;
			$answers[]                = array( $answer( fn () => $probe->delete( 'rv_parents', array( 'id' => $parent['id'] ), false, $me ) ), $GLOBALS['rv_write_runs'], $GLOBALS['rv_written_runs'] );
		}
		// An extension that writes a hidden value into a reference discloses it on a direct update too;
		// the delete's set null is that same update, with the same listeners, refused with the one body.
		eq( 'an extension-written reference answers as the viewer\'s own update does, with the same listeners', array( $answers[0][0]['status'], $answers[0][2], $answers[1][0]['status'], $answers[1][0]['detail'] ?? null, $answers[1][2] ), array( 200, 1, 409, "Rows you can't read may reference this row", 0 ) );
	} finally {
		\SpacePress\Db::setInstance( $previous ); }
} )();


// A hidden nondefault-locale child refuses before any hook; a visible one cascades and runs its hook.
( static function () use ( $db ): void {
	$wp     = $GLOBALS['wp'];
	$id     = array(
		'type'          => 'integer',
		'primaryKey'    => true,
		'autoIncrement' => true,
	);
	$any    = array( 'role' => 'anyone' );
	$open   = array(
		'read'   => $any,
		'create' => $any,
		'update' => $any,
		'delete' => $any,
	);
	$schema = new \SpacePress\Schema(
		array(
			'locales'     => array(
				'default'  => 'en',
				'all'      => array( 'en', 'fr' ),
				'fallback' => true,
			),
			'collections' => array(
				'rv_lparent' => array(
					'editor'     => false,
					'primaryKey' => 'id',
					'table'      => 'sp_rv_lparent',
					'columns'    => array(
						'id'   => $id,
						'name' => array( 'type' => 'text' ),
					),
					'access'     => $open,
				),
				'rv_lchild'  => array(
					'editor'     => false,
					'localized'  => true,
					'primaryKey' => 'id',
					'table'      => 'sp_rv_lchild',
					'columns'    => array(
						'id'               => $id,
						'ownerId'          => array( 'type' => 'integer' ),
						'locale'           => array(
							'type'   => 'text',
							'system' => true,
						),
						'translationGroup' => array(
							'type'   => 'text',
							'system' => true,
							'hidden' => true,
						),
						'translations'     => array(
							'type'    => 'json',
							'system'  => true,
							'derived' => true,
						),
						'parentId'         => array(
							'type'       => 'integer',
							'references' => array(
								'collection' => 'rv_lparent',
								'column'     => 'id',
								'onDelete'   => 'cascade',
							),
						),
					),
					'access'     => array( 'read' => array( 'fn' => static fn () => array( 'ownerId' => 7 ) ) ) + $open,
					'hooks'      => array(
						'beforeDelete' => static function (): void {
								$GLOBALS['rv_child_before']++; },
					),
				),
			),
		)
	);
	$wp->exec( 'CREATE TABLE {prefix}sp_rv_lparent (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, name LONGTEXT, PRIMARY KEY(id)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_rv_lchild (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ownerId BIGINT, locale LONGTEXT, translationGroup LONGTEXT, parentId BIGINT, PRIMARY KEY(id)) ENGINE=InnoDB' );
	$probe  = new \SpacePress\Db( \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() ), $schema, $db->media() );
	$viewer = new \SpacePress\Viewer(
		array(
			'id'   => 7,
			'name' => 'me',
			'role' => 'subscriber',
		)
	);
	$parent = $probe->insert( 'rv_lparent', array( 'name' => 'localized control' ), true )[0];
	$wp->connection()->run( 'INSERT INTO wp_sp_rv_lchild (ownerId, locale, parentId) VALUES (8, ?, ?)', array( 'fr', $parent['id'] ) );
	$GLOBALS['rv_child_before'] = 0;
	problem( 'hidden nondefault-locale cascade child refuses', fn () => $probe->delete( 'rv_lparent', array( 'id' => $parent['id'] ), false, $viewer ), 409, 'reference_violation' );
	eq( 'no hidden child beforeDelete hook ran', $GLOBALS['rv_child_before'], 0 );
	$wp->connection()->run( 'UPDATE wp_sp_rv_lchild SET ownerId = 7 WHERE parentId = ?', array( $parent['id'] ) );
	$probe->delete( 'rv_lparent', array( 'id' => $parent['id'] ), false, $viewer );
	eq( 'visible nondefault-locale cascade runs its hook', $GLOBALS['rv_child_before'], 1 );
	eq( 'visible nondefault-locale cascade removes child', $probe->findMany( 'rv_lchild' ), array() );
} )();

// ================================================================ Slice 2: Soft deletes, retention, strict undefined filters, system fields
( static function (): void {
	$wp          = $GLOBALS['wp'];
	$now         = array( 'now' => true );
	$purgedLog   = array();
	$restoredLog = array();
	$sdSchema    = new \SpacePress\Schema(
		array(
			'version'     => 5,
			'runtime'     => \SpacePress\Schema::SERIES,
			'retention'   => array(
				'deletedSeconds' => 86400,
				'revisions'      => null,
			),
			'collections' => array(
				'sd_parents'  => array(
					'primaryKey' => 'id',
					'editor'     => false,
					'softDelete' => true,
					'table'      => 'sp_sd_parents',
					'access'     => array(
						'read'   => array( 'role' => 'anyone' ),
						'create' => array( 'role' => 'editor' ),
						'update' => array( 'role' => 'editor' ),
						'delete' => array( 'role' => 'editor' ),
					),
					'hooks'      => array(
						'afterRestore' => static function ( array $row ) use ( &$restoredLog ): void {
							$restoredLog[] = $row['email']; },
						'afterPurge'   => static function ( array $row ) use ( &$purgedLog ): void {
							$purgedLog[] = $row['email']; },
					),
					'columns'    => array(
						'id'           => array(
							'type'          => 'integer',
							'primaryKey'    => true,
							'autoIncrement' => true,
							'notNull'       => true,
						),
						'email'        => array(
							'type'    => 'email',
							'notNull' => true,
							'unique'  => true,
						),
						'bio'          => array( 'type' => 'text' ),
						'author'       => array(
							'type'     => 'integer',
							'readOnly' => true,
							'system'   => true,
						),
						'createdAt'    => array(
							'type'     => 'timestamp',
							'notNull'  => true,
							'default'  => $now,
							'readOnly' => true,
							'system'   => true,
						),
						'updatedAt'    => array(
							'type'     => 'timestamp',
							'notNull'  => true,
							'default'  => $now,
							'onUpdate' => $now,
							'readOnly' => true,
							'system'   => true,
						),
						'deletedAt'    => array(
							'type'     => 'timestamp',
							'readOnly' => true,
							'system'   => true,
						),
						'deletedBy'    => array(
							'type'     => 'integer',
							'readOnly' => true,
							'system'   => true,
						),
						'deletedGroup' => array(
							'type'     => 'text',
							'rules'    => array( 'max' => 36 ),
							'hidden'   => true,
							'readOnly' => true,
							'system'   => true,
						),
						'_live'        => array(
							'type'     => 'boolean',
							'default'  => array( 'value' => true ),
							'hidden'   => true,
							'readOnly' => true,
							'system'   => true,
						),
					),
				),
				'sd_children' => array(
					'primaryKey' => 'id',
					'editor'     => false,
					'softDelete' => true,
					'table'      => 'sp_sd_children',
					'access'     => array(
						'read'   => array( 'role' => 'anyone' ),
						'create' => array( 'role' => 'editor' ),
						'update' => array( 'role' => 'editor' ),
						'delete' => array( 'role' => 'editor' ),
					),
					'columns'    => array(
						'id'           => array(
							'type'          => 'integer',
							'primaryKey'    => true,
							'autoIncrement' => true,
							'notNull'       => true,
						),
						'parentId'     => array(
							'type'       => 'integer',
							'notNull'    => true,
							'references' => array(
								'collection' => 'sd_parents',
								'column'     => 'id',
								'onDelete'   => 'cascade',
							),
						),
						'note'         => array(
							'type'    => 'text',
							'notNull' => true,
						),
						'author'       => array(
							'type'     => 'integer',
							'readOnly' => true,
							'system'   => true,
						),
						'createdAt'    => array(
							'type'     => 'timestamp',
							'notNull'  => true,
							'default'  => $now,
							'readOnly' => true,
							'system'   => true,
						),
						'updatedAt'    => array(
							'type'     => 'timestamp',
							'notNull'  => true,
							'default'  => $now,
							'onUpdate' => $now,
							'readOnly' => true,
							'system'   => true,
						),
						'deletedAt'    => array(
							'type'     => 'timestamp',
							'readOnly' => true,
							'system'   => true,
						),
						'deletedBy'    => array(
							'type'     => 'integer',
							'readOnly' => true,
							'system'   => true,
						),
						'deletedGroup' => array(
							'type'     => 'text',
							'rules'    => array( 'max' => 36 ),
							'hidden'   => true,
							'readOnly' => true,
							'system'   => true,
						),
						'_live'        => array(
							'type'     => 'boolean',
							'default'  => array( 'value' => true ),
							'hidden'   => true,
							'readOnly' => true,
							'system'   => true,
						),
					),
				),
				'sd_articles' => array(
					'primaryKey' => 'id',
					'editor'     => true,
					'drafts'     => true,
					'revisions'  => true,
					'softDelete' => true,
					'title'      => 'title',
					'slug'       => 'slug',
					'wp'         => array(
						'postType'       => 'sp_sd_articles',
						'metaPrefix'     => 'sp_',
						'fieldKeyPrefix' => 'field_sp_sd_articles_',
					),
					'access'     => array(
						'read'   => array( 'role' => 'anyone' ),
						'create' => array( 'role' => 'editor' ),
						'update' => array( 'role' => 'editor' ),
						'delete' => array( 'role' => 'editor' ),
					),
					'columns'    => array(
						'id'           => array(
							'type'          => 'integer',
							'primaryKey'    => true,
							'autoIncrement' => true,
							'notNull'       => true,
						),
						'title'        => array(
							'type'    => 'text',
							'notNull' => true,
						),
						'slug'         => array(
							'type'    => 'slug',
							'notNull' => true,
							'unique'  => true,
							'source'  => 'title',
						),
						'status'       => array(
							'type'    => 'text',
							'notNull' => true,
							'enum'    => array( 'draft', 'published', 'scheduled' ),
							'default' => array( 'value' => 'published' ),
							'system'  => true,
						),
						'publishedAt'  => array(
							'type'   => 'timestamp',
							'system' => true,
						),
						'author'       => array(
							'type'     => 'integer',
							'readOnly' => true,
							'system'   => true,
						),
						'createdAt'    => array(
							'type'     => 'timestamp',
							'notNull'  => true,
							'default'  => $now,
							'readOnly' => true,
							'system'   => true,
						),
						'updatedAt'    => array(
							'type'     => 'timestamp',
							'notNull'  => true,
							'default'  => $now,
							'onUpdate' => $now,
							'readOnly' => true,
							'system'   => true,
						),
						'deletedAt'    => array(
							'type'     => 'timestamp',
							'readOnly' => true,
							'system'   => true,
						),
						'deletedBy'    => array(
							'type'     => 'integer',
							'readOnly' => true,
							'system'   => true,
						),
						'deletedGroup' => array(
							'type'     => 'text',
							'rules'    => array( 'max' => 36 ),
							'hidden'   => true,
							'readOnly' => true,
							'system'   => true,
						),
					),
				),
			),
		)
	);
	register_post_type(
		'sp_sd_articles',
		array(
			'public'   => false,
			'supports' => array( 'title', 'revisions' ),
		)
	);
	$wp->exec( 'CREATE TABLE {prefix}sp_sd_parents (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `email` VARCHAR(191) NOT NULL, `bio` LONGTEXT, `author` BIGINT, `createdAt` CHAR(24) NOT NULL, `updatedAt` CHAR(24) NOT NULL, `deletedAt` CHAR(24), `deletedBy` BIGINT, `deletedGroup` VARCHAR(36), `_live` TINYINT(1) DEFAULT 1, PRIMARY KEY (`id`), UNIQUE KEY `email_unique` (`email`, `_live`), INDEX `deletedAt_idx` (`deletedAt`)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_sd_children (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `parentId` BIGINT UNSIGNED NOT NULL, `note` LONGTEXT NOT NULL, `author` BIGINT, `createdAt` CHAR(24) NOT NULL, `updatedAt` CHAR(24) NOT NULL, `deletedAt` CHAR(24), `deletedBy` BIGINT, `deletedGroup` VARCHAR(36), `_live` TINYINT(1) DEFAULT 1, PRIMARY KEY (`id`), INDEX `deletedAt_idx` (`deletedAt`)) ENGINE=InnoDB' );
	$store  = \SpacePress\Wp\CompositeStore::create( $sdSchema, $wp->connection() );
	$db     = new \SpacePress\Db( $store, $sdSchema, \SpacePress\db()->media() );
	$editor = new \SpacePress\Viewer(
		array(
			'id'   => 42,
			'name' => 'Ed',
			'role' => 'editor',
		)
	);
	$guest  = new \SpacePress\Viewer( null );

	// System fields auto-populated + read-only to callers
	$db->setActor( $editor->user );
	problem(
		'read-only system field rejected on create',
		fn () => $db->insert(
			'sd_parents',
			array(
				'email'     => 'ro@x.test',
				'createdAt' => '2020-01-01T00:00:00.000Z',
			),
			true
		),
		422,
		'invalid_input',
		'/createdAt'
	);
	$p1 = $db->insert(
		'sd_parents',
		array(
			'email' => 'alice@x.test',
			'bio'   => 'hello',
		),
		true
	)[0];
	check( 'system fields populated on create (author, createdAt, updatedAt, deletedAt=null)', 42 === $p1['author'] && is_string( $p1['createdAt'] ) && is_string( $p1['updatedAt'] ) && null === $p1['deletedAt'], $p1 );
	$c1 = $db->insert(
		'sd_children',
		array(
			'parentId' => $p1['id'],
			'note'     => 'child-1',
		),
		true
	)[0];

	// Strict Drizzle 1.0 filter semantics: explicit undefined rejected, update ignores undefined and clears null
	problem( 'undefined in where filter throws 422 invalid_input', fn () => $db->findMany( 'sd_parents', array( 'where' => array( 'email' => \SpacePress\JsUndefined::Value ) ) ), 422, 'invalid_input', '/where/email' );
	problem( 'undefined in operator object throws 422 invalid_input', fn () => $db->findMany( 'sd_parents', array( 'where' => array( 'email' => array( 'eq' => \SpacePress\JsUndefined::Value ) ) ) ), 422, 'invalid_input', '/where/email/eq' );
	problem( 'undefined in in-list throws 422 invalid_input', fn () => $db->findMany( 'sd_parents', array( 'where' => array( 'id' => array( 'in' => array( \SpacePress\JsUndefined::Value ) ) ) ) ), 422, 'invalid_input', '/where/id/in/0' );
	$u1 = $db->update(
		'sd_parents',
		array(
			'email' => \SpacePress\JsUndefined::Value,
			'bio'   => null,
		),
		array( 'id' => $p1['id'] ),
		true
	)[0];
	eq( 'update ignores undefined and clears null', array( $u1['email'], $u1['bio'] ), array( 'alice@x.test', null ) );

	// Soft delete + deletedGroup cascade
	$del = $db->delete( 'sd_parents', array( 'id' => $p1['id'] ), true, $editor )[0];
	check( 'soft delete sets deletedAt and deletedBy', is_string( $del['deletedAt'] ) && 42 === $del['deletedBy'], $del );
	eq( 'default list excludes soft-deleted parent and cascaded child', array( count( $db->findMany( 'sd_parents' ) ), count( $db->findMany( 'sd_children' ) ) ), array( 0, 0 ) );
	problem( 'deleted: only refused to anonymous visitor without restore/delete access', fn () => $db->findMany( 'sd_parents', array( 'deleted' => 'only' ), $guest ), 401, 'unauthenticated' );
	eq( 'deleted: only visible to editor', array( count( $db->findMany( 'sd_parents', array( 'deleted' => 'only' ), $editor ) ), count( $db->findMany( 'sd_children', array( 'deleted' => 'only' ), $editor ) ) ), array( 1, 1 ) );

	// Active-row unique reuse while soft-deleted + restore 409 collision
	$p2 = $db->insert(
		'sd_parents',
		array(
			'email' => 'alice@x.test',
			'bio'   => 'reused',
		),
		true,
		$editor
	)[0];
	eq( 'unique email reused while original row is soft-deleted', $p2['email'], 'alice@x.test' );
	problem( 'restore collides with active row holding same unique email (409)', fn () => $db->restore( 'sd_parents', array( 'id' => $p1['id'] ), true, $editor ), 409, 'unique_violation', '/email' );

	// Delete second row, then restore first -> restores parent AND cascaded child via deletedGroup!
	$db->delete( 'sd_parents', array( 'id' => $p2['id'] ), true, $editor );
	$restored = $db->restore( 'sd_parents', array( 'id' => $p1['id'] ), true, $editor )[0];
	eq(
		'restore clears deletedAt/deletedBy, restores cascaded child, fires afterRestore',
		array(
			$restored['deletedAt'],
			$restored['deletedBy'],
			count( $db->findMany( 'sd_children' ) ),
			$restoredLog,
		),
		array( null, null, 1, array( 'alice@x.test' ) )
	);

	// Purge: denied to untrusted editor (default "system"), succeeds when trusted, fires afterPurge
	problem( 'purge denied to untrusted editor by default (system only)', fn () => $db->purge( 'sd_parents', array( 'id' => $p2['id'] ), true, $editor ), 403, 'forbidden' );
	$db->purge( 'sd_parents', array( 'id' => $p2['id'] ), true );
	eq( 'trusted purge permanently deletes row and fires afterPurge', array( count( $db->findMany( 'sd_parents', array( 'deleted' => 'include' ) ) ), $purgedLog ), array( 1, array( 'alice@x.test' ) ) );

	// Soft delete on post-backed collection(): WP Trash + restore prior status + purge
	$art = $db->insert( 'sd_articles', array( 'title' => 'Hello Trash' ), true, $editor )[0];
	eq( 'post collection system fields populated', array( $art['author'], is_string( $art['createdAt'] ), $art['deletedAt'] ), array( 42, true, null ) );
	$trashed = $db->delete( 'sd_articles', array( 'id' => $art['id'] ), true, $editor )[0];
	eq( 'post soft delete moves to WP trash with deletedAt/deletedBy', array( get_post_status( $art['id'] ), is_string( $trashed['deletedAt'] ), $trashed['deletedBy'] ), array( 'trash', true, 42 ) );
	eq( 'post list excludes trashed by default, finds with deleted: only', array( count( $db->findMany( 'sd_articles' ) ), count( $db->findMany( 'sd_articles', array( 'deleted' => 'only' ), $editor ) ) ), array( 0, 1 ) );
	$untrashed = $db->restore( 'sd_articles', array( 'id' => $art['id'] ), true, $editor )[0];
	eq( 'post restore calls wp_untrash_post and restores published status', array( $untrashed['status'], $untrashed['deletedAt'], get_post_status( $art['id'] ) ), array( 'published', null, 'publish' ) );
	$db->purge( 'sd_articles', array( 'id' => $art['id'] ), true );
	eq( 'post purge permanently deletes post', get_post( $art['id'] ), null );

	// Retention helper: blocks wp_scheduled_delete for SpacePress softDelete post types + reads configured seconds
	eq( 'Retention blocks wp_scheduled_delete for softDelete post types', \SpacePress\Wp\Retention::blocksWpScheduledDelete( $sdSchema, 'sp_sd_articles' ), true );
	eq( 'Retention reads configured deletedSeconds', \SpacePress\Wp\Retention::deletedSeconds( $sdSchema, 'sd_parents' ), 86400 );
	$db->setActor( null );
} )();

// ================================================================ Slice 3: native revisions, diff, schema-aware decode, table _rev
( static function () use ( $wp ): void {
	$revSchema = new \SpacePress\Schema(
		array(
			'name'        => 'rev_test',
			'collections' => array(
				'docs' => array(
					'primaryKey' => 'id',
					'editor'     => false,
					'table'      => 'sp_rev_docs',
					'revisions'  => true,
					'softDelete' => true,
					'access'     => array(
						'read'    => array( 'role' => 'anyone' ),
						'create'  => array( 'role' => 'anyone' ),
						'update'  => array( 'role' => 'anyone' ),
						'delete'  => array( 'role' => 'anyone' ),
						'restore' => array( 'role' => 'anyone' ),
						'purge'   => array( 'role' => 'anyone' ),
					),
					'columns'    => array(
						'id'           => array(
							'type'          => 'integer',
							'primaryKey'    => true,
							'autoIncrement' => true,
							'notNull'       => true,
						),
						'summary'      => array(
							'type'    => 'text',
							'notNull' => true,
							'column'  => 'legacy_title',
							'aliases' => array( 'oldTitle' ),
						),
						'note'         => array(
							'type'    => 'text',
							'default' => array( 'value' => 'default-note' ),
						),
						'secret'       => array(
							'type'   => 'text',
							'access' => array( 'read' => array( 'role' => 'admin' ) ),
						),
						'author'       => array(
							'type'     => 'integer',
							'readOnly' => true,
							'system'   => true,
						),
						'createdAt'    => array(
							'type'     => 'timestamp',
							'notNull'  => true,
							'default'  => array( 'now' => true ),
							'readOnly' => true,
							'system'   => true,
						),
						'updatedAt'    => array(
							'type'     => 'timestamp',
							'notNull'  => true,
							'default'  => array( 'now' => true ),
							'onUpdate' => array( 'now' => true ),
							'readOnly' => true,
							'system'   => true,
						),
						'deletedAt'    => array(
							'type'     => 'timestamp',
							'readOnly' => true,
							'system'   => true,
						),
						'deletedBy'    => array(
							'type'     => 'integer',
							'readOnly' => true,
							'system'   => true,
						),
						'deletedGroup' => array(
							'type'     => 'text',
							'rules'    => array( 'max' => 36 ),
							'hidden'   => true,
							'readOnly' => true,
							'system'   => true,
						),
						'_live'        => array(
							'type'     => 'boolean',
							'default'  => array( 'value' => true ),
							'hidden'   => true,
							'readOnly' => true,
							'system'   => true,
						),
					),
					'relations'  => array(),
					'hooks'      => array(),
				),
			),
		)
	);
	$wp->exec( 'DROP TABLE IF EXISTS {prefix}sp_rev_docs' );
	$wp->exec( "CREATE TABLE {prefix}sp_rev_docs (`id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, `legacy_title` LONGTEXT NOT NULL, `note` LONGTEXT DEFAULT ('default-note'), `secret` LONGTEXT, `author` BIGINT, `createdAt` CHAR(24) NOT NULL, `updatedAt` CHAR(24) NOT NULL, `deletedAt` CHAR(24), `deletedBy` BIGINT, `deletedGroup` VARCHAR(36), `_live` TINYINT(1) DEFAULT 1, PRIMARY KEY (`id`)) ENGINE=InnoDB" );
	$wp->exec( "DELETE FROM {prefix}sp__migrations WHERE `app` = 'rev_test'" );
	$wp->exec( "INSERT INTO {prefix}sp__migrations (`app`, `id`, `kind`, `applied_at`) VALUES ('rev_test', '20261121180000_aaaaaa_init', 'schema', '2026-11-21T18:00:00.000Z')" );

	$store = \SpacePress\Wp\CompositeStore::create( $revSchema, $wp->connection() );
	$rdb   = new \SpacePress\Db( $store, $revSchema, \SpacePress\db()->media() );

	// 1. Create -> update -> soft delete -> restore -> purge all emit monotonic versioned revisions with op, changed, schemaMigration.
	$doc = $rdb->insert(
		'docs',
		array(
			'summary' => 'V1',
			'secret'  => 's1',
		),
		true
	)[0];
	$rdb->update(
		'docs',
		array(
			'summary' => 'V2',
			'secret'  => 's2',
		),
		array( 'id' => $doc['id'] ),
		true
	);
	$rdb->delete( 'docs', array( 'id' => $doc['id'] ), true );
	$rdb->restore( 'docs', array( 'id' => $doc['id'] ), true );

	$list = $rdb->revisions( 'docs', $doc['id'] );
	eq(
		'table revisions record create/update/delete/restore with monotonic versions',
		array_map( static fn ( array $r ) => array( $r['version'], $r['op'], $r['schemaMigration'] ), $list ),
		array(
			array( 4, 'restore', '20261121180000_aaaaaa_init' ),
			array( 3, 'delete', '20261121180000_aaaaaa_init' ),
			array( 2, 'update', '20261121180000_aaaaaa_init' ),
			array( 1, 'create', '20261121180000_aaaaaa_init' ),
		)
	);
	eq( 'update revision lists changed non-hidden fields', $list[2]['changed'], array( 'summary', 'secret' ) );

	// 2. Diff between v1 and v2 masks hidden fields for non-admin viewer.
	$guest     = new \SpacePress\Viewer( null );
	$admin     = new \SpacePress\Viewer(
		array(
			'id'   => 1,
			'role' => 'admin',
		)
	);
	$diffGuest = $rdb->diffRevisions( 'docs', $doc['id'], 1, 2, $guest, byVersion: true );
	$diffAdmin = $rdb->diffRevisions( 'docs', $doc['id'], 1, 2, $admin, byVersion: true );
	eq(
		'diff masks restricted fields from non-admin viewer',
		array_column( $diffGuest['changes'], 'field' ),
		array( 'summary' )
	);
	eq(
		'diff shows all changed fields to admin',
		$diffAdmin['changes'],
		array(
			array(
				'field' => 'summary',
				'from'  => 'V1',
				'to'    => 'V2',
			),
			array(
				'field' => 'secret',
				'from'  => 's1',
				'to'    => 's2',
			),
		)
	);

	// 3. Restore by version restores V1 cleanly.
	$restored = $rdb->restoreRevision( 'docs', $doc['id'], 1, $admin, byVersion: true );
	eq( 'restoreRevision by version restores v1 values', array( $restored['summary'], $restored['secret'] ), array( 'V1', 's1' ) );

	// 4. Schema-aware revision decoding handles aliased column names, physical column names, retired columns, and newly added defaulted columns.
	$decoded = \SpacePress\Db::decodeRevisionPayload(
		$revSchema->collection( 'docs' ),
		array(
			'id'          => 99,
			'oldTitle'    => 'From Alias',
			'retired_col' => 'should be dropped',
			'createdAt'   => '2026-01-01T00:00:00.000Z',
			'updatedAt'   => '2026-01-01T00:00:00.000Z',
		)
	);
	eq(
		'schema-aware decode resolves alias, fills default for newly added column, and drops retired columns',
		array( $decoded['summary'], $decoded['note'], array_key_exists( 'retired_col', $decoded ) ),
		array( 'From Alias', 'default-note', false )
	);
	$decodedPhys = \SpacePress\Db::decodeRevisionPayload(
		$revSchema->collection( 'docs' ),
		array(
			'id'           => 100,
			'legacy_title' => 'From Physical',
			'createdAt'    => '2026-01-01T00:00:00.000Z',
			'updatedAt'    => '2026-01-01T00:00:00.000Z',
		)
	);
	eq( 'schema-aware decode resolves physical column name to logical field name', $decodedPhys['summary'], 'From Physical' );

	// 5. Purge records a final purge revision that survives row deletion.
	$rdb->purge( 'docs', array( 'id' => $doc['id'] ), true );
	$afterPurge = $store->revisions( 'docs', $doc['id'] );
	eq( 'purge writes a final audit revision in sp__revisions', $afterPurge[0]['op'], 'purge' );
} )();

// PR #516 review: a referential update on visible rows can't answer with hidden values, a many-ref
// link from a hidden row refuses, hidden volume can't change the answer, and a read extension that may
// hide rows makes every relationship refuse.
( static function () use ( $db ): void {
	$wp     = $GLOBALS['wp'];
	$id     = array(
		'type'          => 'integer',
		'primaryKey'    => true,
		'autoIncrement' => true,
		'notNull'       => true,
	);
	$any    = array( 'role' => 'anyone' );
	$open   = array(
		'read'   => $any,
		'create' => $any,
		'update' => $any,
		'delete' => $any,
	);
	$mine   = array( 'fn' => static fn ( array $ctx ) => array( 'ownerId' => 7 ) );
	$hidden = array(
		'type'   => 'integer',
		'access' => array( 'read' => array( 'role' => 'admin' ) ),
	);
	$schema = new \SpacePress\Schema(
		array(
			'version'     => 3,
			'runtime'     => \SpacePress\Schema::SERIES,
			'collections' => array(
				'r_parents'   => array(
					'primaryKey' => 'id',
					'editor'     => false,
					'table'      => 'sp_r_parents',
					'access'     => array( 'read' => $mine ) + $open,
					'columns'    => array(
						'id'      => $id,
						'ownerId' => array( 'type' => 'integer' ),
					),
				),
				// A hook copies a hidden column into the reference set null writes.
				'r_hooked'    => array(
					'primaryKey' => 'id',
					'editor'     => false,
					'table'      => 'sp_r_hooked',
					'access'     => $open,
					'columns'    => array(
						'id'       => $id,
						'parentId' => array(
							'type'       => 'integer',
							'references' => array(
								'collection' => 'r_parents',
								'column'     => 'id',
								'onDelete'   => 'set null',
							),
						),
						'backupId' => $hidden,
					),
					'hooks'      => array(
						'beforeUpdate' => static function ( array $data, array $existing ): array {
								$data['parentId'] = $existing['backupId'];
								return $data; },
					),
				),
				// set default writes a generated value.
				'r_defaulted' => array(
					'primaryKey' => 'id',
					'editor'     => false,
					'table'      => 'sp_r_defaulted',
					'access'     => $open,
					'columns'    => array(
						'id'       => $id,
						'parentId' => array(
							'type'       => 'integer',
							'default'    => array( 'fn' => static fn () => $GLOBALS['r_default'] ?? null ),
							'references' => array(
								'collection' => 'r_parents',
								'column'     => 'id',
								'onDelete'   => 'set default',
							),
						),
					),
				),
				'r_tags'      => array(
					'primaryKey' => 'id',
					'editor'     => false,
					'table'      => 'sp_r_tags',
					'access'     => $open,
					'columns'    => array(
						'id'   => $id,
						'name' => array( 'type' => 'text' ),
					),
				),
				'r_cards'     => array(
					'primaryKey' => 'id',
					'editor'     => false,
					'table'      => 'sp_r_cards',
					'access'     => array( 'read' => $mine ) + $open,
					'columns'    => array(
						'id'      => $id,
						'ownerId' => array( 'type' => 'integer' ),
						'tags'    => array(
							'type'       => 'refList',
							'notNull'    => true,
							'references' => array(
								'collection' => 'r_tags',
								'column'     => 'id',
								'onDelete'   => 'cascade',
								'join'       => 'r_cards_tags',
							),
						),
					),
					'relations'  => array(
						'tags' => array(
							'kind'       => 'many',
							'collection' => 'r_tags',
							'from'       => 'id',
							'to'         => 'id',
							'optional'   => false,
							'through'    => array(
								'table' => 'r_cards_tags',
								'from'  => 'owner_id',
								'to'    => 'target_id',
							),
						),
					),
				),
				'r_bulky'     => array(
					'primaryKey' => 'id',
					'editor'     => false,
					'table'      => 'sp_r_bulky',
					'access'     => array( 'read' => array( 'role' => 'admin' ) ) + $open,
					'columns'    => array(
						'id'    => $id,
						'body'  => array( 'type' => 'text' ),
						'tagId' => array(
							'type'       => 'integer',
							'references' => array(
								'collection' => 'r_tags',
								'column'     => 'id',
								'onDelete'   => 'cascade',
							),
						),
					),
				),
			),
		)
	);
	$wp->exec( 'CREATE TABLE {prefix}sp_r_parents (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ownerId BIGINT, PRIMARY KEY(id)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_r_hooked (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, parentId BIGINT, backupId BIGINT, PRIMARY KEY(id)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_r_defaulted (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, parentId BIGINT, PRIMARY KEY(id)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_r_tags (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, name LONGTEXT, PRIMARY KEY(id)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_r_cards (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ownerId BIGINT, PRIMARY KEY(id)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp__join_r_cards_tags (owner_id BIGINT UNSIGNED NOT NULL, target_id BIGINT UNSIGNED NOT NULL, position INT NOT NULL, PRIMARY KEY(owner_id, target_id)) ENGINE=InnoDB' );
	$wp->exec( 'CREATE TABLE {prefix}sp_r_bulky (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, body LONGTEXT, tagId BIGINT, PRIMARY KEY(id)) ENGINE=InnoDB' );
	$probe    = new \SpacePress\Db( \SpacePress\Wp\CompositeStore::create( $schema, $wp->connection() ), $schema, $db->media() );
	$previous = \SpacePress\Db::instance();
	\SpacePress\Db::setInstance( $probe );
	$me     = new \SpacePress\Viewer(
		array(
			'id'   => 7,
			'name' => 'me',
			'role' => 'subscriber',
		)
	);
	$answer = static function ( callable $write ): array {
		try {
			$write();

			return array( 'status' => 200 );
		} catch ( \Throwable $e ) {
			return \SpacePress\App::problem( $e );
		}
	};
	try {
		$theirs  = $probe->insert( 'r_parents', array( 'ownerId' => 8 ), true )[0];
		$answers = array();
		foreach ( array( null, $theirs['id'] ) as $backup ) {
			$parent = $probe->insert( 'r_parents', array( 'ownerId' => 7 ), true )[0];
			$probe->insert(
				'r_hooked',
				array(
					'parentId' => $parent['id'],
					'backupId' => $backup,
				),
				true
			);
			$answers[] = $answer( fn () => $probe->delete( 'r_parents', array( 'id' => $parent['id'] ), false, $me ) );
		}
		$direct = array();
		foreach ( array( null, $theirs['id'] ) as $backup ) {
			$p        = $probe->insert( 'r_parents', array( 'ownerId' => 7 ), true )[0];
			$h        = $probe->insert(
				'r_hooked',
				array(
					'parentId' => $p['id'],
					'backupId' => $backup,
				),
				true
			)[0];
			$direct[] = $answer( fn () => $probe->update( 'r_hooked', array( 'parentId' => null ), array( 'id' => $h['id'] ), false, $me ) );
		}
		// The app's hook copies a value into a reference the viewer reads: a direct update discloses it
		// through its answer, and a delete's set null, that viewer's update of the same row, answers alike.
		eq( 'a referential set null answers as the viewer\'s own update of the row does', array( $answers[0]['status'], $answers[1]['status'] ), array( $direct[0]['status'], 200 === $direct[1]['status'] ? 200 : 409 ) );
		eq(
			'… and a refusal is the one body',
			$answers[1],
			array(
				'type'   => 'about:blank',
				'title'  => 'Reference violation',
				'status' => 409,
				'code'   => 'reference_violation',
				'detail' => "Rows you can't read may reference this row",
			)
		);
		$probe->delete( 'r_hooked', array( 'parentId' => array( 'isNull' => false ) ) );
		$answers = array();
		foreach ( array( null, $theirs['id'] ) as $generated ) {
			$GLOBALS['r_default'] = $generated;
			$parent               = $probe->insert( 'r_parents', array( 'ownerId' => 7 ), true )[0];
			$probe->insert( 'r_defaulted', array( 'parentId' => $parent['id'] ), true );
			$answers[] = $answer( fn () => $probe->delete( 'r_parents', array( 'id' => $parent['id'] ), false, $me ) );
		}
		eq( 'set default runs the app\'s generator as the viewer\'s update: a visible target applies, a hidden one refuses with the one body', array( $answers[0]['status'], $answers[1]['status'], $answers[1]['detail'] ?? null ), array( 200, 409, "Rows you can't read may reference this row" ) );

		$tag = $probe->insert( 'r_tags', array( 'name' => 't' ), true )[0];
		$probe->insert(
			'r_cards',
			array(
				'ownerId' => 7,
				'tags'    => array( $tag['id'] ),
			),
			true
		);
		$hiddenCard = $probe->insert(
			'r_cards',
			array(
				'ownerId' => 8,
				'tags'    => array( $tag['id'] ),
			),
			true
		)[0];
		problem( 'a many-ref link from a row the viewer can\'t read refuses the delete', fn () => $probe->delete( 'r_tags', array( 'id' => $tag['id'] ), false, $me ), 409, 'reference_violation' );
		eq( '… and keeps that row\'s link', $probe->findFirst( 'r_cards', array( 'where' => array( 'id' => $hiddenCard['id'] ) ) )['tags'], array( $tag['id'] ) );
		$own = $probe->insert( 'r_tags', array( 'name' => 't' ), true )[0];
		$probe->insert(
			'r_cards',
			array(
				'ownerId' => 7,
				'tags'    => array( $own['id'] ),
			),
			true
		);
		eq( 'a tag only the viewer\'s rows link to deletes', $answer( fn () => $probe->delete( 'r_tags', array( 'id' => $own['id'] ), false, $me ) )['status'], 200 );

		// Hidden volume: many large hidden rows answer as one does, within the default memory limit.
		$bulk = $probe->insert( 'r_tags', array( 'name' => 't' ), true )[0];
		$one  = $probe->insert( 'r_tags', array( 'name' => 't' ), true )[0];
		$probe->insert(
			'r_bulky',
			array(
				'tagId' => $one['id'],
				'body'  => 'x',
			),
			true
		);
		$payload = str_repeat( 'x', 2 * 1024 * 1024 );
		for ( $i = 0; $i < 90; $i++ ) {
			$wp->connection()->run( 'INSERT INTO wp_sp_r_bulky (body, tagId) VALUES (?, ?)', array( $payload, $bulk['id'] ) );
		}
		unset( $payload );
		$limit = ini_get( 'memory_limit' );
		ini_set( 'memory_limit', '128M' );
		try {
			eq( 'ninety 2 MiB hidden rows answer like one, without loading them', $answer( fn () => $probe->delete( 'r_tags', array( 'id' => $bulk['id'] ), false, $me ) ), $answer( fn () => $probe->delete( 'r_tags', array( 'id' => $one['id'] ), false, $me ) ) );
		} finally {
			ini_set( 'memory_limit', $limit );
		}

		// Many-ref volume: the owners of links are counted in SQL, never listed in PHP.
		$many = $probe->insert( 'r_tags', array( 'name' => 't' ), true )[0];
		$wp->connection()->run( 'INSERT INTO wp_sp_r_cards (ownerId) SELECT 8 FROM wp_sp_r_bulky' );
		for ( $i = 0; $i < 6; $i++ ) {
			$wp->connection()->run( 'INSERT INTO wp_sp_r_cards (ownerId) SELECT ownerId FROM wp_sp_r_cards WHERE ownerId = 8' );
		}
		$wp->connection()->run( 'INSERT INTO wp_sp__join_r_cards_tags (owner_id, target_id, position) SELECT id, ?, 0 FROM wp_sp_r_cards WHERE ownerId = 8', array( $many['id'] ) );
		$limit = ini_get( 'memory_limit' );
		ini_set( 'memory_limit', '128M' );
		try {
			eq( 'thousands of hidden many-ref owners answer like one', $answer( fn () => $probe->delete( 'r_tags', array( 'id' => $many['id'] ), false, $me ) ), $answer( fn () => $probe->delete( 'r_tags', array( 'id' => $one['id'] ), false, $me ) ) );
		} finally {
			ini_set( 'memory_limit', $limit );
		}

		// Last, since registrations stay for the rest of the process: a read extension that may hide rows.
		$free = $probe->insert( 'r_tags', array( 'name' => 't' ), true )[0];
		\SpacePress\Extensions::beforeRead(
			static function ( string $collection, array &$opts ): void {
				if ( 'r_cards' === $collection ) {
					$opts['limit'] = 1;
				}
			}
		);
		$limited = $probe->insert( 'r_tags', array( 'name' => 't' ), true )[0];
		problem( 'with an unproven read extension, every relationship to the row refuses', fn () => $probe->delete( 'r_tags', array( 'id' => $free['id'] ), false, $me ), 409, 'reference_violation' );
		eq( 'trusted deletes are not affected', $answer( fn () => $probe->delete( 'r_tags', array( 'id' => $limited['id'] ) ) )['status'], 200 );
	} finally {
		\SpacePress\Db::setInstance( $previous );
		unset( $GLOBALS['r_default'] );
	}
} )();

// ================================================================ ref(labels).many(): links in a join table

( static function () use ( $db, $wp ): void {
	$anon                          = new \SpacePress\Viewer( null );
	$member                        = new \SpacePress\Viewer(
		array(
			'id'   => 1,
			'name' => 'm',
			'role' => 'subscriber',
		)
	);
	[$red, $green, $blue, $hidden] = $db->insert(
		'labels',
		array(
			array( 'name' => 'red' ),
			array( 'name' => 'green' ),
			array( 'name' => 'blue' ),
			array(
				'name'   => 'hidden',
				'secret' => true,
			),
		),
		true
	);
	$links                         = static fn ( string $table ) => array_map( static fn ( array $r ) => array_map( 'intval', $r ), $wp->sql( "SELECT `owner_id`, `target_id`, `position` FROM {prefix}sp__join_$table ORDER BY `owner_id`, `position`" ) );

	$card = $db->insert(
		'cards',
		array(
			'title'  => 'one',
			'labels' => array( $blue['id'], $red['id'] ),
		),
		true
	)[0];
	eq( 'a many-ref reads back as its ids in write order; an omitted optional one is []', array( $card['labels'], $card['pinned'] ), array( array( $blue['id'], $red['id'] ), array() ) );
	eq(
		'the links are rows of the join table, positions 0-based in write order',
		$links( 'cards_labels' ),
		array(
			array(
				'owner_id'  => $card['id'],
				'target_id' => $blue['id'],
				'position'  => 0,
			),
			array(
				'owner_id'  => $card['id'],
				'target_id' => $red['id'],
				'position'  => 1,
			),
		)
	);
	problem( 'a required many-ref must be given on create', fn () => $db->insert( 'cards', array( 'title' => 'none' ) ), 422, 'invalid_input', '/labels' );
	eq(
		'[] satisfies a required many-ref',
		$db->insert(
			'cards',
			array(
				'title'  => 'empty',
				'labels' => array(),
			),
			true
		)[0]['labels'],
		array()
	);
	problem(
		'duplicates are refused at the repeat',
		fn () => $db->insert(
			'cards',
			array(
				'title'  => 'dup',
				'labels' => array( $red['id'], $green['id'], $red['id'] ),
			)
		),
		422,
		'invalid_input',
		'/labels/2'
	);
	problem(
		'a missing target is a reference violation at its index',
		fn () => $db->insert(
			'cards',
			array(
				'title'  => 'gone',
				'labels' => array( $red['id'], 999999 ),
			)
		),
		409,
		'reference_violation',
		'/labels/1'
	);
	problem(
		'a target the writer can\'t read refuses like a missing one',
		fn () => $db->insert(
			'cards',
			array(
				'title'  => 'peek',
				'labels' => array( $hidden['id'] ),
			),
			false,
			$anon
		),
		409,
		'reference_violation',
		'/labels/0'
	);
	eq(
		'a writer who can read the target links it',
		$db->insert(
			'cards',
			array(
				'title'  => 'seen',
				'labels' => array( $hidden['id'] ),
			),
			true,
			$member
		)[0]['labels'],
		array( $hidden['id'] )
	);

	$updated = $db->update( 'cards', array( 'labels' => array( $green['id'], $blue['id'] ) ), array( 'id' => $card['id'] ), true )[0];
	eq( 'an update replaces the whole list, in its new order', array( $updated['labels'], $updated['title'] ), array( array( $green['id'], $blue['id'] ), 'one' ) );
	eq( 'an update without the field keeps its links', $db->update( 'cards', array( 'title' => 'uno' ), array( 'id' => $card['id'] ), true )[0]['labels'], array( $green['id'], $blue['id'] ) );

	$two    = $db->insert(
		'cards',
		array(
			'title'  => 'two',
			'labels' => array( $red['id'], $green['id'] ),
			'pinned' => array( $green['id'] ),
		),
		true
	)[0];
	$titles = static fn ( array $opts, ?\SpacePress\Viewer $v = null ) => array_column( $db->findMany( 'cards', $opts + array( 'orderBy' => array( 'id' => 'asc' ) ), $v ), 'title' );
	eq( '`has` matches rows linked to the id', $titles( array( 'where' => array( 'labels' => array( 'has' => $green['id'] ) ) ) ), array( 'uno', 'two' ) );
	eq( 'NOT has, and eq [] (no links)', array( $titles( array( 'where' => array( 'labels' => array( 'NOT' => array( 'has' => $green['id'] ) ) ) ) ), $titles( array( 'where' => array( 'labels' => array() ) ) ) ), array( array( 'empty', 'seen' ), array( 'empty' ) ) );
	eq( 'a filter on the linked rows means some linked row matches', $titles( array( 'where' => array( 'labels' => array( 'name' => 'red' ) ) ) ), array( 'two' ) );
	eq( 'true / false: some link or none', array( $titles( array( 'where' => array( 'pinned' => true ) ) ), count( $titles( array( 'where' => array( 'pinned' => false ) ) ) ) ), array( array( 'two' ), 3 ) );
	eq( 'relation filters see only rows the viewer may read', $titles( array( 'where' => array( 'labels' => array( 'name' => 'hidden' ) ) ), $anon ), array() );
	problem( 'orderBy on a many-ref is refused', fn () => $db->findMany( 'cards', array( 'orderBy' => array( 'labels' => 'asc' ) ) ), 400, 'invalid_query', '/orderBy/labels' );

	$loaded = $db->findFirst(
		'cards',
		array(
			'where' => array( 'id' => $card['id'] ),
			'with'  => array( 'labels' => true ),
		)
	);
	eq( 'with loads the linked rows in position order', array_column( $loaded['labels'], 'name' ), array( 'green', 'blue' ) );
	$sorted = $db->findFirst(
		'cards',
		array(
			'where' => array( 'id' => $card['id'] ),
			'with'  => array(
				'labels' => array(
					'orderBy' => array( 'name' => 'asc' ),
					'columns' => array( 'name' => true ),
				),
			),
		)
	);
	eq( 'nested options sort and pick the linked rows', $sorted['labels'], array( array( 'name' => 'blue' ), array( 'name' => 'green' ) ) );
	eq(
		'limit applies per row',
		array_map(
			static fn ( $c ) => array_column( $c['labels'], 'name' ),
			$db->findMany(
				'cards',
				array(
					'where'   => array( 'id' => array( 'in' => array( $card['id'], $two['id'] ) ) ),
					'orderBy' => array( 'id' => 'asc' ),
					'with'    => array( 'labels' => array( 'limit' => 1 ) ),
				)
			)
		),
		array( array( 'green' ), array( 'red' ) )
	);
	eq(
		'with applies the target\'s read access',
		array_column(
			$db->findFirst(
				'cards',
				array(
					'where' => array( 'title' => 'seen' ),
					'with'  => array( 'labels' => true ),
				),
				$anon
			)['labels'],
			'name'
		),
		array()
	);
	eq(
		'columns keeps a loaded many-ref',
		array_keys(
			$db->findFirst(
				'cards',
				array(
					'where'   => array( 'id' => $card['id'] ),
					'columns' => array( 'title' => true ),
					'with'    => array( 'labels' => true ),
				)
			)
		),
		array( 'title', 'labels' )
	);
	$reverse = $db->findFirst(
		'labels',
		array(
			'where' => array( 'id' => $green['id'] ),
			'with'  => array(
				'cards'    => array( 'columns' => array( 'title' => true ) ),
				'pinnedBy' => true,
			),
		)
	);
	eq( 'the target lists its linking rows (reverse many)', array( array_column( $reverse['cards'], 'title' ), array_column( $reverse['pinnedBy'], 'title' ) ), array( array( 'uno', 'two' ), array( 'two' ) ) );
	eq(
		'a filter through the reverse list',
		array_column(
			$db->findMany(
				'labels',
				array(
					'where'   => array( 'cards' => array( 'title' => 'two' ) ),
					'orderBy' => array( 'id' => 'asc' ),
				)
			),
			'name'
		),
		array( 'red', 'green' )
	);

	problem( 'restrict refuses deleting a target that is still linked', fn () => $db->delete( 'labels', array( 'id' => $green['id'] ) ), 409, 'reference_violation' );
	eq( '… and keeps it and its links', array( count( $db->findMany( 'labels', array( 'where' => array( 'id' => $green['id'] ) ) ) ), $db->findFirst( 'cards', array( 'where' => array( 'id' => $two['id'] ) ) )['labels'] ), array( 1, array( $red['id'], $green['id'] ) ) );
	$db->delete( 'labels', array( 'id' => $red['id'] ) );
	eq( 'deleting a target removes the links pointing at it', array( $db->findFirst( 'cards', array( 'where' => array( 'id' => $two['id'] ) ) )['labels'], count( $wp->sql( 'SELECT 1 FROM {prefix}sp__join_cards_labels WHERE `target_id` = ?', array( $red['id'] ) ) ) ), array( array( $green['id'] ), 0 ) );
	$db->update( 'cards', array( 'pinned' => array() ), array( 'id' => $two['id'] ) );
	$db->delete( 'cards', array( 'id' => $two['id'] ) );
	eq( 'deleting the owner removes its links', count( $wp->sql( 'SELECT 1 FROM {prefix}sp__join_cards_labels WHERE `owner_id` = ?', array( $two['id'] ) ) ), 0 );
	$db->delete( 'labels', array( 'id' => $green['id'] ) );
	eq( 'with the last link gone, restrict lets the target go', $db->findFirst( 'cards', array( 'where' => array( 'id' => $card['id'] ) ) )['labels'], array( $blue['id'] ) );

	$r = http(
		'POST',
		'/cards',
		array(
			'title'  => 'rest',
			'labels' => array( $blue['id'] ),
		)
	);
	eq( 'REST writes and reads a many-ref as ids', array( $r['status'], $r['json']['data']['labels'] ?? null ), array( 201, array( $blue['id'] ) ) );
	$r = http(
		'GET',
		'/cards?' . http_build_query(
			array(
				'where' => json_encode( array( 'id' => $card['id'] ) ),
				'with'  => 'labels',
			)
		)
	);
	eq( 'REST with loads the linked rows', array( $r['status'], array_column( $r['json']['data'][0]['labels'] ?? array(), 'name' ) ), array( 200, array( 'blue' ) ) );
} )();

finish( 'db_test' );
