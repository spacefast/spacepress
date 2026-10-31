<?php

declare(strict_types=1);

// Lane M: mapping an original Zero (0.8) release onto the new app's schema (Zero\Wp\Legacy\Model).
// Pure logic; the data migration itself is proven against real WordPress in tests/wp/legacy.

require __DIR__ . '/../../runtime/Zero/bootstrap.php';
require __DIR__ . '/harness.php';

use Zero\HttpError;
use Zero\Schema;
use Zero\Wp\Legacy\Model;

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

finish('legacy_test');
