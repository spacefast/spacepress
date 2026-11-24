<?php

declare(strict_types=1);

// Mapping a Zero 0.8 release onto the new app's schema (SpacePress\Wp\Legacy\Model).
// Pure logic; the data import itself is proven against real WordPress in migrate/tests/wp/legacy.

require __DIR__ . '/../../runtime/SpacePress/bootstrap.php';
require __DIR__ . '/../../tests/php/harness.php';
require __DIR__ . '/../zero/wp/Model.php';
require __DIR__ . '/../zero/wp/Users.php';

use SpacePress\HttpError;
use SpacePress\Schema;
use SpacePress\Wp\Legacy\Model;
use SpacePress\Wp\Legacy\Users;

// The release the original compiler produced for tests/wp/legacy/capsule.ts.
$release = require __DIR__ . '/wp/legacy/content-model.php';
$schema  = static fn ( array $overrides = array() ) => new Schema(
	array(
		'version'     => 5,
		'runtime'     => Schema::SERIES,
		'collections' => array_replace_recursive(
			array(
				'projects' => array(
					'editor'     => true,
					'title'      => 'title',
					'primaryKey' => 'id',
					'wp'         => array(
						'postType'       => 'sp_projects',
						'metaPrefix'     => 'sp_',
						'fieldKeyPrefix' => 'field_sp_projects_',
					),
					'columns'    => array(
						'id'      => array(
							'type'       => 'integer',
							'primaryKey' => true,
						),
						'title'   => array(
							'type'    => 'text',
							'notNull' => true,
						),
						'budget'  => array( 'type' => 'real' ),
						'active'  => array( 'type' => 'boolean' ),
						'kickoff' => array( 'type' => 'timestamp' ),
						'stage'   => array(
							'type' => 'text',
							'enum' => array( 'idea', 'live', 'done' ),
						),
						'tags'    => array(
							'type' => 'select',
							'enum' => array( 'red', 'green', 'blue' ),
						),
						'cover'   => array( 'type' => 'media' ),
						'gallery' => array( 'type' => 'mediaList' ),
					),
				),
				'tasks'    => array(
					'editor'     => true,
					'title'      => 'title',
					'primaryKey' => 'id',
					'wp'         => array(
						'postType'       => 'sp_tasks',
						'metaPrefix'     => 'sp_',
						'fieldKeyPrefix' => 'field_sp_tasks_',
					),
					'columns'    => array(
						'id'        => array(
							'type'       => 'integer',
							'primaryKey' => true,
						),
						'title'     => array(
							'type'    => 'text',
							'notNull' => true,
						),
						'notes'     => array( 'type' => 'text' ),
						'projectId' => array(
							'type'       => 'integer',
							'notNull'    => true,
							'references' => array(
								'collection' => 'projects',
								'column'     => 'id',
							),
						),
						'parentId'  => array(
							'type'       => 'integer',
							'references' => array(
								'collection' => 'tasks',
								'column'     => 'id',
							),
						),
					),
				),
			),
			$overrides
		),
	)
);

$map = Model::map( $release, $schema() );
eq( 'collections map by resource id; natives are skipped', array_keys( $map->collections ), array( 'projects', 'tasks' ) );
eq( 'a reference maps to its <field>Id column', array( $map->collections['tasks']['fields']['project']['column'], $map->collections['tasks']['fields']['project']['kind'] ), array( 'projectId', 'reference' ) );
eq( 'legacy storage names come from the release', $map->collections['projects']['fields']['gallery']['key'], '_zero_projects_gallery' );
eq( 'the native title is not a meta field', array_key_exists( 'title', $map->collections['projects']['fields'] ), false );

$mixedRelease = $release;
$names        = array(
	'projects' => 'stockItems',
	'tasks'    => 'stockTasks',
);
foreach ( $mixedRelease['postTypes'] as &$resource ) {
	$resource['id'] = $names[ $resource['id'] ] ?? $resource['id'];
	foreach ( $resource['fields'] as &$field ) {
		if ( isset( $field['definition']['collection'] ) ) {
			$field['definition']['collection'] = $names[ $field['definition']['collection'] ];
		}
	}
	unset( $field );
}
unset( $resource );
$mixedCollections = array();
foreach ( $schema()->collections() as $name => $spec ) {
	$spec['key'] = $names[ $name ];
	foreach ( $spec['columns'] as &$column ) {
		if ( isset( $column['references'] ) ) {
			$column['references']['collection'] = 'projects' === $column['references']['collection'] ? 'stock_items' : 'stock_tasks';
		}
	}
	unset( $column );
	$mixedCollections[ 'projects' === $name ? 'stock_items' : 'stock_tasks' ] = $spec;
}
$mixed = Model::map( $mixedRelease, new Schema( array( 'collections' => $mixedCollections ) ) );
eq(
	'mixed-case release ids resolve authored keys to physical storage, including references',
	array_map( static fn ( array $c ) => $c['collection'], $mixed->collections ),
	array(
		'stockItems' => 'stock_items',
		'stockTasks' => 'stock_tasks',
	)
);

