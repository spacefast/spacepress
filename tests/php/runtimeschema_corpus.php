<?php

declare(strict_types=1);

/*
 * The runtime's half of tests/runtime-schema/corpus.json (docs/spec/spec.md §2.10): every case, as
 * an addField change on the project in tests/runtime-schema/base, gets the verdict the corpus
 * records, with the same code the compiler gives (src/runtime_schema.rs runs the other half), and
 * an accepted field is stored exactly as the compiler compiles it. Pure PHP: no WordPress.
 */

require __DIR__ . '/../../runtime/TypedPress/bootstrap.php';
require __DIR__ . '/harness.php';

use TypedPress\RuntimeSchema\Changes;
use TypedPress\RuntimeSchema\Kinds;
use TypedPress\RuntimeSchema\Loader;
use TypedPress\RuntimeSchema\Refused;

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
        // `===`: same keys in the same order, same value types. A build after `typedpress pull` then
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
eq('a table() kind\'s label is build-only', $verdict($set(['op' => 'setLabel', 'kind' => 'votes', 'label' => 'Ballots']), $kinds), '422 schema_build_only /changes/0/kind');
eq('and so is its fields\' presentation', $verdict($set(['op' => 'setFieldUi', 'kind' => 'votes', 'field' => 'weight', 'ui' => ['label' => 'Weight']]), $kinds), '422 schema_build_only /changes/0/kind');

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

// A removed or hidden field keeps its values, sub-fields included: a new field can't store under its keys.
$venue = ['type' => 'group', 'fields' => ['name' => $text]];
$venueGone = Changes::resolve($kinds, Changes::resolve($kinds, $empty, $add('articles', 'venue', $venue))['state'], $removeField('articles', 'venue'))['state'];
eq('a field can\'t store under the keys of a removed group\'s sub-fields, nor of its own name in another case',
    [$verdict($add('articles', 'venue_name', ['type' => 'integer']), $kinds, $venueGone), $verdict($add('articles', 'Venue', $venue), $kinds, $venueGone), $verdict($add('articles', 'venue', $venue), $kinds, $venueGone), $verdict($add('articles', 'venues', $text), $kinds, $venueGone)],
    ['422 schema_invalid /changes/0/field', '422 schema_invalid /changes/0/field', 'accept', 'accept']);
$promoBuild = $kinds;
$promoBuild['collections']['articles']['columns']['promo'] = $venue;
$promoState = Changes::resolve($kinds, $empty, $add('articles', 'promo', $venue))['state'];
$noCode = ['collections' => ['articles' => []], 'globals' => [], 'kinds' => []];
$promoHidden = Changes::resolve($promoBuild, $promoState, $removeField('articles', 'promo'), $noCode)['state'];
check('a field the build declares and no code names is hidden', !isset(Loader::apply($promoBuild, $promoHidden, $noCode)['collections']['articles']['columns']['promo']));
try {
    Changes::resolve($promoBuild, $promoHidden, $add('articles', 'promo_name', ['type' => 'integer']), $noCode);
    $hiddenVerdict = 'accept';
} catch (Refused $e) {
    $hiddenVerdict = "$e->status $e->errorCode $e->pointer";
}
eq('and a new field can\'t store under its sub-fields\' keys, which the build will read again', $hiddenVerdict, '422 schema_invalid /changes/0/field');
$declaredGroup = static function (array $changeSet) use ($kinds, $empty): string {
    try {
        Changes::resolve($kinds, $empty, $changeSet, null, ['collections' => ['articles' => ['promo' => 'group']], 'globals' => ['site' => ['links' => 'repeater']]]);

        return 'accept';
    } catch (Refused $e) {
        return "$e->status {$e->verdict()} $e->pointer";
    }
};
eq('nor under the keys of a group or repeater an earlier build on the site declared',
    [$declaredGroup($add('articles', 'promo_name', $text)), $declaredGroup($set(['op' => 'addGlobalField', 'global' => 'site', 'field' => 'links_0_href', 'definition' => $text])), $declaredGroup($add('articles', 'promotion', $text))],
    ['422 F3001 /changes/0/field', '422 F3001 /changes/0/field', 'accept']);

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
    [['id', 'title', 'starts', 'status', 'publishedAt', 'author', 'createdAt', 'updatedAt', 'deletedAt', 'deletedBy', 'deletedGroup', 'venue'], 'What\'s on', ['text' => ['type' => 'text', 'ui' => ['help' => 'Shown on every page']], 'on' => ['type' => 'boolean', 'notNull' => true, 'default' => ['value' => false]]]]);
