<?php

declare(strict_types=1);

namespace Zero\Wp\Legacy;

use Zero\App;
use Zero\HttpError;
use Zero\Js;
use Zero\Wp\Plugin;

/**
 * `wp zero migrate-legacy <content-model.php | -> [--dry-run] [--space=<id>]` (WordPress only; see
 * Migrate). A site maintenance command like `wp zero migrate`: it runs in its own transaction, not
 * the app CLI's, so nothing else (scheduled promotion) commits alongside it, and a dry run rolls
 * the whole transaction back.
 */
final class Module
{
    private const USAGE = 'Usage: migrate-legacy <content-model.php | -> [--dry-run] [--space=<id>]';

    /** @param list<string> $args the WP-CLI arguments after `zero` */
    public static function handles(array $args): bool
    {
        return ($args[0] ?? '') === 'migrate-legacy';
    }

    /** Runs the command and prints `{data}` / `{error}`; returns the exit code. */
    public static function wpCli(Plugin $plugin, array $args, array $flags): int
    {
        try {
            $data = self::run($plugin, array_slice($args, 1), $flags);
            \WP_CLI::line((string) Js::jsonStringify(['data' => $data]));

            return 0;
        } catch (\Throwable $e) {
            \WP_CLI::line((string) Js::jsonStringify(['error' => App::problem($e)]));

            return 1;
        }
    }

    private static function run(Plugin $plugin, array $args, array $flags): array
    {
        // A typo (`--dryrun`) must not fall through to a real migration.
        $unknown = array_diff(array_keys($flags), ['dry-run', 'space']);
        if (count($args) !== 1 || $unknown !== [] || (isset($flags['dry-run']) && $flags['dry-run'] !== true)
            || (isset($flags['space']) && (!is_string($flags['space']) || $flags['space'] === ''))) {
            throw new HttpError(400, 'invalid_command', self::USAGE . ($unknown === [] ? '' : ' (unknown: --' . implode(', --', $unknown) . ')'));
        }
        $file = $args[0];
        $release = self::release($file);
        $dryRun = isset($flags['dry-run']);
        $space = isset($flags['space']) && is_string($flags['space']) ? $flags['space'] : null;
        // Boot the app (loads compiled validators and default functions) without the CLI's prologue.
        $plugin->app();
        $migrate = new Migrate($plugin->connection(), $plugin->schema);
        if (!$dryRun) {
            return $plugin->connection()->transaction(static fn () => $migrate->run($release, false, $space));
        }
        // Plan and validate with real reads, then roll back: a dry run commits nothing.
        $report = null;
        try {
            $plugin->connection()->transaction(static function () use ($migrate, $release, $space, &$report): void {
                $report = $migrate->run($release, true, $space);
                throw new DryRun();
            });
        } catch (DryRun) {
        }

        return $report;
    }

    /** The original release: a path, or `-` for stdin (so `zero migrate site` can send a local file). */
    private static function release(string $file): array
    {
        $tmp = null;
        if ($file === '-') {
            $tmp = (string) tempnam(sys_get_temp_dir(), 'zero-release');
            file_put_contents($tmp, (string) stream_get_contents(STDIN));
            $file = $tmp;
        }
        try {
            if (!is_file($file)) {
                throw new HttpError(400, 'invalid_command', "No release at $file; pass the original site's content-model.php");
            }
            // The release is the original compiler's PHP artifact (`return [...]`), trusted like `wp eval-file`.
            $release = (static fn (string $path): mixed => require $path)($file);
        } finally {
            if ($tmp !== null) {
                unlink($tmp);
            }
        }
        if (!is_array($release)) {
            throw Model::refuse('', 'content-model.php must return an array');
        }

        return $release;
    }
}

