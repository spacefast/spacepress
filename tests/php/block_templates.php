<?php

declare(strict_types=1);

/*
 * first/app/ pages inside the active block theme's templates (docs/pages.md "Block templates",
 * docs/decisions/2026-11-16-pages-in-block-templates.md), over HTTP with php -S:
 * tests/fixtures/block-templates, built by `first build`, on First's default block theme. Prints
 * one JSON object: label => observed.
 *
 *   FIRST_WP_THEMES=1 php tests/php/block_templates.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('block-templates', ['wpContent' => $argv[1], 'users' => ['reader' => 'subscriber']]);
wp_set_current_user(1);
update_option('blogdescription', 'Tagline from WordPress');
\First\db()->insert('notes', ['title' => 'Hello', 'status' => 'published']);
$site->actAs(null);
$site->startServer();
$url = $site->url();
$password = 'correct horse battery stapler';
$site->addUser('ana', 'subscriber', $password);

function fetch(string $url, string $method = 'GET', array $headers = [], ?string $body = null): array
{
    $ch = curl_init($url);
    $out = [];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => [...$headers, 'Cookie: wordpress_test_cookie=WP+Cookie+check'], CURLOPT_POSTFIELDS => $body,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$out): int {
            if (str_contains($line, ':')) {
                [$name, $value] = explode(':', $line, 2);
                $out[strtolower(trim($name))][] = trim($value);
            }
            return strlen($line);
        },
    ]);
    $text = (string) curl_exec($ch);
    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'headers' => $out, 'body' => $text];
}

/** What a page shows: the theme's parts, the app's markup, the head. */
function shape(array $r): array
{
    $doc = new DOMDocument();
    @$doc->loadHTML('<?xml encoding="utf-8"?>' . $r['body']);
    $x = new DOMXPath($doc);
    $count = static fn (string $q): int => $x->query($q)->length;
    $text = static fn (string $q): ?string => ($n = $x->query($q)->item(0)) ? trim(preg_replace('/\s+/', ' ', $n->textContent)) : null;
    return [
        'status' => $r['status'],
        'title' => $text('//title'),
        'titles' => $count('//title'),
        'description' => $x->query('//meta[@name="description"]')->item(0)?->getAttribute('content'),
        'canonicals' => $count('//link[@rel="canonical"]'),
        // The theme's parts: First's default theme has the site title in its header and the tagline in its footer.
        'theme header' => $count('//header[contains(@class,"wp-block-template-part")]//*[contains(@class,"wp-block-site-title")]'),
        'theme footer' => $count('//footer[contains(@class,"wp-block-template-part")]//*[contains(@class,"wp-block-site-tagline")]'),
        'site blocks' => $count('//div[contains(concat(" ",@class," ")," wp-site-blocks ")]'),
        'region' => $count('//*[@data-wp-router-region="first/main"]'),
        'region in template' => $count('//div[contains(concat(" ",@class," ")," wp-site-blocks ")]//*[@data-wp-router-region="first/main"]'),
        'page' => $text('//*[@data-wp-router-region="first/main"]//h1'),
        'root layout' => $count('//nav[@class="app-nav"]'),
        'global styles' => str_contains($r['body'], 'global-styles-inline-css'),
        'router module' => str_contains($r['body'], 'first/Render/client/router.js'),
        'cache' => $r['headers']['cache-control'][0] ?? null,
        'location' => $r['headers']['location'][0] ?? null,
    ];
}

$admin = ['Authorization: Basic ' . base64_encode($site->appPassword('admin')), 'Content-Type: application/json'];
$stylesheet = get_stylesheet();
$out = ['stylesheet' => $stylesheet, 'block theme' => wp_is_block_theme()];

// The theme's template wraps each page; the root layout's chrome isn't doubled.
$out['home'] = shape(fetch("$url/"));
$out['home list'] = str_contains(fetch("$url/")['body'], '<li>Hello</li>');
$out['notes'] = shape(fetch("$url/notes"));
// A layout that places <TemplatePart> itself: the blank template, its own footer.
$studio = fetch("$url/studio");
$out['studio'] = shape($studio) + ['own footer' => str_contains($studio['body'], 'Studio footer')];
// `template = "blank"` on a page: no theme parts, the root layout renders.
$out['bare'] = shape(fetch("$url/bare"));
// A guard sends a signed-out visitor to sign in.
$out['guard'] = shape(fetch("$url/account"));
// not-found.tsx inside the theme's 404 template.
$out['404'] = shape(fetch("$url/no/such/page"));

