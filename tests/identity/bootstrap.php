<?php
// Loads WordPress inside the identity test stack and gives every suite the same two assertions.
declare(strict_types=1);
define('WP_DISABLE_FATAL_ERROR_HANDLER', true);
require '/var/www/html/wp-load.php';
// Local stand-ins for an external provider and a webhook receiver live on the compose network.
add_filter('http_request_host_is_external', static fn ($external, $host) => $external || in_array($host, ['oidc', 'webhook'], true), 10, 2);
add_filter('http_allowed_safe_ports', static fn ($ports) => [...$ports, 8080]);

function check(bool $condition, string $name): void
{
    if (!$condition) {
        throw new RuntimeException('FAIL ' . $name);
    }
    echo 'PASS ' . $name . "\n";
}

/** Run $fn and require a Failure (or OAuthError) with this code. */
function rejects(callable $fn, string $code, string $name = ''): void
{
    try {
        $fn();
    } catch (\SpacePress\Identity\Failure $e) {
        check($e->kind === $code, ($name ?: $code) . ' (got ' . $e->kind . ')');
        return;
    } catch (\SpacePress\Identity\Protocol\OAuthError $e) {
        check($e->error === $code, ($name ?: $code) . ' (got ' . $e->error . ')');
        return;
    }
    throw new RuntimeException('FAIL ' . ($name ?: $code) . ': nothing thrown');
}

/** Spawn a PHP worker inside the stack, write $input as JSON, return [process, pipes]. */
function worker(string $script, array $input): array
{
    $process = proc_open(['php', __DIR__ . '/' . $script], [['pipe', 'r'], ['pipe', 'w'], ['pipe', 'w']], $pipes);
    if (!is_resource($process)) {
        throw new RuntimeException("worker $script did not start");
    }
    fwrite($pipes[0], json_encode($input, JSON_THROW_ON_ERROR));
    fclose($pipes[0]);
    return [$process, $pipes];
}

/** Collect a worker's stdout, stderr and exit code. */
function finish_worker(array $worker): array
{
    [$process, $pipes] = $worker;
    $out = stream_get_contents($pipes[1]);
    $err = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    return [trim($out), $err, proc_close($process)];
}
