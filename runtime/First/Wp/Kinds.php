<?php

declare(strict_types=1);

namespace First\Wp;

/**
 * The facade's kinds and the mapping between First rows and core shapes (spec §3a). Each kind names
 * the core route that serves it; the mapping is data only:
 *
 * - post kinds (`/wp/v2/<post type>`): title/content/slug from core's own fields (`raw` in the edit
 *   context), `status` from `post_status` (`publish` → `published`, `future` → `scheduled`,
 *   `pending` → `pending`, others `draft`), `publishedAt` from `date_gmt`, every field from `meta`;
 * - users (`/wp/v2/users`): `email`, `name`, `role` and every member field from `meta`;
 * - tables (`/wp/v2/<table>`): already First rows.
 *
 * Relations `with` attached sit under `with` on core responses and are flattened onto the row.
 */
final class Kinds
{
    /** Where a users response carries First's row during the facade's own dispatches (UserMeta::prepare). */
    public const USER_ROW = '__first_row';

    /** @return array<string, array{name: string, type: string, route: string, spec: array, drafts?: true}> */
    public static function all(Plugin $plugin): array
    {
        $out = [];
        $auth = $plugin->schema->auth()['collection'] ?? null;
        foreach ($plugin->schema->collections() as $name => $spec) {
            $name = (string) $name;
            if ($name === $auth) {
                $out[$name] = ['name' => $name, 'type' => 'users', 'route' => '/wp/v2/users', 'spec' => $spec];
            } elseif (($spec['editor'] ?? true) && ($spec['wp'] ?? null) !== null) {
                $out[$name] = ['name' => $name, 'type' => 'post', 'route' => '/wp/v2/' . $spec['wp']['postType'], 'spec' => $spec]
                    + (($spec['drafts'] ?? false) ? ['drafts' => true] : []);
            } elseif (isset($spec['table'])) {
                $out[$name] = ['name' => $name, 'type' => 'table', 'route' => '/wp/v2/' . $spec['table'], 'spec' => $spec];
            }
        }
        if ($auth !== null) {
            $out['users'] ??= $out[$auth]; // the spec's name for the users kind
        }

        return $out;
    }

    /** A core response item as the First row (fields flat, First's status, relations flattened). */
    public static function row(array $kind, mixed $item): mixed
    {
        if (!is_array($item)) {
            return $item;
        }
        $spec = $kind['spec'];
        $with = is_array($item['with'] ?? null) ? $item['with'] : [];
        if ($kind['type'] === 'table') {
            unset($item['_links'], $item['with']);

            return $item + $with;
        }
        if ($kind['type'] === 'users') {
            // First's row for this viewer, or null: core may list a user First's read rule hides.
            $first = $item[self::USER_ROW] ?? null;

            return $first === null ? null : (is_object($first) ? get_object_vars($first) : (array) $first) + $with;
        }
        $row = [$spec['primaryKey'] => $item['id'] ?? null];
        $text = static fn (mixed $v): mixed => is_array($v) ? ($v['raw'] ?? $v['rendered'] ?? null) : $v;
        foreach ($spec['columns'] as $col => $def) {
            $col = (string) $col;
            if ($col === $spec['primaryKey'] || ($def['hidden'] ?? false)) {
                continue;
            }
            $designation = match ($col) {
                $spec['title'] ?? null => 'title',
                $spec['content'] ?? null => 'content',
                $spec['slug'] ?? null => 'slug',
                default => null,
            };
            if ($designation !== null) {
                if (array_key_exists($designation, $item)) {
                    $row[$col] = $text($item[$designation]);
                }
            } elseif (($def['system'] ?? false) && $col === 'status') {
                $row[$col] = self::status((string) ($item['status'] ?? ''));
            } elseif (($def['system'] ?? false) && $col === 'publishedAt') {
                $row[$col] = in_array($item['status'] ?? null, ['publish', 'future'], true) && is_string($item['date_gmt'] ?? null)
                    ? $item['date_gmt'] . '.000Z' : null;
            } elseif (is_array($item['meta'] ?? null) && array_key_exists($col, $item['meta'])) {
                $row[$col] = $item['meta'][$col];
            }
        }

        return $row + $with;
    }

