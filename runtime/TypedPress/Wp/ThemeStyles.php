<?php

declare(strict_types=1);

namespace TypedPress\Wp;

/**
 * The project's styles (docs/decisions/2026-11-15-styles-from-wordpress.md). `tp/theme.json`, shipped
 * as the app plugin's `tp/app/theme.json`, is merged into the theme layer of WordPress's global
 * styles: over the active theme's theme.json (TypedPress's `typedpress-default` or an installed block theme),
 * under the site owner's Global Styles, which the Styles screen and the Site Editor save. Code is the
 * default; what the owner customizes on the site wins, and `typedpress styles pull` brings it back to code.
 */
final class ThemeStyles
{
    public const FILE = 'tp/app/theme.json';

    /** @var array<string, mixed>|null the shipped document, read once */
    private static ?array $data = null;

    public static function register(Plugin $plugin): void
    {
        $file = $plugin->dir . '/' . self::FILE;
        if (is_readable($file)) {
            $data = json_decode((string) file_get_contents($file), true);
            if (is_array($data)) {
                self::$data = $data;
                add_filter('wp_theme_json_data_theme', [self::class, 'merge']);
            }
        }
        $command = static fn () => Runtime::command('styles', self::wpCli(...));
        if (defined('WP_CLI') && WP_CLI) {
            did_action('tp_runtime_loaded') ? $command() : add_action('tp_runtime_loaded', $command);
        }
    }

    /** The theme layer with the project's settings and styles over it. */
    public static function merge(\WP_Theme_JSON_Data $theme): \WP_Theme_JSON_Data
    {
        return self::$data === null ? $theme : $theme->update_with(self::$data);
    }

    /**
     * What `typedpress styles pull` writes to `tp/theme.json`: the project's file with the owner's Global
     * Styles merged over it, as WordPress merges the two layers, keeping only settings and styles.
     *
     * @return array<string, mixed>
     */
    public static function export(): array
    {
        $tree = new \WP_Theme_JSON(self::$data ?? ['version' => \WP_Theme_JSON::LATEST_SCHEMA], 'theme');
        $tree->merge(\WP_Theme_JSON_Resolver::get_user_data());
        $data = $tree->get_data();
        $out = ['version' => $data['version'] ?? \WP_Theme_JSON::LATEST_SCHEMA];
        foreach (['settings', 'styles'] as $key) {
            if (isset($data[$key]) && is_array($data[$key]) && $data[$key] !== []) {
                $out[$key] = $data[$key];
            }
        }

        return $out;
    }

    /** `wp typedpress styles export`: one `{"data": …}` or `{"error": …}` line, like every `wp typedpress` command. */
    public static function wpCli(array $args, array $flags): int
    {
        try {
            if (($args[0] ?? '') !== 'export') {
                throw new \TypedPress\HttpError(400, 'invalid_command', 'Usage: wp typedpress styles export');
            }
            [$code, $out] = [0, ['data' => self::export()]];
        } catch (\Throwable $e) {
            [$code, $out] = [1, ['error' => \TypedPress\App::problem($e)]];
        }
        \WP_CLI::line((string) wp_json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

        return $code;
    }
}
