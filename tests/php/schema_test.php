<?php

declare(strict_types=1);

/*
 * Schema codecs (§3.4) and rules (§1.2) as pure functions, on the blog fixture's column shapes.
 * Validators come from the fixture's functions.php.
 */

require __DIR__ . '/../../runtime/SpacePress/bootstrap.php';
require __DIR__ . '/../fixtures/blog/functions.php';
require __DIR__ . '/harness.php';

use SpacePress\Schema;

$fixture = __DIR__ . '/../fixtures/blog/schema.php';
$schema  = Schema::load( $fixture );
eq( 'PHP platform policy matches the shared golden', \SpacePress\Wp\Platform::requirements(), json_decode( file_get_contents( __DIR__ . '/../fixtures/platform.json' ), true, 512, JSON_THROW_ON_ERROR ) );
// The WordPress floor is 7.1: what $wp_version reads on each build, whole (core's suffix-dropping check would pass 7.1's pre-releases).
$floor = array(
	'7.1'             => true,
	'7.1.4'           => true,
	'7.2-alpha-64000' => true,
	'7.2-beta5'       => true,
	'7.2-beta5-65525' => true,
	'7.2-RC1'         => true,
	'7.2'             => true,
	'8.0'             => true,
	'7.0'             => false,
	'7.0.3'           => false,
	'7.1-beta2'       => false,
	'7.1-RC1'         => false,
	'7.1-alpha-62000' => false,
);
eq( 'WordPress floor accepts 7.1 and later, rejects 7.0.x and 7.1 pre-releases', array_map( \SpacePress\Wp\Platform::wordpressSupported( ... ), array_map( 'strval', array_keys( $floor ) ) ), array_values( $floor ) );
$posts    = $schema->collection( 'posts' )['columns'];
$comments = $schema->collection( 'comments' )['columns'];
$settings = $schema->global( 'settings' )['fields'];
$ctx      = array(
	'data' => array(),
	'user' => null,
);

/** normalize + rules, like the write pipeline does for one column. */
$write = static function ( array $col, mixed $v, string $name ) use ( $ctx ): mixed {
	$n = Schema::normalize( $col, $v, $name, '/' . $name );
	Schema::checkRules( $col, $n, $name, '/' . $name, array( 'data' => array( $name => $n ) ) + array_diff_key( $ctx, array( 'data' => true ) ), array( $name => $col ) );

	return $n;
};

// ---------------------------------------------------------------- load

$tmp = tempnam( sys_get_temp_dir(), 'zs' );
foreach ( array(
	array(
		'version' => 4,
		'runtime' => Schema::SERIES,
	),
	array(
		'version' => 5,
		'runtime' => '0.2',
	),
	array( 'version' => 5 ),
) as $raw ) {
	file_put_contents( $tmp, '<?php return ' . var_export( $raw, true ) . ';' );
	try {
		Schema::load( $tmp );
		check( 'incompatible schema is refused', false );
	} catch ( RuntimeException $e ) {
		$expected = 5 !== $raw['version'] ? 'schema.php version 5 required; rebuild with this SpacePress version'
			: 'schema.php built for runtime ' . ( $raw['runtime'] ?? '(missing)' ) . '; this runtime is 0.3; rebuild with this SpacePress version';
		eq( 'incompatible schema is refused', $e->getMessage(), $expected );
	}
}
unlink( $tmp );
eq( 'v5 reader reports its contract', array( $schema->version(), $schema->runtime() ), array( 5, '0.3' ) );

