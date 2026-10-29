<?php

declare(strict_types=1);

namespace Zero\Wp;

use Zero\App;
use Zero\Db;
use Zero\Schema;

/**
 * The plugin bootstrap (§4.9). `new Plugin(__DIR__)` from the generated main file wires every hook;
 * the App (Db pipeline + stores) is booted lazily, the first time a request or an editor save needs it.
 */
final class Plugin
{
    public const MIN_WP = '6.7';
    public const MIN_SCF = '6.9.7';
    private const PRIMITIVE_CAPS = ['edit_%s', 'edit_others_%s', 'delete_%s', 'publish_%s', 'read_private_%s',
        'delete_private_%s', 'delete_published_%s', 'delete_others_%s', 'edit_private_%s', 'edit_published_%s'];
    private const AUTHOR_CAPS = ['edit_%s', 'publish_%s', 'delete_%s', 'edit_published_%s', 'delete_published_%s'];

    private static ?self $instance = null;

    public readonly Schema $schema;
    private ?App $app = null;
    private ?Connection $connection = null;
    /** @var array<int, ?array> post id → row before an editor update (null = treat as create) */
    private array $before = [];
    /** @var array<int, array{string, array}> post id → [collection, row] captured before an editor delete */
    private array $deleting = [];

    public function __construct(public readonly string $dir, ?string $mainFile = null)
    {
        self::$instance = $this;
        $this->schema = Schema::load($dir . '/zero/app/schema.php');
        $mainFile ??= defined('ZERO_PLUGIN_FILE') ? (string) constant('ZERO_PLUGIN_FILE') : $dir . '/zero-' . $this->schema->name() . '.php';

        register_activation_hook($mainFile, [$this, 'activate']);
        add_action('plugins_loaded', [$this, 'checkRequirements']);
        add_action('init', [$this, 'registerPostTypes'], 0);
        add_action('acf/init', [$this, 'registerFields'], 5);
        add_action('rest_api_init', fn () => Rest::register(fn () => $this->app()));
        Rest::boot();
        add_action('admin_menu', [$this, 'adminMenu'], 9);
        add_action('admin_init', [$this, 'maybeMigrate']);

        // Editor saves (wp-admin, core /wp/v2/<type>): hooks run after the post and its fields are saved.
        add_action('pre_post_update', [$this, 'capturePrevious'], 10, 1);
        add_action('wp_after_insert_post', [$this, 'afterEditorSave'], 20, 4);
        add_action('before_delete_post', [$this, 'beforeEditorDelete'], 10, 2);
        add_action('deleted_post', [$this, 'afterEditorDelete'], 10, 2);

        if (defined('WP_CLI') && constant('WP_CLI')) {
            \WP_CLI::add_command('zero', [$this, 'cli'], ['shortdesc' => 'Trusted Zero commands: find|insert|update|delete|action|migrate (JSON in, {data}|{error} out).']);
        }
    }

    /**
     * `wp zero <find|insert|update|delete|action> <name> [json...]` and `wp zero migrate`: the
     * standalone CLI's trusted surface (no access checks) on WordPress.
     *
     * @param list<string> $args
     */
    public function cli(array $args, array $assocArgs = []): void
    {
        foreach ($assocArgs as $name => $value) {
            $args[] = '--' . $name . ($value === true ? '' : '=' . ($value === false ? 'false' : (string) $value));
        }
        if (($args[0] ?? '') === 'migrate') {
            [$code, $out] = [0, \Zero\Js::jsonStringify(['data' => ['applied' => $this->migrator()->migrate()]])];
        } else {
            [$code, $out] = $this->app()->cli($args);
        }
        \WP_CLI::line((string) $out);
        if ($code !== 0) {
            \WP_CLI::halt($code);
        }
    }

    public static function instance(): ?self
    {
        return self::$instance;
    }

    public function connection(): Connection
    {
        global $wpdb;

        return $this->connection ??= new Connection($wpdb);
    }

    public function app(): App
    {
        if ($this->app === null) {
            $db = $this->connection();
            $store = CompositeStore::create($this->schema, $db);
            $this->app = App::boot($this->dir, $store, new WpAuth(), new WpMedia($db, $store->dialect()));
        }

        return $this->app;
    }

