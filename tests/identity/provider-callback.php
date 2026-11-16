<?php
// The external-provider callback over real HTTP against a local OpenID provider: a verified
// exchange links the immutable subject; every broken property is refused; callbacks are one-use.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
// start() sets the binding cookie as a browser response would; buffer so the CLI can send it.
ob_start();
use TypedPress\Identity\{Plugin, Providers, Security, Failure};

add_filter('tp_identity_providers', static fn () => [
    'google' => ['issuer' => 'http://oidc:8080', 'client_id' => 'contract-client', 'secret' => 'disposable-secret'],
    // An EdDSA public client whose authorization starts at a host-chosen URL; the other endpoints
    // still come from the issuer's discovery document.
    'platform' => ['issuer' => 'http://oidc:8080/ed', 'client_id' => 'public-client', 'secret' => '', 'alg' => 'EdDSA',
        'discovery' => ['authorization_endpoint' => 'http://oidc:8080/ed/start']],
]);
$p = new Providers(Plugin::$security, Plugin::$accounts, Plugin::$sessions);
$uid = Plugin::$accounts->emailLogin('provider-' . bin2hex(random_bytes(4)) . '@example.test');
$session = Plugin::$sessions->create($uid);
$_COOKIE['zi_session'] = $session['secret'];
$follow = static function (string $url): array {
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_TIMEOUT => 10]);
    $response = (string) curl_exec($ch);
    preg_match('/^Location: (.+)$/mi', $response, $match);
    parse_str((string) parse_url(trim($match[1] ?? ''), PHP_URL_QUERY), $query);
    return $query;
};
$expected = ['issuer' => 'provider_validation_failed', 'audience' => 'provider_validation_failed', 'nonce' => 'provider_validation_failed', 'expiry' => 'provider_validation_failed',
    'at_hash' => 'provider_validation_failed', 'missing_nonce' => 'provider_validation_failed', 'signature' => 'provider_validation_failed',
    'userinfo_subject' => 'provider_validation_failed', 'invalid_state' => 'invalid_state', 'wrong_binding' => 'invalid_challenge'];
foreach ([...array_keys($expected), 'valid'] as $fault) {
    $url = $p->start('google', $session['session'], ['fault' => $fault], $fault === 'valid' ? '/authorize?client_id=app_x' : 'https://evil.example/');
    parse_str((string) parse_url($url, PHP_URL_QUERY), $request);
    $row = Plugin::$db->row('SELECT id FROM ' . Plugin::$db->prefix . "challenges WHERE purpose='oidc' AND payload LIKE %s", '%' . Plugin::$db->wp->esc_like($request['state']) . '%');
    // start() set the binding cookie on this "browser"; re-issue a known one for the callback.
    $binding = Security::token();
    Plugin::$db->run('UPDATE ' . Plugin::$db->prefix . 'challenges SET secret_hash=%s WHERE id=%s', Security::hash($binding), $row['id']);
    $_COOKIE['zi_oidc'] = $row['id'] . '.' . ($fault === 'wrong_binding' ? 'incorrect' : $binding);
    $_GET = $follow($url);
    if ($fault === 'invalid_state') {
        $_GET['state'] = 'incorrect';
    }
    try {
        $actual = $p->callback('google');
        check($fault === 'valid' && $actual['uid'] === $uid, 'a verified provider exchange links the immutable subject to the signed-in account');
        check($actual['return_to'] === '/authorize?client_id=app_x', 'the pending authorization survives the provider round trip');
    } catch (Failure $e) {
        check($fault !== 'valid' && $e->kind === $expected[$fault], "the callback refuses $fault ({$e->kind})");
    }
}
rejects(fn () => $p->callback('google'), 'invalid_challenge', 'a provider callback cannot be replayed');

// The EdDSA public client: the override picks the start URL, the code exchange sends no secret,
// and an email-less identity signs in to the account its host names for it.
$hosted = Plugin::$accounts->emailLogin('hosted-' . bin2hex(random_bytes(4)) . '@example.test');
$named = [];
add_filter('tp_identity_provider_account', static function (int $uid, string $issuer, string $subject) use ($hosted, &$named): int {
    $named[] = [$issuer, $subject];
    return $issuer === 'http://oidc:8080/ed' ? $hosted : $uid;
}, 10, 3);
$platformCallback = static function () use ($p, $follow): array {
    $url = $p->start('platform');
    parse_str((string) parse_url($url, PHP_URL_QUERY), $request);
    $row = Plugin::$db->row('SELECT id FROM ' . Plugin::$db->prefix . "challenges WHERE purpose='oidc' AND payload LIKE %s", '%' . Plugin::$db->wp->esc_like($request['state']) . '%');
    $binding = Security::token();
    Plugin::$db->run('UPDATE ' . Plugin::$db->prefix . 'challenges SET secret_hash=%s WHERE id=%s', Security::hash($binding), $row['id']);
    $_COOKIE['zi_oidc'] = $row['id'] . '.' . $binding;
    $_GET = $follow($url);
    return [$url, $p->callback('platform')];
};
[$url, $signedIn] = $platformCallback();
check(str_starts_with($url, 'http://oidc:8080/ed/start?'), 'a discovery override replaces only the authorization endpoint');
check($signedIn['uid'] === $hosted && $named === [['http://oidc:8080/ed', 'platform-subject']], 'an EdDSA ID token from a public client signs in to the host-named account');
check((int) Plugin::$db->row('SELECT wp_user_id FROM ' . Plugin::$db->prefix . 'providers WHERE issuer=%s AND subject=%s', 'http://oidc:8080/ed', 'platform-subject')['wp_user_id'] === $hosted, 'the platform subject is linked for later sign-ins');
remove_all_filters('tp_identity_provider_account');
check($platformCallback()[1]['uid'] === $hosted, 'a linked platform subject keeps its account without the host lookup');

// A WordPress in a subdirectory: cookie paths and continuations derive from the issuer's path.
add_filter('home_url', static fn ($url, $path) => 'http://127.0.0.1:8814/blog/' . ltrim((string) $path, '/'), 10, 2);
check(\TypedPress\Identity\Plugin::path() === '/blog/identity', 'the issuer path follows a subdirectory home URL');