$phase2_raw = json_decode( file_get_contents( __DIR__ . '/../fixtures/phase2.schema.json' ), true, 512, JSON_THROW_ON_ERROR );
$phase2     = new Schema( $phase2_raw );
foreach ( array( 'site', 'locales', 'media', 'files', 'auth', 'jobs', 'webhooks' ) as $key ) {
	eq( "v3 $key passes through", $phase2->$key(), $phase2_raw[ $key ] );
}
eq( 'v3 nested column metadata passes through', $phase2->collection( 'posts' ), $phase2_raw['collections']['posts'] );
eq(
	'v3 describes field rules without function names',
	$phase2->describe()['collections']['authors']['columns']['email']['access'],
	array(
		'read'   => 'editor',
		'create' => 'anyone',
		'update' => 'rule',
	)
);
eq(
	'v3 describes safe file metadata',
	$phase2->describe()['files']['decks'],
	array(
		'accept'   => array( 'application/pdf', 'image/*' ),
		'maxBytes' => 20000000,
	)
);
eq( 'v3 self summary', $phase2->describe()['collections']['members']['access']['read'], 'self' );
$described = $phase2->describe();
eq(
	'/_schema lists every entry; `agents: false` is carried for the agent surfaces to read (§7.1)',
	array(
		array_keys( $described['collections'] ),
		array_keys( $described['globals'] ),
		array_keys( $described['actions'] ),
		array_filter( array_map( static fn ( array $c ): bool => $c['agents'], $described['collections'] ) ),
	),
	array(
		array( 'authors', 'posts', 'audit', 'members' ),
		array( 'settings' ),
		array( 'inbound', 'widened' ),
		array(
			'authors' => true,
			'posts'   => true,
			'members' => true,
		),
	)
);

$described = json_encode( $schema->describe() );
check(
	'describe hides function names, hooks and wp identifiers',
	! str_contains( $described, '__' ) && ! str_contains( $described, 'hooks' ) && ! str_contains( $described, 'postType' ) && ! str_contains( $described, 'handler' ),
	$described
);
eq(
	'describe summarises access',
	array( $schema->describe()['collections']['posts']['access'], $schema->describe()['actions']['publishedCount']['access'] ),
	array(
		array(
			'read'    => 'rule',
			'create'  => 'author',
			'update'  => 'rule',
			'delete'  => 'editor',
			'restore' => 'editor',
			'purge'   => false,
		),
		'anyone',
	)
);

// ---------------------------------------------------------------- scalar formats

// Timestamps: epoch ms or ISO 8601 with Z/±HH:MM, every component a real calendar/clock value.
$at = $schema->collection( 'posts' )['columns']['createdAt'];
eq(
	'timestamp boundaries accepted (leap day, year 0000, negative offset, long fraction, bare date)',
	array_map(
		fn ( $v ) => Schema::encode( $at, $v, 'createdAt', '/createdAt' ),
		array( '2024-02-29T23:59:59.999Z', '0000-02-29T00:00:00Z', '2026-01-01T00:00:00-00:30', '2026-01-01T00:00:00.123456Z', '2026-01-31' ),
	),
	array( '2024-02-29T23:59:59.999Z', '0000-02-29T00:00:00.000Z', '2026-01-01T00:30:00.000Z', '2026-01-01T00:00:00.123Z', '2026-01-31T00:00:00.000Z' )
);
// ...and the other ISO 8601 spellings sources such as Sanity accepted: week, ordinal, reduced and
// compact forms, expanded years, space separators, comma and fractional-minute fractions, colonless offsets.
foreach ( array(
	'now',
	'+1 week',
	'10/30/2026',
	'2026-01-01 tomorrow',
	'2026-01-01T00:00:00Z +1 year',
	'2026-01-01T10:00:00',
	'2026-01-01T24:00:00Z',
	'2026-01-01T00:00:00+24:00',
	'2026-01-01T00:00Z00:00',
	'2026-02-30T00:00:00Z',
	'9999-12-31T23:59:59-00:30',
	'0000-01-01T00:00:00+00:30',
	253402300800000,
	'2026-W05-3',
	'2026-032',
	'2026-01',
	'20260101',
	'2026-01-01T103000+02:00',
	'+002026-01-01T10:00:00Z',
	'2026-01-01 10:00:00Z',
	'2026-01-01T10:00:00,5Z',
	'2026-01-01T10:30.5Z',
	'2026-01-01T10:00:00+0200',
) as $bad ) {
	problem( 'timestamp rejected: ' . json_encode( $bad ), fn () => Schema::encode( $at, $bad, 'createdAt', '/createdAt' ), 422, 'invalid_input', '/createdAt' );
}

