<?php

declare(strict_types=1);

namespace First\Wp;

use First\Schema;

/**
 * The schema lock (spec.md §6): `first.config.ts` is the only way to change what First generates from
 * it. First registers its post types, meta, field groups and options pages in code on every request,
 * so the database holds nothing of theirs to edit. What the site could still do is store something
 * that takes their place or attaches to them, and that is refused to every user, administrators
 * included:
 *
 * - A Secure Custom Fields object (field group, field, post type, taxonomy, options page) saved with one
 *   of First's names, or attached to one of First's kinds. SCF keeps these as posts, so the refusal sits
 *   where WordPress saves a post: SCF's screens, its import tool, quick edit and its abilities (REST and
 *   MCP) all pass through it. An ability is refused before it runs, with the same message.
 * - The same for a field of the site's own that would write one of First's meta keys (`first_…`), on
 *   any post type or on users.
 * - A field group stored in the database never applies to a First kind, however it got there (WP-CLI,
 *   an import made while the app was inactive): a kind's fields are the ones in the config.
 * - A role First creates, and a capability of a First kind on any role, keep their definition: a write
 *   to the roles is saved without those changes ({@see roles()}).
 *
 * First's meta keys are already refused on core's generic meta paths ({@see CoreAccess::protectedMeta},
 * `auth_callback`). Content, media, users, other plugins' settings and SCF objects of the site's own
 * stay open. WP-CLI is the operator's trusted channel, as it is for `wp first insert`, and is not
 * refused. Like every other switch, these are hooks that exist while the app is active; nothing is
 * written.
 */
final class SchemaLock
{
    /** WordPress object names First generates (post types, roles, option page ids) start with this. */
    private const PREFIX = 'first_';
    private const GROUP_PREFIX = 'group_first_';
    private const FIELD_PREFIX = 'field_first_';
    /** Roles First creates, as it creates them ({@see IdentityBridge::provision}). */
    private const ROLES = ['first_guest' => ['name' => 'Guest', 'capabilities' => ['read' => true]]];

    /** @var array<string, true> */
    private static array $postTypes = [];
    /** @var array<string, true> SCF options pages First registers: menu slugs and post ids */
    private static array $optionsPages = [];

    public static function apply(Schema $schema): void
    {
        foreach ($schema->collections() as $spec) {
            if (isset($spec['wp']['postType'])) {
                self::$postTypes[$spec['wp']['postType']] = true;
            }
        }
        self::$optionsPages = ['first-' . $schema->name() => true];
        foreach ($schema->globals() as $global) {
            self::$optionsPages[$global['wp']['menuSlug']] = true;
            self::$optionsPages[$global['wp']['postId']] = true;
        }
        add_filter('wp_insert_post_empty_content', [self::class, 'saving'], PHP_INT_MAX, 2);
        add_filter('wp_pre_execute_ability', [self::class, 'ability'], 10, 3);
        add_action('admin_init', [self::class, 'importFile'], 0);
        add_filter('acf/location/rule_match', [self::class, 'matchRule'], PHP_INT_MAX, 4);
        add_filter('pre_update_option_' . wp_roles()->role_key, [self::class, 'roles'], PHP_INT_MAX, 2);
    }

    public static function message(string $what): string
    {
        return "Refused: $what belongs to the app's schema, which First builds from first.config.ts. Change it there and deploy the app; it can't be changed on the site.";
    }

    // ================================================================ Secure Custom Fields

    /**
     * wp_insert_post_empty_content: every save of an SCF object, before WordPress writes it. SCF stores
     * the object's key as the post name and its settings serialized in the content.
     *
     * @param array<string, mixed> $post slashed, as wp_insert_post received it
     */
    public static function saving(mixed $empty, mixed $post): mixed
    {
        $type = is_array($post) ? (string) ($post['post_type'] ?? '') : '';
        // Moving a stored object to the trash is how a site removes one: never refused.
        if (!str_starts_with($type, 'acf-') || ($post['post_status'] ?? '') === 'trash' || (defined('WP_CLI') && WP_CLI)) {
            return $empty;
        }
        $form = (int) ($_POST['post_ID'] ?? 0) === (int) ($post['ID'] ?? 0) ? self::form() : null;
        // SCF's screen posts the object beside the post core saves first: what will be stored is the
        // form, so it is judged, before that save. Any other save is judged by what it stores.
        self::refuse(self::problem($form ?? self::object(
            wp_unslash((string) ($post['post_name'] ?? '')),
            wp_unslash((string) ($post['post_content'] ?? '')),
            (int) ($post['post_parent'] ?? 0),
        )));

        return $empty;
    }

    /** The SCF object a wp-admin edit screen posted, with its fields, or null when the request has none. */
    private static function form(): ?array
    {
        foreach (['acf_field_group', 'acf_post_type', 'acf_taxonomy', 'acf_ui_options_page'] as $key) {
            if (is_array($_POST[$key] ?? null)) {
                return wp_unslash($_POST[$key]) + ['fields' => is_array($_POST['acf_fields'] ?? null) ? wp_unslash($_POST['acf_fields']) : []];
            }
        }

        return null;
    }

