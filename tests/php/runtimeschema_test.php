<?php

declare(strict_types=1);

/*
 * Runtime schema changes (docs/spec/spec.md §2.10) on an in-process WordPress: a field added to a
 * collection of a running site, stored as a numbered version, with no build.
 *
 * The site runs the compiled schema of tests/runtime-schema/base. Changes are applied in this
 * process; what they do is read back the way a client sees it, over HTTP from the harness's
 * `php -S`, because a version takes effect from the next request.
 */

use First\RuntimeSchema\Loader;
use First\RuntimeSchema\Refused;
use First\Wp\SchemaVersions;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$base = require dirname(__DIR__) . '/runtime-schema/base.schema.php';
$wp = wpSite('rtschema', ['schema' => $base, 'server' => true, 'muPlugins' => ['rtschema-propose' => <<<'PHP'
    <?php
    // Test only: proposes the posted change set in a fresh request, which sees the build as deployed now.
    add_action('init', static function (): void {
        if (parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH) !== '/__rtschema_propose') {
            return;
        }
        try {
            $out = [200, \First\Wp\SchemaVersions::of(\First\Wp\Runtime::plugin())->propose(json_decode((string) file_get_contents('php://input'), true))];
        } catch (\First\HttpError $e) {
            $out = [$e->status, ['code' => $e->errorCode, 'pointer' => $e->pointer]];
        }
        status_header($out[0]);
        header('Content-Type: application/json');
        echo json_encode($out[1]);
        exit;
    }, 99);
    PHP]]);
$api = $wp->url() . '/__first/api/v1';

/** @return array{int, mixed} status and decoded body, as $as (a test user name) or anonymous */
function http(string $method, string $url, mixed $body = null, ?string $as = null): array
{
    global $wp;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', ...($as === null ? [] : ['Authorization: Basic ' . base64_encode($wp->appPassword($as))])],
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
    }
    $res = curl_exec($ch);

    return [(int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), is_string($res) ? json_decode($res, true) : null];
}
$described = static fn (): array => http('GET', $GLOBALS['api'])[1]['data'];
$refusal = static function (callable $fn): string {
    try {
        $fn();

        return 'accepted';
    } catch (Refused $e) {
        return "$e->status {$e->verdict()} $e->pointer";
    }
};
$add = static fn (string $field, array $definition, string $kind = 'articles'): array => ['format' => 1, 'changes' => [['op' => 'addField', 'kind' => $kind, 'field' => $field, 'definition' => $definition]]];
$admin = ['user' => $wp->userId('admin'), 'login' => 'admin', 'via' => 'test'];

$versions = SchemaVersions::of($wp->plugin()) ?? throw new RuntimeException('the app set runtimeSchema: true');

// ================================================================ before any change
eq('a site starts at version 0', [$versions->active(), $versions->list()], [['version' => 0, 'hash' => ''], []]);
$d = $described();
eq('the API says which schema version it describes', $d['runtimeSchema'], ['version' => 0, 'hash' => '', 'build' => ['version' => 0, 'hash' => '']]);
check('the kind has the build\'s fields only', !isset($d['kinds']['articles']['columns']['subtitle']) && isset($d['kinds']['articles']['columns']['rating']), $d['kinds']['articles']);
[$status, $old] = http('POST', "$api/articles", ['title' => 'Written before the change'], 'editor');
eq('an item is created on the build\'s schema', $status, 201);
[$status, $problem] = http('POST', "$api/articles", ['title' => 'Too early', 'subtitle' => 'x'], 'editor');
eq('a field the schema doesn\'t have is refused', [$status, $problem['code'] ?? null, $problem['pointer'] ?? null], [422, 'invalid_input', '/subtitle']);

