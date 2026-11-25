<?php
declare(strict_types=1);
namespace SpacePressOfficialPlugins;

function embed(array $block): string {
    $kind = $block['_type'] ?? '';
    $id = $block['id'] ?? '';
    if (!is_string($id) || !in_array($kind, ['youtube', 'vimeo', 'tweet', 'bluesky', 'mastodon', 'linkPreview', 'gist'], true)) { return ''; }
    if ($kind === 'youtube') {
        if (preg_match('#^[a-zA-Z0-9_-]{11}$#D', $id)) { $video = $id; }
        else {
            $host = wp_parse_url($id, PHP_URL_HOST);
            if (!in_array($host, ['youtube.com', 'www.youtube.com', 'youtu.be'], true)) { return ''; }
            parse_str((string) wp_parse_url($id, PHP_URL_QUERY), $query);
            $video = $host === 'youtu.be' ? trim((string) wp_parse_url($id, PHP_URL_PATH), '/') : ($query['v'] ?? '');
        }
        if (!is_string($video) || !preg_match('/^[a-zA-Z0-9_-]{11}$/D', $video)) { return ''; }
        return '<iframe loading="lazy" title="YouTube video" sandbox="allow-scripts allow-same-origin allow-presentation" allowfullscreen src="https://www.youtube-nocookie.com/embed/' . esc_attr($video) . '"></iframe>';
    }
    if ($kind === 'vimeo') {
        if (ctype_digit($id)) { $video = $id; }
        elseif (in_array(wp_parse_url($id, PHP_URL_HOST), ['vimeo.com', 'www.vimeo.com'], true)) { $video = trim((string) wp_parse_url($id, PHP_URL_PATH), '/'); }
        else { return ''; }
        if (!ctype_digit($video)) { return ''; }
        return '<iframe loading="lazy" title="Vimeo video" sandbox="allow-scripts allow-same-origin allow-presentation" allowfullscreen src="https://player.vimeo.com/video/' . esc_attr($video) . '"></iframe>';
    }
    if ($kind === 'tweet' && ctype_digit($id)) { $id = 'https://twitter.com/i/status/' . $id; }
    if ($kind === 'bluesky' && preg_match('#^at://([^/]+)/app\.bsky\.feed\.post/([a-zA-Z0-9]+)$#D', $id, $parts)) {
        $id = 'https://bsky.app/profile/' . rawurlencode($parts[1]) . '/post/' . $parts[2];
    }
    if (!str_starts_with($id, 'https://') || !wp_http_validate_url($id)) { return ''; }
    $host = wp_parse_url($id, PHP_URL_HOST);
    if ($kind === 'tweet' && !in_array($host, ['twitter.com', 'www.twitter.com', 'x.com', 'www.x.com'], true)) { return ''; }
    if ($kind === 'bluesky' && $host !== 'bsky.app') { return ''; }
    if ($kind === 'gist' && $host !== 'gist.github.com') { return ''; }
    $cache = 'zpl_embed_' . md5($kind . $id);
    $html = get_transient($cache);
    if ($html === false) {
        $html = '';
        if ($kind === 'linkPreview') {
            $response = wp_safe_remote_get($id, ['timeout' => 8, 'limit_response_size' => 512000, 'redirection' => 2]);
            if (!is_wp_error($response) && wp_remote_retrieve_response_code($response) === 200) {
                $document = new \DOMDocument();
                $prior = libxml_use_internal_errors(true);
                $document->loadHTML(wp_remote_retrieve_body($response));
                libxml_clear_errors(); libxml_use_internal_errors($prior);
                $title = $document->getElementsByTagName('title')->item(0)?->textContent ?? $host;
                $description = '';
                foreach ($document->getElementsByTagName('meta') as $meta) {
                    if (in_array($meta->getAttribute('property'), ['og:title', 'og:description'], true)) {
                        if ($meta->getAttribute('property') === 'og:title') { $title = $meta->getAttribute('content'); }
                        else { $description = $meta->getAttribute('content'); }
                    }
                }
                $html = '<a rel="noopener noreferrer" href="' . esc_url($id) . '"><strong>' . esc_html($title) . '</strong><p>' . esc_html($description) . '</p></a>';
            }
        } elseif ($kind === 'gist') {
            $response = wp_safe_remote_get(rtrim($id, '/') . '.json', ['timeout' => 8, 'limit_response_size' => 512000]);
            if (!is_wp_error($response) && wp_remote_retrieve_response_code($response) === 200) {
                $data = json_decode(wp_remote_retrieve_body($response), true);
                $html = wp_kses_post(is_string($data['div'] ?? null) ? $data['div'] : '');
            }
        } else {
            $endpoint = match ($kind) {
                'bluesky' => 'https://embed.bsky.app/oembed?url=' . rawurlencode($id),
                'tweet' => 'https://publish.twitter.com/oembed?omit_script=true&url=' . rawurlencode($id),
                'mastodon' => 'https://' . $host . '/api/oembed?url=' . rawurlencode($id),
            };
            $response = wp_safe_remote_get($endpoint, ['timeout' => 8, 'limit_response_size' => 256000]);
            if (!is_wp_error($response) && wp_remote_retrieve_response_code($response) === 200) {
                $data = json_decode(wp_remote_retrieve_body($response), true);
                $html = wp_kses_post(is_string($data['html'] ?? null) ? $data['html'] : '');
            }
        }
        if ($html !== '') { set_transient($cache, $html, HOUR_IN_SECONDS); }
    }
    // Provider failures stay visible; a link is a fallback, never a successful remote render claim.
    return $html !== '' ? '<div class="remote-embed">' . $html . '</div>' : '<a class="embed-fallback" href="' . esc_url($id) . '" rel="noopener noreferrer">Open ' . esc_html($kind) . ' (remote preview unavailable)</a>';
}

add_shortcode('sp_embed', static function (array $attributes): string {
    return embed(['_type' => $attributes['type'] ?? '', 'id' => $attributes['id'] ?? '']);
});