eq('a required field added to an existing global needs its default', $verdict($set(['op' => 'addGlobalField', 'global' => 'banner', 'field' => 'cta', 'definition' => ['type' => 'text', 'notNull' => true]]), $kinds, $site['state']), '422 schema_invalid /changes/0/definition');
eq('a field that came with a kind goes with the kind, not alone', $verdict($removeField('events', 'starts'), $kinds, $grown['state']), '422 schema_build_only /changes/0/field');
eq('a global field is removed through `global`', $verdict($set(['op' => 'removeField', 'global' => 'banner', 'field' => 'on']), $kinds, $grown['state']), 'accept');
eq('an operation names a kind or a global, not both', $verdict($set(['op' => 'setLabel', 'kind' => 'events', 'global' => 'banner', 'label' => 'x']), $kinds, $grown['state']), '422 schema_format /changes/0');

// A kind a build that ran on the site declared (and the host may still serve) keeps its fields' stored types.
$declared = ['collections' => ['events' => ['starts' => 'text']], 'globals' => ['banner' => ['text' => 'integer']]];
$verdictWith = static function (array $changeSet) use ($kinds, $empty, $declared): string {
    try {
        Changes::resolve($kinds, $empty, $changeSet, null, $declared);

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

// ---------------------------------------------------------------- what a deploy does with the site's changes
$deploy = static fn (array $built, array $state): array => \TypedPress\RuntimeSchema\Deploy::check($built, $state);
$codes = static fn (array $r): array => array_map(static fn (array $x): string => "{$x['code']} {$x['name']}", $r['refusals']);
$withMood = Changes::resolve($kinds, $empty, $add('articles', 'mood', ['type' => 'text', 'enum' => ['calm', 'loud']]))['state'];
eq('a build without the runtime field keeps it', $deploy($kinds, $withMood)['kept'], ['articles.mood']);
$same = $kinds;
$same['collections']['articles']['columns']['mood'] = ['type' => 'text', 'enum' => ['calm', 'loud']];
eq('a build that declares it the same way leaves nothing to report', [$deploy($same, $withMood)['kept'], $deploy($same, $withMood)['refusals'], $deploy($same, $withMood)['changed']], [[], [], []]);
$other = $kinds;
$other['collections']['articles']['columns']['mood'] = ['type' => 'text', 'enum' => ['calm', 'loud', 'angry']];
eq('a build that gives a runtime select other options is refused', $codes($deploy($other, $withMood)), ['runtime_type_differs articles.mood']);
$plain = $kinds;
$plain['collections']['articles']['columns']['mood'] = ['type' => 'text'];
eq('and so is one that declares it without options', $codes($deploy($plain, $withMood)), ['runtime_type_differs articles.mood']);
$longer = $kinds;
$longer['collections']['articles']['columns']['mood'] = ['type' => 'text', 'enum' => ['calm', 'loud'], 'ui' => ['label' => 'Mood']];
eq('a build that only presents it differently is reported as changed, not refused', [$codes($deploy($longer, $withMood)), $deploy($longer, $withMood)['changed']], [[], ['articles.mood']]);
$withVenue = Changes::resolve($kinds, $empty, $add('articles', 'venue', ['type' => 'group', 'fields' => ['name' => ['type' => 'text'], 'city' => ['type' => 'text']]]))['state'];
$subs = $kinds;
$subs['collections']['articles']['columns']['venue'] = ['type' => 'group', 'fields' => ['name' => ['type' => 'text'], 'city' => ['type' => 'integer']]];
eq('a build whose group sub-field has another type is refused', $codes($deploy($subs, $withVenue)), ['runtime_type_differs articles.venue']);
$fewer = $kinds;
$fewer['collections']['articles']['columns']['venue'] = ['type' => 'group', 'fields' => ['name' => ['type' => 'text']]];
eq('and so is one with other sub-fields', $codes($deploy($fewer, $withVenue)), ['runtime_type_differs articles.venue']);
$withEvents = Changes::resolve($kinds, $empty, $set(['op' => 'addCollection', 'kind' => 'events', 'definition' => ['fields' => ['title' => ['type' => 'text', 'notNull' => true]]]]))['state'];
$table = $kinds;
$table['collections']['events'] = ['key' => 'events', 'editor' => false, 'wp' => null, 'table' => 'tp_events', 'primaryKey' => 'id', 'columns' => ['id' => ['type' => 'integer', 'primaryKey' => true, 'autoIncrement' => true, 'notNull' => true], 'title' => ['type' => 'text', 'notNull' => true]]];
eq('a build that declares a table() named like a runtime collection is refused', $codes($deploy($table, $withEvents)), ['runtime_kind_differs events']);
// A build field stored under a runtime field's key: the two would write one meta row.
$withPromoTitle = Changes::resolve($kinds, $empty, $add('articles', 'promo_title', ['type' => 'integer']))['state'];
$promo = $kinds;
$promo['collections']['articles']['columns']['promo'] = ['type' => 'group', 'fields' => ['title' => $text]];
eq('a build whose new group stores under a runtime field\'s key is refused', $codes($deploy($promo, $withPromoTitle)), ['runtime_key_shared articles.promo']);
$cased = $kinds;
$cased['collections']['articles']['columns']['Promo_title'] = $text;
eq('and so is a build field whose key differs from a runtime field\'s only in case', $codes($deploy($cased, $withPromoTitle)), ['runtime_key_shared articles.Promo_title']);
$withNote = Changes::resolve($kinds, $empty, $set(['op' => 'addGlobalField', 'global' => 'site', 'field' => 'note', 'definition' => ['type' => 'group', 'fields' => ['x' => $text]]]))['state'];
$footer = $kinds;
$footer['globals']['site']['fields']['note_x'] = $text;
eq('the same holds for global options', $codes($deploy($footer, $withNote)), ['runtime_key_shared site.note_x']);
// What the build leaves out of a kind the site added stays, and is listed.
$withVenueKind = Changes::resolve($kinds, $empty, $set(['op' => 'addCollection', 'kind' => 'events', 'definition' => ['fields' => ['title' => ['type' => 'text', 'notNull' => true], 'content' => ['type' => 'richText'], 'venue' => $text]]]))['state'];
$eventsBuilt = $kinds;
$eventsBuilt['collections']['events'] = Kinds::expandCollection('events', ['fields' => ['title' => ['type' => 'text', 'notNull' => true]]]);
eq('a build that declares a runtime collection with fewer fields keeps the rest', $deploy($eventsBuilt, $withVenueKind)['kept'], ['events.venue']);
eq('and serves them', array_keys(Loader::apply($eventsBuilt, ['format' => Loader::FORMAT, 'version' => 1, 'hash' => 'h'] + $withVenueKind)['collections']['events']['columns']), ['id', 'title', 'status', 'publishedAt', 'author', 'createdAt', 'updatedAt', 'deletedAt', 'deletedBy', 'deletedGroup', 'venue']);
eq('a body the build doesn\'t declare can\'t be served on another field: it is refused', $codes($deploy($eventsBuilt, Changes::resolve($kinds, $empty, $set(['op' => 'addCollection', 'kind' => 'events', 'definition' => ['fields' => ['title' => ['type' => 'text', 'notNull' => true], 'content' => ['type' => 'richText']]]]))['state'])), ['runtime_body_dropped events']);
$asGlobal = $kinds;
$asGlobal['globals']['events'] = Kinds::expandGlobal('events', ['fields' => ['title' => $text]]);
eq('a build that names something else like a runtime collection is refused', $codes($deploy($asGlobal, $withEvents)), ['runtime_kind_differs events']);
// What reads stored values the same isn't refused: order of options, layouts and sub-fields.
$withChoice = Changes::resolve($kinds, $empty, $add('articles', 'choice', ['type' => 'text', 'enum' => ['a', 'b']]))['state'];
$reordered = $kinds;
$reordered['collections']['articles']['columns']['choice'] = ['type' => 'text', 'enum' => ['b', 'a']];
eq('options in another order read stored values the same', $codes($deploy($reordered, $withChoice)), []);
$swapped = $kinds;
$swapped['collections']['articles']['columns']['venue'] = ['type' => 'group', 'fields' => ['city' => $text, 'name' => $text]];
eq('and so do sub-fields in another order', $codes($deploy($swapped, $withVenue)), []);
eq('a build that declares the runtime collection as a collection is fine', $deploy(['collections' => Loader::apply($kinds, ['format' => Loader::FORMAT, 'version' => 1, 'hash' => 'h'] + $withEvents)['collections']] + $kinds, $withEvents)['refusals'], []);

// ---------------------------------------------------------------- the option is data, not code
// Whoever can write the option (another plugin, a database tool) must not be able to give the site
// more than a runtime change could: access rules, hooks or post types of their own.
$good = Changes::resolve($kinds, $empty, $set(['op' => 'addCollection', 'kind' => 'events', 'definition' => ['fields' => ['title' => ['type' => 'text', 'notNull' => true]]]],
    ['op' => 'addField', 'kind' => 'articles', 'field' => 'teaser', 'definition' => ['type' => 'text']]))['state'];
$good = ['format' => Loader::FORMAT, 'version' => 1, 'hash' => 'h'] + $good;
$tampered = $good;
$tampered['compiled']['collections']['events']['access'] = ['read' => ['role' => 'anyone'], 'create' => ['allow' => true], 'update' => ['allow' => true], 'delete' => ['allow' => true]];
$tampered['compiled']['collections']['events']['hooks'] = ['beforeCreate' => 'phpinfo'];
$tampered['compiled']['collections']['events']['wp']['postType'] = 'post';
$tampered['compiled']['collections']['sneaky'] = Kinds::expandCollection('sneaky', ['fields' => ['title' => ['type' => 'text', 'notNull' => true]]]);
$tampered['collections']['articles']['columns']['teaser'] = ['type' => 'text', 'rules' => ['validate' => 'phpinfo'], 'default' => ['fn' => 'phpinfo']];
$tampered['collections']['articles']['columns']['owned'] = ['type' => 'text', 'access' => ['read' => ['fn' => 'phpinfo']]];
$tampered['overrides']['collections']['articles'] = ['label' => 'Stories', 'access' => ['read' => ['allow' => true]], 'ui' => ['rating' => ['label' => 'Stars', 'validate' => 'phpinfo']]];
$loaded = Loader::apply($kinds, $tampered);
$clean = Loader::apply($kinds, $good);
eq('an added kind is rebuilt from its stored definition: the option can\'t give it access rules, hooks or another post type',
    $loaded['collections']['events'], $clean['collections']['events']);
eq('a kind no runtime change added is not served', isset($loaded['collections']['sneaky']), false);
eq('a field the option holds that no change could make (a function, an access rule) is not served',
    [isset($loaded['collections']['articles']['columns']['teaser']), isset($loaded['collections']['articles']['columns']['owned'])], [false, false]);
eq('one the option holds as a change made it is', $clean['collections']['articles']['columns']['teaser'], ['type' => 'text']);
eq('an override carries a label and field presentation only; presentation a change couldn\'t set is ignored',
    [$loaded['collections']['articles']['label'], $loaded['collections']['articles']['access'], $loaded['collections']['articles']['columns']['rating']],
    ['Stories', $kinds['collections']['articles']['access'], ['type' => 'integer']]);

// A state the option holds is served only as the changes could have made it: every rule a change
// passes holds on load too, whoever wrote the option.
$title = ['title' => ['type' => 'text', 'notNull' => true]];
$forged = ['format' => Loader::FORMAT, 'version' => 1, 'hash' => 'h',
    'added' => ['collections' => ['users' => ['fields' => $title], 'posts' => ['fields' => $title]]],
    'collections' => ['articles' => ['columns' => ['staged' => ['type' => 'json'], 'system' => ['type' => 'json'], 'author' => ['type' => 'text'], 'terms' => ['type' => 'text'],
        str_repeat('x', 200) => $text, 'required' => ['type' => 'text', 'notNull' => true], 'seo_title' => ['type' => 'integer'], 'fine' => $text]]],
    'overrides' => ['collections' => ['votes' => ['label' => 'Ballots', 'ui' => ['weight' => ['label' => 'W']]], 'articles' => ['ui' => ['status' => ['label' => 'S'], 'id' => ['label' => 'I']]]]]];
$served = Loader::apply($kinds, $forged);
eq('kinds every site has are not served from the option', [isset($served['collections']['users']), isset($served['collections']['posts'])], [false, false]);
eq('nor fields under reserved names, over-long names, required without a default, or on another field\'s keys; a field a change could add still is',
    array_values(array_intersect(array_keys($served['collections']['articles']['columns']), ['staged', 'system', 'terms', str_repeat('x', 200), 'required', 'seo_title', 'fine'])), ['fine']);
eq('and a forged reserved system column does not overwrite the built-in system column',
    $served['collections']['articles']['columns']['author'], $kinds['collections']['articles']['columns']['author']);
eq('nor a label or presentation on a table() kind, a system field or the primary key',
    [$served['collections']['votes']['label'], $served['collections']['votes']['columns']['weight'], $served['collections']['articles']['columns']['status'], $served['collections']['articles']['columns']['id']],
    [$kinds['collections']['votes']['label'], $kinds['collections']['votes']['columns']['weight'], $kinds['collections']['articles']['columns']['status'], $kinds['collections']['articles']['columns']['id']]);

// The seal is keyed to the site: a writer who knows the algorithm but not the site's salt can't make one.
$sealable = ['format' => Loader::FORMAT, 'version' => 3, 'hash' => 'h'] + Changes::resolve($kinds, $empty, $add('articles', 'subtitle', $text))['state'];
$plain = $sealable;
$plain['seal'] = hash('sha256', serialize((static function (array $s): array { ksort($s); return $s; })($sealable)));
eq('an unkeyed hash is not a seal', Loader::sealedBy($plain), false);
eq('a state apply seals is', Loader::sealedBy(Loader::sealed($sealable)), true);
eq('the empty state needs none, and any other state without one is refused', [Loader::sealedBy($empty), Loader::sealedBy(['format' => 1, 'version' => 0, 'hash' => '', 'collections' => ['articles' => ['columns' => ['x' => $text]]]])], [true, false]);
$floaty = $sealable;
$floaty['collections']['articles']['columns']['ratio'] = ['type' => 'real', 'rules' => ['min' => 0.1]];
$previous = ini_get('serialize_precision');
ini_set('serialize_precision', '17');
$sealedAt17 = Loader::sealed($floaty);
ini_set('serialize_precision', $previous);
eq('a seal doesn\'t depend on the PHP precision setting it was made under', Loader::sealedBy($sealedAt17), true);

// A table() label stored before the rule existed can be taken off again, and isn't exported to the lock.
$legacy = ['format' => Loader::FORMAT, 'version' => 1, 'hash' => 'h', 'overrides' => ['collections' => ['votes' => ['label' => 'Ballots']]]];
eq('clearing a table() label is accepted; setting one is not',
    [$verdict($set(['op' => 'setLabel', 'kind' => 'votes', 'label' => null]), $kinds, $legacy), $verdict($set(['op' => 'setFieldUi', 'kind' => 'votes', 'field' => 'weight', 'ui' => null]), $kinds, $legacy), $verdict($set(['op' => 'setLabel', 'kind' => 'votes', 'label' => 'B']), $kinds, $legacy)],
    ['accept', 'accept', '422 schema_build_only /changes/0/kind']);
eq('and the lock leaves table() overrides out, so `typedpress build` takes what `typedpress pull` writes', Changes::lock($legacy, $kinds)['overrides'] ?? [], []);

// ---------------------------------------------------------------- replay
$first = Changes::resolve($kinds, $empty, $add('articles', 'subtitle', $text));
$second = Changes::resolve($kinds, $first['state'], $add('articles', 'stars', ['type' => 'integer', 'rules' => ['max' => 5]]));
eq('folding the stored changes gives the state again', Changes::fold(Changes::fold($empty, $first['changes']), $second['changes']), $second['state']);
eq('for every operation', Changes::fold(Changes::fold(Changes::fold($empty, $site['changes']), $grown['changes']), $dropped['changes']), $dropped['state']);

finish('runtimeschema corpus');