// ================================================================ propose writes nothing
$subtitle = $add('subtitle', ['rules' => ['max' => 20], 'type' => 'text', 'ui' => ['label' => 'Subtitle']]);
$proposal = $versions->propose($subtitle);
eq('a proposal names its parent and returns the change in stored form', [$proposal['parent'], $proposal['changes']],
    [0, [['op' => 'addField', 'kind' => 'articles', 'field' => 'subtitle', 'definition' => ['type' => 'text', 'rules' => ['max' => 20], 'ui' => ['label' => 'Subtitle']]]]]);
eq('and what it does to stored data', $proposal['effects'][0], ['op' => 'addField', 'kind' => 'articles', 'field' => 'subtitle', 'storage' => 'post meta first_subtitle on first_articles',
    'existingItems' => 1, 'note' => 'existing items have no value until they are edited']);
eq('a proposal stores nothing', [$versions->list(), get_option(Loader::option('rtschema'), 'absent')], [[], 'absent']);
check('nor does it change the schema requests see', !isset($described()['kinds']['articles']['columns']['subtitle']));

// ================================================================ refusals
eq('a field the build declares can\'t be redefined', $refusal(fn () => $versions->propose($add('rating', ['type' => 'text']))), '422 F3001 /changes/0/field');
eq('a rule the compiler has is refused with its code', $refusal(fn () => $versions->propose($add('subtitle', ['type' => 'text', 'rules' => ['min' => 9, 'max' => 2]]))), '422 F3001 /changes/0/definition');
eq('a table() kind is build-only', $refusal(fn () => $versions->propose($add('note', ['type' => 'text'], 'votes'))), '422 F3001 /changes/0/definition');
eq('removing a field the build declares is build-only', $refusal(fn () => $versions->propose(['format' => 1, 'changes' => [['op' => 'removeField', 'kind' => 'articles', 'field' => 'rating']]])), '422 schema_build_only /changes/0/field');
eq('renaming a field is build-only', $refusal(fn () => $versions->propose(['format' => 1, 'changes' => [['op' => 'renameField', 'kind' => 'articles', 'field' => 'rating', 'to' => 'stars']]])), '422 schema_build_only /changes/0/op');
eq('a required field needs a default', $refusal(fn () => $versions->propose($add('subtitle', ['type' => 'text', 'notNull' => true]))), '422 schema_required /changes/0/definition/notNull');
eq('refusals store nothing', $versions->list(), []);

// ================================================================ apply: version 1
$v1 = $versions->apply(0, $subtitle, $admin);
eq('the first change is version 1 on parent 0', [$v1['version'], $v1['parent'], $v1['format'], $v1['actor']], [1, 0, 1, $admin]);
eq('it records the build it was validated on', $v1['build'], hash_file('sha256', "$wp->content/plugins/first-app-rtschema/first/app/schema.php"));
check('and when', preg_match('/\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z\z/', $v1['createdAt']) === 1, $v1['createdAt']);
eq('the stored version reads back as it was applied', $versions->list(), [$v1]);
eq('its hash covers the row and the parent\'s hash', $v1['hash'], SchemaVersions::hashOf('', $v1));

