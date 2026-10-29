<?php
declare(strict_types=1);
namespace Zero\Wp;

/** The single runtime and app registry; optional features attach to existing seams. */
final class Runtime
{
    public const SERIES = \Zero\Schema::SERIES;
    public const VERSION = '0.2.0';
    private static ?Plugin $plugin = null;
    private static ?string $appFile = null;
    private static bool $booted = false;

    public static function boot(string $runtimeFile): void
    {
        if (self::$booted) {
            return;
        }
        if (version_compare((string) get_bloginfo('version'), Platform::WORDPRESS, '<') || version_compare(PHP_VERSION, Platform::PHP, '<')) {
            self::notice('WordPress ' . Platform::WORDPRESS . '+ and PHP ' . Platform::PHP . '+ are required');
            return;
        }
        self::$booted = true;
        register_activation_hook($runtimeFile, [self::class, 'activate']);
        add_action('admin_init', static function (): void {
            if (get_option('zero_runtime_tables') !== self::SERIES && Platform::problems() === []) {
                self::activate();
            }
        });
        if (defined('WP_CLI') && WP_CLI) {
            \WP_CLI::add_command('zero', static function (array $args, array $flags): void {
                if (self::$plugin === null) {
                    \WP_CLI::error('No compatible Zero app is active.');
                }
                self::$plugin->cli($args, $flags);
            });
        }
        do_action('zero_runtime_loaded');
    }

    public static function activate(): void
    {
        $problems = Platform::problems();
        if ($problems !== []) {
            wp_die(esc_html('Zero: ' . implode('; ', $problems)), 'Zero', ['back_link' => true]);
        }
        global $wpdb;
        $connection = new Connection($wpdb);
        $schema = new \Zero\Schema(['version' => 3, 'runtime' => self::SERIES]);
        \Zero\SystemTables::apply(CompositeStore::create($schema, $connection));
        update_option('zero_runtime_tables', self::SERIES, false);
    }

    public static function app(string $dir, string $mainFile): ?Plugin
    {
        if (self::$appFile === $mainFile) {
            return self::$plugin;
        }
        try {
            if (self::$plugin !== null) {
                throw new \RuntimeException('only one Zero app can be active; deactivate the other app first');
            }
            $schema = \Zero\Schema::load($dir . '/zero/app/schema.php');
            $problems = Platform::problems($schema->locales() !== null);
            if ($problems !== []) {
                throw new \RuntimeException(implode('; ', $problems));
            }
            self::$plugin = new Plugin($dir, $mainFile);
            self::$appFile = $mainFile;
            \Zero\Extensions::schemaDescribe(static function (array $description): array {
                $description['runtime']['wp'] = Platform::versions();
                $description['runtime']['wp']['incompatibleTables'] = self::$plugin->storageProblems();
                $description['runtime']['identity'] = self::identity();
                $description['runtime']['version'] = self::VERSION;
                $description['runtime']['pendingMigrations'] = self::$plugin->pendingMigrations();
                $description['runtime']['languages'] = function_exists('pll_languages_list') ? pll_languages_list(['fields' => 'slug']) : [];
                return $description;
            });
            return self::$plugin;
        } catch (\Throwable $error) {
            self::notice($error->getMessage());
            return null;
        }
    }

    public static function plugin(): ?Plugin
    {
        return self::$plugin;
    }

    public static function identity(): bool
    {
        return class_exists(\Zero\Identity\Plugin::class) && defined(\Zero\Identity\Plugin::class . '::VERSION')
            && constant(\Zero\Identity\Plugin::class . '::VERSION') === self::VERSION;
    }

    private static function notice(string $problem): void
    {
        add_action('admin_notices', static fn () => printf('<div class="notice notice-error"><p>%s</p></div>', esc_html('Zero: ' . $problem . '. Rebuild with zero ' . self::SERIES . '.x.')));
    }
}