$email = $schema->collection( 'authors' )['columns']['email'];
eq( 'email accepted', Schema::encode( $email, 'a.b@example.com', 'email', '/email' ), 'a.b@example.com' );
problem( 'email rejected', fn () => Schema::encode( $email, 'not-an-email', 'email', '/email' ), 422, 'invalid_input', '/email' );
$url = $settings['social']['fields']['href'];
eq( 'http(s) url accepted', Schema::encode( $url, 'https://example.com/x?y=1', 'href', '/href' ), 'https://example.com/x?y=1' );
problem( 'non-http url rejected', fn () => Schema::encode( $url, 'ftp://example.com', 'href', '/href' ), 422, 'invalid_input', '/href' );
eq( 'slug accepted', Schema::encode( $posts['slug'], 'a-1-b', 'slug', '/slug' ), 'a-1-b' );
problem( 'slug with a double hyphen rejected', fn () => Schema::encode( $posts['slug'], 'a--b', 'slug', '/slug' ), 422, 'invalid_input', '/slug' );
problem( 'slug over 200 characters rejected', fn () => Schema::encode( $posts['slug'], str_repeat( 'a', 201 ), 'slug', '/slug' ), 422, 'invalid_input', '/slug' );
eq( 'media stores an int id', array( Schema::encode( $posts['cover'], 7.0, 'cover', '/cover' ), Schema::decode( $posts['cover'], 7 ) ), array( 7, 7 ) );
$deck = $phase2->collection( 'posts' )['columns']['deck'];
eq( 'file stores an int id and decodes string storage', array( Schema::encode( $deck, 7, 'deck', '/deck' ), Schema::encode( $deck, 7.0, 'deck', '/deck' ), Schema::decode( $deck, '7' ) ), array( 7, 7, 7 ) );
$e = problem( 'file rejects string input at the field pointer', fn () => Schema::encode( $deck, '7', 'deck', '/deck' ), 422, 'invalid_input', '/deck' );
eq( 'file input describes the expected value', $e?->getMessage(), 'deck must be a file id' );

// ---------------------------------------------------------------- lists

eq( 'select multiple round-trips as JSON', array( Schema::encode( $posts['tags'], array( 'news', 'guide' ), 'tags', '/tags' ), Schema::decode( $posts['tags'], '["news","guide"]' ) ), array( '["news","guide"]', array( 'news', 'guide' ) ) );
problem( 'select item outside the options, pointer at the item', fn () => Schema::encode( $posts['tags'], array( 'news', 'gossip' ), 'tags', '/tags' ), 422, 'invalid_input', '/tags/1' );
problem( 'select duplicates rejected', fn () => Schema::encode( $posts['tags'], array( 'news', 'news' ), 'tags', '/tags' ), 422, 'invalid_input', '/tags/1' );
problem( 'select multiple needs a list', fn () => Schema::encode( $posts['tags'], 'news', 'tags', '/tags' ), 422, 'invalid_input', '/tags' );
$photos = array(
	'type'  => 'mediaList',
	'rules' => array( 'max' => 2 ),
);
eq( 'mediaList round-trips', Schema::decode( $photos, Schema::encode( $photos, array( 1, 2.0 ), 'photos', '/photos' ) ), array( 1, 2 ) );
problem( 'mediaList count max', fn () => $write( $photos, array( 1, 2, 3 ), 'photos' ), 422, 'invalid_input', '/photos' );

// ---------------------------------------------------------------- group / repeater / blocks

