<?php

declare(strict_types=1);

require __DIR__ . '/../../../tests/php/harness.php';
require __DIR__ . '/../../../tests/php/wp.php';

$site = wpSite('starter', ['wpContent' => $argv[1], 'server' => true]);
$url = $site->url();
$browser = curl_init();
curl_setopt_array($browser, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEFILE => '', CURLOPT_TIMEOUT => 15]);

function request(string $path, ?array $fields = null): array
{
    global $browser, $url;
    curl_setopt($browser, CURLOPT_URL, str_starts_with($path, '/') ? $url . $path : $path);
    if ($fields === null) {
        curl_setopt($browser, CURLOPT_HTTPGET, true);
    } else {
        curl_setopt($browser, CURLOPT_POSTFIELDS, http_build_query($fields));
    }
    $body = curl_exec($browser);
    if ($body === false) {
        throw new RuntimeException(curl_error($browser));
    }
    return [curl_getinfo($browser, CURLINFO_RESPONSE_CODE), $body, curl_getinfo($browser, CURLINFO_REDIRECT_URL)];
}

[$status, $home] = request('/');
eq('homepage returns 200', $status, 200);
check('homepage renders the starter and the global site name', str_contains($home, 'Make this site yours.') && str_contains($home, 'Field Notes'));
check('homepage links to the latest seeded note', str_contains($home, 'What to pack'));
$title = static fn (string $html): string => preg_match('#<title>(.*?)</title>#s', $html, $m) === 1 ? html_entity_decode(trim($m[1])) : '';
eq('the home page is titled by the site name', $title($home), 'Field Notes');

[$status, $notes] = request('/notes/');
eq('notes list returns 200', $status, 200);
check('notes list includes both seeded entries', str_contains($notes, 'A first walk') && str_contains($notes, 'What to pack'));

foreach ([
    '/notes/first-walk/' => 'Take the long way to the corner shop.',
    '/notes/what-to-pack/' => '<li>A notebook and a pencil</li>',
] as $path => $body) {
    [$status, $html] = request($path);
    eq("$path returns 200", $status, 200);
    check("$path renders the Markdown body", str_contains($html, $body));
}

[, $note] = request('/notes/first-walk/');
eq('a note is titled by its own title and the site name', $title($note), 'A first walk · Field Notes');
// The layout reads the title from the `site` global, as the header does: renaming the site in
// Site settings renames every page's title.
\TypedPress\db()->globalUpdate('site', ['name' => 'Trail Journal']);
[, $renamed] = request('/notes/first-walk/');
eq('a renamed site renames the browser title', $title($renamed), 'A first walk · Trail Journal');
check('and the header', str_contains($renamed, '>Trail Journal</a>'));
\TypedPress\db()->globalUpdate('site', ['name' => 'Field Notes']);

foreach (['/missing/', '/notes/missing/'] as $path) {
    [$status, $html] = request($path);
    eq("$path returns 404", $status, 404);
    check("$path renders the custom not-found page", str_contains($html, 'Page not found'));
}

$document = new DOMDocument();
@$document->loadHTML($home);
$xpath = new DOMXPath($document);
// A stylesheet of 4 KB or less is inlined in <head> (TypedPress\Assets::INLINE_LIMIT); a larger one is linked.
$inline = $xpath->evaluate('string(//style[starts-with(@id, "typedpress-app-site-") and contains(@id, "-css-inline-css")])');
$stylesheet = $xpath->evaluate('string(//link[@rel="stylesheet" and contains(@href, "/assets/site-")]/@href)');
check('the layout inlines or links its stylesheet', $inline !== '' || $stylesheet !== '');
if ($stylesheet !== '') {
    [$status, $css] = request($stylesheet);
    eq('stylesheet returns 200', $status, 200);
} else {
    $css = $inline;
}
check('the stylesheet includes the starter rules', str_contains($css, '.masthead'));

$form = $xpath->query('//form[.//input[@name="name"]]')->item(0);
if (!$form instanceof DOMElement) {
    throw new RuntimeException('The homepage has no greeting form');
}
eq('the greeting form uses POST', strtolower($form->getAttribute('method')), 'post');
$hidden = [];
foreach ($xpath->query('.//input[@type="hidden"]', $form) as $input) {
    $hidden[$input->getAttribute('name')] = $input->getAttribute('value');
}
foreach (['Ada' => 'Hello, Ada!', str_repeat('x', 61) => 'name must be 1 to 60 characters'] as $name => $expected) {
    [$status, , $back] = request($form->getAttribute('action'), $hidden + ['name' => $name]);
    eq('form POST redirects back', $status, 303);
    if ($back === '') {
        throw new RuntimeException('The form response has no redirect');
    }
    [$status, $html] = request($back);
    eq('form return renders the homepage', $status, 200);
    check('useFormState shows the greeting or validation error', str_contains($html, $expected));
}

[$status, $html, $login] = request('/account/');
eq('account redirects guests', $status, 302);
eq('account redirects to WordPress login', parse_url($login, PHP_URL_PATH), '/wp-login.php');
parse_str((string) parse_url($login, PHP_URL_QUERY), $query);
eq('sign-in returns to the account page', $query['redirect_to'] ?? null, $url . '/account/');
check('account does not render its private content for guests', !str_contains($html, 'signed in to WordPress'));

$id = $site->userId('subscriber');
$expires = time() + 3600;
$token = WP_Session_Tokens::get_instance($id)->create($expires);
$cookie = wp_generate_auth_cookie($id, $expires, 'logged_in', $token);
curl_setopt($browser, CURLOPT_COOKIE, LOGGED_IN_COOKIE . '=' . rawurlencode($cookie));
[$status, $account] = request('/account/');
eq('account returns 200 for a signed-in subscriber', $status, 200);
check('account renders its private content', str_contains($account, 'signed in to WordPress'));

finish('Starter on WordPress');
