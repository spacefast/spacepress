<?php

declare(strict_types=1);

/*
 * The runtime's half of tests/runtime-schema/corpus.json (docs/spec/spec.md §2.10): every case, as
 * an addField change on the project in tests/runtime-schema/base, gets the verdict the corpus
 * records, with the same code the compiler gives (src/runtime_schema.rs runs the other half), and
 * an accepted field is stored exactly as the compiler compiles it. Pure PHP: no WordPress.
 */

require __DIR__ . '/../../runtime/First/bootstrap.php';
require __DIR__ . '/harness.php';

use First\RuntimeSchema\Changes;
use First\RuntimeSchema\Loader;
use First\RuntimeSchema\Refused;

$corpus = json_decode((string) file_get_contents(__DIR__ . '/../runtime-schema/corpus.json'), true, 64, JSON_THROW_ON_ERROR);
// `$kinds` is the build's schema.php: every change is checked against it and the state so far.
$kinds = require __DIR__ . '/../runtime-schema/base.schema.php';
$empty = Loader::EMPTY;
$add = static fn (string $kind, string $field, mixed $definition): array => ['format' => Loader::FORMAT, 'changes' => [['op' => 'addField', 'kind' => $kind, 'field' => $field, 'definition' => $definition]]];

eq('the corpus is in the format this runtime reads', $corpus['format'], Loader::FORMAT);
$accepted = $refused = 0;
foreach ($corpus['cases'] as $case) {
    $name = $case['name'];
    try {
        $resolved = Changes::resolve($kinds, $empty, $add($case['kind'], $case['field'], $case['definition']));
        eq("$name: accepted", 'accept', $case['runtime']);
        // `===`: same keys in the same order, same value types. A build after `first pull` then
        // declares the field exactly as the site stored it.
        eq("$name: stored as the compiler compiles it", $resolved['changes'][0]['definition'], $case['stored'] ?? null);
        eq("$name: the state holds the stored definition", $resolved['state']['collections'][$case['kind']]['columns'][$case['field']], $case['stored'] ?? null);
        eq("$name: and the schema has it", Loader::apply($kinds, $resolved['state'])['collections'][$case['kind']]['columns'][$case['field']], $case['stored'] ?? null);
        $again = Changes::resolve($kinds, $empty, $add($case['kind'], $case['field'], $resolved['changes'][0]['definition']));
        eq("$name: a stored definition is accepted unchanged", $again['changes'][0]['definition'], $resolved['changes'][0]['definition']);
        $accepted++;
    } catch (Refused $e) {
        eq("$name: refused with {$case['runtime']} ({$e->getMessage()})", $e->verdict(), $case['runtime']);
        check("$name: the refusal points into the change", str_starts_with((string) $e->pointer, '/changes/0'), $e->pointer);
        $refused++;
    }
}
check('the corpus kept its cases', $accepted >= 35 && $refused >= 60, [$accepted, $refused]);

// ---------------------------------------------------------------- whole kinds
$accepted = $refused = 0;
foreach ($corpus['kinds'] as $case) {
    $name = $case['name'];
    $key = $case['op'] === 'addGlobal' ? 'global' : 'kind';
    $change = ['format' => Loader::FORMAT, 'changes' => [['op' => $case['op'], $key => $case['name_'], 'definition' => $case['definition']]]];
    try {
        $resolved = Changes::resolve($kinds, $empty, $change);
        eq("$name: accepted", 'accept', $case['runtime']);
        eq("$name: stored as the compiler compiles it", $resolved['changes'][0]['definition'], $case['stored'] ?? null);
        $again = Changes::resolve($kinds, $empty, ['format' => Loader::FORMAT, 'changes' => [['op' => $case['op'], $key => $case['name_'], 'definition' => $resolved['changes'][0]['definition']]]]);
        eq("$name: a stored kind is accepted unchanged", $again['changes'][0]['definition'], $resolved['changes'][0]['definition']);
        $accepted++;
    } catch (Refused $e) {
        eq("$name: refused with {$case['runtime']} ({$e->getMessage()})", $e->verdict(), $case['runtime']);
        check("$name: the refusal points into the change", str_starts_with((string) $e->pointer, '/changes/0'), $e->pointer);
        $refused++;
    }
}
check('the corpus kept its kinds', $accepted >= 12 && $refused >= 28, [$accepted, $refused]);

