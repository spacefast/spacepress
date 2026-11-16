<?php

declare(strict_types=1);

/*
 * One sign-in page (docs/decisions/2026-11-15-one-sign-in-page.md), over HTTP on WordPress with
 * php -S: tests/fixtures/login-page, built by `typedpress build`, with TypedPress Identity and Two Factor
 * active. wp-login.php renders tp/app/login.tsx and still runs WordPress's sign-in; an account
 * with Identity MFA finishes on Two Factor's second step there; /identity sends a browser to
 * wp-login.php and treats its WordPress sign-in as signed in. Prints one JSON object: label => observed.
 *
 *   php tests/php/login_page.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

// LOGIN_PAGE_BASE=/blog runs only the subdirectory checks, on a site served below that path.
$base = (string) getenv('LOGIN_PAGE_BASE');
$site = wpSite('login-page', ['wpContent' => $argv[1], 'identity' => true, 'base' => $base, 'users' => ['reader' => 'subscriber'], 'muPlugins' => ['identity-http' => <<<'PHP'
    <?php
    // php -S speaks HTTP only; Identity allows that on a local site with this switch.
    define('TP_IDENTITY_DEV_HTTP', true);
    PHP, 'captcha' => <<<'PHP'
    <?php
    // A captcha-style plugin: it adds a field to the form, a script in the head and the foot, and a
    // notice above the form, only on the sign-in page (what anti-bot plugins hook).
    add_action('login_form', static function (): void { echo '<input type="hidden" name="probe" value="' . esc_attr(wp_create_nonce('probe')) . '">'; });
    add_action('login_head', static function (): void { echo "<meta name=\"probe-head\" content=\"1\">\n"; });
    add_action('login_footer', static function (): void { echo "<script id=\"probe-foot\">1</script>\n"; });
    add_filter('login_message', static fn (string $m): string => $m . '<p class="probe-notice">Members only</p>');
    PHP]]);
$url = $site->url();
$password = 'correct horse battery stapler';
$reader = $site->addUser('ana', 'subscriber', $password);
$mfaUser = $site->addUser('mo', 'subscriber', $password);
\TypedPress\Identity\Plugin::$accounts->ensure($mfaUser);
$mfa = new \TypedPress\Identity\Mfa(\TypedPress\Identity\Plugin::$db, \TypedPress\Identity\Plugin::$security);
$totp = \TypedPress\Identity\Vendor\OTPHP\TOTP::createFromSecret($mfa->setup($mfaUser, 'Login page')['secret']);
$mfa->verify($mfaUser, $totp->now(), true) || throw new RuntimeException('MFA setup failed');
$recovery = $mfa->recoveryCodes($mfaUser);
// Two Factor's emailed codes are on for the site: an account with Identity MFA must still be asked
// for Identity's factor only, and a WordPress session made another way never counts for Identity.
$emailUser = $site->addUser('em', 'subscriber', $password);
\TypedPress\Identity\Plugin::$accounts->ensure($emailUser);
$emailTotp = \TypedPress\Identity\Vendor\OTPHP\TOTP::createFromSecret($mfa->setup($emailUser, 'Email too')['secret']);
$mfa->verify($emailUser, $emailTotp->now(), true) || throw new RuntimeException('MFA setup failed');
update_user_meta($emailUser, Two_Factor_Core::ENABLED_PROVIDERS_USER_META_KEY, ['Two_Factor_Email']);
update_user_meta($emailUser, Two_Factor_Core::PROVIDER_USER_META_KEY, 'Two_Factor_Email');
$app = \TypedPress\Identity\Applications::add('Login page app', 'http://127.0.0.1:18999/callback', 'http://127.0.0.1:18999', 'app_login_page');
$site->actAs(null);
$site->startServer();

/** A browser: one cookie jar across requests, no redirects followed. */
final class Browser
{
    /** @var array<string, string> */
    public array $cookies = ['wordpress_test_cookie' => 'WP Cookie check'];
    public string $token = '';

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
        'stylesheet' => str_contains($r['body'], 'tp/app/assets/site-'),
        'robots' => str_contains($r['body'], 'noindex'),
        'cache' => $r['headers']['cache-control'][0] ?? null,
        'methods link' => $texts("//p[@class='typedpress-identity-methods']/a")[0] ?? null,
        'probes' => [
            'field' => isset($inputs['probe']),
            'head' => str_contains($r['body'], 'name="probe-head"'),
            'foot' => str_contains($r['body'], 'id="probe-foot"'),
            'notice' => str_contains($r['body'], 'Members only'),
        ],
        'testcookie field' => isset($inputs['testcookie']),
    ];
}

