<?php

declare(strict_types=1);

// Lane M: mapping an original Zero (0.8) release onto the new app's schema (Zero\Wp\Legacy\Model).
// Pure logic; the data migration itself is proven against real WordPress in tests/wp/legacy.

require __DIR__ . '/../../runtime/Zero/bootstrap.php';
require __DIR__ . '/harness.php';

use Zero\HttpError;
use Zero\Schema;
use Zero\Wp\Legacy\Model;
use Zero\Wp\Legacy\Users;

// The release the original compiler produced for tests/wp/legacy/capsule.ts.
$release = require __DIR__ . '/../wp/legacy/content-model.php';
$schema = static fn (array $overrides = []) => new Schema(['version' => 3, 'runtime' => Schema::SERIES, 'collections' => array_replace_recursive([
    'projects' => ['editor' => true, 'title' => 'title', 'primaryKey' => 'id', 'wp' => ['postType' => 'zero_projects', 'metaPrefix' => 'zero_', 'fieldKeyPrefix' => 'field_zero_projects_'], 'columns' => [
        'id' => ['type' => 'integer', 'primaryKey' => true], 'title' => ['type' => 'text', 'notNull' => true],
        'budget' => ['type' => 'real'], 'active' => ['type' => 'boolean'], 'kickoff' => ['type' => 'timestamp'],
        'stage' => ['type' => 'text', 'enum' => ['idea', 'live', 'done']], 'tags' => ['type' => 'select', 'enum' => ['red', 'green', 'blue']],
        'cover' => ['type' => 'media'], 'gallery' => ['type' => 'mediaList'],
    ]],
    'tasks' => ['editor' => true, 'title' => 'title', 'primaryKey' => 'id', 'wp' => ['postType' => 'zero_tasks', 'metaPrefix' => 'zero_', 'fieldKeyPrefix' => 'field_zero_tasks_'], 'columns' => [
        'id' => ['type' => 'integer', 'primaryKey' => true], 'title' => ['type' => 'text', 'notNull' => true], 'notes' => ['type' => 'text'],
        'projectId' => ['type' => 'integer', 'notNull' => true, 'references' => ['collection' => 'projects', 'column' => 'id']],
        'parentId' => ['type' => 'integer', 'references' => ['collection' => 'tasks', 'column' => 'id']],
    ]],
], $overrides)]);

$map = Model::map($release, $schema());
eq('collections map by resource id; natives are skipped', array_keys($map->collections), ['projects', 'tasks']);
eq('a reference maps to its <field>Id column', [$map->collections['tasks']['fields']['project']['column'], $map->collections['tasks']['fields']['project']['kind']], ['projectId', 'reference']);
eq('legacy storage names come from the release', $map->collections['projects']['fields']['gallery']['key'], '_zero_projects_gallery');
eq('the native title is not a meta field', array_key_exists('title', $map->collections['projects']['fields']), false);

$refuses = static function (string $label, callable $fn, string $pointer) {
    try {
        $fn();
        check($label, false, 'no refusal');
    } catch (HttpError $e) {
        check($label, $e->errorCode === 'legacy_unmappable' && $e->pointer === $pointer, [$e->errorCode, $e->pointer, $e->getMessage()]);
    }
};
$at = static function (string $resource, ?string $field = null) use ($release): string {
    foreach ($release['postTypes'] as $i => $r) {
        if ($r['id'] === $resource) {
            if ($field === null) {
                return "/postTypes/$i";
            }
            foreach ($r['fields'] as $j => $f) {
                if ($f['name'] === $field) {
                    return "/postTypes/$i/fields/$j";
                }
            }
        }
    }
    throw new LogicException("no $resource.$field");
};