    /** First input → core input: core's own fields for title/content/slug/status, `meta` for the rest. */
    public static function input(array $kind, array $data, bool $create = false): array
    {
        if ($kind['type'] === 'table') {
            return $data;
        }
        $spec = $kind['spec'];
        $out = [];
        $meta = [];
        foreach ($data as $col => $value) {
            $col = (string) $col;
            if ($kind['type'] === 'users') {
                // Core's own user fields; UserMeta applies them (and `meta`) through First's pipeline.
                match ($col) {
                    'email', 'name', 'password' => $out[$col] = $value,
                    'role' => $out['roles'] = is_string($value) ? [WpUserStore::wpRole($value)] : $value,
                    default => $meta[$col] = $value,
                };
                continue;
            }
            $designation = match ($col) {
                $spec['title'] ?? null => 'title',
                $spec['content'] ?? null => 'content',
                $spec['slug'] ?? null => 'slug',
                default => null,
            };
            if ($designation !== null) {
                $out[$designation] = $value;
            } elseif ($col === 'status' && ($spec['columns']['status']['system'] ?? false)) {
                $out['status'] = ['published' => 'publish', 'scheduled' => 'future', 'draft' => 'draft', 'pending' => 'pending'][$value] ?? $value;
            } elseif ($col === 'publishedAt' && ($spec['columns']['publishedAt']['system'] ?? false)) {
                $out['date_gmt'] = is_string($value) ? substr($value, 0, 19) : $value;
            } else {
                $meta[$col] = $value;
            }
        }
        if ($kind['type'] === 'post' && !isset($out['status']) && $create) {
            $out['status'] = 'publish'; // First's default: a row without a status is published
        }
        if ($kind['type'] === 'users' && $create) {
            // Core requires a login and a password; First generates the login and, without one, a password.
            $out['username'] = 'zm_' . bin2hex(random_bytes(10));
            $out['password'] ??= wp_generate_password(32, true, true);
        }
        if ($meta !== []) {
            $out['meta'] = (object) $meta;
        }

        return $out;
    }

    /** `?format=md`: the title as a heading and the content as markdown (blocks through the toolkit). */
    public static function markdown(array $kind, mixed $item): string
    {
        $row = self::row($kind, $item);
        $spec = $kind['spec'];
        $title = $spec['title'] ?? null;
        $content = $spec['content'] ?? null;
        $out = $title !== null && is_string($row[$title] ?? null) ? '# ' . $row[$title] . "\n\n" : '';
        if ($content !== null && is_string($row[$content] ?? null) && $row[$content] !== '') {
            try {
                $out .= \First\Sync\Markdown::fromBlocks($row[$content]);
            } catch (\First\HttpError) {
                $out .= trim(wp_strip_all_tags($row[$content])) . "\n";
            }
        }

        return $out;
    }

    /** `GET /__first/api/v1`: the app's kinds (with their routes), fields and actions. */
    public static function describe(Plugin $plugin): array
    {
        $described = \First\Extensions::describe($plugin->schema->describe());
        $kinds = [];
        foreach (self::all($plugin) as $name => $kind) {
            $kinds[$name] = ['route' => $kind['route'], 'type' => $kind['type']] + ($described['collections'][$kind['spec']['key'] ?? $name] ?? $described['collections'][$name] ?? []);
        }
        $actions = [];
        foreach ($plugin->schema->actions() as $name => $a) {
            if (($a['signature'] ?? null) !== null || !($a['agents'] ?? true) && false) {
                continue;
            }
            $actions[$name] = ($described['actions'][$name] ?? []) + [
                'readonly' => (bool) ($a['readonly'] ?? false),
                'destructive' => (bool) ($a['destructive'] ?? false),
                'output' => $a['output'] ?? null,
            ];
        }

        return ['name' => $plugin->schema->name(), 'kinds' => $kinds, 'globals' => $described['globals'] ?? [], 'actions' => $actions];
    }

    private static function status(string $status): string
    {
        return match ($status) {
            'publish' => 'published',
            'future' => 'scheduled',
            'pending' => 'pending',
            'private' => 'private',
            default => 'draft',
        };
    }

}
