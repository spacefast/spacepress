<?php

declare(strict_types=1);

/*
 * One sign-in page (docs/decisions/2026-11-15-one-sign-in-page.md), over HTTP on WordPress with
 * php -S: tests/fixtures/login-page, built by `first build`, with First Identity and Two Factor
 * active. wp-login.php renders first/app/login.tsx and still runs WordPress's sign-in; an account
 * with Identity MFA finishes on Two Factor's second step there; /identity sends a browser to
 * wp-login.php and treats its WordPress sign-in as signed in. Prints one JSON object: label => observed.
 *
 *   php tests/php/login_page.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('login-page', ['wpContent' => $argv[1], 'identity' => true, 'users' => ['reader' => 'subscriber'], 'muPlugins' => ['identity-http' => <<<'PHP'
    <?php
    // php -S speaks HTTP only; Identity allows that on a local site with this switch.
    define('FIRST_IDENTITY_DEV_HTTP', true);
    PHP]]);
$url = $site->url();
$password = 'correct horse battery stapler';
$reader = $site->addUser('ana', 'subscriber', $password);
$mfaUser = $site->addUser('mo', 'subscriber', $password);
\First\Identity\Plugin::$accounts->ensure($mfaUser);
$mfa = new \First\Identity\Mfa(\First\Identity\Plugin::$db, \First\Identity\Plugin::$security);
$totp = \First\Identity\Vendor\OTPHP\TOTP::createFromSecret($mfa->setup($mfaUser, 'Login page')['secret']);
$mfa->verify($mfaUser, $totp->now(), true) || throw new RuntimeException('MFA setup failed');
$recovery = $mfa->recoveryCodes($mfaUser);
$app = \First\Identity\Applications::add('Login page app', 'http://127.0.0.1:18999/callback', 'http://127.0.0.1:18999', 'app_login_page');
$site->actAs(null);
$site->startServer();

/** A browser: one cookie jar across requests, no redirects followed. */
final class Browser
{
    /** @var array<string, string> */
    public array $cookies = ['wordpress_test_cookie' => 'WP Cookie check'];

    public function __construct(private readonly string $base) {}

    /** @return array{status: int, location: ?string, body: string, headers: array<string, list<string>>} */
    public function go(string $url, ?array $post = null, array $headers = []): array
    {
        $url = str_starts_with($url, 'http') ? $url : $this->base . $url;
        $ch = curl_init($url);
        $out = [];
        $jar = implode('; ', array_map(static fn (string $k, string $v): string => "$k=$v", array_keys($this->cookies), $this->cookies));
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_HTTPHEADER => [...$headers, "Cookie: $jar"],
            CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$out): int {
                if (str_contains($line, ':')) {
                    [$name, $value] = explode(':', $line, 2);
                    $name = strtolower(trim($name));
                    $value = trim($value);
                    $out[$name][] = $value;
                    if ($name === 'set-cookie') {
                        [$pair] = explode(';', $value, 2);
                        [$k, $v] = explode('=', $pair, 2) + [1 => ''];
                        $expired = preg_match('/expires=([^;]+)/i', $value, $m) === 1 && strtotime($m[1]) < time();
                        if ($expired || $v === '' || $v === '+' || $v === '%20') {
                            unset($this->cookies[$k]);
                        } else {
                            $this->cookies[$k] = $v;
                        }
                    }
                }
                return strlen($line);
            },
        ]);
        if ($post !== null) {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post));
        }
        $body = (string) curl_exec($ch);
        return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'location' => $out['location'][0] ?? null, 'body' => $body, 'headers' => $out];
    }

    public function signedIn(): bool
    {
        return array_filter(array_keys($this->cookies), static fn (string $k): bool => str_starts_with($k, 'wordpress_logged_in_')) !== [];
    }
}

