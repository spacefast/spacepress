<?php

declare(strict_types=1);

namespace Zero\Wp;

/**
 * The facade's kinds and the mapping between Zero rows and core shapes (spec §3a). Each kind names
 * the core route that serves it; the mapping is data only:
 *
 * - post kinds (`/wp/v2/<post type>`): title/content/slug from core's own fields (`raw` in the edit
 *   context), `status` from `post_status` (`publish` → `published`, `future` → `scheduled`,
 *   `pending` → `pending`, others `draft`), `publishedAt` from `date_gmt`, every field from `meta`;
 * - users (`/wp/v2/users`): `email`, `name`, `role` and every member field from `meta`;
 * - tables (`/wp/v2/<table>`): already Zero rows.
 *
 * Relations `with` attached sit under `with` on core responses and are flattened onto the row.
 */
final class Kinds
{
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

    /** A core response item as the Zero row (fields flat, Zero's status, relations flattened). */
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
        $row = [$spec['primaryKey'] => $item['id'] ?? null];
        if ($kind['type'] === 'users') {
            $member = $item['meta'] ?? [];
            foreach ($spec['columns'] as $col => $def) {
                $col = (string) $col;
                if ($col === $spec['primaryKey'] || ($def['hidden'] ?? false)) {
                    continue;
                }
                $value = match ($col) {
                    'email' => $item['email'] ?? null,
                    'name' => $item['name'] ?? null,
                    'role' => array_key_exists('roles', $item) ? self::role((array) $item['roles']) : null,
                    default => $member[$col] ?? null,
                };
                if ($value !== null || array_key_exists($col, $member) || in_array($col, ['email', 'name'], true) && array_key_exists($col, $item)) {
                    $row[$col] = $value;
                }
            }

            return $row + $with;
        }
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

    /** Zero input → core input: core's own fields for title/content/slug/status, `meta` for the rest. */
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
                match ($col) {
                    'email', 'name' => $out[$col] = $value,
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
            $out['status'] = 'publish'; // Zero's default: a row without a status is published
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
                $out .= \Zero\Sync\Markdown::fromBlocks($row[$content]);
            } catch (\Zero\HttpError) {
                $out .= trim(wp_strip_all_tags($row[$content])) . "\n";
            }
        }

        return $out;
    }

    /** `GET /__zero/api/v1`: the app's kinds (with their routes), fields and actions. */
    public static function describe(Plugin $plugin): array
    {
        $described = \Zero\Extensions::describe($plugin->schema->describe());
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

    /** @param list<string> $roles */
    private static function role(array $roles): string
    {
        return match (true) {
            in_array('administrator', $roles, true) => 'admin',
            in_array('editor', $roles, true) => 'editor',
            in_array('author', $roles, true) || in_array('contributor', $roles, true) => 'author',
            in_array('zero_guest', $roles, true) => 'guest',
            default => 'subscriber',
        };
    }
}
