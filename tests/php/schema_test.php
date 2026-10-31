<?php

declare(strict_types=1);

/*
 * Schema codecs (§3.4) and rules (§1.2) as pure functions, on the blog fixture's column shapes.
 * Validators come from the fixture's functions.php.
 */

require __DIR__ . '/../../runtime/Zero/bootstrap.php';
require __DIR__ . '/../fixtures/blog/functions.php';
require __DIR__ . '/harness.php';

use Zero\Schema;

$fixture = __DIR__ . '/../fixtures/blog/schema.php';
$schema = Schema::load($fixture);
eq('PHP platform policy matches the shared golden', \Zero\Wp\Platform::requirements(), json_decode(file_get_contents(__DIR__ . '/../fixtures/platform.json'), true, 512, JSON_THROW_ON_ERROR));
$posts = $schema->collection('posts')['columns'];
$comments = $schema->collection('comments')['columns'];
$settings = $schema->global('settings')['fields'];
$ctx = ['data' => [], 'user' => null, 'target' => 'standalone'];

/** normalize + rules, like the write pipeline does for one column. */
$write = static function (array $col, mixed $v, string $name) use ($ctx): mixed {
    $n = Schema::normalize($col, $v, $name, '/' . $name);
    Schema::checkRules($col, $n, $name, '/' . $name, $ctx);

    return $n;
};

// ---------------------------------------------------------------- load

$tmp = tempnam(sys_get_temp_dir(), 'zs');
foreach ([
    ['version' => 2, 'runtime' => '0.2'],
    ['version' => 3, 'runtime' => '0.1'],
    ['version' => 3],
] as $raw) {
    file_put_contents($tmp, '<?php return ' . var_export($raw, true) . ';');
    try {
        Schema::load($tmp);
        check('incompatible schema is refused', false);
    } catch (RuntimeException $e) {
        $expected = $raw['version'] !== 3 ? 'schema.php version 3 required'
            : 'schema.php built for runtime ' . ($raw['runtime'] ?? '(missing)') . '; this runtime is 0.2';
        eq('incompatible schema is refused', $e->getMessage(), $expected);
    }
}
unlink($tmp);
eq('v3 reader reports its contract', [$schema->version(), $schema->runtime()], [3, '0.2']);

$phase2Raw = json_decode(file_get_contents(__DIR__ . '/../fixtures/phase2.schema.json'), true, 512, JSON_THROW_ON_ERROR);
$phase2 = new Schema($phase2Raw);
foreach (['site', 'locales', 'media', 'files', 'auth', 'jobs', 'webhooks'] as $key) {
    eq("v3 $key passes through", $phase2->$key(), $phase2Raw[$key]);
}
eq('v3 nested column metadata passes through', $phase2->collection('posts'), $phase2Raw['collections']['posts']);
eq('v3 describes field rules without function names', $phase2->describe()['collections']['authors']['columns']['email']['access'], ['read' => 'editor', 'create' => 'anyone', 'update' => 'rule']);
eq('v3 describes safe file metadata', $phase2->describe()['files']['decks'], ['accept' => ['application/pdf', 'image/*'], 'maxBytes' => 20000000]);
eq('v3 self summary', $phase2->describe()['collections']['members']['access']['read'], 'self');
$described = $phase2->describe();
eq('standalone /_schema omits agents: false entries (§7.1)', [array_keys($described['collections']), array_keys($described['globals']), array_keys($described['actions'])],
    [['authors', 'posts', 'members'], [], ['widened']]);

$described = json_encode($schema->describe());
check('describe hides function names, hooks and wp identifiers',
    !str_contains($described, '__') && !str_contains($described, 'hooks') && !str_contains($described, 'postType') && !str_contains($described, 'handler'),
    $described);
eq('describe summarises access', [$schema->describe()['collections']['posts']['access'], $schema->describe()['actions']['publishedCount']['access']],
    [['read' => 'rule', 'create' => 'author', 'update' => 'rule', 'delete' => 'editor'], 'anyone']);

// ---------------------------------------------------------------- scalar formats