$refuses = static function ( string $label, callable $fn, string $pointer ) {
	try {
		$fn();
		check( $label, false, 'no refusal' );
	} catch ( HttpError $e ) {
		check( $label, 'legacy_unmappable' === $e->errorCode && $e->pointer === $pointer, array( $e->errorCode, $e->pointer, $e->getMessage() ) );
	}
};
$at      = static function ( string $resource, ?string $field = null ) use ( $release ): string {
	foreach ( $release['postTypes'] as $i => $r ) {
		if ( $r['id'] === $resource ) {
			if ( null === $field ) {
				return "/postTypes/$i";
			}
			foreach ( $r['fields'] as $j => $f ) {
				if ( $f['name'] === $field ) {
					return "/postTypes/$i/fields/$j";
				}
			}
		}
	}
	throw new LogicException( "no $resource.$field" );
};

$refuses( 'not a release', fn () => Model::map( array( 'format' => 'other' ), $schema() ), '' );
$noTasks = new Schema(
	array(
		'version'     => 5,
		'runtime'     => Schema::SERIES,
		'collections' => array( 'projects' => $schema()->collection( 'projects' ) ),
	)
);
$refuses( 'a collection the new app lacks', fn () => Model::map( $release, $noTasks ), $at( 'tasks' ) . '/id' );
$refuses(
	'a table() kind',
	fn () => Model::map(
		$release,
		$schema(
			array(
				'tasks' => array(
					'editor' => false,
					'wp'     => null,
				),
			)
		)
	),
	$at( 'tasks' ) . '/id'
);
$refuses(
	'a field without its column',
	fn () => Model::map(
		$release,
		new Schema(
			array(
				'version'     => 5,
				'runtime'     => Schema::SERIES,
				'collections' => array(
					'projects' => $schema()->collection( 'projects' ),
					'tasks'    => array_replace( $schema()->collection( 'tasks' ), array( 'columns' => array_diff_key( $schema()->collection( 'tasks' )['columns'], array( 'notes' => 1 ) ) ) ),
				),
			)
		)
	),
	$at( 'tasks', 'notes' ) . '/name'
);
$refuses( 'enum options that differ', fn () => Model::map( $release, $schema( array( 'projects' => array( 'columns' => array( 'stage' => array( 'enum' => array( 'idea', 'live', 'gone' ) ) ) ) ) ) ), $at( 'projects', 'stage' ) . '/definition' );
$refuses( 'a single media field on a list column', fn () => Model::map( $release, $schema( array( 'projects' => array( 'columns' => array( 'cover' => array( 'type' => 'mediaList' ) ) ) ) ) ), $at( 'projects', 'cover' ) . '/definition' );
$refuses( 'a reference to another collection', fn () => Model::map( $release, $schema( array( 'tasks' => array( 'columns' => array( 'parentId' => array( 'references' => array( 'collection' => 'projects' ) ) ) ) ) ) ), $at( 'tasks', 'parent' ) . '/definition' );
$blocks = $release;
foreach ( $blocks['postTypes'] as &$r ) {
	if ( 'tasks' === $r['id'] ) {
		foreach ( $r['fields'] as &$f ) {
			if ( 'notes' === $f['name'] ) {
				$f['definition']['type'] = 'richText';
			}
		}
	}
}
unset( $r, $f );
$refuses( 'a rich text field', fn () => Model::map( $blocks, $schema() ), $at( 'tasks', 'notes' ) . '/definition/type' );
$refuses(
	'a field mapped onto the post content column',
	fn () => Model::map(
		$release,
		$schema(
			array(
				'tasks' => array(
					'content' => 'notes',
					'columns' => array( 'notes' => array( 'type' => 'richText' ) ),
				),
			)
		)
	),
	$at( 'tasks', 'notes' ) . '/name'
);
$refuses( 'a localized destination', fn () => Model::map( $release, $schema( array( 'tasks' => array( 'localized' => true ) ) ) ), $at( 'tasks' ) . '/id' );
$refuses( 'a uid destination', fn () => Model::map( $release, $schema( array( 'tasks' => array( 'uid' => true ) ) ) ), $at( 'tasks' ) . '/id' );
$refuses( 'a field mapped onto the post title column', fn () => Model::map( $release, $schema( array( 'tasks' => array( 'title' => 'notes' ) ) ) ), $at( 'tasks', 'notes' ) . '/name' );
$refuses( 'a reference to a business key instead of the id', fn () => Model::map( $release, $schema( array( 'tasks' => array( 'columns' => array( 'projectId' => array( 'references' => array( 'column' => 'code' ) ) ) ) ) ) ), $at( 'tasks', 'project' ) . '/definition' );


