<?php

declare(strict_types=1);

namespace First\RuntimeSchema;

use First\HttpError;
use First\Wp\Abilities\Invoke;
use First\Wp\Abilities\JsonSchema;
use First\Wp\Runtime;
use First\Wp\SchemaVersions;

/**
 * The ways in to runtime schema changes (spec §2.10), all over {@see SchemaVersions}:
 *
 * - Abilities `<app>/schema-read`, `<app>/schema-propose` and `<app>/schema-apply`, served by core's
 *   run route and the MCP Adapter like every other ability of the app. Reading and proposing need
 *   `manage_options`. Applying needs `first_apply_schema`, a capability of its own, which this
 *   module grants to administrators when it is first needed. Taking it away from a role or a user
 *   (`wp cap remove administrator first_apply_schema`) stops them applying and nothing else.
 *   An application password can be denied applying on its own: an administrator lists its UUID in
 *   the `first_<app>_schema_apply_denied` option.
 * - `wp first schema list | diff <version> | apply <file> | rollback <version>`: the trusted CLI,
 *   which needs no capability (`first schema …` forwards to it).
 * - A screen, "Schema versions", declared once for both admins (runtime/admin/lib/screens.php):
 *   under Tools in classic wp-admin and in First Admin's sidebar. It lists the versions through
 *   `<app>/schema-read`, so it shows exactly what an agent reads.
 *
 * Every apply records who made it: the user, and the application password's UUID and name when one
 * signed the request (never the secret), or `wp-cli`.
 */
final class Surfaces
{
    public const APPLY = 'first_apply_schema';
    private const READ = 'manage_options';

    public static function register(): void
    {
        if (!function_exists('add_action')) {
            return; // the runtime loaded outside WordPress (the pure PHP suites): nothing to serve
        }
        add_filter('first_ability_operations', [self::class, 'operations'], 10, 2);
        add_filter('user_has_cap', [self::class, 'grant'], 10, 4);
        add_action('first_admin_screens', [self::class, 'screen']);
        // Outside the app's command transaction: applying takes the schema lock and commits its own.
        $command = static fn () => Runtime::command('schema', self::wpCli(...));
        did_action('first_runtime_loaded') ? $command() : add_action('first_runtime_loaded', $command);
    }

    private static function versions(): SchemaVersions
    {
        $plugin = Runtime::plugin() ?? throw new HttpError(503, 'unavailable', 'No First app is active');

        return SchemaVersions::of($plugin)
            ?? throw HttpError::notFound('This app does not use runtime schema changes (runtimeSchema: true in first.config.ts)');
    }

    /** Administrators hold `first_apply_schema` until a role or user record says otherwise. */
    public static function grant(array $all, array $caps, array $args, \WP_User $user): array
    {
        if (in_array(self::APPLY, $caps, true) && !array_key_exists(self::APPLY, $all) && !empty($all['manage_options'])) {
            $all[self::APPLY] = true;
        }

        return $all;
    }

    /** The application password that signed this request, or null. */
    private static function credential(): ?array
    {
        $uuid = function_exists('rest_get_authenticated_app_password') ? rest_get_authenticated_app_password() : null;
        if (!is_string($uuid) || $uuid === '') {
            return null;
        }
        $password = \WP_Application_Passwords::get_user_application_password(get_current_user_id(), $uuid);

        return ['uuid' => $uuid, 'name' => (string) ($password['name'] ?? '')];
    }

    /** Who is applying: the signed-in user and the credential, as a version records them. */
    private static function actor(string $via): array
    {
        $user = wp_get_current_user();
        $actor = ['user' => (int) $user->ID, 'login' => $user->ID === 0 ? null : (string) $user->user_login, 'via' => $via];
        $credential = self::credential();

        return $credential === null ? $actor : $actor + ['credential' => $credential];
    }

    private static function deniedOption(): string
    {
        return 'first_' . (Runtime::plugin()?->schema->name() ?? 'app') . '_schema_apply_denied';
    }

