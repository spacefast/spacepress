<?php
// The WordPress HTTP API, reduced to what SpacePress\Fetch calls, for the host-globals contract.
// `origin.example` resolves to the local origin (tests/differential/host-origin.mjs), opened with
// the same `sp_fetch_allow_address` seam a site plugin uses, so SpacePress\Fetch's own pin decides
// where the request connects. The stub only lets this one origin speak plain HTTP.

declare(strict_types=1);

namespace WpOrg\Requests\Transport {
    /** WordPress's Requests cURL transport, as SpacePress\Fetch checks for it before pinning. */
    final class Curl
    {
        public static function test(array $capabilities = []): bool
        {
            return function_exists('curl_init');
        }
    }
}

namespace {

/** @var array<string, list<callable>> */
$GLOBALS['host_actions'] = [];
function add_action(string $hook, callable $fn, int $priority = 10): void
{
    $GLOBALS['host_actions'][$hook][] = $fn;
}
function remove_action(string $hook, callable $fn, int $priority = 10): void
{
    $GLOBALS['host_actions'][$hook] = array_values(array_filter($GLOBALS['host_actions'][$hook] ?? [], static fn ($f) => $f !== $fn));
}
function apply_filters(string $hook, mixed $value, mixed ...$args): mixed
{
    return match (true) {
        $hook === 'sp_fetch_resolve' && $args[0] === 'origin.example' => ['127.0.0.1'],
        $hook === 'sp_fetch_allow_address' => $value || ($args[1] === 'origin.example' && $args[0] === '127.0.0.1'),
        default => $value,
    };
}
function is_wp_error(mixed $v): bool { return $v === false; }
function wp_remote_request(string $url, array $args): array|false
{
    // The local origin speaks plain HTTP; host and port stay what SpacePress\Fetch checked and pinned.
    $target = (string) preg_replace('#\Ahttps://origin\.example:#', 'http://origin.example:', $url);
    $headers = [];
    foreach ($args['headers'] as $name => $value) {
        $headers[] = "$name: $value";
    }
    $status = 0;
    $message = '';
    $out = [];
    $curl = curl_init($target);
    // As WordPress's cURL transport does: SpacePress\Fetch pins the checked address here and decides
    // where the handle connects. Only the scheme is the stub's.
    foreach ($GLOBALS['host_actions']['http_api_curl'] ?? [] as $fn) {
        $fn($curl);
    }
    curl_setopt($curl, CURLOPT_PROTOCOLS, CURLPROTO_HTTP | CURLPROTO_HTTPS);
    curl_setopt_array($curl, [
        CURLOPT_CUSTOMREQUEST => $args['method'],
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$status, &$message, &$out): int {
            if (preg_match('#^HTTP/\S+ (\d+) ?(.*?)\s*$#', $line, $m) === 1) {
                [$status, $message] = [(int) $m[1], $m[2]];
            } elseif (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $out[strtolower($name)] = trim($value);
            }
            return strlen($line);
        },
    ]);
    if ($args['body'] !== null) {
        curl_setopt($curl, CURLOPT_POSTFIELDS, $args['body']);
    }
    $body = curl_exec($curl);
    return ['status' => $status, 'message' => $message, 'headers' => $out, 'body' => (string) $body];
}
function wp_remote_retrieve_body(array $r): string { return $r['body']; }
function wp_remote_retrieve_headers(array $r): array { return $r['headers']; }
function wp_remote_retrieve_response_code(array $r): int { return $r['status']; }
function wp_remote_retrieve_response_message(array $r): string { return $r['message']; }
}