eq(
	'group: absent optional → null, absent defaulted → default, every sub-key present',
	Schema::decode( $posts['seo'], Schema::encode( $posts['seo'], array( 'metaTitle' => 'T' ), 'seo', '/seo' ) ),
	array(
		'metaTitle'       => 'T',
		'metaDescription' => null,
		'noindex'         => false,
	)
);
problem( 'group: unknown sub-field', fn () => Schema::encode( $posts['seo'], array( 'nope' => 1 ), 'seo', '/seo' ), 422, 'invalid_input', '/seo/nope' );
// json() values preserve object/list shape, including nested values and generated defaults.
$box     = array(
	'type'   => 'group',
	'fields' => array(
		'label' => array( 'type' => 'text' ),
		'extra' => array( 'type' => 'json' ),
	),
);
$encoded = Schema::encode(
	$box,
	array(
		'label' => 'x',
		'extra' => \SpacePress\Js::decodeJson( '{"a":{}}' ),
	),
	'box',
	'/box'
);
eq(
	'a json sub-field in a group keeps {} through encode and decode',
	array( $encoded, \SpacePress\Js::jsonStringify( Schema::decode( $box, $encoded ) ) ),
	array( '{"label":"x","extra":{"a":{}}}', '{"label":"x","extra":{"a":{}}}' )
);
eq(
	'a json() default holding {} generates the empty object',
	\SpacePress\Js::jsonStringify(
		Schema::generate(
			array(
				'value' => array( 'a' => array() ),
				'json'  => '{"a":{}}',
			),
			array( 'type' => 'json' )
		)
	),
	'{"a":{}}'
);
$undefined_default = array(
	'type'    => 'text',
	'default' => array( 'fn' => static fn () => \SpacePress\JsUndefined::Value ),
);
eq(
	'undefined generators become nullable storage values',
	Schema::validateInput(
		array(
			'note'    => $undefined_default,
			'payload' => array(
				'type'    => 'json',
				'default' => $undefined_default['default'],
			),
		),
		array()
	),
	array(
		'note'    => null,
		'payload' => null,
	)
);
problem(
	'undefined generators still enforce required fields',
	fn () => Schema::validateInput(
		array(
			'note' => $undefined_default + array( 'notNull' => true ),
		),
		array()
	),
	422,
	'invalid_input',
	'/note'
);
$undefined_input  = new \SpacePress\JsObject(
	array(
		'note'    => \SpacePress\Js::undefined(),
		'payload' => \SpacePress\Js::undefined(),
		'nested'  => new \SpacePress\JsObject( array( 'note' => \SpacePress\Js::undefined() ) ),
	)
);
$undefined_fields = array(
	'note'    => array( 'type' => 'text' ),
	'payload' => array( 'type' => 'json' ),
	'nested'  => array(
		'type'   => 'group',
		'fields' => array( 'note' => array( 'type' => 'text' ) ),
	),
);
eq(
	'explicit undefined becomes null at shaped storage boundaries',
	Schema::validateInput( $undefined_fields, $undefined_input ),
	array(
		'note'    => null,
		'payload' => null,
		'nested'  => array( 'note' => null ),
	)
);
problem(
	'explicit undefined still enforces required storage fields',
	fn () => Schema::validateInput(
		array(
			'note' => array(
				'type'    => 'text',
				'notNull' => true,
			),
		),
		new \SpacePress\JsObject( array( 'note' => \SpacePress\Js::undefined() ) )
	),
	422,
	'invalid_input',
	'/note'
);
$optional_input = array(
	'limit' => array(
		'type'    => 'integer',
		'notNull' => true,
		'omit'    => true,
	),
);
eq(
	'an undefined optional argument stays omitted',
	Schema::validateInput(
		$optional_input,
		new \SpacePress\JsObject( array( 'limit' => \SpacePress\Js::undefined() ) )
	),
	array()
);
problem(
	'a null optional argument is still rejected',
	fn () => Schema::validateInput(
		$optional_input,
		array( 'limit' => null )
	),
	422,
	'invalid_input',
	'/limit'
);
$deep_default = str_repeat( '[', 520 ) . '1' . str_repeat( ']', 520 );
$deep_value   = Schema::validateInput(
	array(
		'deep' => array(
			'type'    => 'json',
			'default' => array( 'json' => $deep_default ),
		),
	),
	array()
)['deep'];
eq(
	'container defaults preserve values deeper than request JSON through storage',
	array( \SpacePress\Js::jsonStringify( $deep_value ), \SpacePress\Js::jsonStringify( Schema::decode( array( 'type' => 'json' ), Schema::store( array( 'type' => 'json' ), $deep_value ) ) ) ),
	array( $deep_default, $deep_default )
);
problem( 'group: sub-field type', fn () => Schema::encode( $posts['seo'], array( 'noindex' => 'yes' ), 'seo', '/seo' ), 422, 'invalid_input', '/seo/noindex' );
problem( 'group: sub-field rule (max), nested pointer', fn () => $write( $posts['seo'], array( 'metaTitle' => str_repeat( 'x', 71 ) ), 'seo' ), 422, 'invalid_input', '/seo/metaTitle' );