// The schema.php array the runtime builds for a kind it adds is the one the compiler emits for it.
$lock = json_decode((string) file_get_contents(__DIR__ . '/../runtime-schema/kinds.lock.json'), true, 64, JSON_THROW_ON_ERROR);
$compiledKinds = require __DIR__ . '/../runtime-schema/kinds.schema.php';
$changes = [];
foreach ($lock['added']['collections'] as $name => $definition) {
    $changes[] = ['op' => 'addCollection', 'kind' => $name, 'definition' => $definition];
}
foreach ($lock['added']['globals'] as $name => $definition) {
    $changes[] = ['op' => 'addGlobal', 'global' => $name, 'definition' => $definition];
}
$added = Changes::resolve($kinds, $empty, ['format' => Loader::FORMAT, 'changes' => $changes]);
$merged = Loader::apply($kinds, ['format' => Loader::FORMAT, 'version' => 4, 'hash' => 'kinds'] + $added['state']);
foreach (['events', 'press_notes'] as $name) {
    eq("the runtime's `$name` is the compiler's, key for key", $merged['collections'][$name], $compiledKinds['collections'][$name]);
}
foreach (['banner', 'siteFooter'] as $name) {
    eq("the runtime's global `$name` is the compiler's, key for key", $merged['globals'][$name], $compiledKinds['globals'][$name]);
}
eq('and nothing the build declares moved', [$merged['collections']['articles'], $merged['collections']['votes']], [$kinds['collections']['articles'], $kinds['collections']['votes']]);
eq('a build that contains the kinds is the same schema with or without the state', Loader::apply($compiledKinds, ['format' => Loader::FORMAT, 'version' => 4, 'hash' => 'kinds'] + $added['state'])['collections'], $compiledKinds['collections']);

// ---------------------------------------------------------------- the change set itself
$verdict = static function (mixed $changeSet, array $kinds, ?array $state = null) use ($empty): string {
    try {
        Changes::resolve($kinds, $state ?? $empty, $changeSet);

        return 'accept';
    } catch (Refused $e) {
        return "$e->status $e->errorCode $e->pointer";
    }
};
$text = ['type' => 'text'];
eq('a change set in another format is refused', $verdict(['format' => 2, 'changes' => []], $kinds), '422 schema_format /format');
eq('a change set with no changes is refused', $verdict(['format' => 1, 'changes' => []], $kinds), '422 schema_format /changes');
eq('a change set with another key is refused', $verdict(['format' => 1, 'changes' => [['op' => 'addField', 'kind' => 'articles', 'field' => 'a', 'definition' => $text]], 'apply' => true], $kinds), '422 schema_format /apply');
eq('a change with another key is refused', $verdict(['format' => 1, 'changes' => [['op' => 'addField', 'kind' => 'articles', 'field' => 'a', 'definition' => $text, 'was' => 'b']]], $kinds), '422 schema_format /changes/0');
foreach (['renameField', 'changeField', 'retypeField', 'renameCollection', 'addTable', 'addTableField', 'addAction', 'addJob', 'addHook', 'addPage', 'addRoute', 'addTaxonomy', 'dropKind'] as $op) {
    eq("$op is build-only", $verdict(['format' => 1, 'changes' => [['op' => $op, 'kind' => 'articles', 'field' => 'rating']]], $kinds), '422 schema_build_only /changes/0/op');
}
$two = ['format' => 1, 'changes' => [
    ['op' => 'addField', 'kind' => 'articles', 'field' => 'subtitle', 'definition' => $text],
    ['op' => 'addField', 'kind' => 'articles', 'field' => 'subtitle', 'definition' => $text],
]];
eq('one change set can\'t add a name twice', $verdict($two, $kinds), '422 schema_invalid /changes/1/field');
$stateWith = Changes::fold($empty, [['op' => 'addField', 'kind' => 'articles', 'field' => 'subtitle', 'definition' => $text]]);
eq('a name an earlier version added is taken, whatever this request\'s schema holds', $verdict($add('articles', 'subtitle', $text), $kinds, $stateWith), '422 schema_invalid /changes/0/field');
$many = ['format' => 1, 'changes' => array_map(static fn (int $i): array => ['op' => 'addField', 'kind' => 'articles', 'field' => "f$i", 'definition' => $text], range(1, Changes::MAX_CHANGES + 1))];
eq('one version holds a bounded number of changes', $verdict($many, $kinds), '422 schema_format /changes');
$full = Changes::fold($empty, array_map(static fn (int $i): array => ['op' => 'addField', 'kind' => 'articles', 'field' => "wide$i", 'definition' => ['type' => 'text', 'ui' => ['help' => str_repeat('h', 60)]]], range(1, 900)));
eq('a state past the option bound is refused with the way out', $verdict($add('articles', 'subtitle', $text), $kinds, $full), '422 schema_too_large /changes');
foreach (['localized' => true, 'sync' => ['dir' => 'content/articles', 'format' => 'md']] as $key => $value) {
    $other = $kinds;
    $other['collections']['articles'][$key] = $value;
    eq("a kind with `$key` takes fields from source only", $verdict($add('articles', 'subtitle', $text), $other), '422 schema_build_only /changes/0/kind');
}