    // ================================================================ activation

    public function activate(): void
    {
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $migrator = $this->migrator();
        $bad = $migrator->nonInnoDb();
        if ($bad === []) {
            $migrator->migrate();
            $bad = $migrator->nonInnoDb();
        }
        if ($bad !== []) {
            deactivate_plugins(plugin_basename(defined('ZERO_PLUGIN_FILE') ? (string) constant('ZERO_PLUGIN_FILE') : $this->dir));
            wp_die(esc_html('Zero needs InnoDB tables for transactions; these are not: ' . implode(', ', $bad)), 'Zero', ['back_link' => true]);
        }
        update_option($this->schemaOption(), self::schemaHash(), false);
        $this->grantCapabilities();
    }

    public function maybeMigrate(): void
    {
        if (get_option($this->schemaOption()) !== self::schemaHash()) {
            $this->migrator()->migrate();
            $this->grantCapabilities();
            update_option($this->schemaOption(), self::schemaHash(), false);
        }
    }

    private function migrator(): Migrator
    {
        return new Migrator($this->connection(), $this->dir . '/zero/app/migrations', $this->schema);
    }

    private function schemaOption(): string
    {
        return 'zero_' . $this->schema->name() . '_schema';
    }

    private static function schemaHash(): string
    {
        return defined('ZERO_SCHEMA_HASH') ? (string) constant('ZERO_SCHEMA_HASH') : '';
    }

    /** §4.1/§5.1: administrator + editor get every collection cap; author edits/publishes/deletes own. */
    private function grantCapabilities(): void
    {
        foreach ($this->postBacked() as $spec) {
            $plural = $spec['wp']['postType'];
            foreach (['administrator', 'editor', 'author'] as $roleName) {
                $role = get_role($roleName);
                if ($role === null) {
                    continue;
                }
                foreach ($roleName === 'author' ? self::AUTHOR_CAPS : self::PRIMITIVE_CAPS as $cap) {
                    $role->add_cap(sprintf($cap, $plural));
                }
            }
        }
    }

    // ================================================================ registration

    public function checkRequirements(): void
    {
        $scf = defined('ACF_VERSION') ? (string) constant('ACF_VERSION') : null;
        $problem = match (true) {
            !class_exists('ACF') || $scf === null => 'Secure Custom Fields is not active',
            version_compare($scf, self::MIN_SCF, '<') => 'Secure Custom Fields ' . self::MIN_SCF . '+ is required (found ' . $scf . ')',
            version_compare((string) get_bloginfo('version'), self::MIN_WP, '<') => 'WordPress ' . self::MIN_WP . '+ is required',
            default => null,
        };
        if ($problem !== null) {
            remove_action('init', [$this, 'registerPostTypes'], 0);
            remove_all_actions('rest_api_init');
            add_action('admin_notices', static fn () => printf('<div class="notice notice-error"><p>%s</p></div>', esc_html('Zero: ' . $problem . '.')));
        }
    }

    public function registerPostTypes(): void
    {
        foreach ($this->postBacked() as $name => $spec) {
            $label = (string) ($spec['label'] ?? $name);
            $type = $spec['wp']['postType'];
            register_post_type($type, [
                'label' => $label,
                'labels' => ['name' => $label, 'singular_name' => $label, 'menu_name' => $label, 'all_items' => $label],
                'public' => false,
                'show_ui' => true,
                'show_in_menu' => true,
                'show_in_rest' => true,
                'rest_base' => $type,
                'menu_icon' => 'dashicons-database',
                'supports' => array_values(array_filter(['title', ($spec['content'] ?? null) !== null ? 'editor' : null, ($spec['revisions'] ?? false) ? 'revisions' : null, 'author', 'custom-fields'])),
                // Singular differs from plural so `edit_<type>` stays a primitive cap (see report).
                'capability_type' => [$type . '_item', $type],
                'map_meta_cap' => true,
                'hierarchical' => false,
                'has_archive' => false,
                'rewrite' => false,
                'query_var' => false,
            ]);
        }
    }

    public function registerFields(): void
    {
        Scf::register($this->schema);
        Scf::registerFilters();
    }