/** A browser holding a WordPress session for $uid that no wp-login.php sign-in made (`wp_set_auth_cookie` only). */
function planted(string $url, int $uid, array $extra = []): Browser
{
    $b = new Browser($url);
    $expires = time() + 3600;
    $token = WP_Session_Tokens::get_instance($uid)->create($expires);
    if ($extra !== []) {
        $tokens = WP_Session_Tokens::get_instance($uid);
        $tokens->update($token, $extra + $tokens->get($token));
    }
    $b->cookies[LOGGED_IN_COOKIE] = rawurlencode(wp_generate_auth_cookie($uid, $expires, 'logged_in', $token));
    $b->token = $token;
    return $b;
}

/** WordPress's view of $uid's session $token, after what the web server wrote: no stale caches. */
function wpSession(int $uid, string $token): bool
{
    wp_cache_flush();
    return WP_Session_Tokens::get_instance($uid)->verify($token);
}

/** The identity sessions open for a user, newest first. */
function identitySessions(int $uid): array
{
    wp_cache_flush();
    $db = \TypedPress\Identity\Plugin::$db;
    return $db->rows("SELECT id, wp_token, revoked_at FROM {$db->prefix}sessions WHERE wp_user_id=%d ORDER BY created_at DESC", $uid);
}

$out = [];
$login = "$url/wp-login.php";
if ($base !== '') {
    // L1: the way back after signing in is this page, not the subdirectory twice.
    $r = (new Browser($url))->go('/identity/account?tab=1');
    parse_str((string) parse_url((string) $r['location'], PHP_URL_QUERY), $q);
    $out['subdirectory'] = ['status' => $r['status'], 'login' => strtok((string) $r['location'], '?'), 'back' => $q['redirect_to'] ?? null, 'url' => $url];
    echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
    $site->destroy();
    exit;
}

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
$out['form elsewhere'] = ['action' => $home['action'], 'redirect_to' => $home['inputs']['redirect_to'] ?? null, 'cache' => $home['cache'], 'testcookie field' => $home['testcookie field'], 'probe field' => $home['probes']['field']];
// A first-time visitor signs in from that form: no wp-login.php visit before it, so no test cookie.
$fresh = new Browser($url);
$fresh->cookies = [];
$fields = ['log' => 'ana', 'pwd' => $password, 'redirect_to' => html_entity_decode((string) ($home['inputs']['redirect_to'] ?? ''))];
$fromHome = $fresh->go('/wp-login.php', $fields);
$out['form elsewhere sign in'] = ['status' => $fromHome['status'], 'location' => $fromHome['location'], 'signed in' => $fresh->signedIn()];
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
// That real sign-in (password, then Identity's factor through Two Factor) is an identity sign-in.
$out['mfa identity'] = $m->go('/identity/account')['status'];
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
$me = $anon->go('/wp-json/typedpress-identity/v1/account');
$out['identity rest'] = ['status' => $me['status'], 'id' => json_decode($me['body'], true)['data']['account']['id'] ?? null];
// prompt=login wants a sign-in made after the request: wp-login.php with reauth.
$fresh = $anon->go("/identity/authorize?$query&prompt=login");
$out['prompt login'] = ['location' => $fresh['location'], 'identity cookie' => isset($anon->cookies['zi_session'])];
// Signing out of Identity signs this browser out of WordPress too, and the other way round.
$anon->go("/identity/account");
preg_match('#"csrf":"([0-9a-f]{64})"#', $anon->go('/wp-json/typedpress-identity/v1/account')['body'], $c);
$signout = $anon->go('/wp-json/typedpress-identity/v1/sign-out', [], ["Origin: $url", 'X-Identity-CSRF: ' . ($c[1] ?? '')]);
$out['identity sign-out'] = ['status' => $signout['status'], 'wordpress signed in' => $anon->signedIn(), 'identity cookie' => isset($anon->cookies['zi_session'])];
$after = $anon->go('/identity/account');
$out['after sign-out'] = ['status' => $after['status'], 'to login' => str_starts_with((string) $after['location'], $login)];

