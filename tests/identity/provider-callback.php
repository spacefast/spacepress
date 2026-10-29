<?php
// The external-provider callback over real HTTP against a local OpenID provider: a verified
// exchange links the immutable subject; every broken property is refused; callbacks are one-use.
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
// start() sets the binding cookie as a browser response would; buffer so the CLI can send it.
ob_start();
use Zero\Identity\{Plugin, Providers, Security, Failure};

add_filter('zero_identity_providers', static fn () => ['google' => ['issuer' => 'http://oidc:8080', 'client_id' => 'contract-client', 'secret' => 'disposable-secret']]);
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
    $url = $p->start('google', $session['session'], ['fault' => $fault], $fault === 'valid' ? '/identity/authorize?client_id=app_x' : 'https://evil.example/');
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
        check($actual['return_to'] === '/identity/authorize?client_id=app_x', 'the pending authorization survives the provider round trip');
    } catch (Failure $e) {
        check($fault !== 'valid' && $e->kind === $expected[$fault], "the callback refuses $fault ({$e->kind})");
    }
}
rejects(fn () => $p->callback('google'), 'invalid_challenge', 'a provider callback cannot be replayed');
check(Providers::continuation('https://evil.example/') === '' && Providers::continuation('/identity/authorize?x=1') === '/identity/authorize?x=1', 'only a pending authorization is a continuation');