$d = $described();
eq('the next request describes version 1', $d['runtimeSchema'], ['version' => 1, 'hash' => $v1['hash'], 'build' => ['version' => 0, 'hash' => '']]);
eq('with the new field as stored', $d['kinds']['articles']['columns']['subtitle'], ['type' => 'text', 'rules' => ['max' => 20], 'ui' => ['label' => 'Subtitle']]);
[$status, $new] = http('POST', "$api/articles", ['title' => 'Written after', 'subtitle' => 'Now it fits'], 'editor');
eq('a write takes the new field', [$status, $new['data']['subtitle'] ?? null], [201, 'Now it fits']);
[$status, $problem] = http('POST', "$api/articles", ['title' => 'Too long', 'subtitle' => str_repeat('s', 21)], 'editor');
eq('and its rule is enforced', [$status, $problem['code'] ?? null, $problem['pointer'] ?? null], [422, 'invalid_input', '/subtitle']);
$before = http('GET', "$api/articles/{$old['data']['id']}")[1]['data'];
eq('an item written before the change reads the field as empty', [array_key_exists('subtitle', $before), $before['subtitle'] ?? null], [true, null]);
[$status, $patched] = http('PATCH', "$api/articles/{$old['data']['id']}", ['subtitle' => 'Added later'], 'editor');
eq('and takes a value', [$status, $patched['data']['subtitle'] ?? null], [200, 'Added later']);
eq('the value is post meta under the field\'s name', $wp->scalar("SELECT meta_value FROM {prefix}postmeta WHERE post_id = ? AND meta_key = 'first_subtitle'", [$new['data']['id']]), 'Now it fits');
[$status, $core] = http('GET', $wp->url() . "/wp-json/wp/v2/first_articles/{$new['data']['id']}?context=edit", null, 'editor');
eq('core REST serves it as registered meta', [$status, $core['meta']['subtitle'] ?? null], [200, 'Now it fits']);
[$status, $core] = http('POST', $wp->url() . "/wp-json/wp/v2/first_articles/{$new['data']['id']}", ['meta' => ['subtitle' => str_repeat('s', 21)]], 'editor');
eq('and core REST enforces the rule too', $status, 422);
[$status, $types] = http('GET', $wp->url() . '/wp-json/wp/v2/first_articles/' . $new['data']['id'] . '?context=edit&_fields=acf', null, 'editor');
check('the editor\'s field group has the field', array_key_exists('first_subtitle', $types['acf'] ?? []), $types);

// ================================================================ two changes on one parent
eq('a second change on the same parent is a 409', $refusal(fn () => $versions->apply(0, $add('stars', ['type' => 'integer']), $admin)), '409 schema_conflict /parent');
eq('and stores nothing', count($versions->list()), 1);
eq('a name an earlier version added is taken', $refusal(fn () => $versions->apply(1, $add('subtitle', ['type' => 'text']), $admin)), '422 F3001 /changes/0/field');
$v2 = $versions->apply(1, $add('stars', ['type' => 'integer', 'notNull' => true, 'default' => ['value' => 3], 'rules' => ['min' => 1, 'max' => 5]]), $admin);
eq('proposed again on the new parent it is version 2, chained to version 1', [$v2['version'], $v2['parent'], $v2['hash']], [2, 1, SchemaVersions::hashOf($v1['hash'], $v2)]);
[$status, $defaulted] = http('POST', "$api/articles", ['title' => 'Defaulted'], 'editor');
eq('a default applies to new items', [$status, $defaulted['data']['stars'] ?? null], [201, 3]);