$refuses('not a release', fn () => Model::map(['format' => 'other'], $schema()), '');
$noTasks = new Schema(['version' => 3, 'runtime' => Schema::SERIES, 'collections' => ['projects' => $schema()->collection('projects')]]);
$refuses('a collection the new app lacks', fn () => Model::map($release, $noTasks), $at('tasks') . '/id');
$refuses('an editor: false table', fn () => Model::map($release, $schema(['tasks' => ['editor' => false, 'wp' => null]])), $at('tasks') . '/id');
$refuses('a field without its column', fn () => Model::map($release, new Schema(['version' => 3, 'runtime' => Schema::SERIES, 'collections' => ['projects' => $schema()->collection('projects'), 'tasks' => array_replace($schema()->collection('tasks'), ['columns' => array_diff_key($schema()->collection('tasks')['columns'], ['notes' => 1])])]])), $at('tasks', 'notes') . '/name');
$refuses('enum options that differ', fn () => Model::map($release, $schema(['projects' => ['columns' => ['stage' => ['enum' => ['idea', 'live', 'gone']]]]])), $at('projects', 'stage') . '/definition');
$refuses('a single media field on a list column', fn () => Model::map($release, $schema(['projects' => ['columns' => ['cover' => ['type' => 'mediaList']]]])), $at('projects', 'cover') . '/definition');
$refuses('a reference to another collection', fn () => Model::map($release, $schema(['tasks' => ['columns' => ['parentId' => ['references' => ['collection' => 'projects']]]]])), $at('tasks', 'parent') . '/definition');
$blocks = $release;
foreach ($blocks['postTypes'] as &$r) {
    if ($r['id'] === 'tasks') {
        foreach ($r['fields'] as &$f) {
            if ($f['name'] === 'notes') {
                $f['definition']['type'] = 'richText';
            }
        }
    }
}
unset($r, $f);
$refuses('a rich text field', fn () => Model::map($blocks, $schema()), $at('tasks', 'notes') . '/definition/type');
$refuses('a field mapped onto the post content column', fn () => Model::map($release, $schema(['tasks' => ['content' => 'notes', 'columns' => ['notes' => ['type' => 'richText']]]])), $at('tasks', 'notes') . '/name');
$refuses('a localized destination', fn () => Model::map($release, $schema(['tasks' => ['localized' => true]])), $at('tasks') . '/id');
$refuses('a uid destination', fn () => Model::map($release, $schema(['tasks' => ['uid' => true]])), $at('tasks') . '/id');
$refuses('a field mapped onto the post title column', fn () => Model::map($release, $schema(['tasks' => ['title' => 'notes']])), $at('tasks', 'notes') . '/name');
$refuses('a reference to a business key instead of the id', fn () => Model::map($release, $schema(['tasks' => ['columns' => ['projectId' => ['references' => ['column' => 'code']]]]])), $at('tasks', 'project') . '/definition');


$refuses('a new reference column with a default', fn () => Model::map($release, $schema(['tasks' => ['columns' => ['reviewerId' => ['type' => 'integer', 'default' => ['value' => 1], 'references' => ['collection' => 'tasks', 'column' => 'id']]]]])), $at('tasks') . '/id');
$refuses('a new media column with a default', fn () => Model::map($release, $schema(['tasks' => ['columns' => ['badge' => ['type' => 'media', 'default' => ['value' => 1]]]]])), $at('tasks') . '/id');
$refuses('a new private file column with a default', fn () => Model::map($release, $schema(['tasks' => ['columns' => ['brief' => ['type' => 'file', 'default' => ['value' => 9]]]]])), $at('tasks') . '/id');
$refuses('a new post content column with a default', fn () => Model::map($release, $schema(['tasks' => ['content' => 'body', 'columns' => ['body' => ['type' => 'richText', 'default' => ['value' => '<p>x</p>']]]]])), $at('tasks') . '/id');
$refuses('a new structured column with a default', fn () => Model::map($release, $schema(['tasks' => ['columns' => ['links' => ['type' => 'repeater', 'default' => ['value' => []]]]]])), $at('tasks') . '/id');
eq('a new plain column with a default maps', array_keys(Model::map($release, $schema(['tasks' => ['columns' => ['reviewedAt' => ['type' => 'timestamp', 'default' => ['value' => '2026-03-01T12:00:00+02:00']]]]]))->collections), ['projects', 'tasks']);

$refuses('a destination with a slug column', fn () => Model::map($release, $schema(['tasks' => ['slug' => 'handle', 'columns' => ['handle' => ['type' => 'slug']]]])), $at('tasks') . '/id');

$refuses('a destination whose primary key is not id', fn () => Model::map($release, $schema(['projects' => ['primaryKey' => 'postId', 'columns' => ['postId' => ['type' => 'integer', 'primaryKey' => true], 'id' => ['type' => 'integer', 'unique' => true]]]])), $at('projects') . '/id');

