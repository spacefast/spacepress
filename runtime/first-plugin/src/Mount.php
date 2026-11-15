<?php
declare(strict_types=1);

namespace FirstPlugin;

/**
 * Mounts one build per request through First's loader (docs/host-contract.md): the live build, or,
 * for the two deploy requests that name a deployment and prove they hold its token, the build that
 * deployment uploaded. The plugin is the host here, so it also supplies what a host supplies: the
 * app's variables and mail delivery.
 */
final class Mount
{
    /** @var ?array{build: string, mode: string, deployment: ?string} */
    private static ?array $mounted = null;
    private static ?string $error = null;

    /**
     * Mount on `plugins_loaded` priority 1, where the loader itself would do it, but inside this
     * plugin's own callback: a build that can't mount (a required plugin was deactivated, its files
     * are gone) then leaves WordPress serving without the app instead of failing every request.
     */
    public static function run(): void
    {
        add_action('plugins_loaded', [self::class, 'mount'], 1);
    }

    public static function mount(): void
    {
        try {
            [$build, $mode, $deployment] = self::selected();
            if ($build === null) {
                return;
            }
            $manifest = Site::manifest($build);
            if ($manifest === null || !Site::complete($manifest)) {
                throw new \RuntimeException("First build $build is not in the build store");
            }
            $root = Site::root();
            require_once $root . '/runtime/' . $manifest['runtime'] . '/first-loader.php';
            \First\Loader\Loader::load($root, $build, [
                'variables' => self::variables(),
                'url' => Site::url(),
                'inspect' => $mode === 'inspect',
            ]);
            if (\First\Wp\Runtime::plugin() === null) {
                throw new \RuntimeException('The build did not mount');
            }
            self::$mounted = ['build' => $build, 'mode' => $mode, 'deployment' => $deployment];
            // Last, so a host's own transport answers first and this one only sends what nothing took.
            add_filter('first_mail_transport', [self::class, 'mail'], PHP_INT_MAX, 2);
        } catch (\Throwable $error) {
            // WordPress keeps serving without the app; the First screen and `first push` show why.
            self::$error = $error->getMessage();
            $missing = array_column(array_filter(Requirements::checks(), static fn (array $check): bool => !$check['ok'] && !$check['optional']), 'label');
            if ($missing !== []) {
                self::$error = 'The app needs ' . implode(', ', $missing) . ', which ' . (count($missing) === 1 ? 'is' : 'are') . ' missing or inactive on this site.';
            }
            error_log('[first] ' . self::$error);
        }
    }

    /** @return ?array{build: string, mode: string, deployment: ?string} */
    public static function mounted(): ?array
    {
        return self::$mounted;
    }

    public static function error(): ?string
    {
        return self::$error;
    }

    /**
     * The build for this request. `X-First-Deployment: <id>:<token>` selects that deployment's build
     * when the token is the one issued for it; `X-First-Mount: activate` mounts it to run, anything
     * else mounts it to inspect, where none of the app's own code runs. It is honored only on that
     * deployment's routes, which still check who is asking: the token only decides which code is loaded.
     *
     * @return array{0: ?string, 1: string, 2: ?string}
     */
    private static function selected(): array
    {
        $header = $_SERVER['HTTP_X_FIRST_DEPLOYMENT'] ?? null;
        if (is_string($header) && preg_match('/\A([0-9a-f]{32}):([0-9a-f]{64})\z/D', $header, $match) === 1) {
            // Only on that deployment's own routes: the token never puts another page of the site on
            // a build that isn't live.
            $route = is_string($_GET['rest_route'] ?? null) ? $_GET['rest_route'] : (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
            $pending = get_option(Site::PENDING, []);
            $record = is_array($pending) ? ($pending[$match[1]] ?? null) : null;
            if (str_contains($route, '/' . Site::REST . '/deployments/' . $match[1] . '/')
                && is_array($record) && is_string($record['token'] ?? null) && hash_equals($record['token'], hash('sha256', $match[2]))
                && (int) ($record['expires'] ?? 0) > time() && Site::validId($record['build'] ?? null)) {
                $mode = ($_SERVER['HTTP_X_FIRST_MOUNT'] ?? '') === 'activate' ? 'activate' : 'inspect';

                return [$record['build'], $mode, $match[1]];
            }
        }

        return [Site::live(), 'live', null];
    }

    /**
     * The app's runtime variables (`process.env.NAME` in its code): the `FIRST_VARIABLES` constant from
     * wp-config.php, an array of names to strings. Nothing else of the server's environment reaches
     * the app.
     *
     * @return array<string, string>
     */
    private static function variables(): array
    {
        $variables = defined('FIRST_VARIABLES') && is_array(FIRST_VARIABLES) ? FIRST_VARIABLES : [];
        $variables = apply_filters('first_variables', $variables);

        return array_filter(is_array($variables) ? $variables : [], static fn ($value, $name): bool => is_string($name) && is_string($value), ARRAY_FILTER_USE_BOTH);
    }

    /** `first_mail_transport`: the app's mail leaves through WordPress's own `wp_mail`. */
    public static function mail(mixed $accepted, mixed $payload): mixed
    {
        if ($accepted !== null || !is_array($payload)) {
            return $accepted;
        }
        $mail = \First\Mail::wpMailArguments($payload);
        $alt = $mail['alt'];
        $configure = static function ($mailer) use ($alt): void {
            if ($alt !== null && is_object($mailer)) {
                $mailer->AltBody = $alt;
            }
        };
        add_action('phpmailer_init', $configure);
        try {
            return wp_mail($mail['to'], $mail['subject'], $mail['message'], $mail['headers']) === true;
        } finally {
            remove_action('phpmailer_init', $configure);
        }
    }
}