$gallery = array(
	array(
		'image'   => 1,
		'caption' => 'a',
	),
	array( 'image' => 2 ),
);
eq(
	'repeater round-trips with every sub-key',
	Schema::decode( $posts['gallery'], Schema::encode( $posts['gallery'], $gallery, 'gallery', '/gallery' ) ),
	array(
		array(
			'image'   => 1,
			'caption' => 'a',
		),
		array(
			'image'   => 2,
			'caption' => null,
		),
	)
);
problem( 'repeater: required sub-field per item', fn () => Schema::encode( $posts['gallery'], array( array( 'image' => 1 ), array( 'caption' => 'x' ) ), 'gallery', '/gallery' ), 422, 'invalid_input', '/gallery/1/image' );
problem(
	'repeater: sub-field rule deep pointer',
	fn () => $write(
		$posts['gallery'],
		array(
			array( 'image' => 1 ),
			array( 'image' => 2 ),
			array(
				'image'   => 3,
				'caption' => str_repeat( 'c', 121 ),
			),
		),
		'gallery'
	),
	422,
	'invalid_input',
	'/gallery/2/caption'
);
problem( 'repeater: item count max', fn () => $write( $posts['gallery'], array_fill( 0, 13, array( 'image' => 1 ) ), 'gallery' ), 422, 'invalid_input', '/gallery' );
problem( 'repeater: items must be objects', fn () => Schema::encode( $posts['gallery'], array( 1 ), 'gallery', '/gallery' ), 422, 'invalid_input', '/gallery/0' );

$sections = array(
	array(
		'layout' => 'quote',
		'text'   => 'Hi',
	),
	array(
		'layout'  => 'hero',
		'heading' => 'H',
		'image'   => 3,
	),
);
eq(
	'blocks: layout kept first, every layout sub-key present',
	Schema::decode( $posts['sections'], Schema::encode( $posts['sections'], $sections, 'sections', '/sections' ) ),
	array(
		array(
			'layout' => 'quote',
			'text'   => 'Hi',
			'cite'   => null,
		),
		array(
			'layout'  => 'hero',
			'heading' => 'H',
			'image'   => 3,
		),
	)
);
problem( 'blocks: unknown layout', fn () => Schema::encode( $posts['sections'], array( array( 'layout' => 'video' ) ), 'sections', '/sections' ), 422, 'invalid_input', '/sections/0/layout' );
problem(
	'blocks: field of another layout is unknown',
	fn () => Schema::encode(
		$posts['sections'],
		array(
			array(
				'layout'  => 'quote',
				'text'    => 'x',
				'heading' => 'y',
			),
		),
		'sections',
		'/sections'
	),
	422,
	'invalid_input',
	'/sections/0/heading'
);
eq(
	'media refs found through nested values',
	Schema::mediaRefs( $posts['sections'], Schema::normalize( $posts['sections'], $sections, 'sections', '/sections' ), '/sections' ),
	array( array( 3, '/sections/1/image', 'image' ) )
);

eq( 'boolean decodes numeric and legacy text storage', array_map( static fn ( $v ) => Schema::decode( array( 'type' => 'boolean' ), $v ), array( '0', '1', 'true', 'false', null ) ), array( false, true, true, false, null ) );
$nested = array(
	'type'   => 'group',
	'fields' => array(
		'meta' => array( 'type' => 'json' ),
		'n'    => array( 'type' => 'integer' ),
		'on'   => array( 'type' => 'boolean' ),
	),
);
eq(
	'nested json strings stay strings; WP-style string scalars are coerced',
	Schema::decode( $nested, '{"meta":"hello","n":"5","on":"1"}' ),
	array(
		'meta' => 'hello',
		'n'    => 5,
		'on'   => true,
	)
);

// ---------------------------------------------------------------- rules

