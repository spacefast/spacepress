<?php

declare(strict_types=1);

namespace TypedPress\Sync;

use TypedPress\App;
use TypedPress\HttpError;
use TypedPress\Js;
use TypedPress\Seam;
use TypedPress\Wp\Plugin;

/** TypedPress-sync content from compiled sources, with one transaction per collection and no deletes. */
final class Seed
{
    public static function wpCli(Plugin $plugin, array $args, array $flags): int
    {
        try {
            if ($args !== ['seed'] || array_diff(array_keys($flags), ['records', 'dry-run']) !== []
                || !is_string($flags['records'] ?? null) || $flags['records'] === ''
                || (isset($flags['dry-run']) && $flags['dry-run'] !== true)) {
                throw new HttpError(400, 'invalid_command', 'Usage: seed --records=<dir> [--dry-run]');
            }
            $receipt = self::run($plugin, $flags['records'], isset($flags['dry-run']));
            $out = ['data' => $receipt];
            $skipped = array_sum(array_column($receipt, 'skipped_existing'));
            if ($skipped > 0) {
                $out['warnings'] = [['code' => 'tp_seed_skipped_existing', 'count' => $skipped, 'detail' => 'Existing editable records kept their site content. Run typedpress sync to merge file edits.']];
            }
            \WP_CLI::line((string) Js::jsonStringify($out));
            return 0;
        } catch (\Throwable $e) {
            \WP_CLI::line((string) Js::jsonStringify(['error' => App::problem($e)]));
            return 1;
        }
    }

    public static function run(Plugin $plugin, string $directory, bool $dry = false, ?array $expectedHashes = null): array
    {
        if (!is_dir($directory)) {
            throw new HttpError(400, 'invalid_command', 'Seed records directory does not exist.', '/records');
        }
        $plugin->app();
        $entries = @scandir($directory);
        if ($entries === false) { throw new \RuntimeException('Cannot list seed records'); }
        $files = [];
        foreach ($entries as $entry) {
            // Hidden files and other extensions are not seed input.
            if ($entry[0] !== '.' && (str_ends_with($entry, '.json') || str_ends_with($entry, '.php'))) {
                $files[] = rtrim($directory, '/') . '/' . $entry;
            }
        }
        sort($files, SORT_STRING);
        if ($expectedHashes !== null) {
            $actual = [];
            foreach ($files as $file) { $actual[basename($file)] = hash_file('sha256', $file); }
            $mismatched = [];
            foreach (array_keys($expectedHashes + $actual) as $name) {
                if (!isset($expectedHashes[$name], $actual[$name]) || $actual[$name] !== $expectedHashes[$name]) {
                    $mismatched[] = $name;
                }
            }
            if ($mismatched !== []) {
                sort($mismatched, SORT_STRING);
                throw new \RuntimeException('Commerce seed files do not match the compiled seed version: ' . implode(', ', $mismatched));
            }
        }
        $files = self::ordered($plugin, $files);
        $plan = static function () use ($plugin, $files, $dry): array {
            $receipt = [];
            foreach ($files as $file) {
                try {
                    $input = str_ends_with($file, '.php') ? require $file : Seam::container(Js::decodeJson((string) file_get_contents($file)));
                } catch (\JsonException $e) {
                    throw new HttpError(400, 'invalid_json', 'Invalid seed JSON: ' . $e->getMessage(), '/records/' . basename($file));
                }
                $collection = $input['collection'] ?? null;
                if (!is_string($collection) || pathinfo($file, PATHINFO_FILENAME) !== $collection || isset($receipt[$collection])) {
                    throw HttpError::invalidInput('Seed collection must match its filename.', '/collection');
                }
                $spec = $plugin->schema->collection($collection);
                if (($spec['sync'] ?? null) === null || ($input['format'] ?? null) !== $spec['sync']['format']) {
                    throw HttpError::invalidInput('Seed format must match a synced collection.', '/format');
                }
                $records = Seam::container($input['records'] ?? null);
                if (!is_array($records) || !array_is_list($records)) {
                    throw HttpError::invalidInput('Seed records must be a list.', '/records');
                }
                // Only taxonomy hierarchies need parent-first records; ordinary references may cycle.
                if (($spec['taxonomy'] ?? false) && isset($spec['columns']['parent']['references'])) {
                    $pending = $records; $records = []; $done = [];
                    while ($pending !== []) {
                        $progress = false;
                        foreach ($pending as $i => $record) {
                            $row = Seam::container($record); $fields = Seam::container($row['fields'] ?? []); $parent = $fields['parent'] ?? null;
                            if ($parent !== null && !isset($done[$parent]) && array_filter($pending, static fn ($r) => Seam::container($r)['uid'] === $parent)) { continue; }
                            $records[] = $record; $done[$row['uid']] = true; unset($pending[$i]); $progress = true;
                        }
                        if (!$progress) { throw HttpError::invalidInput('Cyclic parent terms', '/records'); }
                    }
                }
                $receipt[$collection] = $plugin->connection()->transaction(static function () use ($collection, $spec, $records): array {
                    $counts = array_fill_keys(['created', 'unchanged', 'skipped_existing', 'updated', 'trashed_skipped'], 0);
                    $seen = [];
                    foreach ($records as $index => $record) {
                        $row = Seam::container($record);
                        $uid = $row['uid'] ?? null;
                        if (!Uid::valid($uid) || isset($seen[$uid])) {
                            throw HttpError::invalidInput('Seed records need unique valid uids.', '/records/' . $index . '/uid');
                        }
                        $seen[$uid] = true;
                        $counts[Routes::seedRecord($collection, $spec, $record)]++;
                    }
                    return $counts;
                });
            }
            if ($dry) { throw new SeedDryRun($receipt); }
            return $receipt;
        };
        if (!$dry) { return $plan(); }
        try { return $plugin->connection()->transaction($plan); }
        catch (SeedDryRun $rollback) { return $rollback->counts; }
    }

