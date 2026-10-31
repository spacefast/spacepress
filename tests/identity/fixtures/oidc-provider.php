<?php
// A local OpenID provider for the provider-callback suite (php -S router; test stack only).
// RS256 ID tokens signed with a throwaway key; the `fault` authorize parameter breaks one property.
declare(strict_types=1);
$origin = 'http://oidc:8080';
$dir = sys_get_temp_dir() . '/oidc-fixture';
@mkdir($dir);
$b64 = static fn (string $s): string => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
$json = static function (array $data, int $status = 200): never {
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
};
if (!is_file("$dir/key.pem")) {
    $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    openssl_pkey_export($key, $pem);
    file_put_contents("$dir/key.pem", $pem);
}
$key = openssl_pkey_get_private(file_get_contents("$dir/key.pem"));
$rsa = openssl_pkey_get_details($key)['rsa'];
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if ($path === '/.well-known/openid-configuration') {
    $json(['issuer' => $origin, 'authorization_endpoint' => "$origin/authorize", 'token_endpoint' => "$origin/token", 'userinfo_endpoint' => "$origin/userinfo",
        'jwks_uri' => "$origin/jwks", 'response_types_supported' => ['code'], 'id_token_signing_alg_values_supported' => ['RS256'], 'code_challenge_methods_supported' => ['S256']]);
}
if ($path === '/jwks') {
    $json(['keys' => [['kty' => 'RSA', 'kid' => 'fixture', 'alg' => 'RS256', 'use' => 'sig', 'n' => $b64($rsa['n']), 'e' => $b64($rsa['e'])]]]);
}
if ($path === '/authorize') {
    if (($_GET['code_challenge_method'] ?? '') !== 'S256') {
        $json(['error' => 'invalid_request'], 400);
    }
    $code = bin2hex(random_bytes(16));
    file_put_contents("$dir/$code.json", json_encode($_GET));
    $target = $_GET['redirect_uri'] . (str_contains($_GET['redirect_uri'], '?') ? '&' : '?') . http_build_query(['code' => $code, 'state' => $_GET['state']]);
    header("Location: $target", true, 302);
    exit;
}
if ($path === '/token') {
    $code = preg_replace('/[^a-f0-9]/', '', (string) ($_POST['code'] ?? ''));
    $grant = is_file("$dir/$code.json") ? json_decode(file_get_contents("$dir/$code.json"), true) : null;
    @unlink("$dir/$code.json");
    if (!$grant || $grant['client_id'] !== ($_POST['client_id'] ?? null) || $grant['redirect_uri'] !== ($_POST['redirect_uri'] ?? null)
        || $b64(hash('sha256', (string) ($_POST['code_verifier'] ?? ''), true)) !== $grant['code_challenge']) {
        $json(['error' => 'invalid_grant'], 400);
    }
    $access = bin2hex(random_bytes(16));
    $now = time();
    $claims = ['iss' => $origin, 'aud' => $grant['client_id'], 'sub' => 'durable-test-subject', 'iat' => $now - 1, 'exp' => $now + 300, 'nonce' => $grant['nonce'],
        'at_hash' => $b64(substr(hash('sha256', $access, true), 0, 16)), 'email' => 'provider@example.test', 'email_verified' => true, 'name' => 'Provider account'];
    $fault = $grant['fault'] ?? 'valid';
    match ($fault) {
        'issuer' => $claims['iss'] = "$origin/wrong",
        'audience' => $claims['aud'] = 'other-client',
        'nonce' => $claims['nonce'] = 'wrong',
        'expiry' => $claims['exp'] = $now - 120,
        'at_hash' => $claims['at_hash'] = 'wrong',
        'missing_nonce' => $claims = array_diff_key($claims, ['nonce' => true]),
        default => null,
    };
    $signing = $b64(json_encode(['alg' => 'RS256', 'typ' => 'JWT', 'kid' => 'fixture'])) . '.' . $b64(json_encode($claims));
    openssl_sign($signing, $signature, $key, OPENSSL_ALGO_SHA256);
    if ($fault === 'signature') {
        $signature[0] = chr(ord($signature[0]) ^ 1);
    }
    file_put_contents("$dir/access-$access.json", json_encode(['sub' => $fault === 'userinfo_subject' ? 'wrong-subject' : $claims['sub'], 'email' => $claims['email'], 'email_verified' => true, 'name' => $claims['name']]));
    $json(['access_token' => $access, 'token_type' => 'Bearer', 'expires_in' => 300, 'id_token' => $signing . '.' . $b64($signature)]);
}
if ($path === '/userinfo') {
    $access = preg_replace('/[^a-f0-9]/', '', substr((string) ($_SERVER['HTTP_AUTHORIZATION'] ?? ''), 7));
    is_file("$dir/access-$access.json") ? $json(json_decode(file_get_contents("$dir/access-$access.json"), true)) : $json(['error' => 'invalid_token'], 401);
}
$json(['error' => 'not_found'], 404);