// Timestamps: epoch ms or ISO 8601 with Z/±HH:MM, every component a real calendar/clock value.
$at = $schema->collection('posts')['columns']['createdAt'];
eq('timestamp boundaries accepted (leap day, year 0000, negative offset, long fraction, bare date)', array_map(
    fn ($v) => Schema::encode($at, $v, 'createdAt', '/createdAt'),
    ['2024-02-29T23:59:59.999Z', '0000-02-29T00:00:00Z', '2026-01-01T00:00:00-00:30', '2026-01-01T00:00:00.123456Z', '2026-01-31'],
), ['2024-02-29T23:59:59.999Z', '0000-02-29T00:00:00.000Z', '2026-01-01T00:30:00.000Z', '2026-01-01T00:00:00.123Z', '2026-01-31T00:00:00.000Z']);
// ...and the other ISO 8601 spellings sources such as Sanity accepted: week, ordinal, reduced and
// compact forms, expanded years, space separators, comma and fractional-minute fractions, colonless offsets.
foreach (['now', '+1 week', '10/30/2026', '2026-01-01 tomorrow', '2026-01-01T00:00:00Z +1 year', '2026-01-01T10:00:00', '2026-01-01T24:00:00Z', '2026-01-01T00:00:00+24:00', '2026-01-01T00:00Z00:00', '2026-02-30T00:00:00Z', '9999-12-31T23:59:59-00:30', '0000-01-01T00:00:00+00:30', 253402300800000,
    '2026-W05-3', '2026-032', '2026-01', '20260101', '2026-01-01T103000+02:00', '+002026-01-01T10:00:00Z', '2026-01-01 10:00:00Z', '2026-01-01T10:00:00,5Z', '2026-01-01T10:30.5Z', '2026-01-01T10:00:00+0200'] as $bad) {
    problem("timestamp rejected: " . json_encode($bad), fn () => Schema::encode($at, $bad, 'createdAt', '/createdAt'), 422, 'invalid_input', '/createdAt');
}

$email = $schema->collection('authors')['columns']['email'];
eq('email accepted', Schema::encode($email, 'a.b@example.com', 'email', '/email'), 'a.b@example.com');
problem('email rejected', fn () => Schema::encode($email, 'not-an-email', 'email', '/email'), 422, 'invalid_input', '/email');
$url = $settings['social']['fields']['href'];
eq('http(s) url accepted', Schema::encode($url, 'https://example.com/x?y=1', 'href', '/href'), 'https://example.com/x?y=1');
problem('non-http url rejected', fn () => Schema::encode($url, 'ftp://example.com', 'href', '/href'), 422, 'invalid_input', '/href');
eq('slug accepted', Schema::encode($posts['slug'], 'a-1-b', 'slug', '/slug'), 'a-1-b');
problem('slug with a double hyphen rejected', fn () => Schema::encode($posts['slug'], 'a--b', 'slug', '/slug'), 422, 'invalid_input', '/slug');
problem('slug over 200 characters rejected', fn () => Schema::encode($posts['slug'], str_repeat('a', 201), 'slug', '/slug'), 422, 'invalid_input', '/slug');
eq('media stores an int id', [Schema::encode($posts['cover'], 7.0, 'cover', '/cover'), Schema::decode($posts['cover'], 7)], [7, 7]);
$deck = $phase2->collection('posts')['columns']['deck'];
eq('file stores an int id and decodes string storage', [Schema::encode($deck, 7, 'deck', '/deck'), Schema::encode($deck, 7.0, 'deck', '/deck'), Schema::decode($deck, '7')], [7, 7, 7]);
$e = problem('file rejects string input at the field pointer', fn () => Schema::encode($deck, '7', 'deck', '/deck'), 422, 'invalid_input', '/deck');
eq('file input describes the expected value', $e?->getMessage(), 'deck must be a file id');

// ---------------------------------------------------------------- lists

eq('select multiple round-trips as JSON', [Schema::encode($posts['tags'], ['news', 'guide'], 'tags', '/tags'), Schema::decode($posts['tags'], '["news","guide"]')], ['["news","guide"]', ['news', 'guide']]);
problem('select item outside the options, pointer at the item', fn () => Schema::encode($posts['tags'], ['news', 'gossip'], 'tags', '/tags'), 422, 'invalid_input', '/tags/1');
problem('select duplicates rejected', fn () => Schema::encode($posts['tags'], ['news', 'news'], 'tags', '/tags'), 422, 'invalid_input', '/tags/1');
problem('select multiple needs a list', fn () => Schema::encode($posts['tags'], 'news', 'tags', '/tags'), 422, 'invalid_input', '/tags');
$photos = ['type' => 'mediaList', 'rules' => ['max' => 2]];
eq('mediaList round-trips', Schema::decode($photos, Schema::encode($photos, [1, 2.0], 'photos', '/photos')), [1, 2]);
problem('mediaList count max', fn () => $write($photos, [1, 2, 3], 'photos'), 422, 'invalid_input', '/photos');

// ---------------------------------------------------------------- group / repeater / blocks

eq('group: absent optional → null, absent defaulted → default, every sub-key present',
    Schema::decode($posts['seo'], Schema::encode($posts['seo'], ['metaTitle' => 'T'], 'seo', '/seo')),
    ['metaTitle' => 'T', 'metaDescription' => null, 'noindex' => false]);