    /** Whether the current request may apply: the capability, and a credential that isn't denied. */
    private static function mayApply(): bool
    {
        if (!current_user_can(self::APPLY)) {
            return false;
        }
        $credential = self::credential();
        $denied = get_option(self::deniedOption(), []);

        return $credential === null || !in_array($credential['uuid'], is_array($denied) ? $denied : [], true);
    }

    /**
     * A version as the surfaces show it: without the app name, which every row shares, and with
     * `by` and `summary`, who made it and each change in a sentence.
     */
    private static function version(array $row): array
    {
        return array_diff_key($row, ['app' => true])
            + ['by' => self::by($row), 'summary' => array_map(self::describe(...), $row['changes'] ?? [])];
    }

    /**
     * The three abilities, added to the app's operation list.
     *
     * @param list<array> $ops
     * @return list<array>
     */
    public static function operations(array $ops, string $app): array
    {
        $plugin = Runtime::plugin();
        if ($plugin === null || SchemaVersions::of($plugin) === null) {
            return $ops;
        }
        $change = ['type' => 'object', 'properties' => [
            'parent' => ['type' => 'integer', 'description' => 'The version this change was made against: the `version` schema-read returned.'],
            // A read-only ability runs over GET, where a query string can't carry typed JSON, so the
            // changes may also come as one JSON string (as `where` does on list abilities).
            'changes' => ['type' => ['array', 'string'], 'items' => ['type' => 'object'], 'description' => 'The changes, as a list or as one JSON string: addField, addGlobalField, addCollection, addGlobal, setLabel, setFieldUi, removeField, removeCollection, removeGlobal.'],
        ], 'required' => ['changes']];
        $changes = static function (array $in): mixed {
            $changes = $in['changes'] ?? null;
            if (!is_string($changes)) {
                return $changes;
            }
            try {
                return json_decode($changes, true, 64, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                throw HttpError::invalidInput('`changes` is a list of changes, or one JSON string of it', '/changes');
            }
        };
        $allowed = static fn (string $what): array => [['allow' => true], 'read', $what];
        $guard = static function (bool $ok, string $what): void {
            if (!$ok) {
                throw Invoke::viewer()->user === null
                    ? new HttpError(401, 'unauthenticated', "Sign in to $what")
                    : new HttpError(403, 'forbidden', "You may not $what");
            }
        };
        $ops[] = [
            'name' => "$app/schema-read", 'op' => 'schema-read', 'agents' => true,
            'label' => 'Read the schema versions', 'description' => 'The site\'s runtime schema: the active version, every stored version with what it changed, and what a deploy of the running build would keep.',
            'input' => JsonSchema::input([], []), 'output' => ['type' => 'object'],
            'annotations' => ['readonly' => true, 'idempotent' => true], 'rule' => $allowed('read the schema versions'), 'first' => ['schema' => 'read'],
            'run' => static function () use ($guard): array {
                $guard(current_user_can(self::READ), 'read the schema versions');
                $versions = self::versions();

                return ['version' => $versions->active()['version'], 'hash' => $versions->active()['hash'],
                    'versions' => array_map(self::version(...), $versions->list()), 'deploy' => $versions->deployCheck()];
            },
        ];
        $ops[] = [
            'name' => "$app/schema-propose", 'op' => 'schema-propose', 'agents' => true,
            'label' => 'Propose a schema change', 'description' => 'Checks a runtime schema change set and returns it in stored form with what it would do to stored data. Writes nothing.',
            'input' => $change, 'output' => ['type' => 'object'],
            'annotations' => ['readonly' => true, 'idempotent' => true], 'rule' => $allowed('propose a schema change'), 'first' => ['schema' => 'propose'],
            'run' => static function (array $in) use ($guard, $changes): array {
                $guard(current_user_can(self::READ), 'propose a schema change');

                return self::versions()->propose(['format' => Loader::FORMAT, 'changes' => $changes($in)]);
            },
        ];
        $ops[] = [
            'name' => "$app/schema-apply", 'op' => 'schema-apply', 'agents' => true,
            'label' => 'Apply a schema change', 'description' => 'Stores a runtime schema change set as the next version and makes it active. `parent` must be the newest version; if another change was applied first the answer is 409 and the change must be proposed again.',
            'input' => $change + ['required' => ['parent', 'changes']], 'output' => ['type' => 'object'],
            'annotations' => ['destructive' => false, 'idempotent' => false], 'rule' => $allowed('apply a schema change'), 'first' => ['schema' => 'apply'],
            'run' => static function (array $in) use ($guard, $changes): array {
                $guard(self::mayApply(), 'apply a schema change');
                $parent = $in['parent'] ?? null;
                if (!is_int($parent)) {
                    throw HttpError::invalidInput('`parent` is the version this change was made against', '/parent');
                }

                return self::version(self::versions()->apply($parent, ['format' => Loader::FORMAT, 'changes' => $changes($in)], self::actor('ability')));
            },
        ];

        return $ops;
    }

    /** `wp first schema …` as WP-CLI runs it: one JSON document, `{data}` or `{error}`, and the exit code. */
    public static function wpCli(array $args, array $flags): int
    {
        try {
            [$code, $out] = [0, ['data' => self::cli($args, $flags)]];
        } catch (\Throwable $e) {
            [$code, $out] = [1, ['error' => \First\App::problem($e)]];
        }
        \WP_CLI::line((string) \First\Js::jsonStringify($out));

        return $code;
    }

    /**
     * `wp first schema list | diff <version> | apply <file|-> [--parent=<n>] | rollback <version> [--parent=<n>]`.
     *
     * @param list<string> $args
     * @param array<string, string|true> $flags
     */
    public static function cli(array $args, array $flags): mixed
    {
        $versions = self::versions();
        $number = static function (?string $raw, string $what): int {
            if ($raw === null || preg_match('/\A[1-9][0-9]*\z/', $raw) !== 1) {
                throw new HttpError(400, 'invalid_command', "$what needs a version number");
            }

            return (int) $raw;
        };
        // The newest stored version, not the one this process loaded: another may have been applied since.
        $newest = static function () use ($versions): int {
            $rows = $versions->list();

            return $rows === [] ? 0 : end($rows)['version'];
        };
        $parent = static fn (): int => isset($flags['parent']) ? $number((string) $flags['parent'], '--parent') : $newest();

        return match ($args[0] ?? null) {
            'list' => array_map(static fn (array $row): array => array_diff_key(self::version($row), ['changes' => true])
                + ['changes' => count($row['changes'])], $versions->list()),
            'diff' => (static function () use ($versions, $number, $args): array {
                $version = $number($args[1] ?? null, 'schema diff');
                foreach ($versions->list() as $row) {
                    if ($row['version'] === $version) {
                        return self::version($row);
                    }
                }
                throw HttpError::notFound("No schema version $version");
            })(),
            'apply' => (static function () use ($versions, $args, $parent): array {
                $file = $args[1] ?? throw new HttpError(400, 'invalid_command', 'schema apply needs a JSON file of changes, or - for standard input');
                $text = $file === '-' ? stream_get_contents(STDIN) : @file_get_contents($file);
                if (!is_string($text)) {
                    throw new HttpError(400, 'invalid_command', "Cannot read $file");
                }
                try {
                    $changeSet = json_decode($text, true, 64, JSON_THROW_ON_ERROR);
                } catch (\JsonException $e) {
                    throw HttpError::invalidInput("$file is not JSON: " . $e->getMessage());
                }
                // A bare list of changes is the common case; a whole change set is accepted too.
                $changeSet = is_array($changeSet) && array_is_list($changeSet) ? ['format' => Loader::FORMAT, 'changes' => $changeSet] : $changeSet;

                return self::version($versions->apply($parent(), $changeSet, self::actor('wp-cli')));
            })(),
            'rollback' => self::version($versions->apply($parent(), $versions->reversal($number($args[1] ?? null, 'schema rollback')), self::actor('wp-cli'))),
            default => throw new HttpError(400, 'invalid_command', 'usage: wp first schema list | diff <version> | apply <file|-> [--parent=<n>] | rollback <version> [--parent=<n>]'),
        };
    }

    /** Tools → Schema versions, for administrators, when the app uses runtime schema changes. */
    /** The versions screen, for both admins (First Admin's screen API; absent with `admin: false`). */
    public static function screen(): void
    {
        $plugin = Runtime::plugin();
        if ($plugin === null || SchemaVersions::of($plugin) === null || !function_exists('first_admin_register_screen')) {
            return;
        }
        $app = $plugin->schema->name();
        first_admin_register_screen('schema-versions', [
            'title' => 'Schema versions',
            'description' => 'Runtime schema changes stored on this site, newest first.',
            'capability' => self::READ,
            'classic' => ['parent' => 'tools.php'],
            'menu' => ['icon' => 'dashicons-backup'],
            'view' => [
                'ability' => "$app/schema-read",
                'items' => 'versions',
                'id' => 'version',
                'fields' => [
                    ['id' => 'version', 'label' => 'Version', 'type' => 'integer'],
                    ['id' => 'createdAt', 'label' => 'When', 'type' => 'datetime'],
                    ['id' => 'by', 'label' => 'Who'],
                    ['id' => 'summary', 'label' => 'Changes', 'type' => 'array'],
                ],
                'layout' => ['type' => 'table', 'fields' => ['createdAt', 'by', 'summary'], 'titleField' => 'version',
                    'sort' => ['field' => 'version', 'direction' => 'desc']],
            ],
            'data' => static function (): array {
                $versions = self::versions();
                $deploy = $versions->deployCheck();
                $lines = [sprintf('Active version: %d. The build this site runs contains version %d.', $versions->active()['version'], $deploy['build']['version'])];
                if ($deploy['kept'] !== []) {
                    $lines[] = 'On this site but not in the build: ' . implode(', ', $deploy['kept']) . '. Run `first pull` in the project to bring them into git.';
                }

                return $lines;
            },
        ]);
    }

    /** Who made a version, in words. */
    private static function by(array $row): string
    {
        $who = (string) ($row['actor']['login'] ?? 'system');
        if (isset($row['actor']['credential']['name'])) {
            return $who . ' (application password ' . $row['actor']['credential']['name'] . ')';
        }

        return ($row['actor']['via'] ?? null) === 'wp-cli' ? $who . ' (WP-CLI)' : $who;
    }

    /** One change in a sentence. */
    public static function describe(array $change): string
    {
        $kind = $change['kind'] ?? $change['global'] ?? '';
        $field = isset($change['field']) ? "$kind.{$change['field']}" : $kind;

        return match ($change['op']) {
            'addField', 'addGlobalField' => "Added $field ({$change['definition']['type']}" . (($change['definition']['notNull'] ?? false) ? ', required' : '') . ')',
            'addCollection' => "Added the collection $kind with " . implode(', ', array_keys($change['definition']['fields'])),
            'addGlobal' => "Added the global $kind with " . implode(', ', array_keys($change['definition']['fields'])),
            'setLabel' => $change['label'] === null ? "Took the runtime label off $kind" : "Labelled $kind \"{$change['label']}\"",
            'setFieldUi' => $change['ui'] === null ? "Took the runtime presentation off $field" : "Set how $field is presented",
            'removeField' => "Hid $field (its values are kept)",
            'removeCollection' => "Hid the collection $kind (its items are kept)",
            'removeGlobal' => "Hid the global $kind (its values are kept)",
            default => (string) $change['op'],
        };
    }
}