// ---------------------------------------------------------------- Identity counts only its own second factor (H1)
// The MFA account's methods are Identity's only, whatever Two Factor's settings: the Email account is asked
// for Identity's factor, never sent an emailed code.
$step = (new Browser($url))->go('/wp-login.php', ['log' => 'em', 'pwd' => $password, 'testcookie' => '1']);
preg_match('#name="provider"[^>]*value="([^"]+)"#', $step['body'], $p);
$out['mfa methods'] = ['provider' => html_entity_decode($p[1] ?? ''), 'emailed' => str_contains($step['body'], 'Two_Factor_Email')];
// A WordPress session that another Two Factor method made, or that a plugin set with wp_set_auth_cookie
// alone (no wp-login.php, no second step), is a WordPress session but not an identity one.
$byEmail = planted($url, $emailUser, ['two-factor-provider' => 'Two_Factor_Email', 'two-factor-login' => time()]);
$plain = planted($url, $mfaUser);
$withFactor = planted($url, $mfaUser, ['two-factor-provider' => \TypedPress\Identity\Plugin::TWO_FACTOR_KEY, 'two-factor-login' => time()]);
$out['bridge'] = [
    'other method' => $byEmail->go('/wp-json/typedpress-identity/v1/account')['status'],
    'other method page' => str_starts_with((string) $byEmail->go('/identity/account')['location'], $login),
    'cookie only' => $plain->go('/wp-json/typedpress-identity/v1/account')['status'],
    'identity factor' => $withFactor->go('/identity/account')['status'],
    'no factor, no password' => $plain->signedIn(),
];