problem('group: unknown sub-field', fn () => Schema::encode($posts['seo'], ['nope' => 1], 'seo', '/seo'), 422, 'invalid_input', '/seo/nope');
problem('group: sub-field type', fn () => Schema::encode($posts['seo'], ['noindex' => 'yes'], 'seo', '/seo'), 422, 'invalid_input', '/seo/noindex');
problem('group: sub-field rule (max), nested pointer', fn () => $write($posts['seo'], ['metaTitle' => str_repeat('x', 71)], 'seo'), 422, 'invalid_input', '/seo/metaTitle');

$gallery = [['image' => 1, 'caption' => 'a'], ['image' => 2]];
eq('repeater round-trips with every sub-key', Schema::decode($posts['gallery'], Schema::encode($posts['gallery'], $gallery, 'gallery', '/gallery')),
    [['image' => 1, 'caption' => 'a'], ['image' => 2, 'caption' => null]]);
problem('repeater: required sub-field per item', fn () => Schema::encode($posts['gallery'], [['image' => 1], ['caption' => 'x']], 'gallery', '/gallery'), 422, 'invalid_input', '/gallery/1/image');
problem('repeater: sub-field rule deep pointer', fn () => $write($posts['gallery'], [['image' => 1], ['image' => 2], ['image' => 3, 'caption' => str_repeat('c', 121)]], 'gallery'), 422, 'invalid_input', '/gallery/2/caption');
problem('repeater: item count max', fn () => $write($posts['gallery'], array_fill(0, 13, ['image' => 1]), 'gallery'), 422, 'invalid_input', '/gallery');
problem('repeater: items must be objects', fn () => Schema::encode($posts['gallery'], [1], 'gallery', '/gallery'), 422, 'invalid_input', '/gallery/0');

$sections = [['layout' => 'quote', 'text' => 'Hi'], ['layout' => 'hero', 'heading' => 'H', 'image' => 3]];
eq('blocks: layout kept first, every layout sub-key present', Schema::decode($posts['sections'], Schema::encode($posts['sections'], $sections, 'sections', '/sections')),
    [['layout' => 'quote', 'text' => 'Hi', 'cite' => null], ['layout' => 'hero', 'heading' => 'H', 'image' => 3]]);
problem('blocks: unknown layout', fn () => Schema::encode($posts['sections'], [['layout' => 'video']], 'sections', '/sections'), 422, 'invalid_input', '/sections/0/layout');
problem('blocks: field of another layout is unknown', fn () => Schema::encode($posts['sections'], [['layout' => 'quote', 'text' => 'x', 'heading' => 'y']], 'sections', '/sections'), 422, 'invalid_input', '/sections/0/heading');
eq('media refs found through nested values', Schema::mediaRefs($posts['sections'], Schema::normalize($posts['sections'], $sections, 'sections', '/sections'), '/sections'),
    [[3, '/sections/1/image', 'image']]);

$nested = ['type' => 'group', 'fields' => ['meta' => ['type' => 'json'], 'n' => ['type' => 'integer'], 'on' => ['type' => 'boolean']]];
eq('nested json strings stay strings; WP-style string scalars are coerced',
    Schema::decode($nested, '{"meta":"hello","n":"5","on":"1"}'), ['meta' => 'hello', 'n' => 5, 'on' => true]);

// ---------------------------------------------------------------- rules

problem('min length in code points', fn () => $write($posts['title'], '', 'title'), 422, 'invalid_input', '/title');
eq('max length counts code points, not bytes', $write($posts['title'], str_repeat('é', 120), 'title'), str_repeat('é', 120));
problem('integer bounds', fn () => $write($settings['postsPerPage'], 51, 'postsPerPage'), 422, 'invalid_input', '/postsPerPage');
$e = problem('validate returns a message', fn () => $write($comments['body'], 'see http://spam', 'body'), 422, 'invalid_input', '/body');
eq('validate message is the detail', $e?->getMessage(), 'No links in comments');
$e = problem('min/max runs before validate', fn () => $write($comments['body'], '', 'body'), 422, 'invalid_input', '/body');
check('… so the length message wins', $e !== null && $e->getMessage() !== 'No links in comments', $e?->getMessage());
$pattern = ['type' => 'text', 'rules' => ['pattern' => ['source' => '^[A-Z]{3}$', 'flags' => '']]];
problem('pattern uses JS semantics', fn () => $write($pattern, 'ABCD', 'code'), 422, 'invalid_input', '/code');
eq('pattern accepted', $write($pattern, 'ABC', 'code'), 'ABC');

// ---------------------------------------------------------------- action input

eq('action input: nested defaults + coercion', Schema::validateInput(['tags' => $posts['tags'], 'seo' => $posts['seo']], ['seo' => []]),
    ['tags' => [], 'seo' => ['metaTitle' => null, 'metaDescription' => null, 'noindex' => false]]);

finish('schema_test');