// ---- Users::member: the member row an original app user becomes (pure; the move is in tests/wp/legacy).
$memberSpec = static fn (array $columns) => ['primaryKey' => 'id', 'columns' => ['id' => ['type' => 'integer', 'primaryKey' => true],
    'email' => ['type' => 'email', 'notNull' => true], 'name' => ['type' => 'text', 'notNull' => true, 'rules' => ['max' => 80]],
    'role' => ['type' => 'text', 'system' => true]] + $columns];
$member = static fn (array $columns, string $role = 'subscriber', string $name = 'Ada') => Users::member($memberSpec($columns), 5, 'ada@example.test', $name, $role, '/users/5');
eq('a member row: email, name and normalized defaults in storage form', $member(['since' => ['type' => 'timestamp', 'default' => ['value' => '2026-03-01T12:00:00+02:00']], 'tags' => ['type' => 'select', 'enum' => ['a', 'b'], 'default' => ['value' => ['a']]]]),
    ['email' => 'ada@example.test', 'name' => 'Ada', 'since' => '2026-03-01T10:00:00.000Z', 'tags' => '["a"]']);
eq('a column without a default is cleared (validators see the row the move leaves)', $member(['note' => ['type' => 'text']]), ['email' => 'ada@example.test', 'name' => 'Ada', 'note' => null]);
putenv('ZERO_NOW=2030-01-01T00:00:00.000Z');
putenv('ZERO_NOW_STEP=1'); // every clock read moves the pinned clock a millisecond
try {
    $stamps = $member(['joinedAt' => ['type' => 'timestamp', 'default' => ['now' => true]], 'seenAt' => ['type' => 'timestamp', 'default' => ['now' => true]]]);
} finally {
    putenv('ZERO_NOW_STEP');
    putenv('ZERO_NOW');
}
eq('a member row\'s now defaults are one instant', [$stamps['joinedAt'], $stamps['seenAt']], ['2030-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z']);
problem('a name over the member column\'s bound', fn () => $member([], 'subscriber', str_repeat('x', 81)), 422, 'invalid_input', '/users/5/name');
problem('a required member column with no default', fn () => $member(['plan' => ['type' => 'text', 'notNull' => true]]), 422, 'invalid_input', '/users/5/plan');
problem('a default breaking its own rule', fn () => $member(['code' => ['type' => 'text', 'default' => ['value' => 'ab'], 'rules' => ['min' => 3]]]), 422, 'invalid_input', '/users/5/code');
problem('a media default', fn () => $member(['avatar' => ['type' => 'media', 'default' => ['value' => 9]]]), 422, 'legacy_unmappable', '/users/5/avatar');
problem('a private file default', fn () => $member(['brief' => ['type' => 'file', 'bucket' => 'briefs', 'default' => ['value' => 999]]]), 422, 'legacy_unmappable', '/users/5/brief');
problem('...or one nested in a group', fn () => $member(['profile' => ['type' => 'group', 'fields' => ['cv' => ['type' => 'file', 'bucket' => 'briefs']], 'default' => ['value' => ['cv' => 999]]]]), 422, 'legacy_unmappable', '/users/5/profile');
problem('a reference default', fn () => $member(['teamId' => ['type' => 'integer', 'default' => ['value' => 1], 'references' => ['collection' => 'teams', 'column' => 'id']]]), 422, 'legacy_unmappable', '/users/5/teamId');
eval('namespace ZeroApp; function legacy_role_check($v, $ctx) { return ($ctx->p["data"]->p["role"] === "admin" || $v !== "pro") ? true : "pro needs admin"; }');
problem('validators see the user\'s role (a subscriber can\'t default to pro)', fn () => $member(['plan' => ['type' => 'text', 'default' => ['value' => 'pro'], 'rules' => ['validate' => 'legacy_role_check']]]), 422, 'invalid_input', '/users/5/plan');
eq('...and an admin can', $member(['plan' => ['type' => 'text', 'default' => ['value' => 'pro'], 'rules' => ['validate' => 'legacy_role_check']]], 'admin')['plan'], 'pro');

finish('legacy_test');