/** What a sign-in page shows: whose page it is, its form, its notices. */
function view(array $r): array
{
    $doc = new DOMDocument();
    @$doc->loadHTML('<?xml encoding="utf-8"?>' . $r['body']);
    $x = new DOMXPath($doc);
    $texts = static fn (string $q): array => array_map(static fn ($n) => trim(preg_replace('/\s+/', ' ', $n->textContent)), iterator_to_array($x->query($q)));
    $form = $x->query("//form[@id='loginform']")->item(0);
    $inputs = [];
    foreach ($form === null ? [] : $x->query('.//input', $form) as $input) {
        $inputs[$input->getAttribute('name')] = $input->getAttribute('type') === 'password' ? '' : $input->getAttribute('value');
    }
    return [
        'status' => $r['status'],
        'app' => $texts("//section[@class='signin']/h1")[0] ?? null,
        'title' => $texts('//title')[0] ?? null,
        'wordpress' => str_contains($r['body'], 'login.min.css') || str_contains($r['body'], "class=\"login no-js"),
        'action' => $form?->getAttribute('action'),
        'inputs' => $inputs,
        'errors' => $texts("//p[@class='problem']"),
        'notices' => $texts("//p[@class='notice']"),
        'stylesheet' => str_contains($r['body'], 'first/app/assets/site-'),
        'robots' => str_contains($r['body'], 'noindex'),
        'cache' => $r['headers']['cache-control'][0] ?? null,
        'methods link' => $texts("//p[@class='first-identity-methods']/a")[0] ?? null,
    ];
}

$out = [];
$login = "$url/wp-login.php";

// ---------------------------------------------------------------- (a) login.tsx is wp-login.php's sign-in view
$b = new Browser($url);
$out['get'] = view($b->go('/wp-login.php'));
$out['wrong password'] = view($b->go('/wp-login.php', ['log' => 'ana', 'pwd' => 'nope', 'testcookie' => '1', 'redirect_to' => "$url/account"]));
$out['unknown user'] = view($b->go('/wp-login.php', ['log' => 'nobody', 'pwd' => 'nope', 'testcookie' => '1']));
$signin = $b->go('/wp-login.php', ['log' => 'ana', 'pwd' => $password, 'testcookie' => '1', 'redirect_to' => "$url/account"]);
$out['sign in'] = ['status' => $signin['status'], 'location' => $signin['location'], 'signed in' => $b->signedIn()];
$out['account after sign in'] = $b->go('/account')['status'];
// Signing out is WordPress's (its nonce'd link); it comes back to the sign-in page with its message.
// The nonce is bound to the browser's session token, as a page rendered for it would carry it.
$cookieName = array_values(array_filter(array_keys($b->cookies), static fn (string $k): bool => str_starts_with($k, 'wordpress_logged_in_')))[0];
$token = wp_parse_auth_cookie(rawurldecode($b->cookies[$cookieName]), 'logged_in')['token'];
$nonce = substr(wp_hash(wp_nonce_tick('log-out') . "|log-out|$reader|$token", 'nonce'), -12, 10);
$logout = $b->go("/wp-login.php?action=logout&_wpnonce=$nonce");
$out['logout'] = ['status' => $logout['status'], 'location' => $logout['location'], 'signed in' => $b->signedIn()];
$out['loggedout'] = view($b->go((string) $logout['location']));
$out['lost password'] = view($b->go('/wp-login.php?action=lostpassword'));
$out['checkemail'] = view($b->go('/wp-login.php?checkemail=confirm'));
// <LoginForm /> on any other page signs in and comes back to that page.
$home = view((new Browser($url))->go('/?from=home'));
$out['form elsewhere'] = ['action' => $home['action'], 'redirect_to' => $home['inputs']['redirect_to'] ?? null, 'cache' => $home['cache']];
$guard = (new Browser($url))->go('/account');
$out['guard'] = ['status' => $guard['status'], 'to login' => str_starts_with((string) $guard['location'], $login)];

