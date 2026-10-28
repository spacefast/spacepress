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
file_put_contents($tmp, "<?php return ['collections' => []];");
try {
    Schema::load($tmp);
    check('v1 schema.php is refused', false);
} catch (RuntimeException $e) {
    eq('v1 schema.php is refused', $e->getMessage(), 'schema.php version 2 required');
}
unlink($tmp);

$described = json_encode($schema->describe());
check('describe hides function names, hooks and wp identifiers',
    !str_contains($described, '__') && !str_contains($described, 'hooks') && !str_contains($described, 'postType') && !str_contains($described, 'handler'),
    $described);
eq('describe summarises access', [$schema->describe()['collections']['posts']['access'], $schema->describe()['actions']['publishedCount']['access']],
    [['read' => 'rule', 'create' => 'author', 'update' => 'rule', 'delete' => 'editor'], 'anyone']);

// ---------------------------------------------------------------- scalar formats

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