    /**
     * An SCF object as it is stored: its key is the post name, its settings the serialized content, and
     * a field's parent is the group or field post above it.
     *
     * @return array<string, mixed>
     */
    private static function object(string $key, string $content, int $parent): array
    {
        $settings = maybe_unserialize($content);

        return ['key' => $key, 'parent' => $parent > 0 ? get_post($parent)?->post_name : null] + (is_array($settings) ? $settings : []);
    }

    /**
     * admin_init: SCF's import tool saves a group's fields before the group itself, so the uploaded
     * export is judged whole, before any of it is stored.
     */
    public static function importFile(): void
    {
        $file = $_FILES['acf_import_file']['tmp_name'] ?? null;
        $json = is_string($file) && is_uploaded_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        if (is_array($json)) {
            self::refuse(self::problem(isset($json['key']) ? $json : ['fields' => $json]));
        }
    }

    /** A REST or MCP request gets the refusal as JSON, in core's error shape; a screen gets a page. */
    private static function refuse(?string $problem): void
    {
        if ($problem === null) {
            return;
        }
        if (wp_is_serving_rest_request()) {
            wp_send_json(['code' => 'first_schema_locked', 'message' => self::message($problem), 'data' => ['status' => 403]], 403);
        }
        wp_die(esc_html(self::message($problem)), 'First', ['response' => 403, 'back_link' => true]);
    }

    /**
     * wp_pre_execute_ability: an SCF ability that would store something of First's gets the refusal as
     * its own error, before SCF writes anything. Judged: the input, and the stored object the input
     * names by id or key (an update merges into it, a duplicate copies it). Reading and removing a
     * stored object stay open.
     */
    public static function ability(mixed $pre, mixed $name, mixed $input): mixed
    {
        if (!is_string($name) || !preg_match('#^scf/(?!get-|list-|export-|delete-|trash-)#', $name) || !is_array($input) || (defined('WP_CLI') && WP_CLI)) {
            return $pre;
        }
        $problem = self::problem($input + ['key' => $input['identifier'] ?? null]);
        $id = $input['ID'] ?? $input['identifier'] ?? null;
        if ($problem === null && (is_int($id) || is_string($id)) && $id !== '') {
            $types = array_values(array_filter(get_post_types(), static fn (string $type): bool => str_starts_with($type, 'acf-')));
            $post = is_numeric($id) ? get_post((int) $id) : (get_posts(['name' => $id, 'post_type' => $types, 'post_status' => 'any', 'numberposts' => 1])[0] ?? null);
            if ($post instanceof \WP_Post && in_array($post->post_type, $types, true)) {
                // An update replaces the settings it sends: only the ones it leaves are the stored ones.
                $problem = self::problem(array_diff_key(self::object($post->post_name, $post->post_content, (int) $post->post_parent), $input));
            }
        }

        return $problem === null ? $pre : new \WP_Error('first_schema_locked', self::message($problem), ['status' => 403]);
    }

    /**
     * What makes an SCF object First's: its key or its parent's, the post type or taxonomy it declares,
     * or the First kind or options page it attaches to; the same for every object nested in it (a
     * group's fields, their sub-fields and layouts). Null for an object of the site's own.
     *
     * @param array<string, mixed> $object an SCF field group, field, post type, taxonomy or options page
     */
    private static function problem(array $object): ?string
    {
        foreach (['key', 'parent'] as $key) {
            $name = $object[$key] ?? null;
            if (self::named($name, self::GROUP_PREFIX) || self::named($name, self::FIELD_PREFIX)) {
                return "the field or field group $name";
            }
        }
        foreach (['post_type' => 'post type', 'taxonomy' => 'taxonomy'] as $key => $label) {
            if (self::named($object[$key] ?? null, self::PREFIX)) {
                return "the $label {$object[$key]}";
            }
        }
        foreach ((array) ($object['object_type'] ?? []) as $type) {
            if (is_string($type) && self::firstType($type)) {
                return "the list of taxonomies of $type";
            }
        }
        foreach (['menu_slug', 'post_id'] as $key) {
            // An options page keeps its values as `<post_id>_<field>` options: First's are `first_…`.
            if (is_scalar($object[$key] ?? null) && (isset(self::$optionsPages[(string) $object[$key]]) || ($key === 'post_id' && self::named($object[$key], self::PREFIX)))) {
                return "the options page {$object[$key]}";
            }
        }
        // A field's name is the meta key it writes: First's meta (`first_<field>`, on posts and users)
        // is written through First alone.
        if (isset($object['type']) && self::named($object['name'] ?? null, self::PREFIX)) {
            return "the meta key {$object['name']}";
        }
        foreach (is_array($object['location'] ?? null) ? $object['location'] : [] as $rules) {
            foreach (is_array($rules) ? $rules : [] as $rule) {
                $param = is_array($rule) ? (string) ($rule['param'] ?? '') : '';
                $value = is_array($rule) && is_scalar($rule['value'] ?? null) ? (string) $rule['value'] : '';
                if (($param === 'post_type' && self::firstType($value)) || ($param === 'options_page' && isset(self::$optionsPages[$value]))) {
                    return "the field list of $value";
                }
            }
        }
        foreach (['fields', 'sub_fields', 'layouts'] as $nested) {
            foreach (is_array($object[$nested] ?? null) ? $object[$nested] : [] as $child) {
                if (is_array($child) && ($problem = self::problem($child)) !== null) {
                    return $problem;
                }
            }
        }

        return null;
    }

