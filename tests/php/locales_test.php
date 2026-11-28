<?php

declare(strict_types=1);

/*
 * Localization (§7.3) on custom tables, on WordPress in-process (tests/php/wp.php): one row per locale
 * in a translation group (the `translationGroup` column, as the compiler emits for `editor: false`
 * collections); synced columns follow the group; reads pick a locale and fall back to the default per
 * group. Post-backed collections keep their group in Polylang.
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$id                                = array(
	'type'          => 'integer',
	'primaryKey'    => true,
	'autoIncrement' => true,
	'notNull'       => true,
);
$open                              = array(
	'read'   => array( 'role' => 'anyone' ),
	'create' => array( 'role' => 'anyone' ),
	'update' => array( 'role' => 'anyone' ),
	'delete' => array( 'role' => 'anyone' ),
);
$api                               = array(
	'list'   => true,
	'get'    => true,
	'create' => true,
	'update' => true,
	'delete' => true,
);
$schema                            = array(
	'name'        => 'pages',
	'locales'     => array(
		'default'  => 'en',
		'all'      => array( 'en', 'de', 'fr' ),
		'fallback' => true,
	),
	'collections' => array(
		'pages'    => array(
			'primaryKey' => 'id',
			'localized'  => true,
			'drafts'     => true,
			'revisions'  => true,
			'slug'       => 'slug',
			'access'     => $open,
			'api'        => $api,
			'hooks'      => array(
				'beforeUpdate' => 'pages__beforeUpdate',
				'afterUpdate'  => 'pages__afterUpdate',
			),
			'relations'  => array(
				'notes'    => array(
					'kind'       => 'many',
					'collection' => 'notes',
					'from'       => 'id',
					'to'         => 'pageId',
				),
				'chapters' => array(
					'kind'       => 'many',
					'collection' => 'chapters',
					'from'       => 'id',
					'to'         => 'pageId',
				),
				'parent'   => array(
					'kind'       => 'one',
					'collection' => 'pages',
					'from'       => 'parentId',
					'to'         => 'id',
					'optional'   => true,
				),
			),
			'columns'    => array(
				'id'               => $id,
				'title'            => array(
					'type'      => 'text',
					'notNull'   => true,
					'localized' => true,
				),
				'slug'             => array(
					'type'   => 'slug',
					'unique' => true,
					'source' => 'title',
				),
				'price'            => array( 'type' => 'integer' ),
				'tags'             => array(
					'type'     => 'select',
					'multiple' => true,
					'enum'     => array( 'a', 'b' ),
					'notNull'  => true,
					'default'  => array( 'value' => array() ),
				),
				'seo'              => array(
					'type'   => 'group',
					'fields' => array(
						'heading' => array(
							'type'      => 'text',
							'localized' => true,
						),
						'noindex' => array( 'type' => 'boolean' ),
					),
				),
				'stampedAt'        => array(
					'type'    => 'timestamp',
					'notNull' => true,
					'default' => array( 'now' => true ),
				),
				'box'              => array(
					'type'   => 'group',
					'fields' => array(
						'label'  => array( 'type' => 'text' ),
						'secret' => array(
							'type'   => 'text',
							'access' => array( 'read' => array( 'role' => 'admin' ) ),
						),
					),
				),
				'parentId'         => array(
					'type'       => 'integer',
					'references' => array(
						'collection' => 'pages',
						'column'     => 'id',
						'onDelete'   => 'set null',
					),
				),
				'status'           => array(
					'type'    => 'text',
					'notNull' => true,
					'enum'    => array( 'draft', 'published', 'scheduled' ),
					'default' => array( 'value' => 'published' ),
					'system'  => true,
				),
				'publishedAt'      => array(
					'type'   => 'timestamp',
					'system' => true,
				),
				'locale'           => array(
					'type'    => 'text',
					'enum'    => array( 'en', 'de', 'fr' ),
					'notNull' => true,
					'default' => array( 'value' => 'en' ),
					'system'  => true,
				),
				'translations'     => array(
					'type'    => 'json',
					'system'  => true,
					'derived' => true,
				),
				'translationGroup' => array(
					'type'   => 'text',
					'system' => true,
					'hidden' => true,
				),
			),
		),
		'codes'    => array(
			'primaryKey' => 'code',
			'localized'  => true,
			'access'     => $open,
			'api'        => $api,
			'relations'  => array(),
			'columns'    => array(
				'code'             => array(
					'type'       => 'text',
					'primaryKey' => true,
					'notNull'    => true,
				),
				'label'            => array(
					'type'      => 'text',
					'localized' => true,
				),
				'rank'             => array( 'type' => 'integer' ),
				'locale'           => array(
					'type'    => 'text',
					'enum'    => array( 'en', 'de', 'fr' ),
					'notNull' => true,
					'default' => array( 'value' => 'en' ),
					'system'  => true,
				),
				'translations'     => array(
					'type'    => 'json',
					'system'  => true,
					'derived' => true,
				),
				'translationGroup' => array(
					'type'   => 'text',
					'system' => true,
					'hidden' => true,
				),
			),
		),
		'notes'    => array(
			'primaryKey' => 'id',
			'access'     => $open,
			'api'        => $api,
			'relations'  => array(),
			'columns'    => array(
				'id'     => $id,
				'pageId' => array( 'type' => 'integer' ),
				'body'   => array(
					'type'    => 'text',
					'notNull' => true,
				),
			),
		),
		'parents'  => array(
			'primaryKey' => 'id',
			'access'     => $open,
			'api'        => $api,
			'relations'  => array(),
			'columns'    => array(
				'id'    => $id,
				'label' => array( 'type' => 'text' ),
			),
		),
		'chapters' => array(
			'primaryKey' => 'id',
			'localized'  => true,
			'access'     => $open,
			'api'        => $api,
			'relations'  => array(),
			'columns'    => array(
				'id'               => $id,
				'pageId'           => array( 'type' => 'integer' ),
				'heading'          => array(
					'type'      => 'text',
					'notNull'   => true,
					'localized' => true,
				),
				'locale'           => array(
					'type'    => 'text',
					'enum'    => array( 'en', 'de', 'fr' ),
					'notNull' => true,
					'default' => array( 'value' => 'en' ),
					'system'  => true,
				),
				'translations'     => array(
					'type'    => 'json',
					'system'  => true,
					'derived' => true,
				),
				'translationGroup' => array(
					'type'   => 'text',
					'system' => true,
					'hidden' => true,
				),
			),
		),
	),
);
$children                          = $schema['collections']['chapters'];
$children['access']['read']        = array( 'fn' => 'localizedChildren__read' );
$children['hooks']['beforeUpdate'] = 'localizedChildren__beforeUpdate';
$children['hooks']['afterUpdate']  = 'localizedChildren__afterUpdate';
$children['columns']['pageId']    += array(
	'localized'  => true,
	'references' => array(
		'collection' => 'parents',
		'column'     => 'id',
		'onDelete'   => 'set null',
	),
);
$children['columns']['detached']   = array(
	'type'    => 'boolean',
	'notNull' => true,
	'default' => array( 'value' => false ),
);
$schema['collections']['localizedChildren'] = $children;
$articles                                   = array(
	'editor' => true,
	'title'  => 'heading',
	'hooks'  => array(),
) + $children;
unset( $articles['columns']['pageId'], $articles['columns']['translationGroup'] );
$schema['collections']['articles'] = $articles;

$functions = <<<'PHP'
function localizedChildren__read($ctx) { return $ctx->p['user'] === null ? new \SpacePress\JsObject(['locale' => 'en']) : true; }
function localizedChildren__beforeUpdate($patch) {
    if (array_key_exists('pageId', $patch->p) && $patch->p['pageId'] === null) {
        $patch->p['detached'] = true;
    }
    return $patch;
}
function localizedChildren__afterUpdate() { $GLOBALS['localizedChildrenUpdates']++; }

// Records every afterUpdate as "<locale>:<price>", so per-row hooks during group sync are observable.
// Rewrites a synced value on one translation: group sync must refuse rather than split the group.
function pages__beforeUpdate($patch, $existing) {
    if ($existing->p['title'] === 'Bump DE' && isset($patch->p['price'])) {
        $patch->p['price']++;
    }
    if ($existing->p['title'] === 'Tag DE' && isset($patch->p['price'])) {
        $patch->p['tags'] = new \SpacePress\JsArray(['b']); // a different synced column than the one propagated
    }
    if ($existing->p['title'] === 'Adopt DE' && isset($patch->p['price'])) {
        $patch->p['price']++; // rewrites the value it is adopting
    }
    if ($existing->p['title'] === 'Spawn on adopt' && isset($patch->p['price'])) {
        \SpacePress\db()->insert('pages', ['title' => 'Spawned FR', 'locale' => 'fr', 'translationOf' => $existing->p['id']]);
    }
    if ($existing->p['title'] === 'Order EN' && ($patch->p['stampedAt'] ?? null) === '2001-01-01T00:00:00.000Z') {
        $patch->p['price'] = 5; // a hook changes a synced value during a bulk update of another column
    }
    if ($existing->p['title'] === 'Move DE') {
        $patch->p['locale'] = 'fr';
    }
    if ($existing->p['title'] === 'Spawn DE' && isset($patch->p['price'])) {
        // creates a French translation while the group still holds its old values
        \SpacePress\db()->insert('pages', ['title' => 'Spawn FR', 'locale' => 'fr', 'translationOf' => $existing->p['id']]);
    }
    return $patch;
}
function pages__afterUpdate($row, $previous) {
    if ($row->p['price'] === 13 && $row->p['locale'] === 'de') {
        throw new \SpacePress\JsError('de refuses 13');
    }
    if ($row->p['title'] === 'Between' && $row->p['price'] === 41) {
        // between two rows of one group in a bulk update: touch the first again
        \SpacePress\db()->update('pages', ['title' => 'Order EN'], ['title' => 'Order']);
    }
    if ($row->p['title'] === 'Between' && $row->p['stampedAt'] === '2001-01-01T00:00:00.000Z') {
        // restore the first row's synced value: what was handed to the second must follow
        \SpacePress\db()->update('pages', ['price' => 41], ['title' => 'Order EN']);
    }
    if ($row->p['title'] === 'Mid' && $row->p['price'] === 51) {
        \SpacePress\db()->update('pages', ['price' => 57], ['title' => 'Late DE']); // a nested write to a row still to come
    }
    if ($row->p['title'] === 'Mid' && $row->p['price'] === 52) {
        \SpacePress\db()->insert('pages', ['title' => 'Late FR', 'locale' => 'fr', 'translationOf' => \SpacePress\db()->findFirst('pages', ['where' => ['title' => 'Late DE']])['id']]);
    }
    if ($row->p['title'] === 'Late DE' && $row->p['price'] === 53 && $previous->p['price'] !== 53) {
        // the sibling written early deletes the row that started the group write, then fails
        \SpacePress\db()->delete('pages', ['title' => 'Late']);
        if (\SpacePress\db()->findFirst('pages', ['where' => ['title' => 'Late']]) === null) {
            throw new \SpacePress\JsError('de refuses 53');
        }
    }
    if ($row->p['title'] === 'Kick' && $row->p['price'] === 31) {
        // a nested bulk update over two translations whose group the outer update also covers,
        // changing another synced column than the outer one
        \SpacePress\db()->update('pages', ['tags' => ['b']], ['title' => ['in' => ['Nest DE', 'Nest FR']]]);
    }
    if ($row->p['price'] === 21 && $row->p['locale'] === 'en' && ($other = \SpacePress\db()->findFirst('pages', ['where' => ['title' => 'Coffee']])) !== null) {
        \SpacePress\db()->update('pages', ['price' => 22], ['id' => $other['id']]); // another group, from inside a sync
    }
    $group = $row->p['translations']->p;
    ksort($group);
    \SpacePress\db()->insert('notes', ['pageId' => $row->p['id'], 'body' => 'afterUpdate ' . $row->p['locale'] . ':' . $row->p['price'] . ' ' . json_encode($group)]);
}
PHP;

$wp     = wpSite(
	'locales',
	array(
		'schema'    => $schema,
		'functions' => $functions,
		// In-process App::handle calls lack the REST URL Polylang uses to select its context.
		'muPlugins' => array( 'polylang-context' => "<?php add_filter('pll_context', static fn (\$class) => \$class ?: 'PLL_REST_Request');" ),
	)
);
$db     = \SpacePress\db();
$anon   = new \SpacePress\Viewer( null );
$editor = new \SpacePress\Viewer( $wp->user( 'editor' ) );
// Reads are anonymous; writes are the editor's: a unique slug may only be written by a viewer who can
// read the whole collection (#72), and the public read rule gives everyone that for pages.
$rest   = static function ( string $method, string $path, array $query = array(), mixed $body = null, array $headers = array() ) use ( $wp ): array {
	[$status, , $payload] = $wp->handle( $method, $path, null === $body ? '' : json_encode( $body ), 'GET' === $method ? null : 'editor', $headers, $query );
	$json                 = json_decode( $payload, true );

	return array( $status, $json['data'] ?? $json );
};
$titles = static fn ( array $rows ): array => array_map( static fn ( $r ) => $r['locale'] . ':' . $r['title'], $rows );

$one                                 = $db->insert( 'parents', array( 'label' => 'One' ), true )[0]['id'];
$two                                 = $db->insert( 'parents', array( 'label' => 'Two' ), true )[0]['id'];
$en                                  = $db->insert(
	'localizedChildren',
	array(
		'heading' => 'English',
		'pageId'  => $one,
	),
	true
)[0]['id'];
$fr                                  = $db->insert(
	'localizedChildren',
	array(
		'heading'       => 'French',
		'pageId'        => $two,
		'locale'        => 'fr',
		'translationOf' => $en,
	),
	true
)[0]['id'];
$GLOBALS['localizedChildrenUpdates'] = 0;
$refusal                             = array( 409, 'reference_violation', "Rows you can't read may reference this row", null );
$answer                              = static function ( string $method, string $path, ?array $body = null ) use ( $wp ): array {
	[$status, $problem] = $wp->call( $method, $path, $body, null );

	return array( $status, $problem['code'] ?? null, $problem['detail'] ?? null, $problem['pointer'] ?? null );
};
eq( 'a delete whose set-null hook would sync a hidden translation refuses', $answer( 'DELETE', "/parents/$one" ), $refusal );
eq( 'an ordinary PATCH that would sync a hidden translation refuses the same way', $answer( 'PATCH', "/localizedChildren/$en", array( 'detached' => true ) ), $refusal );
eq( 'both refusals precede afterUpdate', $GLOBALS['localizedChildrenUpdates'], 0 );
check( 'the refused delete leaves its parent in place', $db->findFirst( 'parents', array( 'where' => array( 'id' => $one ) ) ) !== null );
$translationState = static fn (): array => array_map(
	static fn ( array $row ): array => array( $row['pageId'], $row['detached'] ),
	$db->findMany(
		'localizedChildren',
		array(
			'where'   => array( 'id' => array( 'in' => array( $en, $fr ) ) ),
			'locale'  => '*',
			'orderBy' => array( 'id' => 'asc' ),
		)
	),
);
eq( 'both translations keep their values', $translationState(), array( array( $one, false ), array( $two, false ) ) );
eq( 'repeating a synced value leaves the hidden translation untouched', $answer( 'PATCH', "/localizedChildren/$en", array( 'detached' => false ) )[0], 200 );
eq( 'a localized-only PATCH can leave the hidden translation untouched', $answer( 'PATCH', "/localizedChildren/$en", array( 'heading' => 'New heading' ) )[0], 200 );
$db->delete( 'parents', array( 'id' => $one ), viewer: $editor );
eq( 'the same set-null hook syncs when the viewer can read both translations', $translationState(), array( array( null, true ), array( $two, true ) ) );

$article     = $db->insert( 'articles', array( 'heading' => 'English article' ), true )[0]['id'];
$translation = $db->insert(
	'articles',
	array(
		'heading'       => 'French article',
		'locale'        => 'fr',
		'translationOf' => $article,
	),
	true
)[0]['id'];
eq(
	'Polylang links the post translations',
	pll_get_post_translations( $article ),
	array(
		'en' => $article,
		'fr' => $translation,
	)
);
eq( 'PATCH refuses a hidden post translation with the same body', $answer( 'PATCH', "/articles/$article", array( 'detached' => true ) ), $refusal );
eq( 'the hidden post translation keeps its synced value', $db->editorRow( 'articles', $translation )['detached'], false );
$db->update( 'articles', array( 'detached' => true ), array( 'id' => $article ), viewer: $editor );
eq( 'a viewer who reads both Polylang translations can sync them', $db->editorRow( 'articles', $translation )['detached'], true );

// create: default and explicit locale; translationOf joins the group and copies synced columns
$tea = $db->insert(
	'pages',
	array(
		'title' => 'Tea',
		'price' => 3,
		'tags'  => array( 'a' ),
	),
	true
)[0];
eq( 'create defaults to locales.default in its own group', array( $tea['locale'], $tea['translations'] ), array( 'en', array( 'en' => $tea['id'] ) ) );
[$status, $tee] = $rest(
	'POST',
	'/pages',
	array(),
	array(
		'title'         => 'Tee',
		'locale'        => 'de',
		'translationOf' => $tea['id'],
		'status'        => 'draft',
	)
);
eq( 'translationOf copies synced columns, keeps localized + per-row ones', array( $status, $tee['locale'], $tee['price'], $tee['tags'], $tee['slug'], $tee['status'] ), array( 201, 'de', 3, array( 'a' ), 'tee', 'draft' ) );
eq(
	'translations list the whole group on every row (API rows hide translationGroup)',
	array(
		$tee['translations'],
		$db->findFirst( 'pages', array( 'where' => array( 'id' => $tea['id'] ) ) )['translations'],
		array_key_exists( 'translationGroup', $tee ),
		array_key_exists( 'translationGroup', $db->findFirst( 'pages', array( 'where' => array( 'id' => $tea['id'] ) ) ) ),
		array_key_exists( 'translationGroup', \SpacePress\Seam::findFirst( 'pages', array( 'where' => array( 'id' => $tea['id'] ) ) )->p ),
	),
	array(
		array(
			'en' => $tea['id'],
			'de' => $tee['id'],
		),
		array(
			'en' => $tea['id'],
			'de' => $tee['id'],
		),
		false,
		true,
		false,
	)
);
problem(
	'a synced column that differs from the group → 422',
	fn () => $db->insert(
		'pages',
		array(
			'title'         => 'Thé',
			'locale'        => 'fr',
			'translationOf' => $tea['id'],
			'price'         => 9,
		)
	),
	422,
	'invalid_input',
	'/price'
);
problem(
	'one row per locale per group → 409',
	fn () => $db->insert(
		'pages',
		array(
			'title'         => 'Tee 2',
			'locale'        => 'de',
			'translationOf' => $tea['id'],
		)
	),
	409,
	'unique_violation',
	'/locale'
);
problem(
	'translationOf must name a row',
	fn () => $db->insert(
		'pages',
		array(
			'title'         => 'x',
			'locale'        => 'fr',
			'translationOf' => 999,
		)
	),
	422,
	'invalid_input',
	'/translationOf'
);
problem(
	'a malformed locale is invalid input',
	fn () => $db->insert(
		'pages',
		array(
			'title'         => 'x',
			'locale'        => array(),
			'translationOf' => $tea['id'],
		)
	),
	422,
	'invalid_input',
	'/locale'
);
problem(
	'translations are derived',
	fn () => $db->insert(
		'pages',
		array(
			'title'        => 'x',
			'translations' => array(),
		)
	),
	422,
	'invalid_input',
	'/translations'
);
$the = $db->insert(
	'pages',
	array(
		'title'         => 'Thé',
		'locale'        => 'fr',
		'translationOf' => $tee['id'],
		'price'         => 3,
	),
	true
)[0];
problem( 'locale is immutable', fn () => $db->update( 'pages', array( 'locale' => 'de' ), array( 'id' => $the['id'] ) ), 422, 'invalid_input', '/locale' );
problem( 'translationOf only on create', fn () => $db->update( 'pages', array( 'translationOf' => $tea['id'] ), array( 'id' => $the['id'] ) ), 422, 'invalid_input', '/translationOf' );

// update: a synced change reaches every row of the group in one transaction, hooks + revisions per row
$db->update(
	'pages',
	array(
		'price' => 4,
		'title' => 'Thé vert',
	),
	array( 'id' => $the['id'] )
);
$group = $db->findMany(
	'pages',
	array(
		'locale'  => '*',
		'orderBy' => array( 'id' => 'asc' ),
	)
);
eq( 'synced column propagates; localized one stays per row', array_map( static fn ( $r ) => array( $r['locale'], $r['title'], $r['price'] ), $group ), array( array( 'en', 'Tea', 4 ), array( 'de', 'Tee', 4 ), array( 'fr', 'Thé vert', 4 ) ) );
eq(
	'afterUpdate ran once per row, sibling rows already see the full group',
	array_column( $db->findMany( 'notes', array( 'orderBy' => array( 'id' => 'asc' ) ) ), 'body' ),
	array(
		'afterUpdate fr:4 {"de":' . $tee['id'] . ',"en":' . $tea['id'] . ',"fr":' . $the['id'] . '}',
		'afterUpdate en:4 {"de":' . $tee['id'] . ',"en":' . $tea['id'] . ',"fr":' . $the['id'] . '}',
		'afterUpdate de:4 {"de":' . $tee['id'] . ',"en":' . $tea['id'] . ',"fr":' . $the['id'] . '}',
	)
);
eq( 'each synced row keeps its own revision', count( $db->revisions( 'pages', $tee['id'] ) ), 2 );
// A bulk update covering several rows of one group: each row's hooks and revision once, not
// once for the update and again for the group sync it already received.
$before = array_column( $db->findMany( 'notes' ), 'id' );
$db->update( 'pages', array( 'price' => 5 ), array( 'id' => array( 'in' => array( $tea['id'], $tee['id'] ) ) ) );
$bodies = array_map(
	static fn ( $n ) => substr( $n['body'], 0, 16 ),
	$db->findMany(
		'notes',
		array(
			'where'   => array( 'id' => array( 'notIn' => $before ) ),
			'orderBy' => array( 'id' => 'asc' ),
		)
	)
);
sort( $bodies );
eq( 'a bulk update over one group runs each row\'s afterUpdate once', $bodies, array( 'afterUpdate de:5', 'afterUpdate en:5', 'afterUpdate fr:5' ) );
eq( '… one revision each', array( count( $db->revisions( 'pages', $tea['id'] ) ), count( $db->revisions( 'pages', $tee['id'] ) ), count( $db->revisions( 'pages', $the['id'] ) ) ), array( 3, 3, 3 ) );
$db->update( 'pages', array( 'price' => 4 ), array( 'id' => array( 'in' => array( $tea['id'], $tee['id'], $the['id'] ) ) ) );
$db->delete( 'notes', array( 'id' => array( 'notIn' => $before ) ) );
// A nested bulk update over rows of the same group: both changes reach every row.
$kick   = $db->insert(
	'pages',
	array(
		'title' => 'Kick',
		'price' => 1,
	),
	true
)[0];
$nest   = $db->insert(
	'pages',
	array(
		'title' => 'Nest',
		'price' => 1,
	),
	true
)[0];
$nestDe = $db->insert(
	'pages',
	array(
		'title'         => 'Nest DE',
		'locale'        => 'de',
		'translationOf' => $nest['id'],
	),
	true
)[0];
$nestFr = $db->insert(
	'pages',
	array(
		'title'         => 'Nest FR',
		'locale'        => 'fr',
		'translationOf' => $nest['id'],
	),
	true
)[0];
$db->update( 'pages', array( 'price' => 31 ), array( 'id' => array( 'in' => array( $kick['id'], $nest['id'] ) ) ) );
eq(
	'… a nested bulk over the same group commits both changes to every row',
	array_map(
		static fn ( $r ) => array( $r['price'], $r['tags'] ),
		$db->findMany(
			'pages',
			array(
				'locale' => '*',
				'where'  => array( 'id' => array( 'in' => array( $nest['id'], $nestDe['id'], $nestFr['id'] ) ) ),
			)
		)
	),
	array( array( 31, array( 'b' ) ), array( 31, array( 'b' ) ), array( 31, array( 'b' ) ) )
);
$db->delete( 'pages', array( 'id' => array( 'in' => array( $kick['id'], $nest['id'], $nestDe['id'], $nestFr['id'] ) ) ) );
$db->delete( 'notes', array( 'id' => array( 'notIn' => $before ) ) );
// Writes between two rows of one group in a bulk update: the group agrees, and the latest change wins.
$order   = $db->insert(
	'pages',
	array(
		'title' => 'Order',
		'price' => 1,
	),
	true
)[0];
$between = $db->insert(
	'pages',
	array(
		'title' => 'Between',
		'price' => 1,
	),
	true
)[0];
$orderDe = $db->insert(
	'pages',
	array(
		'title'         => 'Order DE',
		'locale'        => 'de',
		'translationOf' => $order['id'],
	),
	true
)[0];
$three   = array( 'id' => array( 'in' => array( $order['id'], $between['id'], $orderDe['id'] ) ) );
$db->update( 'pages', array( 'price' => 41 ), $three );
eq(
	'… a nested write between the rows commits with the group agreeing',
	array_column(
		$db->findMany(
			'pages',
			array(
				'locale' => '*',
				'where'  => array( 'id' => array( 'in' => array( $order['id'], $orderDe['id'] ) ) ),
			)
		),
		'price'
	),
	array( 41, 41 )
);
$db->update( 'pages', array( 'stampedAt' => '2001-01-01T00:00:00.000Z' ), $three );
eq(
	'… also when a later change restores the value the group had',
	array_column(
		$db->findMany(
			'pages',
			array(
				'locale' => '*',
				'where'  => array( 'id' => array( 'in' => array( $order['id'], $orderDe['id'] ) ) ),
			)
		),
		'price'
	),
	array( 41, 41 )
);
$db->delete( 'pages', $three );
$db->delete( 'notes', array( 'id' => array( 'notIn' => $before ) ) );
// Hooks between two rows of a group in a bulk update: a nested write to the later row, a new
// translation of it, or deleting the earlier one all leave the group consistent.
$late     = $db->insert(
	'pages',
	array(
		'title' => 'Late',
		'price' => 1,
	),
	true
)[0];
$mid      = $db->insert(
	'pages',
	array(
		'title' => 'Mid',
		'price' => 1,
	),
	true
)[0];
$lateDe   = $db->insert(
	'pages',
	array(
		'title'         => 'Late DE',
		'locale'        => 'de',
		'translationOf' => $late['id'],
	),
	true
)[0];
$lateRows = static fn () => array_map(
	static fn ( $r ) => $r['title'] . ':' . $r['price'],
	$db->findMany(
		'pages',
		array(
			'locale'  => '*',
			'where'   => array( 'title' => array( 'like' => 'Late%' ) ),
			'orderBy' => array( 'id' => 'asc' ),
		)
	)
);
$three    = array( 'id' => array( 'in' => array( $late['id'], $mid['id'], $lateDe['id'] ) ) );
$db->update( 'pages', array( 'price' => 51 ), $three );
// Late DE was already written by the bulk update (once, with the group's 51); Mid's hook wrote later.
eq( '… a later nested write to a row the bulk update already reached wins, the group agreeing', $lateRows(), array( 'Late:57', 'Late DE:57' ) );
$db->update( 'pages', array( 'price' => 52 ), $three );
eq( '… a translation created between them joins with the group\'s current values', $lateRows(), array( 'Late:52', 'Late DE:52', 'Late FR:52' ) );
$revisionsBefore = count( $db->revisions( 'pages', $late['id'] ) );
$notesBefore     = count( $db->findMany( 'notes' ) );
problem( '… a sibling hook that deletes the first row and then fails rolls everything back', fn () => $db->update( 'pages', array( 'price' => 53 ), $three ), 422, 'rejected' );
eq(
	'… nothing of it committed: rows, revisions, hook effects',
	array( $lateRows(), count( $db->revisions( 'pages', $late['id'] ) ), count( $db->findMany( 'notes' ) ) ),
	array( array( 'Late:52', 'Late DE:52', 'Late FR:52' ), $revisionsBefore, $notesBefore )
);
$db->delete( 'pages', array( 'title' => array( 'in' => array( 'Late', 'Mid', 'Late DE', 'Late FR' ) ) ) );
$db->delete( 'notes', array( 'id' => array( 'notIn' => $before ) ) );
// A row from before localization (no group yet): its old revisions show the group it has now.
$legacy = $db->insert( 'pages', array( 'title' => 'Legacy' ), true )[0];
$wp->exec( 'UPDATE {prefix}sp_pages SET `translationGroup` = NULL WHERE `id` = ?', array( $legacy['id'] ) );
$db->update( 'pages', array( 'title' => 'Legacy v2' ), array( 'id' => $legacy['id'] ) );
$legacyRevision = array_reverse( $db->revisions( 'pages', $legacy['id'] ) )[0]['id'];
$legacyDe       = $db->insert(
	'pages',
	array(
		'title'         => 'Alt',
		'locale'        => 'de',
		'translationOf' => $legacy['id'],
	),
	true
)[0];
eq(
	'a revision taken before the row had a group shows its current group',
	$db->revision( 'pages', $legacy['id'], $legacyRevision )['translations'],
	array(
		'en' => $legacy['id'],
		'de' => $legacyDe['id'],
	)
);
$db->delete( 'pages', array( 'id' => array( 'in' => array( $legacy['id'], $legacyDe['id'] ) ) ) );
$firstRevision = array_reverse( $db->revisions( 'pages', $tea['id'] ) )[0]['id'];
eq(
	'a revision shows the group as it is now, not as it was',
	$db->revision( 'pages', $tea['id'], $firstRevision )['translations'],
	array(
		'en' => $tea['id'],
		'de' => $tee['id'],
		'fr' => $the['id'],
	)
);
$notesBefore     = count( $db->findMany( 'notes' ) );
$revisionsBefore = count( $db->revisions( 'pages', $tea['id'] ) );
problem( 'a sibling hook failing mid-sync rolls back the whole group', fn () => $db->transaction( fn () => $db->update( 'pages', array( 'price' => 13 ), array( 'id' => $tea['id'] ) ) ), 422, 'rejected' );
eq(
	'… rows, hook effects and revisions written before the failure are gone',
	array(
		array_column( $db->findMany( 'pages', array( 'locale' => '*' ) ), 'price' ),
		count( $db->findMany( 'notes' ) ),
		count( $db->revisions( 'pages', $tea['id'] ) ),
	),
	array( array( 4, 4, 4 ), $notesBefore, $revisionsBefore )
);

// A group holding a localized sub-field is translated whole: never copied or synced.
$seo   = $db->insert(
	'pages',
	array(
		'title' => 'Seo',
		'seo'   => array(
			'heading' => 'Hello',
			'noindex' => true,
		),
	),
	true
)[0];
$seoDe = $db->insert(
	'pages',
	array(
		'title'         => 'Seo DE',
		'locale'        => 'de',
		'translationOf' => $seo['id'],
		'seo'           => array(
			'heading' => 'Hallo',
			'noindex' => true,
		),
	),
	true
)[0];
$db->update(
	'pages',
	array(
		'seo' => array(
			'heading' => 'Hi',
			'noindex' => false,
		),
	),
	array( 'id' => $seo['id'] )
);
eq(
	'a group with a localized sub-field stays per row',
	array( $seoDe['seo']['heading'], $db->findFirst( 'pages', array( 'where' => array( 'id' => $seoDe['id'] ) ) )['seo'] ),
	array(
		'Hallo',
		array(
			'heading' => 'Hallo',
			'noindex' => true,
		),
	)
);
$db->delete( 'pages', array( 'id' => array( 'in' => array( $seo['id'], $seoDe['id'] ) ) ) );
// A sibling's hook that rewrites a synced value can't split the group: the whole write is refused.
$bump   = $db->insert(
	'pages',
	array(
		'title' => 'Bump',
		'price' => 1,
	),
	true
)[0];
$bumpDe = $db->insert(
	'pages',
	array(
		'title'         => 'Bump DE',
		'locale'        => 'de',
		'translationOf' => $bump['id'],
	),
	true
)[0];
problem( 'a hook that diverges a synced column → 409, nothing committed', fn () => $db->transaction( fn () => $db->update( 'pages', array( 'price' => 2 ), array( 'id' => $bump['id'] ) ) ), 409, 'conflict', '/price' );
problem( '… also when one bulk update covers both rows', fn () => $db->transaction( fn () => $db->update( 'pages', array( 'price' => 2 ), array( 'id' => array( 'in' => array( $bump['id'], $bumpDe['id'] ) ) ) ) ), 409, 'conflict', '/price' );
problem(
	'… also when the patch is input that normalizes to the group\'s values',
	fn () => $db->transaction(
		fn () => $db->update(
			'pages',
			array(
				'price' => 2.0,
				'box'   => array( 'label' => 'x' ),
			),
			array( 'id' => array( 'in' => array( $bump['id'], $bumpDe['id'] ) ) )
		)
	),
	409,
	'conflict',
	'/price'
);
eq(
	'… both rows keep the group value',
	array_column(
		$db->findMany(
			'pages',
			array(
				'locale' => '*',
				'where'  => array( 'id' => array( 'in' => array( $bump['id'], $bumpDe['id'] ) ) ),
			)
		),
		'price'
	),
	array( 1, 1 )
);
$db->delete( 'pages', array( 'id' => array( 'in' => array( $bump['id'], $bumpDe['id'] ) ) ) );
$tag   = $db->insert(
	'pages',
	array(
		'title' => 'Tag',
		'price' => 1,
		'tags'  => array( 'a' ),
	),
	true
)[0];
$tagDe = $db->insert(
	'pages',
	array(
		'title'         => 'Tag DE',
		'locale'        => 'de',
		'translationOf' => $tag['id'],
	),
	true
)[0];
problem( '… also when the hook changes another synced column', fn () => $db->transaction( fn () => $db->update( 'pages', array( 'price' => 2 ), array( 'id' => $tag['id'] ) ) ), 409, 'conflict', '/tags' );
eq(
	'… nothing committed',
	array_map(
		static fn ( $r ) => array( $r['price'], $r['tags'] ),
		$db->findMany(
			'pages',
			array(
				'locale'  => '*',
				'where'   => array( 'id' => array( 'in' => array( $tag['id'], $tagDe['id'] ) ) ),
				'orderBy' => array( 'id' => 'asc' ),
			)
		)
	),
	array( array( 1, array( 'a' ) ), array( 1, array( 'a' ) ) )
);
$db->delete( 'pages', array( 'id' => array( 'in' => array( $tag['id'], $tagDe['id'] ) ) ) );
$spawn   = $db->insert(
	'pages',
	array(
		'title' => 'Spawn',
		'price' => 1,
	),
	true
)[0];
$spawnDe = $db->insert(
	'pages',
	array(
		'title'         => 'Spawn DE',
		'locale'        => 'de',
		'translationOf' => $spawn['id'],
	),
	true
)[0];
problem( '… also when a hook adds a translation with the old values', fn () => $db->transaction( fn () => $db->update( 'pages', array( 'price' => 2 ), array( 'id' => $spawn['id'] ) ) ), 409, 'conflict', '/price' );
eq(
	'… nothing committed',
	count(
		$db->findMany(
			'pages',
			array(
				'locale' => '*',
				'where'  => array( 'title' => array( 'like' => 'Spawn%' ) ),
			)
		)
	),
	2
);
$db->delete( 'pages', array( 'id' => array( 'in' => array( $spawn['id'], $spawnDe['id'] ) ) ) );
$move   = $db->insert(
	'pages',
	array(
		'title' => 'Move',
		'price' => 1,
	),
	true
)[0];
$moveDe = $db->insert(
	'pages',
	array(
		'title'         => 'Move DE',
		'locale'        => 'de',
		'translationOf' => $move['id'],
	),
	true
)[0];
problem( 'a hook can\'t move a row to another locale either', fn () => $db->update( 'pages', array( 'title' => 'Move DE' ), array( 'id' => $moveDe['id'] ) ), 422, 'invalid_input', '/locale' );
$db->delete( 'pages', array( 'id' => array( 'in' => array( $move['id'], $moveDe['id'] ) ) ) );

// Per-row generated values (default now, onUpdate) aren't synced: a translation keeps its own.
$stamped   = $db->insert(
	'pages',
	array(
		'title'     => 'Stamped',
		'stampedAt' => '2000-01-01T00:00:00Z',
	),
	true
)[0];
$stampedDe = $db->insert(
	'pages',
	array(
		'title'         => 'Stamped DE',
		'locale'        => 'de',
		'translationOf' => $stamped['id'],
	),
	true
)[0];
check( 'a generated column is per row', $stampedDe['stampedAt'] !== $stamped['stampedAt'], array( $stamped['stampedAt'], $stampedDe['stampedAt'] ) );
$db->delete( 'pages', array( 'id' => array( 'in' => array( $stamped['id'], $stampedDe['id'] ) ) ) );

// Text primary keys that look like numbers stay text through groups, sync and reads.
$db->insert(
	'codes',
	array(
		'code'  => '01',
		'label' => 'One',
		'rank'  => 1,
	)
);
$db->insert(
	'codes',
	array(
		'code'          => '001',
		'label'         => 'Eins',
		'locale'        => 'de',
		'translationOf' => '01',
	)
);
$db->update( 'codes', array( 'rank' => 2 ), array( 'code' => '001' ) );
eq(
	'numeric-looking text keys keep their type',
	array_map(
		static fn ( $r ) => array( $r['code'], $r['rank'], $r['translations'] ),
		$db->findMany(
			'codes',
			array(
				'locale'  => '*',
				'orderBy' => array( 'code' => 'asc' ),
			)
		)
	),
	array(
		array(
			'001',
			2,
			array(
				'en' => '01',
				'de' => '001',
			),
		),
		array(
			'01',
			2,
			array(
				'en' => '01',
				'de' => '001',
			),
		),
	)
);

// A synced group with an admin-only sub-field: an editor can't confirm the hidden value by guessing.
$boxed    = $db->insert(
	'pages',
	array(
		'title' => 'Boxed',
		'box'   => array(
			'label'  => 'L',
			'secret' => 's3cret',
		),
	),
	true
)[0];
$boxGuess = static fn ( string $secret ) => fn () => $db->insert(
	'pages',
	array(
		'title'         => 'Boxed DE',
		'locale'        => 'de',
		'translationOf' => $boxed['id'],
		'box'           => array(
			'label'  => 'L',
			'secret' => $secret,
		),
	),
	true,
	$editor
);
problem( 'a hidden sub-field is refused whatever it is (right guess)', $boxGuess( 's3cret' ), 422, 'invalid_input', '/box' );
problem( '… exactly like a wrong guess', $boxGuess( 'nope' ), 422, 'invalid_input', '/box' );
$db->delete( 'pages', array( 'id' => $boxed['id'] ) );

// Adoption (a row linked into a group outside the API) is held to the same group invariant.
$adopt = $db->insert(
	'pages',
	array(
		'title' => 'Adopt',
		'price' => 7,
	),
	true
)[0];
problem(
	'a hook rewriting an adopted synced value → 409, nothing committed',
	fn () => $db->transaction(
		function () use ( $db, $adopt, $wp ) {
			$de = $db->insert(
				'pages',
				array(
					'title'  => 'Adopt DE',
					'locale' => 'de',
					'price'  => 1,
				),
				true
			)[0];
			$wp->exec( 'UPDATE {prefix}sp_pages SET `translationGroup` = ? WHERE `id` = ?', array( $db->findFirst( 'pages', array( 'where' => array( 'id' => $adopt['id'] ) ) )['translationGroup'], $de['id'] ) ); // linked outside the pipeline
			\SpacePress\Locale\GroupSync::adopt( 'pages', $db->findFirst( 'pages', array( 'where' => array( 'id' => $de['id'] ) ) ) );
			}
	),
	409,
	'conflict',
	'/price'
);
eq(
	'… no Adopt DE row was committed',
	count(
		$db->findMany(
			'pages',
			array(
				'locale' => '*',
				'where'  => array( 'title' => 'Adopt DE' ),
			)
		)
	),
	0
);
problem(
	'… and a hook that adds a translation during a group adoption is checked too',
	fn () => $db->transaction(
		function () use ( $db, $adopt, $wp ) {
			$de = $db->insert(
				'pages',
				array(
					'title'  => 'Spawn on adopt',
					'locale' => 'de',
					'price'  => 1,
				),
				true
			)[0];
			$wp->exec( 'UPDATE {prefix}sp_pages SET `translationGroup` = ? WHERE `id` = ?', array( $db->findFirst( 'pages', array( 'where' => array( 'id' => $adopt['id'] ) ) )['translationGroup'], $de['id'] ) );
			$rows = $db->findMany(
				'pages',
				array(
					'locale'  => '*',
					'where'   => array( 'id' => array( 'in' => array( $adopt['id'], $de['id'] ) ) ),
					'orderBy' => array( 'id' => 'asc' ),
				)
			);
			\SpacePress\Locale\GroupSync::adoptAll( 'pages', $rows );
			}
	),
	409,
	'conflict',
	'/price'
);
eq(
	'… nothing of it committed',
	count(
		$db->findMany(
			'pages',
			array(
				'locale' => '*',
				'where'  => array( 'title' => array( 'in' => array( 'Spawn on adopt', 'Spawned FR' ) ) ),
			)
		)
	),
	0
);
$db->delete( 'pages', array( 'id' => $adopt['id'] ) );

// An idempotent translation create replays its receipt even after the group's values moved on.
$idem    = $db->insert(
	'pages',
	array(
		'title' => 'Idem',
		'price' => 3,
	),
	true
)[0];
$request = array(
	'title'         => 'Idem FR',
	'locale'        => 'fr',
	'translationOf' => $idem['id'],
	'price'         => 3,
);
$first   = $rest( 'POST', '/pages', array(), $request, array( 'idempotency-key' => 'idem-fr' ) );
$db->update( 'pages', array( 'price' => 4 ), array( 'id' => $idem['id'] ) );
$again = $rest( 'POST', '/pages', array(), $request, array( 'idempotency-key' => 'idem-fr' ) );
eq( '… the replay returns the original 201', array( $first[0], $again[0], $again[1]['id'] ?? null ), array( 201, 201, $first[1]['id'] ) );
$db->delete( 'pages', array( 'id' => array( 'in' => array( $idem['id'], $first[1]['id'] ) ) ) );

// reads: locale with fallback per group, `*`, filters combine, non-localized collections refuse
$coffee = $db->insert(
	'pages',
	array(
		'title' => 'Coffee',
		'price' => 5,
	),
	true
)[0];
$kaffee = $db->insert(
	'pages',
	array(
		'title'         => 'Kaffee',
		'locale'        => 'de',
		'translationOf' => $coffee['id'],
	),
	true
)[0];
$db->update( 'pages', array( 'price' => 21 ), array( 'id' => $the['id'] ) );
eq(
	'a sync that writes another group still propagates that group',
	array_column(
		$db->findMany(
			'pages',
			array(
				'locale'  => '*',
				'orderBy' => array( 'id' => 'asc' ),
			)
		),
		'price'
	),
	array( 21, 21, 21, 22, 22 )
);
$db->delete( 'pages', array( 'id' => $kaffee['id'] ) );
$db->update( 'pages', array( 'price' => 4 ), array( 'id' => $the['id'] ) );
$db->update( 'pages', array( 'price' => 5 ), array( 'id' => $coffee['id'] ) );
eq(
	'locale=de: the de row, else the group\'s default-locale row',
	$titles(
		$db->findMany(
			'pages',
			array(
				'locale'  => 'de',
				'orderBy' => array( 'id' => 'asc' ),
			)
		)
	),
	array( 'de:Tee', 'en:Coffee' )
);
eq(
	'locale=fr with a filter',
	$titles(
		$db->findMany(
			'pages',
			array(
				'locale'  => 'fr',
				'where'   => array( 'price' => array( 'gte' => 4 ) ),
				'orderBy' => array( 'id' => 'asc' ),
			)
		)
	),
	array( 'fr:Thé vert', 'en:Coffee' )
);
eq(
	'a filter that excludes the translation does not resurrect its fallback',
	$titles(
		$db->findMany(
			'pages',
			array(
				'locale' => 'fr',
				'where'  => array( 'title' => array( 'like' => 'Tea%' ) ),
			)
		)
	),
	array()
);
eq( 'locale=* returns every row', count( $db->findMany( 'pages', array( 'locale' => '*' ) ) ), 4 );
eq( 'API list defaults to locales.default', $titles( $rest( 'GET', '/pages', array( 'orderBy' => 'id' ) )[1] ), array( 'en:Tea', 'en:Coffee' ) );
eq(
	'REST ?locale=fr',
	$titles(
		$rest(
			'GET',
			'/pages',
			array(
				'locale'  => 'fr',
				'orderBy' => 'id',
			)
		)[1]
	),
	array( 'fr:Thé vert', 'en:Coffee' )
);
eq(
	'a hidden translation (draft) does not hide its group: anonymous de falls back',
	array(
		$titles(
			$db->findMany(
				'pages',
				array(
					'locale'  => 'de',
					'orderBy' => array( 'id' => 'asc' ),
				),
				$anon
			)
		),
		$titles(
			$db->findMany(
				'pages',
				array(
					'locale'  => 'de',
					'orderBy' => array( 'id' => 'asc' ),
				),
				$editor
			)
		),
	),
	array( array( 'en:Tea', 'en:Coffee' ), array( 'de:Tee', 'en:Coffee' ) )
);
eq(
	'GET /pages/{id} names a row; ?locale= picks its group\'s row',
	array(
		$rest( 'GET', '/pages/' . $tea['id'] )[1]['title'],
		$rest( 'GET', '/pages/' . $tea['id'], array( 'locale' => 'fr' ) )[1]['title'],
		$rest( 'GET', '/pages/' . $coffee['id'], array( 'locale' => 'fr' ) )[1]['title'],
	),
	array( 'Tea', 'Thé vert', 'Coffee' )
);
$isBad = static fn ( array $r, string $ptr ) => check( "bad locale → 400 $ptr", 400 === $r[0] && 'invalid_query' === $r[1]['code'] && $r[1]['pointer'] === $ptr, $r );
$isBad( $rest( 'GET', '/pages', array( 'locale' => 'es' ) ), '/locale' );
$isBad( $rest( 'GET', '/notes', array( 'locale' => 'en' ) ), '/locale' );
problem( 'translations cannot be filtered', fn () => $db->findMany( 'pages', array( 'where' => array( 'translations' => null ) ) ), 400, 'invalid_query', '/where/translations' );

// with: a localized `many` resolves to each parent row's locale, `one` resolves the stored id
$db->insert(
	'notes',
	array(
		'pageId' => $coffee['id'],
		'body'   => 'child',
	)
);
$fallback = $db->findMany(
	'pages',
	array(
		'locale' => 'de',
		'with'   => array( 'notes' => true ),
		'where'  => array( 'id' => $coffee['id'] ),
	)
);
eq( '`many` children that aren\'t localized are attached as stored', array( $fallback[0]['locale'], in_array( 'child', array_column( $fallback[0]['notes'], 'body' ), true ) ), array( 'en', true ) );
// Chapters name the en page (pageId is synced, so the de translation names it too); Serve has no de row.
$steep = $db->insert(
	'chapters',
	array(
		'pageId'  => $tea['id'],
		'heading' => 'Steep',
	),
	true
)[0];
$db->insert(
	'chapters',
	array(
		'heading'       => 'Ziehen',
		'locale'        => 'de',
		'translationOf' => $steep['id'],
	)
);
$db->insert(
	'chapters',
	array(
		'pageId'  => $tea['id'],
		'heading' => 'Serve',
	)
);
$headings = static fn ( array $rows ): array => array_map( static fn ( $r ) => array( $r['locale'] . ':' . $r['title'], $titles( array_map( static fn ( $c ) => array( 'title' => $c['heading'] ) + $c, $r['chapters'] ) ) ), $rows );
$mine     = array( 'id' => array( 'in' => array( $tea['id'], $tee['id'], $the['id'] ) ) );
eq(
	'each parent row gets its group\'s children in its own locale, falling back per group',
	$headings(
		$db->findMany(
			'pages',
			array(
				'locale'  => '*',
				'where'   => $mine,
				'orderBy' => array( 'id' => 'asc' ),
				'with'    => array( 'chapters' => true ),
			)
		)
	),
	array(
		array( 'en:Tea', array( 'en:Steep', 'en:Serve' ) ),
		array( 'de:Tee', array( 'de:Ziehen', 'en:Serve' ) ),
		array( 'fr:Thé vert', array( 'en:Steep', 'en:Serve' ) ),
	)
);
eq(
	'… limit applies per parent',
	$headings(
		$db->findMany(
			'pages',
			array(
				'locale'  => '*',
				'where'   => $mine,
				'orderBy' => array( 'id' => 'asc' ),
				'with'    => array(
					'chapters' => array(
						'limit'  => 1,
						'offset' => 1,
					),
				),
			)
		)
	),
	array(
		array( 'en:Tea', array( 'en:Serve' ) ),
		array( 'de:Tee', array( 'en:Serve' ) ),
		array( 'fr:Thé vert', array( 'en:Serve' ) ),
	)
);
eq(
	'… over REST, a viewer who can\'t see the de draft gets its fallback parent and en children',
	$headings(
		$rest(
			'GET',
			'/pages',
			array(
				'locale' => 'de',
				'with'   => 'chapters',
				'where'  => json_encode( array( 'id' => $tea['id'] ) ),
			)
		)[1]
	),
	array(
		array( 'en:Tea', array( 'en:Steep', 'en:Serve' ) ),
	)
);
eq(
	'… a nested locale still wins, for every row of the group',
	$headings(
		$db->findMany(
			'pages',
			array(
				'locale'  => '*',
				'where'   => $mine,
				'orderBy' => array( 'id' => 'asc' ),
				'with'    => array(
					'chapters' => array(
						'locale' => 'en',
						'limit'  => 1,
					),
				),
			)
		)
	),
	array(
		array( 'en:Tea', array( 'en:Steep' ) ),
		array( 'de:Tee', array( 'en:Steep' ) ),
		array( 'fr:Thé vert', array( 'en:Steep' ) ),
	)
);
problem(
	'… a nested limit is still validated',
	fn () => $db->findMany(
		'pages',
		array(
			'where' => array( 'id' => $tea['id'] ),
			'with'  => array( 'chapters' => array( 'limit' => -1 ) ),
		)
	),
	400,
	'invalid_query',
	'/with/chapters/limit'
);
problem(
	'… so is a nested option when no parent has a key to follow',
	fn () => $db->findMany(
		'pages',
		array(
			'where' => array( 'id' => $tea['id'] ),
			'with'  => array( 'parent' => array( 'limit' => -1 ) ),
		)
	),
	400,
	'invalid_query',
	'/with/parent/limit'
);
$db->update( 'pages', array( 'parentId' => $tea['id'] ), array( 'id' => $coffee['id'] ) );
$fr = $db->findMany(
	'pages',
	array(
		'locale'  => 'fr',
		'with'    => array( 'parent' => true ),
		'orderBy' => array( 'id' => 'asc' ),
	)
);
eq( '`one` relation resolves the referenced row as stored', array_map( static fn ( $r ) => $r['parent']['title'] ?? null, $fr ), array( null, 'Tea' ) );

// delete: only that row; the group shrinks
$db->delete( 'pages', array( 'id' => $tee['id'] ) );
eq(
	'delete shrinks the group',
	array(
		$db->findFirst( 'pages', array( 'where' => array( 'id' => $tea['id'] ) ) )['translations'],
		$titles(
			$db->findMany(
				'pages',
				array(
					'locale'  => 'de',
					'orderBy' => array( 'id' => 'asc' ),
				)
			)
		),
	),
	array(
		array(
			'en' => $tea['id'],
			'fr' => $the['id'],
		),
		array( 'en:Tea', 'en:Coffee' ),
	)
);

// hooks see rows as stored (locale, translations, translationGroup)
$stored = $db->findFirst( 'pages', array( 'where' => array( 'id' => $the['id'] ) ) );
check( 'trusted rows carry the group id', is_string( $stored['translationGroup'] ) && strlen( $stored['translationGroup'] ) === 36, $stored );

// translationOf copies synced values from storage, not from the caller's field-filtered view.
$hidePrice = true;
\SpacePress\Extensions::onRead(
	static function ( array $rows, string $c, ?\SpacePress\Viewer $v ) use ( &$hidePrice ): array {
		return 'pages' === $c && null !== $v && $hidePrice ? array_map( static fn ( $r ) => array_diff_key( $r, array( 'price' => 1 ) ), $rows ) : $rows;
	},
	constraintSafe: true
);
$de        = $db->insert(
	'pages',
	array(
		'title'         => 'Tee wieder',
		'locale'        => 'de',
		'translationOf' => $tea['id'],
	),
	true,
	$editor
)[0];
$hidePrice = false;
$hidePrice = true;
$guess     = static fn ( int $price ) => fn () => $db->insert(
	'pages',
	array(
		'title'         => 'Thé encore',
		'locale'        => 'fr',
		'translationOf' => $tea['id'],
		'price'         => $price,
	),
	true,
	$editor
);
problem( 'a hidden synced value is refused whatever it is (right guess)', $guess( 4 ), 422, 'invalid_input', '/price' );
problem( '… exactly like a wrong guess', $guess( 5 ), 422, 'invalid_input', '/price' );
$hidePrice = false;
eq( 'a hidden synced column is copied at create (no repair update, one revision)', array( $db->findFirst( 'pages', array( 'where' => array( 'id' => $de['id'] ) ) )['price'], count( $db->revisions( 'pages', $de['id'] ) ) ), array( 4, 1 ) );

finish( 'locales_test' );