// The Site Editor's templates (REST): First's, and the theme's 404 with not-found.tsx as its content.
$list = json_decode(fetch("$url/wp-json/wp/v2/templates?context=edit", headers: $admin)['body'], true);
$slugs = [];
foreach (is_array($list) ? $list : [] as $t) {
    $slugs[$t['slug']] = ['source' => $t['source'], 'page block' => str_contains((string) ($t['content']['raw'] ?? ''), 'wp:first/page')];
}
$out['templates'] = array_intersect_key($slugs, array_flip(['first-page', 'first-blank', 'first-login', '404']));

// The sign-in template: login.tsx inside it, posting to wp-login.php.
$login = static function () use ($url): array {
    $r = fetch("$url/wp-login.php");
    $s = shape($r);
    return $s + ['app' => str_contains($r['body'], 'Sign in to Field Notes'), 'owner text' => str_contains($r['body'], 'Owner sign-in text'),
        'posts to' => preg_match('#<form name="loginform" id="loginform"[^>]*action="([^"]+)"#', $r['body'], $m) ? $m[1] : null,
        'wordpress page' => str_contains($r['body'], 'login.min.css')];
};
$out['login'] = $login();
$wrong = fetch("$url/wp-login.php", 'POST', ['Content-Type: application/x-www-form-urlencoded'], http_build_query(['log' => 'ana', 'pwd' => 'nope', 'testcookie' => '1']));
$out['login wrong password'] = ['status' => $wrong['status'], 'error' => str_contains($wrong['body'], 'class="problem"'), 'theme header' => shape($wrong)['theme header']];

// The owner edits the sign-in template in the Site Editor (a wp_template post saved through REST).
$saved = fetch("$url/wp-json/wp/v2/templates/$stylesheet//first-login", 'POST', $admin, json_encode(['content' =>
    "<!-- wp:paragraph --><p>Owner sign-in text</p><!-- /wp:paragraph -->\n<!-- wp:first/page /-->"]));
$out['login saved'] = $saved['status'];
$out['login edited'] = $login();
$wrong = fetch("$url/wp-login.php", 'POST', ['Content-Type: application/x-www-form-urlencoded'], http_build_query(['log' => 'ana', 'pwd' => 'nope', 'testcookie' => '1']));
$out['login edited wrong password'] = ['status' => $wrong['status'], 'error' => str_contains($wrong['body'], 'class="problem"'), 'owner text' => str_contains($wrong['body'], 'Owner sign-in text')];
// Rebuilt without code: the Login form block alone, its own notices shown.
fetch("$url/wp-json/wp/v2/templates/$stylesheet//first-login", 'POST', $admin, json_encode(['content' =>
    "<!-- wp:paragraph --><p>Owner sign-in text</p><!-- /wp:paragraph -->\n<!-- wp:first/login-form {\"submitLabel\":\"Go\"} /-->"]));
$out['login block'] = $login() + ['button' => (bool) preg_match('#<button type="submit" name="wp-submit" id="wp-submit">Go</button>#', fetch("$url/wp-login.php")['body'])];
$wrong = fetch("$url/wp-login.php", 'POST', ['Content-Type: application/x-www-form-urlencoded'], http_build_query(['log' => 'ana', 'pwd' => 'nope', 'testcookie' => '1']));
$out['login block wrong password'] = ['status' => $wrong['status'], 'error' => str_contains($wrong['body'], 'id="login_error"')];
$right = fetch("$url/wp-login.php", 'POST', ['Content-Type: application/x-www-form-urlencoded'], http_build_query(['log' => 'ana', 'pwd' => $password, 'testcookie' => '1', 'redirect_to' => "$url/account"]));
$out['login block sign in'] = ['status' => $right['status'], 'location' => $right['headers']['location'][0] ?? null];

// The owner edits the 404 template: their text around the app's not-found page.
fetch("$url/wp-json/wp/v2/templates/$stylesheet//404", 'POST', $admin, json_encode(['content' =>
    "<!-- wp:paragraph --><p>Owner 404 text</p><!-- /wp:paragraph -->\n<!-- wp:first/page /-->"]));
$missing = fetch("$url/no/such/page");
$out['404 edited'] = ['status' => $missing['status'], 'owner text' => str_contains($missing['body'], 'Owner 404 text'), 'page' => shape($missing)['page']];

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT), "\n";
$site->destroy();
