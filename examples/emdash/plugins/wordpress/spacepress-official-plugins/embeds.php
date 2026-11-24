<?php
declare(strict_types=1);
namespace SpacePressOfficialPlugins;

function embed( array $block ): string {
	$kind = $block['_type'] ?? '';
	$id   = $block['id'] ?? '';
	if ( ! is_string( $id ) || ! in_array( $kind, array( 'youtube', 'vimeo', 'tweet', 'bluesky', 'mastodon', 'linkPreview', 'gist' ), true ) ) {
		return ''; }
	if ( 'youtube' === $kind ) {
		if ( preg_match( '#^[a-zA-Z0-9_-]{11}$#D', $id ) ) {
			$video = $id; } else {
			$host = wp_parse_url( $id, PHP_URL_HOST );
			if ( ! in_array( $host, array( 'youtube.com', 'www.youtube.com', 'youtu.be' ), true ) ) {
				return ''; }
			parse_str( (string) wp_parse_url( $id, PHP_URL_QUERY ), $query );
			$video = 'youtu.be' === $host ? trim( (string) wp_parse_url( $id, PHP_URL_PATH ), '/' ) : ( $query['v'] ?? '' );
			}
			if ( ! is_string( $video ) || ! preg_match( '/^[a-zA-Z0-9_-]{11}$/D', $video ) ) {
				return ''; }
			return '<iframe loading="lazy" title="YouTube video" sandbox="allow-scripts allow-same-origin allow-presentation" allowfullscreen src="https://www.youtube-nocookie.com/embed/' . esc_attr( $video ) . '"></iframe>';
	}
	if ( 'vimeo' === $kind ) {
		if ( ctype_digit( $id ) ) {
			$video = $id; } elseif ( in_array( wp_parse_url( $id, PHP_URL_HOST ), array( 'vimeo.com', 'www.vimeo.com' ), true ) ) {
			$video = trim( (string) wp_parse_url( $id, PHP_URL_PATH ), '/' ); } else {
				return ''; }
			if ( ! ctype_digit( $video ) ) {
				return ''; }
			return '<iframe loading="lazy" title="Vimeo video" sandbox="allow-scripts allow-same-origin allow-presentation" allowfullscreen src="https://player.vimeo.com/video/' . esc_attr( $video ) . '"></iframe>';
	}
	if ( 'tweet' === $kind && ctype_digit( $id ) ) {
		$id = 'https://twitter.com/i/status/' . $id; }
	if ( 'bluesky' === $kind && preg_match( '#^at://([^/]+)/app\.bsky\.feed\.post/([a-zA-Z0-9]+)$#D', $id, $parts ) ) {
		$id = 'https://bsky.app/profile/' . rawurlencode( $parts[1] ) . '/post/' . $parts[2];
	}
	if ( ! str_starts_with( $id, 'https://' ) || ! wp_http_validate_url( $id ) ) {
		return ''; }
	$host = wp_parse_url( $id, PHP_URL_HOST );
	if ( 'tweet' === $kind && ! in_array( $host, array( 'twitter.com', 'www.twitter.com', 'x.com', 'www.x.com' ), true ) ) {
		return ''; }
	if ( 'bluesky' === $kind && 'bsky.app' !== $host ) {
		return ''; }
	if ( 'gist' === $kind && 'gist.github.com' !== $host ) {
		return ''; }
	$cache = 'zpl_embed_' . md5( $kind . $id );
	$html  = get_transient( $cache );
	if ( false === $html ) {
		$html = '';
		if ( 'linkPreview' === $kind ) {
			$response = wp_safe_remote_get(
				$id,
				array(
					'timeout'             => 8,
					'limit_response_size' => 512000,
					'redirection'         => 2,
				)
			);
			if ( ! is_wp_error( $response ) && wp_remote_retrieve_response_code( $response ) === 200 ) {
				$document = new \DOMDocument();
				$prior    = libxml_use_internal_errors( true );
				$document->loadHTML( wp_remote_retrieve_body( $response ) );
				libxml_clear_errors();
				libxml_use_internal_errors( $prior );
				$title       = $document->getElementsByTagName( 'title' )->item( 0 )?->textContent ?? $host;
				$description = '';
				foreach ( $document->getElementsByTagName( 'meta' ) as $meta ) {
					if ( in_array( $meta->getAttribute( 'property' ), array( 'og:title', 'og:description' ), true ) ) {
						if ( $meta->getAttribute( 'property' ) === 'og:title' ) {
							$title = $meta->getAttribute( 'content' ); } else {
							$description = $meta->getAttribute( 'content' ); }
					}
				}
				$html = '<a rel="noopener noreferrer" href="' . esc_url( $id ) . '"><strong>' . esc_html( $title ) . '</strong><p>' . esc_html( $description ) . '</p></a>';
			}
		} elseif ( 'gist' === $kind ) {
			$response = wp_safe_remote_get(
				rtrim( $id, '/' ) . '.json',
				array(
					'timeout'             => 8,
					'limit_response_size' => 512000,
				)
			);
			if ( ! is_wp_error( $response ) && wp_remote_retrieve_response_code( $response ) === 200 ) {
				$data = json_decode( wp_remote_retrieve_body( $response ), true );
				$html = wp_kses_post( is_string( $data['div'] ?? null ) ? $data['div'] : '' );
			}
		} else {
			$endpoint = match ( $kind ) {
				'bluesky' => 'https://embed.bsky.app/oembed?url=' . rawurlencode( $id ),
				'tweet' => 'https://publish.twitter.com/oembed?omit_script=true&url=' . rawurlencode( $id ),
				'mastodon' => 'https://' . $host . '/api/oembed?url=' . rawurlencode( $id ),
			};
			$response = wp_safe_remote_get(
				$endpoint,
				array(
					'timeout'             => 8,
					'limit_response_size' => 256000,
				)
			);
			if ( ! is_wp_error( $response ) && wp_remote_retrieve_response_code( $response ) === 200 ) {
				$data = json_decode( wp_remote_retrieve_body( $response ), true );
				$html = wp_kses_post( is_string( $data['html'] ?? null ) ? $data['html'] : '' );
			}
		}
		if ( '' !== $html ) {
			set_transient( $cache, $html, HOUR_IN_SECONDS ); }
	}
	// Provider failures stay visible; a link is a fallback, never a successful remote render claim.
	return '' !== $html ? '<div class="remote-embed">' . $html . '</div>' : '<a class="embed-fallback" href="' . esc_url( $id ) . '" rel="noopener noreferrer">Open ' . esc_html( $kind ) . ' (remote preview unavailable)</a>';
}

add_shortcode(
	'sp_embed',
	static function ( array $attributes ): string {
		return embed(
			array(
				'_type' => $attributes['type'] ?? '',
				'id'    => $attributes['id'] ?? '',
			)
		);
	}
);