problem( 'min length in code points', fn () => $write( $posts['title'], '', 'title' ), 422, 'invalid_input', '/title' );
eq( 'max length counts code points, not bytes', $write( $posts['title'], str_repeat( 'é', 120 ), 'title' ), str_repeat( 'é', 120 ) );
problem( 'integer bounds', fn () => $write( $settings['postsPerPage'], 51, 'postsPerPage' ), 422, 'invalid_input', '/postsPerPage' );
$e = problem( 'validate returns a message', fn () => $write( $comments['body'], 'see http://spam', 'body' ), 422, 'invalid_input', '/body' );
eq( 'validate message is the detail', $e?->getMessage(), 'No links in comments' );
$e = problem( 'min/max runs before validate', fn () => $write( $comments['body'], '', 'body' ), 422, 'invalid_input', '/body' );
check( '… so the length message wins', null !== $e && $e->getMessage() !== 'No links in comments', $e?->getMessage() );
$pattern = array(
	'type'  => 'text',
	'rules' => array(
		'pattern' => array(
			'source' => '^[A-Z]{3}$',
			'flags'  => '',
		),
	),
);
problem( 'pattern uses JS semantics', fn () => $write( $pattern, 'ABCD', 'code' ), 422, 'invalid_input', '/code' );
eq( 'pattern accepted', $write( $pattern, 'ABC', 'code' ), 'ABC' );

// ---------------------------------------------------------------- action input

eq(
	'action input: nested defaults + coercion',
	Schema::validateInput(
		array(
			'tags' => $posts['tags'],
			'seo'  => $posts['seo'],
		),
		array( 'seo' => array() )
	),
	array(
		'tags' => array(),
		'seo'  => array(
			'metaTitle'       => null,
			'metaDescription' => null,
			'noindex'         => false,
		),
	)
);

// SCF codec for nested booleans (SpacePress\Wp\Scf is pure here). SCF keeps an unchecked true_false as ''
// in the sub-field's meta row, and writes '' for null too: a notNull boolean reads it as false, a
// nullable one keeps it as null. Both row key forms (field key and core REST meta name) agree.
$scf_group = array(
	'type'   => 'group',
	'fields' => array(
		'req' => array(
			'type'    => 'boolean',
			'notNull' => true,
			'default' => array( 'value' => false ),
		),
		'opt' => array( 'type' => 'boolean' ),
	),
);
$scf_back  = static fn ( array $raw ) => Schema::decode( $scf_group, \SpacePress\Wp\Scf::toStorage( $scf_group, $raw, 'field_x' ) );
eq(
	'scf group: unchecked notNull toggle is false, unset nullable stays null',
	$scf_back(
		array(
			'field_x_req' => '',
			'field_x_opt' => '',
		)
	),
	array(
		'req' => false,
		'opt' => null,
	)
);
eq(
	'scf group: the same through core REST meta names',
	$scf_back(
		array(
			'sp_x_req' => '',
			'sp_x_opt' => '',
		)
	),
	array(
		'req' => false,
		'opt' => null,
	)
);
eq(
	'scf group: checked toggles are true',
	$scf_back(
		array(
			'field_x_req' => 1,
			'field_x_opt' => '1',
		)
	),
	array(
		'req' => true,
		'opt' => true,
	)
);

// ================================================================ comment policy (spec §2.3)
$raw           = require $fixture;
$with_comments = static function ( array $posts ) use ( $raw ): Schema {
	$raw['collections']['posts'] = $posts + $raw['collections']['posts'];
	return new Schema( $raw );
};
eq( 'comments off: no policy', $with_comments( array( 'comments' => false ) )->commentPolicy( 'posts' ), null );
eq(
	'an authored policy is read as compiled',
	$with_comments(
		array(
			'comments'      => true,
			'commentPolicy' => array(
				'guests'         => true,
				'moderation'     => 'all',
				'threaded'       => 1,
				'closeAfterDays' => 30,
				'types'          => array(),
			),
		)
	)->commentPolicy( 'posts' ),
	array(
		'guests'         => true,
		'moderation'     => 'all',
		'threaded'       => 1,
		'closeAfterDays' => 30,
		'types'          => array(),
	)
);

finish( 'schema_test' );