    /** Dependencies first; schema cycles stay together, in deterministic source order. */
    private static function ordered(Plugin $plugin, array $files): array
    {
        $names = array_fill_keys(array_map(static fn ($file) => pathinfo($file, PATHINFO_FILENAME), $files), true);
        $dependencies = [];
        foreach ($names as $name => $_) {
            $dependencies[$name] = [];
            foreach ($plugin->schema->collection($name)['columns'] as $column) {
                $target = $column['references']['collection'] ?? null;
                if ($target !== null && isset($names[$target])) { $dependencies[$name][] = $target; }
            }
        }
        // Tarjan's traversal emits each strongly connected component after its dependencies.
        // Cyclic schemas can have null/omitted or already-stored references; Wire checks actual UIDs.
        $indices = []; $low = []; $stack = []; $active = []; $ordered = [];
        $visit = static function (string $name) use (&$visit, &$indices, &$low, &$stack, &$active, &$ordered, $dependencies, $files): void {
            $indices[$name] = $low[$name] = count($indices);
            $stack[] = $name; $active[$name] = true;
            foreach ($dependencies[$name] as $target) {
                if (!isset($indices[$target])) {
                    $visit($target); $low[$name] = min($low[$name], $low[$target]);
                } elseif (isset($active[$target])) { $low[$name] = min($low[$name], $indices[$target]); }
            }
            if ($low[$name] !== $indices[$name]) { return; }
            $component = [];
            do { $member = array_pop($stack); unset($active[$member]); $component[$member] = true; } while ($member !== $name);
            foreach ($files as $file) {
                if (isset($component[pathinfo($file, PATHINFO_FILENAME)])) { $ordered[] = $file; }
            }
        };
        foreach ($names as $name => $_) { if (!isset($indices[$name])) { $visit($name); } }
        return $ordered;
    }
}

final class SeedDryRun extends \RuntimeException
{
    public function __construct(public readonly array $counts) { parent::__construct('rollback seed dry run'); }
}
