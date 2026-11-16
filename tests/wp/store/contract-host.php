<?php
/**
 * Test-only host seams for tests/wp/store-run.sh: implements every hook docs/host-contract.md lists
 * and records each call in the `tp_test_contract` option, so the lane proves the runtime calls
 * them. Installed as a must-use plugin beside host.php.
 */
declare(strict_types=1);
defined('ABSPATH') || exit;

(static function (): void {
    $record = static function (string $hook, mixed $value): void {
        $log = get_option('tp_test_contract', []);
        $log[$hook] = $value;
        update_option('tp_test_contract', $log, false);
    };
    add_filter('tp_mail_transport', static function (mixed $accepted, array $message) use ($record): bool {
        $record('tp_mail_transport', $message['subject'] ?? null);
        return true;
    }, 10, 2);
    add_action('tp_purge_urls', static fn (array $paths) => $record('tp_purge_urls', count($paths)));
    add_filter('tp_identity_providers', static function (array $providers) use ($record): array {
        $record('tp_identity_providers', array_keys($providers));
        return $providers;
    });
    add_action('tp_runtime_loaded', static fn () => $record('tp_runtime_loaded', true));
    add_action('tp_realtime_changes', static fn (array $notice) => $record('tp_realtime_changes', array_column($notice['changes'], 'collection')));
    add_action('tp_runtime_loaded', static function () use ($record): void {
        \TypedPress\Realtime\Module::publish(new class ($record) implements \TypedPress\Realtime\Publisher {
            public function __construct(private \Closure $record) {}
            public function publish(array $notice): void { ($this->record)('TypedPress\\Realtime\\Publisher', count($notice['changes'])); }
        });
    });
})();