$related = $kinds;
$related['collections']['articles']['relations']['votes'] = ['kind' => 'many', 'collection' => 'votes', 'from' => 'id', 'to' => 'article', 'optional' => false];
eq('a name a relation of the kind has is taken, with the compiler\'s code', [$verdict($add('articles', 'votes', $text), $related), $verdict($add('articles', 'subtitle', $text), $related)],
    ['422 schema_invalid /changes/0/field', 'accept']);

// ---------------------------------------------------------------- labels and presentation
$set = static fn (array ...$changes): array => ['format' => Loader::FORMAT, 'changes' => $changes];
$labelled = Changes::resolve($kinds, $empty, $set(['op' => 'setLabel', 'kind' => 'articles', 'label' => 'Stories'], ['op' => 'setFieldUi', 'kind' => 'articles', 'field' => 'rating', 'ui' => ['width' => 50, 'label' => 'Stars']]));
$shown = Loader::apply($kinds, $labelled['state'])['collections']['articles'];
eq('a label and a field\'s presentation replace the build\'s', [$shown['label'], $shown['columns']['rating']], ['Stories', ['type' => 'integer', 'ui' => ['label' => 'Stars', 'width' => 50]]]);
eq('and nothing else about the kind moves', array_diff_key($shown, ['label' => 1, 'columns' => 1]), array_diff_key($kinds['collections']['articles'], ['label' => 1, 'columns' => 1]));
$cleared = Changes::resolve($kinds, $labelled['state'], $set(['op' => 'setLabel', 'kind' => 'articles', 'label' => null], ['op' => 'setFieldUi', 'kind' => 'articles', 'field' => 'rating', 'ui' => null]));
eq('null takes them off again, back to an empty state', [$cleared['state'], Loader::apply($kinds, $cleared['state'])['collections']['articles']], [$empty, $kinds['collections']['articles']]);
eq('presentation follows the compiler\'s ui rule', $verdict($set(['op' => 'setFieldUi', 'kind' => 'articles', 'field' => 'rating', 'ui' => ['width' => 500]]), $kinds), '422 schema_invalid /changes/0/definition');
eq('a field the kind lacks has nothing to present', $verdict($set(['op' => 'setFieldUi', 'kind' => 'articles', 'field' => 'nope', 'ui' => ['label' => 'x']]), $kinds), '422 schema_invalid /changes/0/field');
eq('nor has a system field', $verdict($set(['op' => 'setFieldUi', 'kind' => 'articles', 'field' => 'status', 'ui' => ['label' => 'x']]), $kinds), '422 schema_invalid /changes/0/field');
eq('a label on a kind the app lacks is refused', $verdict($set(['op' => 'setLabel', 'kind' => 'nope', 'label' => 'x']), $kinds), '422 schema_invalid /changes/0/kind');
eq('a label that is not text is refused', $verdict($set(['op' => 'setLabel', 'kind' => 'articles', 'label' => ['a']]), $kinds), '422 schema_format /changes/0/label');