// ---------------------------------------------------------------- the identity session follows its WordPress session (H2, L3)
$wpUser = $site->addUser('wu', 'subscriber', $password);
$h2 = planted($url, $wpUser);
$h2->go('/identity/account');
$first = identitySessions($wpUser);
// Losing the identity cookie gives the same session back, not a new row.
unset($h2->cookies['zi_session']);
$h2->go('/identity/account');
$again = identitySessions($wpUser);
$out['reuse'] = ['rows' => count($again), 'same' => ($first[0]['id'] ?? null) === ($again[0]['id'] ?? null), 'linked' => ($first[0]['wp_token'] ?? null) === hash('sha256', $h2->token)];
// An application's tokens minted from that session.
$grant = (static function () use ($h2, $url, $app): array {
    $verifier = bin2hex(random_bytes(32));
    $q = ['response_type' => 'code', 'client_id' => $app['id'], 'redirect_uri' => 'http://127.0.0.1:18999/callback', 'scope' => 'openid', 'state' => 'st-' . bin2hex(random_bytes(12)), 'nonce' => 'n-' . bin2hex(random_bytes(12)), 'code_challenge_method' => 'S256', 'code_challenge' => rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=')];
    $page = $h2->go('/identity/authorize?' . http_build_query($q));
    preg_match('#name="csrf" value="([0-9a-f]{64})"#', $page['body'], $c);
    $ok = $h2->go('/identity/authorize', [...$q, 'csrf' => $c[1] ?? ''], ["Origin: $url"]);
    parse_str((string) parse_url((string) $ok['location'], PHP_URL_QUERY), $back);
    $t = (new Browser($url))->go('/identity/token', ['grant_type' => 'authorization_code', 'client_id' => $app['id'], 'redirect_uri' => 'http://127.0.0.1:18999/callback', 'code' => $back['code'] ?? '', 'code_verifier' => $verifier]);
    return json_decode($t['body'], true) ?? [];
})();
$refresh = static fn (string $r) => (new Browser($url))->go('/identity/token', ['grant_type' => 'refresh_token', 'client_id' => $app['id'], 'refresh_token' => $r]);
$out['h2 tokens'] = ['access' => isset($grant['access_token']), 'refresh' => isset($grant['refresh_token'])];
// "Log out everywhere else" in WordPress (destroy_others from another session) ends this browser's WordPress
// session, and with it the identity session and the application's tokens.
wp_cache_flush();
$other = WP_Session_Tokens::get_instance($wpUser)->create(time() + 3600);
WP_Session_Tokens::get_instance($wpUser)->destroy_others($other);
$userinfo = (new Browser($url))->go('/identity/userinfo', null, ['Authorization: Bearer ' . ($grant['access_token'] ?? '')]);
$out['destroy others'] = [
    'identity rest' => $h2->go('/wp-json/typedpress-identity/v1/account')['status'],
    'userinfo' => $userinfo['status'],
    'refresh' => $refresh((string) ($grant['refresh_token'] ?? ''))['status'],
    'session revoked' => array_values(array_filter(identitySessions($wpUser), static fn (array $r): bool => $r['wp_token'] === hash('sha256', $h2->token)))[0]['revoked_at'] !== null,
];
WP_Session_Tokens::get_instance($wpUser)->destroy_all();
// Revoking the identity session (its own sessions list, another device) ends the WordPress session it came from.
$h3 = planted($url, $wpUser);
$h3->go('/identity/account');
$row = array_values(array_filter(identitySessions($wpUser), static fn (array $r): bool => $r['wp_token'] === hash('sha256', $h3->token)))[0];
wp_cache_flush();
\TypedPress\Identity\Plugin::$sessions->revoke($wpUser, $row['id']);
$out['revoke identity'] = [
    'wordpress session' => wpSession($wpUser, $h3->token),
    'page' => str_starts_with((string) $h3->go('/identity/account')['location'], $login),
];

// ---------------------------------------------------------------- a mismatched identity cookie gives way to WordPress's sign-in (M5)
// A guest's identity session planted in a browser that is signed in to WordPress as someone else.
$guest = wp_insert_user(['user_login' => 'tp_guest_probe', 'user_pass' => wp_generate_password(32), 'role' => 'tp_guest']);
\TypedPress\Identity\Plugin::$accounts->ensure($guest);
$guestSession = \TypedPress\Identity\Plugin::$sessions->create($guest);
$m5 = planted($url, $wpUser);
$m5->cookies['zi_session'] = $guestSession['secret'];
$me5 = json_decode($m5->go('/wp-json/typedpress-identity/v1/account')['body'], true);
$page5 = $m5->go('/identity/account');
$me5 = json_decode($m5->go('/wp-json/typedpress-identity/v1/account')['body'], true);
$out['mismatch'] = ['page' => $page5['status'], 'account' => (string) ($me5['data']['account']['id'] ?? ''), 'wu' => (string) $wpUser];

// ---------------------------------------------------------------- RP logout ends both, and a bare link only asks (M3)
$l = planted($url, $wpUser);
$l->go('/identity/account');
$bare = $l->go('/identity/logout');
preg_match('#name="csrf" value="([^"]+)"#', $bare['body'], $n);
$out['logout link'] = ['status' => $bare['status'], 'asks' => str_contains($bare['body'], 'name="confirm"'), 'still signed in' => wpSession($wpUser, $l->token)];
$forged = $l->go('/identity/logout', ['confirm' => '1', 'csrf' => 'nope'], ["Origin: $url"]);
$out['logout forged'] = ['status' => $forged['status'], 'still signed in' => wpSession($wpUser, $l->token)];
$confirmed = $l->go('/identity/logout', ['confirm' => '1', 'csrf' => html_entity_decode($n[1] ?? '')], ["Origin: $url"]);
$out['logout confirmed'] = [
    'status' => $confirmed['status'],
    'wordpress session' => wpSession($wpUser, $l->token),
    'identity revoked' => array_values(array_filter(identitySessions($wpUser), static fn (array $r): bool => $r['wp_token'] === hash('sha256', $l->token)))[0]['revoked_at'] !== null,
];

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), "\n";
$site->destroy();
