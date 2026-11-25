<?php

declare(strict_types=1);

/*
 * `apiReference()` from "spacepress/content" (tests/app_router.rs `api_reference_renders_openapi_as_pages`):
 * tests/fixtures/api-reference as built, served by php -S, read over HTTP. Prints one JSON object.
 *
 *   SP_WP_THEMES=1 php tests/php/api_reference.php <wp-content dir>
 */

require __DIR__ . '/wp.php';

$site = wpSite('api-reference', ['wpContent' => $argv[1]]);
$site->startServer();
$url = $site->url();

function page(string $url): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60]);
    $body = (string) curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $html = new DOMDocument();
    @$html->loadHTML('<?xml encoding="utf-8"?>' . $body);
    return [$status, new DOMXPath($html)];
}
$texts = static fn (DOMXPath $x, string $q): array => array_map(static fn (DOMNode $n): string => trim(preg_replace('/\s+/', ' ', $n->textContent)), iterator_to_array($x->query($q)));

$out = [];
// The index: the document's title and server, a section per tag, a link per operation.
[$status, $x] = page("$url/api/");
$out['index'] = [
    'status' => $status,
    'h1' => $texts($x, '//main/h1'),
    'server' => $texts($x, '//p[@class="server"]'),
    'tags' => array_map(static fn (DOMElement $s): string => $s->getAttribute('id'), iterator_to_array($x->query('//main/section'))),
    'notes' => array_map(static fn (DOMElement $a): string => parse_url($a->getAttribute('href'), PHP_URL_PATH), iterator_to_array($x->query('//section[@id="notes"]//a'))),
    'description' => $texts($x, '//main/p[not(@class)]/code')[0] ?? null,
];
// One operation: parameters with where they go and their constraints, the body, responses and samples.
[$status, $x] = page("$url/api/notes/notes-list/");
$out['list'] = [
    'status' => $status,
    'endpoint' => $texts($x, '//p[@class="endpoint"]'),
    'access' => $texts($x, '//p[@class="access"]'),
    'limit' => $texts($x, '//li[code="limit"]/span'),
    'response' => array_map(static fn (DOMElement $li): string => $li->getAttribute('class') . ' ' . trim($li->getElementsByTagName('code')->item(0)->textContent) . ' ' . trim($li->getElementsByTagName('span')->item(0)->textContent), iterator_to_array($x->query('//section[@class="response-200"]//li'))),
    'curl' => $texts($x, '//pre[@class="curl"]'),
];
[$status, $x] = page("$url/api/notes/notes-create/");
$out['create'] = [
    'body type' => $texts($x, '//p[@class="body-type"]'),
    'body' => array_map(static fn (DOMElement $li): string => trim($li->getElementsByTagName('code')->item(0)->textContent) . ' ' . trim($li->getElementsByTagName('span')->item(0)->textContent), iterator_to_array($x->query('//h2[.="Body"]/following-sibling::ul[1]/li'))),
    'curl' => $texts($x, '//pre[@class="curl"]'),
    'fetch' => $texts($x, '//pre[@class="fetch"]'),
];
$out['missing'] = page("$url/api/notes/nope/")[0];
// A document from public/, whose schema refers to itself: the cycle stops, the nesting shows.
[$status, $x] = page("$url/partner/");
$out['partner'] = ['status' => $status, 'h1' => $texts($x, '//h1'), 'server' => $texts($x, '//p[@class="server"]'), 'params' => $texts($x, '//ul[@class="params"]/li'), 'fields' => $texts($x, '//ul[@class="fields"]/li'), 'id' => $texts($x, '//section/@id')];

// A document with blocks in a description, a quote in its server, and colliding slugs.
wp_insert_post(['post_type' => 'post', 'post_status' => 'publish', 'post_title' => 'A published post', 'post_content' => 'x']);
[$status, $x] = page("$url/edge/");
$description = $x->query('//div[@class="description"]')->item(0);
$out['edge'] = [
    'status' => $status,
    'description' => trim(preg_replace('/\s+/', ' ', $description?->textContent ?? '')),
    'renders blocks' => str_contains($x->document->saveHTML($description) ?? '', 'A published post') || $x->query('//div[@class="description"]//a[contains(@href, "wp-login")]')->length > 0,
    'sections' => array_map(static fn (DOMElement $s): string => $s->getAttribute('id'), iterator_to_array($x->query('//section'))),
    'params' => $texts($x, '//section[1]/ul[@class="params"]/li'),
    'fields' => $texts($x, '//section[1]/ul[@class="fields"]/li'),
    'body' => $texts($x, '//section[2]/p[@class="body"]'),
    'curl' => $x->query('//section[1]/pre[@class="curl"]')->item(0)?->textContent,
];
$site->destroy();
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
