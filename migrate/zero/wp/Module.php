<?php

declare(strict_types=1);

namespace TypedPress\Wp\Legacy;

use TypedPress\App;
use TypedPress\HttpError;
use TypedPress\Js;
use TypedPress\Wp\Plugin;

/** Explicit content and account imports run outside the app CLI's transaction. */
final class Module
{
    private const USAGE = 'Usage: wordpress content <content-model.php | -> [--apply] [--space=<id>]';
    private const USERS_USAGE = 'Usage: wordpress users --space=<id> [--apply]';

    /** Runs the command and prints `{data}` / `{error}`; returns the exit code. */
    public static function wpCli(Plugin $plugin, string $operation, array $args, array $flags): int
    {
        try {
            foreach (['apply', 'dry-run', 'verify'] as $flag) {
                if (isset($flags[$flag]) && $flags[$flag] !== true) {
                    throw new HttpError(400, 'invalid_command', "--$flag is a switch");
                }
            }
            if (isset($flags['apply']) && (isset($flags['dry-run']) || isset($flags['verify']))) {
                throw new HttpError(400, 'invalid_command', '--apply cannot be combined with --dry-run or --verify');
            }
            $data = match ($operation) {
                'spacefast' => self::spacefast($plugin, $args, $flags),
                'users' => self::users($plugin, $args, $flags),
                'content' => self::run($plugin, $args, $flags),
                default => throw new HttpError(400, 'invalid_command', 'Unknown WordPress import operation'),
            };
            \WP_CLI::line((string) Js::jsonStringify(['data' => $data]));

            return 0;
        } catch (\Throwable $e) {
            \WP_CLI::line((string) Js::jsonStringify(['error' => App::problem($e) + ($e instanceof SpacefastDrift ? ['groups' => $e->groups] : [])]));

            return 1;
        }
    }

    private static function spacefast(Plugin $plugin, array $args, array $flags): array
    {
        $unknown = array_diff(array_keys($flags), ['space', 'source-prefix', 'target-prefix', 'dry-run', 'apply', 'verify']);
        if ($args !== [] || $unknown !== []
            || (isset($flags['verify']) && isset($flags['dry-run']))) {
            throw new HttpError(400, 'invalid_command', 'Usage: wordpress spacefast --space=<id> --source-prefix=<prefix> --target-prefix=<prefix> [--dry-run | --verify]');
        }
        foreach (['space', 'source-prefix', 'target-prefix'] as $key) {
            if (!is_string($flags[$key] ?? null) || $flags[$key] === '') { throw new HttpError(400, 'invalid_command', "--$key is required", '/' . $key); }
        }
        $plugin->app();
        return (new Spacefast($plugin->connection(), $plugin->schema))->run($flags['space'], $flags['source-prefix'], $flags['target-prefix'], !isset($flags['apply']), isset($flags['verify']));
    }

    private static function run(Plugin $plugin, array $args, array $flags): array
    {
        // A typo (`--dryrun`) must not fall through to a real migration.
        $unknown = array_diff(array_keys($flags), ['dry-run', 'apply', 'space']);
        if (count($args) !== 1 || $unknown !== []
            || (isset($flags['space']) && (!is_string($flags['space']) || $flags['space'] === ''))) {
            throw new HttpError(400, 'invalid_command', self::USAGE . ($unknown === [] ? '' : ' (unknown: --' . implode(', --', $unknown) . ')'));
        }
        $file = $args[0];
        $release = self::release($file);
        $dryRun = !isset($flags['apply']);
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

    private static function users(Plugin $plugin, array $args, array $flags): array
    {
        $unknown = array_diff(array_keys($flags), ['dry-run', 'apply', 'space']);
        if ($args !== [] || $unknown !== []
            || !is_string($flags['space'] ?? null) || $flags['space'] === '') {
            throw new HttpError(400, 'invalid_command', self::USERS_USAGE . ($unknown === [] ? '' : ' (unknown: --' . implode(', --', $unknown) . ')'));
        }
        $plugin->app();
        $users = new Users($plugin->connection(), $plugin->schema);

        return self::inTransaction($plugin, !isset($flags['apply']), static fn (bool $dry) => $users->run($flags['space'], $dry));
    }

    /** Run $fn in its own transaction; a dry run plans with real reads, then rolls back. */
    private static function inTransaction(Plugin $plugin, bool $dryRun, callable $fn): array
    {
        if (!$dryRun) {
            return $plugin->connection()->transaction(static fn () => $fn(false));
        }
        $report = null;
        try {
            $plugin->connection()->transaction(static function () use ($fn, &$report): void {
                $report = $fn(true);
                throw new DryRun();
            });
        } catch (DryRun) {
        }

        return $report;
    }

    /** The original release: a path, or `-` for stdin (use stdin to pass a local file). */
    private static function release(string $file): array
    {
        $tmp = null;
        if ($file === '-') {
            $tmp = (string) tempnam(sys_get_temp_dir(), 'typedpress-release');
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