// ---------------------------------------------------------------- removal hides; rollback reverses
$removeField = static fn (string $kind, string $field): array => $set(['op' => 'removeField', 'kind' => $kind, 'field' => $field]);
eq('a field the build declares can\'t be removed at runtime', $verdict($removeField('articles', 'rating'), $kinds), '422 schema_build_only /changes/0/field');
eq('nor a kind the build declares', $verdict($set(['op' => 'removeCollection', 'kind' => 'articles']), $kinds), '422 schema_build_only /changes/0/kind');
eq('nor something that was never there', $verdict($removeField('articles', 'nope'), $kinds), '422 schema_invalid /changes/0/field');
$withField = Changes::resolve($kinds, $empty, $add('articles', 'stars', ['type' => 'integer', 'ui' => ['label' => 'Stars']]));
$gone = Changes::resolve($kinds, $withField['state'], $removeField('articles', 'stars'));
eq('a removed runtime field leaves the schema and the state remembers its type', [isset(Loader::apply($kinds, $gone['state'])['collections']['articles']['columns']['stars']), $gone['state']], [false, $empty + ['removed' => ['collections' => ['articles' => ['fields' => ['stars' => 'integer']]]]]]);
eq('it comes back only as the type its values were stored with', [$verdict($add('articles', 'stars', $text), $kinds, $gone['state']), $verdict($add('articles', 'stars', ['type' => 'integer']), $kinds, $gone['state'])], ['422 schema_retype /changes/0/definition/type', 'accept']);
$inBuild = $kinds;
$inBuild['collections']['articles']['columns']['stars'] = ['type' => 'integer', 'ui' => ['label' => 'Stars']];
eq('a runtime field a build has since declared is in use: not removable', $verdict($removeField('articles', 'stars'), $inBuild, $withField['state']), '422 schema_in_use /changes/0/field');

$site = Changes::resolve($kinds, $empty, $set(
    ['op' => 'addCollection', 'kind' => 'events', 'definition' => ['fields' => ['title' => ['type' => 'text', 'notNull' => true], 'starts' => ['type' => 'date']]]],
    ['op' => 'addGlobal', 'global' => 'banner', 'definition' => ['fields' => ['text' => $text]]],
));
$grown = Changes::resolve($kinds, $site['state'], $set(
    ['op' => 'addField', 'kind' => 'events', 'field' => 'venue', 'definition' => $text],
    ['op' => 'addGlobalField', 'global' => 'banner', 'field' => 'on', 'definition' => ['type' => 'boolean', 'notNull' => true, 'default' => ['value' => false]]],
    ['op' => 'setLabel', 'kind' => 'events', 'label' => 'What\'s on'],
    ['op' => 'setFieldUi', 'global' => 'banner', 'field' => 'text', 'ui' => ['help' => 'Shown on every page']],
));
$schema = Loader::apply($kinds, $grown['state']);
eq('fields, a label and presentation land on kinds the site added', [array_keys($schema['collections']['events']['columns']), $schema['collections']['events']['label'], $schema['globals']['banner']['fields']],
    [['id', 'title', 'starts', 'status', 'publishedAt', 'venue'], 'What\'s on', ['text' => ['type' => 'text', 'ui' => ['help' => 'Shown on every page']], 'on' => ['type' => 'boolean', 'notNull' => true, 'default' => ['value' => false]]]]);
eq('a required field added to an existing global needs its default', $verdict($set(['op' => 'addGlobalField', 'global' => 'banner', 'field' => 'cta', 'definition' => ['type' => 'text', 'notNull' => true]]), $kinds, $site['state']), '422 schema_invalid /changes/0/definition');
eq('a field that came with a kind goes with the kind, not alone', $verdict($removeField('events', 'starts'), $kinds, $grown['state']), '422 schema_build_only /changes/0/field');
eq('a global field is removed through `global`', $verdict($set(['op' => 'removeField', 'global' => 'banner', 'field' => 'on']), $kinds, $grown['state']), 'accept');
eq('an operation names a kind or a global, not both', $verdict($set(['op' => 'setLabel', 'kind' => 'events', 'global' => 'banner', 'label' => 'x']), $kinds, $grown['state']), '422 schema_format /changes/0');

// A kind a build that ran on the site declared (and the host may still serve) keeps its fields' stored types.
$declared = ['collections' => ['events' => ['starts' => 'text']], 'globals' => ['banner' => ['text' => 'integer']]];
$verdictWith = static function (array $changeSet) use ($kinds, $empty, $declared): string {
    try {
        Changes::resolve($kinds, $empty, $changeSet, $declared);

        return 'accept';
    } catch (Refused $e) {
        return "$e->status {$e->verdict()} $e->pointer";
    }
};
eq('a collection added at runtime keeps the stored types an earlier build gave its fields',
    [$verdictWith($set(['op' => 'addCollection', 'kind' => 'events', 'definition' => ['fields' => ['title' => ['type' => 'text', 'notNull' => true], 'starts' => ['type' => 'date']]]])),
     $verdictWith($set(['op' => 'addCollection', 'kind' => 'events', 'definition' => ['fields' => ['title' => ['type' => 'text', 'notNull' => true], 'starts' => ['type' => 'text']]]]))],
    ['422 schema_retype /changes/0/definition/fields/starts/type', 'accept']);