// ---------------------------------------------------------------- (b) Identity MFA through Two Factor on wp-login.php
$m = new Browser($url);
$first = $m->go('/wp-login.php', ['log' => 'mo', 'pwd' => $password, 'testcookie' => '1', 'redirect_to' => "$url/account"]);
preg_match('#name="wp-auth-nonce"[^>]*value="([^"]+)"#', $first['body'], $nonce);
preg_match('#name="provider"[^>]*value="([^"]+)"#', $first['body'], $provider);
$out['mfa password step'] = [
    'status' => $first['status'],
    'second step' => str_contains($first['body'], 'validate_2fa'),
    'provider' => html_entity_decode($provider[1] ?? ''),
    'signed in' => $m->signedIn(),
];
$wrong = $m->go('/wp-login.php?action=validate_2fa', ['wp-auth-id' => (string) $mfaUser, 'wp-auth-nonce' => $nonce[1] ?? '', 'provider' => html_entity_decode($provider[1] ?? ''), 'authcode' => '000000', 'redirect_to' => "$url/account"]);
preg_match('#name="wp-auth-nonce"[^>]*value="([^"]+)"#', $wrong['body'], $nonce);
$out['mfa wrong code'] = ['status' => $wrong['status'], 'signed in' => $m->signedIn(), 'asks again' => str_contains($wrong['body'], 'validate_2fa')];
// Two Factor waits between failed codes; the next attempt comes after it.
delete_user_meta($mfaUser, Two_Factor_Core::USER_RATE_LIMIT_KEY);
$done = $m->go('/wp-login.php?action=validate_2fa', ['wp-auth-id' => (string) $mfaUser, 'wp-auth-nonce' => $nonce[1] ?? '', 'provider' => html_entity_decode($provider[1] ?? ''), 'authcode' => $recovery[0], 'redirect_to' => "$url/account"]);
$out['mfa recovery code'] = ['status' => $done['status'], 'location' => $done['location'], 'signed in' => $m->signedIn()];
$out['mfa recovery code reused'] = (static function () use ($url, $password, $mfaUser, $recovery): array {
    $again = new Browser($url);
    $step = $again->go('/wp-login.php', ['log' => 'mo', 'pwd' => $password, 'testcookie' => '1']);
    preg_match('#name="wp-auth-nonce"[^>]*value="([^"]+)"#', $step['body'], $n);
    preg_match('#name="provider"[^>]*value="([^"]+)"#', $step['body'], $p);
    delete_user_meta($mfaUser, Two_Factor_Core::USER_RATE_LIMIT_KEY);
    $again->go('/wp-login.php?action=validate_2fa', ['wp-auth-id' => (string) $mfaUser, 'wp-auth-nonce' => $n[1] ?? '', 'provider' => html_entity_decode($p[1] ?? ''), 'authcode' => $recovery[0]]);
    return ['signed in' => $again->signedIn()];
})();
// Outside wp-login.php a password alone never signs an MFA account in.
$GLOBALS['pagenow'] = 'xmlrpc.php';
$direct = wp_authenticate('mo', $password);
$out['mfa elsewhere'] = is_wp_error($direct) ? $direct->get_error_code() : 'signed in';
$out['mfa wrong password'] = (static function () use ($url): array {
    $r = (new Browser($url))->go('/wp-login.php', ['log' => 'mo', 'pwd' => 'nope', 'testcookie' => '1']);
    return ['second step' => str_contains($r['body'], 'validate_2fa'), 'errors' => view($r)['errors']];
})();