    public function adminMenu(): void
    {
        if ($this->schema->globals() === []) {
            return;
        }
        $slug = 'zero-' . $this->schema->name();
        add_menu_page(ucfirst($this->schema->name()), ucfirst($this->schema->name()), 'edit_others_posts', $slug, static function () use ($slug): void {
            echo '<div class="wrap"><h1>' . esc_html(get_admin_page_title()) . '</h1></div>';
        }, 'dashicons-admin-settings');
    }

    // ================================================================ editor hooks (§4.9)

    public function capturePrevious(int $postId): void
    {
        $collection = $this->collectionOf($postId);
        if ($collection === null || $this->connection()->busy()) {
            return;
        }
        $post = get_post($postId);
        $this->before[$postId] = $post instanceof \WP_Post && $post->post_status !== 'auto-draft'
            ? $this->app()->db->editorRow($collection, $postId)
            : null;
    }

    public function afterEditorSave(int $postId, \WP_Post $post, bool $update, ?\WP_Post $before): void
    {
        $collection = $this->collectionOf($postId);
        if ($collection === null || $this->connection()->busy() || in_array($post->post_status, ['auto-draft', 'trash', 'inherit'], true)) {
            return;
        }
        $previous = $before === null || $before->post_status === 'auto-draft' ? null : ($this->before[$postId] ?? null);
        unset($this->before[$postId]);
        $app = $this->app();
        $this->fillEditorDefaults($collection, $postId, $previous === null);
        $app->db->transaction(fn () => $app->db->afterEditorSave($collection, $postId, $previous, WpAuth::current()));
    }

    public function beforeEditorDelete(int $postId, ?\WP_Post $post = null): void
    {
        $collection = $this->collectionOf($postId);
        if ($collection === null || $this->connection()->busy()) {
            return;
        }
        $db = $this->app()->db;
        $row = $db->editorRow($collection, $postId);
        if ($row !== null) {
            $this->deleting[$postId] = [$collection, $row];
            $db->beforeEditorDelete($collection, $row, WpAuth::current());
        }
    }

    public function afterEditorDelete(int $postId, ?\WP_Post $post = null): void
    {
        if (!isset($this->deleting[$postId])) {
            return;
        }
        [$collection, $row] = $this->deleting[$postId];
        unset($this->deleting[$postId]);
        $this->app()->db->afterEditorDelete($collection, $row, WpAuth::current());
    }

    /**
     * wp-admin knows nothing of Zero's generated values: on an editor save, write `default` for meta
     * columns that have none yet and `onUpdate` on every update, so editor rows decode like API rows.
     */
    private function fillEditorDefaults(string $collection, int $postId, bool $created): void
    {
        $spec = $this->schema->collection($collection);
        $store = CompositeStore::create($this->schema, $this->connection())->posts;
        $values = [];
        foreach ($spec['columns'] as $col => $def) {
            $col = (string) $col;
            if (!$store->isMeta($spec, $col)) {
                continue;
            }
            $key = $spec['wp']['metaPrefix'] . $col;
            if (!$created && isset($def['onUpdate'])) {
                $values[$col] = Schema::store($def, Schema::generate($def['onUpdate'], $def['type']));
            } elseif (isset($def['default']) && in_array(get_post_meta($postId, $key, true), ['', false, null], true) && !in_array($def['type'], ['boolean', 'select', 'mediaList'], true)) {
                $values[$col] = Schema::store($def, Schema::generate($def['default'], $def['type']));
            }
        }
        if ($values !== []) {
            $store->update($collection, $postId, $values);
        }
    }

    // ================================================================ helpers

    /** @return array<string, array> post-backed collections */
    private function postBacked(): array
    {
        return array_filter($this->schema->collections(), static fn (array $c) => ($c['editor'] ?? true) && ($c['wp'] ?? null) !== null);
    }

    private function collectionOf(int $postId): ?string
    {
        $type = get_post_type($postId);
        foreach ($this->postBacked() as $name => $spec) {
            if ($spec['wp']['postType'] === $type) {
                return (string) $name;
            }
        }

        return null;
    }

    /** Db for code that runs outside a Zero request (WP-CLI helpers, tests). */
    public function db(): Db
    {
        return $this->app()->db;
    }
}