// Two processes apply on the same parent at the same moment: one becomes the next version, the other gets the 409.
$script = "$wp->dir/apply.php";
file_put_contents($script, '<?php
require ' . var_export(__DIR__ . '/wp.php', true) . ';
$dir = ' . var_export($wp->dir, true) . ';
$site = json_decode((string) file_get_contents("$dir/site.json"), true, 512, JSON_THROW_ON_ERROR);
wpDefine($dir, $site["url"]);
$_SERVER["REQUEST_METHOD"] = "GET";
require_once ABSPATH . "wp-settings.php";
$versions = \First\Wp\SchemaVersions::of(\First\Wp\Runtime::plugin());
fwrite(STDOUT, "ready\n");
// Both processes are loaded and waiting here until the test lets go of the gate.
flock(fopen("$dir/gate", "c"), LOCK_SH);
try {
    $row = $versions->apply(2, ["format" => 1, "changes" => [["op" => "addField", "kind" => "articles", "field" => $argv[1], "definition" => ["type" => "text"]]]], ["user" => 1, "login" => "admin", "via" => "test"]);
    echo json_encode(["version" => $row["version"], "field" => $argv[1]]), "\n";
} catch (\First\RuntimeSchema\Refused $e) {
    echo json_encode(["status" => $e->status, "code" => $e->errorCode]), "\n";
}
');
$gate = fopen("$wp->dir/gate", 'c');
flock($gate, LOCK_EX);
$children = [];
foreach (['left', 'right'] as $field) {
    $process = proc_open([PHP_BINARY, '-d', 'memory_limit=512M', $script, $field], [1 => ['pipe', 'w'], 2 => ['file', "$wp->dir/apply-$field.log", 'a']], $pipes);
    $children[$field] = [$process, $pipes[1]];
}
foreach ($children as [, $out]) {
    fgets($out) === "ready\n" || throw new RuntimeException('a concurrent writer did not start');
}
flock($gate, LOCK_UN);
$outcomes = [];
foreach ($children as $field => [$process, $out]) {
    $outcomes[] = json_decode((string) stream_get_contents($out), true);
    proc_close($process);
}
usort($outcomes, static fn (array $a, array $b): int => isset($b['version']) <=> isset($a['version']));
check('of two concurrent changes on one parent, one is version 3 and the other is refused with a 409',
    ($outcomes[0]['version'] ?? null) === 3 && $outcomes[1] === ['status' => 409, 'code' => 'schema_conflict'], $outcomes);
$rows = $versions->list();
eq('exactly one of them was stored', [count($rows), $rows[2]['changes'][0]['field']], [3, $outcomes[0]['field']]);
$winner = $outcomes[0]['field'];

// ================================================================ the option is a copy of the versions
delete_option(Loader::option('rtschema'));
check('without its option the site serves the build\'s schema', !isset($described()['kinds']['articles']['columns']['subtitle']));
$v4 = $versions->apply(3, $add('teaser', ['type' => 'text', 'multiline' => true]), $admin);
$columns = $described()['kinds']['articles']['columns'];
check('the next change rebuilds it from the stored versions', $v4['version'] === 4 && isset($columns['subtitle'], $columns['stars'], $columns[$winner], $columns['teaser']), array_keys($columns));
eq('and the stored value is still there', http('GET', "$api/articles/{$new['data']['id']}")[1]['data']['subtitle'], 'Now it fits');

// ================================================================ a build deployed over runtime changes
// A build that declares the field itself (as it would after `first pull`, here with a tighter rule): its declaration is used.
$declares = $base;
$declares['collections']['articles']['columns']['subtitle'] = ['type' => 'text', 'rules' => ['max' => 5]];
$wp->writeSchema($declares);
$d = $described();
eq('a build that declares a runtime field uses its own declaration', $d['kinds']['articles']['columns']['subtitle'], ['type' => 'text', 'rules' => ['max' => 5]]);
eq('and still gets the fields it doesn\'t declare', isset($d['kinds']['articles']['columns']['stars'], $d['kinds']['articles']['columns']['teaser']), true);
[$status] = http('PATCH', "$api/articles/{$new['data']['id']}", ['subtitle' => 'Longer than five'], 'editor');
eq('the build\'s rule is the one enforced', $status, 422);
eq('the value stored under the runtime field is the build\'s field\'s value', http('GET', "$api/articles/{$new['data']['id']}")[1]['data']['subtitle'], 'Now it fits');

// A build that declares a relation under a runtime field's name: the relation is used, the field's data stays.
$related = $base;
$related['collections']['articles']['relations']['stars'] = ['kind' => 'many', 'collection' => 'votes', 'from' => 'id', 'to' => 'article', 'optional' => false];
$wp->writeSchema($related);
$columns = $described()['kinds']['articles']['columns'];
check('a build\'s relation wins over a runtime field of the same name', !isset($columns['stars']) && isset($columns['teaser']), array_keys($columns));
eq('and the field\'s stored values are untouched', $wp->scalar("SELECT meta_value FROM {prefix}postmeta WHERE post_id = ? AND meta_key = 'first_stars'", [$defaulted['data']['id']]), '3');

// A build without the runtime changes (the project was not pulled): nothing is dropped.
$wp->writeSchema($base);
$d = $described();
eq('a build without the runtime fields keeps them', [$d['runtimeSchema']['version'], $d['kinds']['articles']['columns']['subtitle']], [4, ['type' => 'text', 'rules' => ['max' => 20], 'ui' => ['label' => 'Subtitle']]]);
eq('and their data', http('GET', "$api/articles/{$new['data']['id']}")[1]['data']['subtitle'], 'Now it fits');

// A build that drops the collection: the versions stay, and its fields have nowhere to go.
$without = $base;
unset($without['collections']['articles']);
$wp->writeSchema($without);
eq('a build without the kind serves without it', [isset($described()['kinds']['articles']), count($versions->list())], [false, 4]);

// ================================================================ the flag off
$off = $base;
unset($off['runtimeSchema']);
$wp->writeSchema($off);
$d = $described();
check('with the flag off the schema is the build\'s alone', !isset($d['runtimeSchema']) && !isset($d['kinds']['articles']['columns']['subtitle']) && isset($d['kinds']['articles']['columns']['rating']), $d['kinds']['articles']['columns']);
[$status] = http('POST', "$api/articles", ['title' => 'Flag off', 'subtitle' => 'x'], 'editor');
eq('and a runtime field is unknown again', $status, 422);
eq('its stored values and versions are untouched', [$wp->scalar("SELECT meta_value FROM {prefix}postmeta WHERE post_id = ? AND meta_key = 'first_subtitle'", [$new['data']['id']]), count($versions->list())], ['Now it fits', 4]);
$wp->writeSchema($base);
eq('turning the flag back on brings the fields and values back', http('GET', "$api/articles/{$new['data']['id']}")[1]['data']['subtitle'], 'Now it fits');

// ================================================================ new kinds, labels, removal and rollback
$set = static fn (array ...$changes): array => ['format' => 1, 'changes' => $changes];
$count = static fn (): int => count($GLOBALS['versions']->list());
$next = $count();
$kindsVersion = $versions->apply($next, $set(
    ['op' => 'addCollection', 'kind' => 'events', 'definition' => ['label' => 'Events', 'access' => ['create' => 'author'], 'fields' => ['title' => ['type' => 'text', 'notNull' => true, 'rules' => ['max' => 60]], 'content' => ['type' => 'richText'], 'starts' => ['type' => 'date']]]],
    ['op' => 'addGlobal', 'global' => 'banner', 'definition' => ['access' => ['update' => 'admin'], 'fields' => ['text' => ['type' => 'text'], 'on' => ['type' => 'boolean', 'notNull' => true, 'default' => ['value' => false]]]]],
), $admin);
$d = $described();
eq('a collection added at runtime is a kind with its route', [$d['kinds']['events']['route'] ?? null, $d['kinds']['events']['label'] ?? null, array_keys($d['kinds']['events']['columns'] ?? [])],
    ['/wp/v2/first_events', 'Events', ['id', 'title', 'content', 'starts', 'status', 'publishedAt']]);
eq('and a global added at runtime is a global', array_keys($d['globals']['banner']['fields'] ?? []), ['text', 'on']);
$tables = static fn (): array => array_merge(...array_map('array_values', $GLOBALS['wp']->sql('SHOW TABLES')));
check('no SQL table was created for either', array_filter($tables(), static fn (string $t): bool => str_contains($t, 'first_events') || str_contains($t, 'banner')) === [], $tables());
[$status, $event] = http('POST', "$api/events", ['title' => 'Launch', 'content' => '<p>Doors at seven.</p>', 'starts' => '2027-03-01'], 'author');
eq('its access rule lets an author create', [$status, $event['data']['title'] ?? null, $event['data']['starts'] ?? null], [201, 'Launch', '2027-03-01']);
eq('and refuses a subscriber', http('POST', "$api/events", ['title' => 'No'], 'subscriber')[0], 403);
eq('its field rules are enforced', http('POST', "$api/events", ['title' => str_repeat('t', 61)], 'author')[0], 422);
eq('an item is a post of the kind\'s type, title and body in core\'s columns', $wp->sql('SELECT post_type, post_title, post_content FROM {prefix}posts WHERE ID = ?', [$event['data']['id']]),
    [['post_type' => 'first_events', 'post_title' => 'Launch', 'post_content' => '<p>Doors at seven.</p>']]);
eq('anyone reads it', http('GET', "$api/events/{$event['data']['id']}")[1]['data']['title'] ?? null, 'Launch');
eq('the global reads its defaults', http('GET', "$api/banner")[1]['data'] ?? null, ['text' => null, 'on' => false]);
eq('an editor may not update it', http('PATCH', "$api/banner", ['on' => true], 'editor')[0], 403);
eq('an admin may', http('PATCH', "$api/banner", ['text' => 'Sale', 'on' => true], 'admin')[1]['data'] ?? null, ['text' => 'Sale', 'on' => true]);

// Names that are taken.
eq('a collection named like the build\'s is refused', $refusal(fn () => $versions->propose($set(['op' => 'addCollection', 'kind' => 'articles', 'definition' => ['fields' => ['title' => ['type' => 'text', 'notNull' => true]]]]))), '422 F3001 /changes/0/kind');
eq('and one named like a kind every site has', $refusal(fn () => $versions->propose($set(['op' => 'addCollection', 'kind' => 'posts', 'definition' => ['fields' => ['title' => ['type' => 'text', 'notNull' => true]]]]))), '422 schema_reserved /changes/0/kind');

// Fields, a label and presentation on the new kinds; then all of it rolled back as a new version.
$grown = $versions->apply($count(), $set(
    ['op' => 'addField', 'kind' => 'events', 'field' => 'venue', 'definition' => ['type' => 'text']],
    ['op' => 'setLabel', 'kind' => 'events', 'label' => 'What\'s on'],
    ['op' => 'setFieldUi', 'kind' => 'articles', 'field' => 'rating', 'ui' => ['label' => 'Stars', 'width' => 50]],
    ['op' => 'setLabel', 'kind' => 'articles', 'label' => 'Stories'],
), $admin);
$d = $described();
eq('a label and presentation replace the build\'s; the field\'s type does not move', [$d['kinds']['events']['label'], $d['kinds']['articles']['label'], $d['kinds']['articles']['columns']['rating']],
    ['What\'s on', 'Stories', ['type' => 'integer', 'ui' => ['label' => 'Stars', 'width' => 50]]]);
eq('the new field takes a value', http('PATCH', "$api/events/{$event['data']['id']}", ['venue' => 'Town hall'], 'editor')[1]['data']['venue'] ?? null, 'Town hall');

$reversal = $versions->reversal($grown['version']);
eq('the reversal of a version is its changes undone, newest first', array_column($reversal['changes'], 'op'), ['setLabel', 'setFieldUi', 'setLabel', 'removeField']);
$rolledBack = $versions->apply($count(), $reversal, $admin);
eq('a rollback is a new version; the one it reverses is still stored', [$rolledBack['version'], $rolledBack['parent'], $versions->list()[$grown['version'] - 1]['hash']], [$grown['version'] + 1, $grown['version'], $grown['hash']]);
$d = $described();
eq('after it the schema is the one before that version', [$d['kinds']['events']['label'], $d['kinds']['articles']['label'], $d['kinds']['articles']['columns']['rating'], isset($d['kinds']['events']['columns']['venue'])],
    ['Events', 'Articles', ['type' => 'integer'], false]);
eq('the hidden field\'s value is still stored', $wp->scalar("SELECT meta_value FROM {prefix}postmeta WHERE post_id = ? AND meta_key = 'first_venue'", [$event['data']['id']]), 'Town hall');
eq('it can\'t come back as another type', $refusal(fn () => $versions->propose($set(['op' => 'addField', 'kind' => 'events', 'field' => 'venue', 'definition' => ['type' => 'integer']]))), '422 schema_retype /changes/0/definition/type');
$versions->apply($count(), $set(['op' => 'addField', 'kind' => 'events', 'field' => 'venue', 'definition' => ['type' => 'text']]), $admin);
eq('added again as the same type, its value is there', http('GET', "$api/events/{$event['data']['id']}")[1]['data']['venue'] ?? null, 'Town hall');

// Removing a kind hides it; nothing is dropped.
$removed = $versions->propose($set(['op' => 'removeCollection', 'kind' => 'events'], ['op' => 'removeGlobal', 'global' => 'banner']));
eq('a proposal to remove a collection says how many items it hides', [$removed['effects'][0]['existingItems'], $removed['effects'][0]['note']], [1, 'hidden from the schema; its items stay in post type first_events and come back if the collection is added again']);
$removal = $versions->apply($count(), $set(['op' => 'removeCollection', 'kind' => 'events'], ['op' => 'removeGlobal', 'global' => 'banner']), $admin);
$d = $described();
eq('a removed kind is gone from the schema and the API', [isset($d['kinds']['events']), isset($d['globals']['banner']), http('GET', "$api/events")[0]], [false, false, 404]);
eq('its items and values are kept', [$wp->scalar("SELECT COUNT(*) FROM {prefix}posts WHERE post_type = 'first_events' AND post_status = 'publish'"), $wp->scalar("SELECT option_value FROM {prefix}options WHERE option_name = 'first_global_banner_text'")], [1, 'Sale']);
eq('removing a kind the build declares is build-only', $refusal(fn () => $versions->propose($set(['op' => 'removeCollection', 'kind' => 'articles']))), '422 schema_build_only /changes/0/kind');
$versions->apply($count(), $versions->reversal($removal['version']), $admin);
$back = http('GET', "$api/events/{$event['data']['id']}")[1]['data'] ?? [];
eq('rolling the removal back brings the kind and its item back, later field included', [$back['title'] ?? null, $back['starts'] ?? null, $back['venue'] ?? null], ['Launch', '2027-03-01', 'Town hall']);
eq('and the global with its values', http('GET', "$api/banner")[1]['data'] ?? null, ['text' => 'Sale', 'on' => true]);
problem('a version that doesn\'t exist has no reversal', fn () => $versions->reversal(999), 404, 'not_found');

// A build that declares a kind the site added (after `first pull`): the build's is used.
$declared = $base;
$declared['collections']['events'] = ['label' => 'From the build'] + \First\RuntimeSchema\Kinds::expandCollection('events', ['fields' => ['title' => ['type' => 'text', 'notNull' => true], 'content' => ['type' => 'richText'], 'starts' => ['type' => 'date']]]);
$wp->writeSchema($declared);
$d = $described();
eq('a build that declares a runtime kind uses its own declaration and keeps the runtime field on it', [$d['kinds']['events']['label'], isset($d['kinds']['events']['columns']['venue'])], ['From the build', true]);
eq('the item is the same post', http('GET', "$api/events/{$event['data']['id']}")[1]['data']['title'] ?? null, 'Launch');
// (This process loaded the build before that update, so it asks a fresh one, as a request would.)
[$status, $inUse] = http('POST', $wp->url() . '/__rtschema_propose', $set(['op' => 'removeCollection', 'kind' => 'events']));
eq('a kind the build declares can\'t be removed at runtime, whoever added it', [$status, $inUse['code'] ?? null, $inUse['pointer'] ?? null], [422, 'schema_in_use', '/changes/0/kind']);
$wp->writeSchema($base);

// ================================================================ a format this runtime doesn't know
$state = get_option(Loader::option('rtschema'));
update_option(Loader::option('rtschema'), ['format' => 2] + $state, true);
$d = $described();
check('a state in a newer format isn\'t guessed at: the site serves the build\'s schema', !isset($d['kinds']['articles']['columns']['subtitle']) && !isset($d['kinds']['events']), array_keys($d['kinds']));
update_option(Loader::option('rtschema'), $state, true);
check('and the known format loads again', isset($described()['kinds']['articles']['columns']['subtitle']));

finish('runtimeschema');