$refuses(
	'a new reference column with a default',
	fn () => Model::map(
		$release,
		$schema(
			array(
				'tasks' => array(
					'columns' => array(
						'reviewerId' => array(
							'type'       => 'integer',
							'default'    => array( 'value' => 1 ),
							'references' => array(
								'collection' => 'tasks',
								'column'     => 'id',
							),
						),
					),
				),
			)
		)
	),
	$at( 'tasks' ) . '/id'
);
$refuses(
	'a new media column with a default',
	fn () => Model::map(
		$release,
		$schema(
			array(
				'tasks' => array(
					'columns' => array(
						'badge' => array(
							'type'    => 'media',
							'default' => array( 'value' => 1 ),
						),
					),
				),
			)
		)
	),
	$at( 'tasks' ) . '/id'
);
$refuses(
	'a new private file column with a default',
	fn () => Model::map(
		$release,
		$schema(
			array(
				'tasks' => array(
					'columns' => array(
						'brief' => array(
							'type'    => 'file',
							'default' => array( 'value' => 9 ),
						),
					),
				),
			)
		)
	),
	$at( 'tasks' ) . '/id'
);
$refuses(
	'a new post content column with a default',
	fn () => Model::map(
		$release,
		$schema(
			array(
				'tasks' => array(
					'content' => 'body',
					'columns' => array(
						'body' => array(
							'type'    => 'richText',
							'default' => array( 'value' => '<p>x</p>' ),
						),
					),
				),
			)
		)
	),
	$at( 'tasks' ) . '/id'
);
$refuses(
	'a new structured column with a default',
	fn () => Model::map(
		$release,
		$schema(
			array(
				'tasks' => array(
					'columns' => array(
						'links' => array(
							'type'    => 'repeater',
							'default' => array( 'value' => array() ),
						),
					),
				),
			)
		)
	),
	$at( 'tasks' ) . '/id'
);
eq(
	'a new plain column with a default maps',
	array_keys(
		Model::map(
			$release,
			$schema(
				array(
					'tasks' => array(
						'columns' => array(
							'reviewedAt' => array(
								'type'    => 'timestamp',
								'default' => array( 'value' => '2026-03-01T12:00:00+02:00' ),
							),
						),
					),
				)
			)
		)->collections
	),
	array( 'projects', 'tasks' )
);

$refuses(
	'a destination with a slug column',
	fn () => Model::map(
		$release,
		$schema(
			array(
				'tasks' => array(
					'slug'    => 'handle',
					'columns' => array( 'handle' => array( 'type' => 'slug' ) ),
				),
			)
		)
	),
	$at( 'tasks' ) . '/id'
);

$refuses(
	'a destination whose primary key is not id',
	fn () => Model::map(
		$release,
		$schema(
			array(
				'projects' => array(
					'primaryKey' => 'postId',
					'columns'    => array(
						'postId' => array(
							'type'       => 'integer',
							'primaryKey' => true,
						),
						'id'     => array(
							'type'   => 'integer',
							'unique' => true,
						),
					),
				),
			)
		)
	),
	$at( 'projects' ) . '/id'
);

