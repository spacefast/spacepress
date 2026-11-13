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
$kinds = (require __DIR__ . '/../runtime-schema/base.schema.php')['collections'];
$empty = ['format' => Loader::FORMAT, 'version' => 0, 'hash' => '', 'collections' => []];
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
foreach (['removeField', 'renameField', 'changeField', 'addTable', 'addAction', 'addHook', 'dropKind'] as $op) {
    eq("$op is build-only", $verdict(['format' => 1, 'changes' => [['op' => $op, 'kind' => 'articles', 'field' => 'rating']]], $kinds), '422 schema_build_only /changes/0/op');
}
$two = ['format' => 1, 'changes' => [
    ['op' => 'addField', 'kind' => 'articles', 'field' => 'subtitle', 'definition' => $text],
    ['op' => 'addField', 'kind' => 'articles', 'field' => 'subtitle', 'definition' => $text],
]];
eq('one change set can\'t add a name twice', $verdict($two, $kinds), '422 schema_invalid /changes/1/field');
$stateWith = $empty;
$stateWith['collections']['articles']['columns']['subtitle'] = $text;
eq('a name an earlier version added is taken, whatever this request\'s schema holds', $verdict($add('articles', 'subtitle', $text), $kinds, $stateWith), '422 schema_invalid /changes/0/field');
$many = ['format' => 1, 'changes' => array_map(static fn (int $i): array => ['op' => 'addField', 'kind' => 'articles', 'field' => "f$i", 'definition' => $text], range(1, Changes::MAX_CHANGES + 1))];
eq('one version holds a bounded number of changes', $verdict($many, $kinds), '422 schema_format /changes');
$full = $empty;
$full['collections']['articles']['columns'] = array_fill_keys(array_map(static fn (int $i): string => "wide$i", range(1, 900)), ['type' => 'text', 'ui' => ['help' => str_repeat('h', 60)]]);
eq('a state past the option bound is refused with the way out', $verdict($add('articles', 'subtitle', $text), $kinds, $full), '422 schema_too_large /changes');
foreach (['localized' => true, 'sync' => ['dir' => 'content/articles', 'format' => 'md']] as $key => $value) {
    $other = $kinds;
    $other['articles'][$key] = $value;
    eq("a kind with `$key` takes fields from source only", $verdict($add('articles', 'subtitle', $text), $other), '422 schema_build_only /changes/0/kind');
}

$related = $kinds;
$related['articles']['relations']['votes'] = ['kind' => 'many', 'collection' => 'votes', 'from' => 'id', 'to' => 'article', 'optional' => false];
eq('a name a relation of the kind has is taken, with the compiler\'s code', [$verdict($add('articles', 'votes', $text), $related), $verdict($add('articles', 'subtitle', $text), $related)],
    ['422 schema_invalid /changes/0/field', 'accept']);

// ---------------------------------------------------------------- replay
$first = Changes::resolve($kinds, $empty, $add('articles', 'subtitle', $text));
$second = Changes::resolve($kinds, $first['state'], $add('articles', 'stars', ['type' => 'integer', 'rules' => ['max' => 5]]));
eq('folding the stored changes gives the state again', Changes::fold(Changes::fold($empty, $first['changes']), $second['changes']), $second['state']);

finish('runtimeschema corpus');
