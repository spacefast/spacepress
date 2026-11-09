<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\HttpError;
use Zero\Js;
use Zero\Schema;
use Zero\Wp\Abilities\JsonSchema;

/**
 * Core `meta` for a Zero post type (spec §3a): every field is registered post meta (`show_in_rest`,
 * with its JSON Schema) under its own name, so `/wp/v2/<type>` reads and writes `meta.<field>`.
 *
 * Values are Zero's, not raw postmeta: a read is the decoded row (a group or repeater is one value,
 * not SCF's sub-field rows); a write goes through Zero's codec and rules and the post store's write
 * path (unique checks, SCF storage forms). Who may read or write a field is not decided here:
 * {@see CoreAccess::strip()} drops hidden fields from responses and {@see EditorSave} authorizes the
 * save, `meta` included ({@see CoreAccess::incoming()}).
 */
final class PostMeta extends \WP_REST_Post_Meta_Fields
{
    public function __construct(string $postType, private readonly string $collection)
    {
        parent::__construct($postType);
    }

    /** register_post_meta for every field of a post-backed collection (init). */
    public static function register(array $spec): void
    {
        foreach (self::fields($spec) as $col => $def) {
            $schema = JsonSchema::column($def, true);
            $types = array_values(array_diff((array) $schema['type'], ['null']));
            register_post_meta($spec['wp']['postType'], $spec['wp']['metaPrefix'] . $col, [
                'single' => true,
                // register_meta's own type is one name; the schema carries the full (nullable) type.
                'type' => count($types) === 1 ? $types[0] : 'object',
                'label' => (string) ($def['ui']['label'] ?? $col),
                'show_in_rest' => ['name' => $col, 'schema' => $schema],
                // Never written through core's generic meta path (it would bypass Zero's codec).
                'auth_callback' => '__return_false',
            ]);
        }
    }

    /**
     * The request's `meta`, read from the JSON body with Zero's decoder when there is one: core's
     * parser turns `{}` into `[]`, which a json() field keeps apart.
     */
    public static function input(\WP_REST_Request $request): mixed
    {
        $body = (string) $request->get_body();
        if (($request->get_content_type()['value'] ?? null) === 'application/json' && trim($body) !== '') {
            try {
                $decoded = \Zero\Seam::container(Js::decodeJson($body));
                if (is_array($decoded) && array_key_exists('meta', $decoded)) {
                    return \Zero\Seam::container($decoded['meta']);
                }
            } catch (\JsonException) {
            }
        }

        return $request->get_param('meta');
    }

    /** @var ?array the current save's `meta`, as {@see input()} read it */
    private ?array $input = null;

    /** Run a create or update with $request's `meta` read by {@see input()}. */
    public function saving(\WP_REST_Request $request, callable $save): mixed
    {
        $previous = $this->input;
        $input = self::input($request);
        $this->input = is_array($input) ? $input : null;
        try {
            return $save();
        } finally {
            $this->input = $previous;
        }
    }

    /** @return array<string, array> the columns that live in postmeta, by name */
    public static function fields(array $spec): array
    {
        $out = [];
        foreach ($spec['columns'] as $col => $def) {
            $col = (string) $col;
            if ($col !== $spec['primaryKey'] && $col !== ($spec['title'] ?? null) && $col !== ($spec['content'] ?? null)
                && $col !== ($spec['slug'] ?? null) && !($def['system'] ?? false)) {
                $out[$col] = $def;
            }
        }

        return $out;
    }

    /** True while core's own code handles the meta that isn't Zero's (other plugins' registered keys). */
    private bool $others = false;

    protected function get_registered_fields()
    {
        $spec = $this->spec();
        $zero = [];
        foreach (self::fields($spec) as $col => $def) {
            $zero[$spec['wp']['metaPrefix'] . $col] = ['name' => $col, 'single' => true, 'schema' => ['default' => null] + JsonSchema::column($def, true), 'prepare_callback' => null];
        }
        $others = array_diff_key(parent::get_registered_fields(), $zero);

        return $this->others ? $others : $zero + $others;
    }

    /** Core's handling, for the registered meta that isn't a Zero field. */
    private function others(callable $fn): mixed
    {
        $this->others = true;
        try {
            return $fn();
        } finally {
            $this->others = false;
        }
    }

    /** @var array{int, ?array}|null the row being prepared, so a response reads it once */
    private ?array $row = null;

    /** Run $prepare with $row as post $id's stored row (the controller already read it). */
    public function with(int $id, ?array $row, callable $prepare): mixed
    {
        $previous = $this->row;
        $this->row = [$id, $row];
        try {
            return $prepare();
        } finally {
            $this->row = $previous;
        }
    }

    public function get_value($object_id, $request)
    {
        $spec = $this->spec();
        $out = [];
        $row = ($this->row !== null && $this->row[0] === (int) $object_id ? $this->row[1]
            : Plugin::instance()?->db()->editorRow($this->collection, (int) $object_id)) ?? [];
        foreach (self::fields($spec) as $col => $def) {
            $out[$col] = Js::jsonTree($row[$col] ?? null);
        }

        return $out + $this->others(fn () => parent::get_value($object_id, $request));
    }

    public function update_value($meta, $object_id)
    {
        if (!is_array($meta)) {
            return null;
        }
        $fields = self::fields($this->spec());
        $values = $norms = [];
        $zero = $this->input ?? $meta;
        $db = Plugin::instance()?->db() ?? throw new \LogicException('No Zero app');
        $viewer = CoreAccess::viewer();
        $before = null;
        foreach (array_intersect_key($zero, $fields) as $col => $v) {
            $col = (string) $col;
            $def = $fields[$col];
            $ptr = HttpError::seg($col);
            $v = \Zero\Seam::toPhp($v, $def);
            if ($def['type'] === 'group' && $viewer !== null) {
                // A partial group keeps the stored sub-fields this viewer can't read or set, as on /zero/v1.
                $before ??= $db->editorRow($this->collection, (int) $object_id) ?? [];
                $v = $db->current(static fn () => \Zero\FieldAccess::effectiveGroup('update', $def, $v, $before[$col] ?? null, $viewer));
            }
            $norm = Schema::normalize($def, $v, $col, $ptr);
            Schema::checkRules($def, $norm, $col, $ptr, ['data' => [$col => $norm], 'user' => WpAuth::current()]);
            $norms[$col] = $norm;
            $values[$col] = Schema::store($def, $norm);
        }
        // Media ids must name attachments (of an accepted kind), as every other write path checks.
        $db->checkMedia($fields, $norms);
        if ($values !== []) {
            $store = $db->store();
            if (!$store instanceof CompositeStore) {
                throw new \LogicException('Zero post meta needs the WordPress store');
            }
            $store->posts->update($this->collection, (int) $object_id, $values);
        }
        $rest = array_diff_key($meta, $fields);

        return $rest === [] ? null : $this->others(fn () => parent::update_value($rest, $object_id));
    }

    private function spec(): array
    {
        return Plugin::instance()?->schema->collection($this->collection) ?? throw new \LogicException('No Zero app');
    }
}