// ---- Users::member: the member row an original app user becomes (pure; the move is in tests/wp/legacy).
$memberSpec = static fn ( array $columns ) => array(
	'primaryKey' => 'id',
	'columns'    => array(
		'id'    => array(
			'type'       => 'integer',
			'primaryKey' => true,
		),
		'email' => array(
			'type'    => 'email',
			'notNull' => true,
		),
		'name'  => array(
			'type'    => 'text',
			'notNull' => true,
			'rules'   => array( 'max' => 80 ),
		),
		'role'  => array(
			'type'   => 'text',
			'system' => true,
		),
	) + $columns,
);
$member     = static fn ( array $columns, string $role = 'subscriber', string $name = 'Ada' ) => Users::member( $memberSpec( $columns ), 5, 'ada@example.test', $name, $role, '/users/5' );
eq(
	'a member row: email, name and normalized defaults in storage form',
	$member(
		array(
			'since' => array(
				'type'    => 'timestamp',
				'default' => array( 'value' => '2026-03-01T12:00:00+02:00' ),
			),
			'tags'  => array(
				'type'    => 'select',
				'enum'    => array( 'a', 'b' ),
				'default' => array( 'value' => array( 'a' ) ),
			),
		)
	),
	array(
		'email' => 'ada@example.test',
		'name'  => 'Ada',
		'since' => '2026-03-01T10:00:00.000Z',
		'tags'  => '["a"]',
	)
);
eq(
	'a column without a default is cleared (validators see the row the move leaves)',
	$member( array( 'note' => array( 'type' => 'text' ) ) ),
	array(
		'email' => 'ada@example.test',
		'name'  => 'Ada',
		'note'  => null,
	)
);
putenv( 'SP_NOW=2030-01-01T00:00:00.000Z' );
putenv( 'SP_NOW_STEP=1' ); // every clock read moves the pinned clock a millisecond
try {
	$stamps = $member(
		array(
			'joinedAt' => array(
				'type'    => 'timestamp',
				'default' => array( 'now' => true ),
			),
			'seenAt'   => array(
				'type'    => 'timestamp',
				'default' => array( 'now' => true ),
			),
		)
	);
} finally {
	putenv( 'SP_NOW_STEP' );
	putenv( 'SP_NOW' );
}
eq( 'a member row\'s now defaults are one instant', array( $stamps['joinedAt'], $stamps['seenAt'] ), array( '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z' ) );
problem( 'a name over the member column\'s bound', fn () => $member( array(), 'subscriber', str_repeat( 'x', 81 ) ), 422, 'invalid_input', '/users/5/name' );
problem(
	'a required member column with no default',
	fn () => $member(
		array(
			'plan' => array(
				'type'    => 'text',
				'notNull' => true,
			),
		)
	),
	422,
	'invalid_input',
	'/users/5/plan'
);
problem(
	'a default breaking its own rule',
	fn () => $member(
		array(
			'code' => array(
				'type'    => 'text',
				'default' => array( 'value' => 'ab' ),
				'rules'   => array( 'min' => 3 ),
			),
		)
	),
	422,
	'invalid_input',
	'/users/5/code'
);
problem(
	'a media default',
	fn () => $member(
		array(
			'avatar' => array(
				'type'    => 'media',
				'default' => array( 'value' => 9 ),
			),
		)
	),
	422,
	'legacy_unmappable',
	'/users/5/avatar'
);
problem(
	'a private file default',
	fn () => $member(
		array(
			'brief' => array(
				'type'    => 'file',
				'bucket'  => 'briefs',
				'default' => array( 'value' => 999 ),
			),
		)
	),
	422,
	'legacy_unmappable',
	'/users/5/brief'
);
problem(
	'...or one nested in a group',
	fn () => $member(
		array(
			'profile' => array(
				'type'    => 'group',
				'fields'  => array(
					'cv' => array(
						'type'   => 'file',
						'bucket' => 'briefs',
					),
				),
				'default' => array( 'value' => array( 'cv' => 999 ) ),
			),
		)
	),
	422,
	'legacy_unmappable',
	'/users/5/profile'
);
problem(
	'a reference default',
	fn () => $member(
		array(
			'teamId' => array(
				'type'       => 'integer',
				'default'    => array( 'value' => 1 ),
				'references' => array(
					'collection' => 'teams',
					'column'     => 'id',
				),
			),
		)
	),
	422,
	'legacy_unmappable',
	'/users/5/teamId'
);
eval( 'namespace SpacePressApp; function legacy_role_check($v, $ctx) { return ($ctx->p["data"]->p["role"] === "admin" || $v !== "pro") ? true : "pro needs admin"; }' );
problem(
	'validators see the user\'s role (a subscriber can\'t default to pro)',
	fn () => $member(
		array(
			'plan' => array(
				'type'    => 'text',
				'default' => array( 'value' => 'pro' ),
				'rules'   => array( 'validate' => 'legacy_role_check' ),
			),
		)
	),
	422,
	'invalid_input',
	'/users/5/plan'
);
eq(
	'...and an admin can',
	$member(
		array(
			'plan' => array(
				'type'    => 'text',
				'default' => array( 'value' => 'pro' ),
				'rules'   => array( 'validate' => 'legacy_role_check' ),
			),
		),
		'admin'
	)['plan'],
	'pro'
);

finish( 'legacy_test' );