eq('and so does a global (a field on a global the build lacks is a global the app lacks)', [$verdictWith($set(['op' => 'addGlobal', 'global' => 'banner', 'definition' => ['fields' => ['text' => ['type' => 'text']]]])),
    $verdictWith($set(['op' => 'addGlobalField', 'global' => 'banner', 'field' => 'text', 'definition' => ['type' => 'text']]))],
    ['422 schema_retype /changes/0/definition/fields/text/type', '422 F3001 /changes/0/definition']);

// Rolling a version back is applying the reverse of its changes as a new version.
$undoGrown = Changes::reverse($site['state'], $grown['changes']);
eq('the reverse of a version undoes its changes, newest first', array_column($undoGrown, 'op'), ['setFieldUi', 'setLabel', 'removeField', 'removeField']);
$back = Changes::resolve($kinds, $grown['state'], ['format' => Loader::FORMAT, 'changes' => $undoGrown]);
eq('applied, the schema is the one before that version', Loader::apply($kinds, $back['state']), Loader::apply($kinds, $site['state']));
$redo = Changes::resolve($kinds, $back['state'], ['format' => Loader::FORMAT, 'changes' => Changes::reverse($grown['state'], $back['changes'])]);
eq('and the reverse of the rollback brings it back', Loader::apply($kinds, $redo['state']), Loader::apply($kinds, $grown['state']));
$dropped = Changes::resolve($kinds, $grown['state'], $set(['op' => 'removeCollection', 'kind' => 'events'], ['op' => 'removeGlobal', 'global' => 'banner']));
$after = Loader::apply($kinds, $dropped['state']);
eq('a removed kind leaves the schema', [isset($after['collections']['events']), isset($after['globals']['banner'])], [false, false]);
eq('and the state keeps every field type it stored, the later-added one included', $dropped['state']['removed']['collections']['events']['fields'], ['title' => 'text', 'starts' => 'date', 'venue' => 'text']);
eq('adding it again with another type for a stored field is refused', $verdict($set(['op' => 'addCollection', 'kind' => 'events', 'definition' => ['fields' => ['title' => ['type' => 'text', 'notNull' => true], 'starts' => $text]]]), $kinds, $dropped['state']), '422 schema_retype /changes/0/definition/fields/starts/type');
$restored = Changes::resolve($kinds, $dropped['state'], ['format' => Loader::FORMAT, 'changes' => Changes::reverse($grown['state'], $dropped['changes'])]);
eq('the reverse of a removal brings the kind back with the fields, label and presentation it had', Loader::apply($kinds, $restored['state']), $schema);
$uiGone = Changes::resolve($kinds, $grown['state'], $set(['op' => 'setFieldUi', 'kind' => 'events', 'field' => 'venue', 'ui' => ['label' => 'Where']], ['op' => 'removeField', 'kind' => 'events', 'field' => 'venue']));
$uiBack = Changes::resolve($kinds, $uiGone['state'], ['format' => Loader::FORMAT, 'changes' => Changes::reverse($grown['state'], $uiGone['changes'])]);
eq('undoing a version that presented a field and then removed it leaves the field as it was before', Loader::apply($kinds, $uiBack['state']), $schema);
eq('undoing the version that added a kind, after another built on it, removes the kind whole', Loader::apply($kinds, Changes::resolve($kinds, $grown['state'], ['format' => Loader::FORMAT, 'changes' => Changes::reverse($empty, $site['changes'])])['state'])['collections'], $kinds['collections']);

// ---------------------------------------------------------------- replay
$first = Changes::resolve($kinds, $empty, $add('articles', 'subtitle', $text));
$second = Changes::resolve($kinds, $first['state'], $add('articles', 'stars', ['type' => 'integer', 'rules' => ['max' => 5]]));
eq('folding the stored changes gives the state again', Changes::fold(Changes::fold($empty, $first['changes']), $second['changes']), $second['state']);
eq('for every operation', Changes::fold(Changes::fold(Changes::fold($empty, $site['changes']), $grown['changes']), $dropped['changes']), $dropped['state']);

finish('runtimeschema corpus');