    /**
     * A field group kept in the database never applies to one of First's kinds. Groups registered in
     * code (First's own, another plugin's) are not this rule's: code is not an edit made on the site.
     */
    public static function matchRule(mixed $match, mixed $rule, mixed $screen, mixed $group): mixed
    {
        // A stored group under one of First's own keys is First's group: SCF reads its fields from code.
        if (!$match || !is_array($group) || empty($group['ID']) || self::named($group['key'] ?? null, self::GROUP_PREFIX) || !is_array($screen)) {
            return $match;
        }
        $type = $screen['post_type'] ?? (is_numeric($screen['post_id'] ?? null) ? get_post_type((int) $screen['post_id']) : null);

        return (is_string($type) && self::firstType($type)) || isset(self::$optionsPages[(string) ($screen['options_page'] ?? '')]) ? false : $match;
    }

    // ================================================================ roles

    /**
     * pre_update_option of the roles option: every way WordPress changes a role definition (add_cap,
     * remove_cap, add_role, remove_role, a role-editor plugin's own write) ends here. The write is
     * saved without its changes to a role First creates, and without a capability of a First kind it
     * adds to any role (the kind's access rules answer those for everyone, {@see CoreAccess::mapMetaCap});
     * the rest of it stands. It is corrected rather than refused with a screen: core has no role screen
     * or route, so the write is another plugin's code, and a plugin that adds its capability to every
     * role when it is activated must still activate.
     */
    public static function roles(mixed $roles, mixed $old): mixed
    {
        if (!is_array($roles) || !is_array($old) || (defined('WP_CLI') && WP_CLI)) {
            return $roles;
        }
        $corrected = [];
        foreach (self::ROLES as $name => $definition) {
            $keep = $old[$name] ?? (isset($roles[$name]) ? $definition : null);
            if (($roles[$name] ?? null) != $keep) {
                $corrected[$name] = $keep;
            }
        }
        foreach ($roles as $name => $role) {
            $before = (array) ($old[$name]['capabilities'] ?? []);
            $caps = (array) ($role['capabilities'] ?? []);
            $kept = array_filter($caps, static fn ($granted, $cap): bool => !self::firstCapability((string) $cap) || ($before[$cap] ?? null) === $granted, ARRAY_FILTER_USE_BOTH);
            if (!array_key_exists($name, $corrected) && $kept !== $caps) {
                $corrected[$name] = ['capabilities' => $kept] + $role;
            }
        }
        if ($corrected !== []) {
            // The request is told, where it still can be: a response header, and a notice on a screen.
            $message = self::message('the role ' . preg_replace('/[^A-Za-z0-9_ ,-]/', '', implode(', ', array_keys($corrected))));
            if (!headers_sent()) {
                header('First-Schema-Lock: ' . $message);
            }
            add_action('admin_notices', static function () use ($message): void {
                echo '<div class="notice notice-error"><p>' . esc_html($message) . '</p></div>';
            });
        }
        foreach ($corrected as $name => $role) {
            // What is saved, and what WordPress holds in memory for the rest of this request.
            $wp = wp_roles();
            unset($roles[$name], $wp->roles[$name], $wp->role_names[$name], $wp->role_objects[$name]);
            if ($role !== null) {
                $roles[$name] = $wp->roles[$name] = $role;
                $wp->role_names[$name] = (string) ($role['name'] ?? $name);
                $wp->role_objects[$name] = new \WP_Role((string) $name, (array) ($role['capabilities'] ?? []));
            }
        }

        return $roles;
    }

    /** A capability of one of First's post types (`edit_others_first_notes`, `edit_first_notes_item`). */
    private static function firstCapability(string $cap): bool
    {
        foreach (self::$postTypes as $type => $_) {
            if (str_ends_with($cap, "_$type") || str_ends_with($cap, "_{$type}_item")) {
                return true;
            }
        }

        return false;
    }

    // ================================================================ helpers

    private static function firstType(string $type): bool
    {
        return isset(self::$postTypes[$type]) || str_starts_with(strtolower($type), self::PREFIX);
    }

    /** WordPress lower-cases the keys it stores, so the comparison does too. */
    private static function named(mixed $name, string $prefix): bool
    {
        return is_string($name) && str_starts_with(strtolower($name), $prefix);
    }
}