// ---------------------------------------------------------------- (c) /identity signs in on wp-login.php
$anon = new Browser($url);
$hosted = $anon->go('/identity/account');
$out['identity signed out'] = ['status' => $hosted['status'], 'location' => $hosted['location']];
$methods = $anon->go('/identity?methods=1');
$out['identity methods'] = ['status' => $methods['status'], 'app' => str_contains($methods['body'], 'identity-root')];
$verifier = bin2hex(random_bytes(32));
$query = http_build_query([
    'response_type' => 'code', 'client_id' => $app['id'], 'redirect_uri' => 'http://127.0.0.1:18999/callback', 'scope' => 'openid profile email',
    'state' => 'st-' . bin2hex(random_bytes(12)), 'nonce' => 'n-' . bin2hex(random_bytes(12)), 'code_challenge_method' => 'S256',
    'code_challenge' => rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '='),
]);
$authorize = $anon->go("/identity/authorize?$query");
$out['authorize signed out'] = ['status' => $authorize['status'], 'location' => $authorize['location']];
$loginPage = $anon->go((string) $authorize['location']);
$out['authorize login page'] = view($loginPage);
$back = $anon->go('/wp-login.php', ['log' => 'ana', 'pwd' => $password, 'testcookie' => '1', 'redirect_to' => html_entity_decode(view($loginPage)['inputs']['redirect_to'] ?? '')]);
$out['authorize sign in'] = ['status' => $back['status'], 'location' => $back['location']];
$consent = $anon->go((string) $back['location']);
preg_match('#name="csrf" value="([0-9a-f]{64})"#', $consent['body'], $csrf);
$out['consent'] = ['status' => $consent['status'], 'csrf' => isset($csrf[1]), 'identity cookie' => isset($anon->cookies['zi_session'])];
parse_str($query, $fields);
$approved = $anon->go('/identity/authorize', [...$fields, 'csrf' => $csrf[1] ?? ''], ["Origin: $url"]);
$code = [];
parse_str((string) parse_url((string) $approved['location'], PHP_URL_QUERY), $code);
$out['approved'] = ['status' => $approved['status'], 'callback' => str_starts_with((string) $approved['location'], 'http://127.0.0.1:18999/callback'), 'state' => ($code['state'] ?? null) === $fields['state']];
$token = (new Browser($url))->go('/identity/token', ['grant_type' => 'authorization_code', 'client_id' => $app['id'], 'redirect_uri' => 'http://127.0.0.1:18999/callback', 'code' => $code['code'] ?? '', 'code_verifier' => $verifier]);
$tokens = json_decode($token['body'], true);
$userinfo = (new Browser($url))->go('/identity/userinfo', null, ['Authorization: Bearer ' . ($tokens['access_token'] ?? '')]);
$out['token'] = ['status' => $token['status'], 'sub' => json_decode($userinfo['body'], true)['sub'] ?? null, 'ana' => (string) $reader];
// The account screens open for the signed-in browser; Identity's REST knows it by its identity cookie.
$account = $anon->go('/identity/account');
$out['identity signed in'] = ['status' => $account['status'], 'app' => str_contains($account['body'], 'identity-root')];
$me = $anon->go('/wp-json/first-identity/v1/account');
$out['identity rest'] = ['status' => $me['status'], 'id' => json_decode($me['body'], true)['data']['account']['id'] ?? null];
// prompt=login wants a sign-in made after the request: wp-login.php with reauth.
$fresh = $anon->go("/identity/authorize?$query&prompt=login");
$out['prompt login'] = ['location' => $fresh['location'], 'identity cookie' => isset($anon->cookies['zi_session'])];
// Signing out of Identity signs this browser out of WordPress too, and the other way round.
$anon->go("/identity/account");
preg_match('#"csrf":"([0-9a-f]{64})"#', $anon->go('/wp-json/first-identity/v1/account')['body'], $c);
$signout = $anon->go('/wp-json/first-identity/v1/sign-out', [], ["Origin: $url", 'X-Identity-CSRF: ' . ($c[1] ?? '')]);
$out['identity sign-out'] = ['status' => $signout['status'], 'wordpress signed in' => $anon->signedIn(), 'identity cookie' => isset($anon->cookies['zi_session'])];
$after = $anon->go('/identity/account');
$out['after sign-out'] = ['status' => $after['status'], 'to login' => str_starts_with((string) $after['location'], $login)];

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
