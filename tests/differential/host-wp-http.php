<?php
// The WordPress HTTP API, reduced to what Zero\Fetch calls, for the host-globals contract: every
// request goes to the local origin named by HOST_ORIGIN (tests/differential/host-origin.mjs),
// whatever the URL's host, after Zero\Fetch has applied its own policy to the public name.

declare(strict_types=1);

function add_action(string $hook, callable $fn, int $priority = 10): void {}
function remove_action(string $hook, callable $fn, int $priority = 10): void {}
function apply_filters(string $hook, mixed $value, mixed ...$args): mixed
{
    // origin.example resolves to a public address, so the address check passes; the transport
    // above then connects to the local origin.
    return $hook === 'zero_fetch_resolve' && $args[0] === 'origin.example' ? ['93.184.216.34'] : $value;
}
function is_wp_error(mixed $v): bool { return $v === false; }
function wp_remote_request(string $url, array $args): array|false
{
    $parts = parse_url($url);
    $target = 'http://127.0.0.1:' . getenv('HOST_ORIGIN') . ($parts['path'] ?? '/') . (isset($parts['query']) ? '?' . $parts['query'] : '');
    $headers = [];
    foreach ($args['headers'] as $name => $value) {
        $headers[] = "$name: $value";
    }
    $status = 0;
    $message = '';
    $out = [];
    $curl = curl_init($target);
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
