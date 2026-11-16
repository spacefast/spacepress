<?php
declare(strict_types=1);
$root = $argv[1];
// Each bundle gets its own loader class and files registry, so two TypedPress bundles never share one.
$bundle = ($argv[2] ?? 'runtime') === 'identity' ? ['TypedPressIdentity', '__tp_identity_vendor_autoload_files'] : ['TypedPressRuntime', '__tp_runtime_vendor_autoload_files'];
$lock = json_decode(file_get_contents($root . '/composer.lock'), true, 512, JSON_THROW_ON_ERROR);
if ($bundle[0] === 'TypedPressRuntime') {
    // Unused terminal diagnostics invoke tput; only the merger's library classes ship.
    unlink($root . '/vendor-prefixed/wp-php-toolkit/merge/functions.php');
    // rowbot/url percent-encodes a byte in the encode set with rawurlencode(), which leaves `~`
    // alone although the application/x-www-form-urlencoded set contains it (Node: `%7E`). Encode
    // the byte directly, as the URL Standard's percent-encode does.
    $encoder = $root . '/vendor-prefixed/rowbot/url/src/String/PercentEncoder.php';
    $source = file_get_contents($encoder);
    $patched = str_replace('$output .= rawurlencode($bytes[$i]);', "\$output .= sprintf('%%%02X', ord(\$bytes[\$i]));", $source, $count);
    if ($count !== 1) { fwrite(STDERR, "rowbot/url percent-encoder patch no longer applies\n"); exit(1); }
    file_put_contents($encoder, $patched);
    // wp-php-toolkit's Markdown converter wrote Markdown that reads back as other blocks, which
    // Sync\Markdown::fromBlocks() then refuses (docs/dependencies.md lists each case). Each pair is
    // an exact upstream fragment and its replacement; generation fails if one stops matching.
    $markdown = $root . '/vendor-prefixed/wp-php-toolkit/markdown/class-markdown';
    foreach ([
    ['producer', <<<'FROM'
		$markdown = trim( $markdown, "\n" );

FROM, <<<'TO'
		if ( $this->has_parent( 'core/code' ) ) {
			return rtrim( preg_replace( '/^\n/', '', $markdown ), "\n" );
		}
		$markdown = trim( $markdown, "\n" );

TO],
    ['producer', <<<'FROM'
				return "{$fence}{$language}\n{$code}\n{$fence}\n\n";
FROM, <<<'TO'
				return $this->indent( "{$fence}{$language}\n{$code}\n{$fence}" ) . "\n\n";
TO],
    ['producer', <<<'FROM'
						$current_row[] = $this->html_to_markdown( $cell_content );
FROM, <<<'TO'
						$current_row[] = str_replace( '|', '\|', $this->html_to_markdown( $cell_content ) );
TO],
    ['producer', <<<'FROM'
		$last_href = null;
		while ( $processor->next_token() ) {
			if ( '#text' === $processor->get_token_type() ) {
				$markdown .= $processor->get_modifiable_text();
FROM, <<<'TO'
		$last_href  = null;
		$code_start = null;
		while ( $processor->next_token() ) {
			if ( '#text' === $processor->get_token_type() ) {
				$text      = $processor->get_modifiable_text();
				$markdown .= $this->has_parent( 'core/code' ) || null !== $code_start ? $text : preg_replace( '/<(?=[A-Za-z\/!?])/', '\\<', $text );
TO],
    ['producer', <<<'FROM'
				case '+CODE':
				case '-CODE':
					if ( ! $this->has_parent( 'core/code' ) ) {
						$markdown .= '`';
					}
					break;
FROM, <<<'TO'
				case '+CODE':
					$code_start = $this->has_parent( 'core/code' ) ? null : strlen( $markdown );
					break;

				case '-CODE':
					if ( null !== $code_start ) {
						$span       = substr( $markdown, $code_start );
						$ticks      = str_repeat( '`', $this->longest_sequence_of( $span, '`' ) + 1 );
						$pad        = '' !== $span && ( '`' === $span[0] || '`' === substr( $span, -1 ) ) ? ' ' : '';
						$markdown   = substr( $markdown, 0, $code_start ) . $ticks . $pad . $span . $pad . $ticks;
						$code_start = null;
					}
					break;
TO],
    ['producer', <<<'FROM'
				$content       = $this->html_to_markdown( $inner_html );
FROM, <<<'TO'
				$pieces        = $block['innerContent'] ?? array( $inner_html );
				$content       = $this->html_to_markdown( (string) array_shift( $pieces ) );
TO],
    ['producer', <<<'FROM'
				$inner_blocks_markdown = $this->blocks_to_markdown(
					$inner_blocks
				);
				if ( $inner_blocks_markdown ) {
					$markdown .= $inner_blocks_markdown . "\n";
				}
FROM, <<<'TO'
				$next = 0;
				foreach ( $pieces as $piece ) {
					if ( null === $piece ) {
						$inner_blocks_markdown = isset( $inner_blocks[ $next ] ) ? $this->blocks_to_markdown( array( $inner_blocks[ $next ] ) ) : '';
						++$next;
						if ( $inner_blocks_markdown ) {
							$markdown .= $inner_blocks_markdown . "\n";
						}
						continue;
					}
					$text = trim( $this->html_to_markdown( $piece ) );
					if ( '' !== $text ) {
						$markdown = rtrim( $markdown, "\n" ) . "\n\n" . $this->indent( $text ) . "\n\n";
					}
				}
TO],
    ['consumer', <<<'FROM'
						 */
						$this->append_content( $node->getLiteral() );
FROM, <<<'TO'
						 */
						$this->append_content( str_replace( '<', '&lt;', $node->getLiteral() ) );
TO],
    ] as [$file, $from, $to]) {
        $source = file_get_contents("$markdown$file.php");
        $patched = str_replace($from, $to, $source, $count);
        if ($count !== 1) { fwrite(STDERR, "wp-php-toolkit Markdown$file patch no longer applies:\n$from\n"); exit(1); }
        file_put_contents("$markdown$file.php", $patched);
    }
}
// Strauss creates a temporary Composer project without a lock, so Composer
// chooses a random loader suffix. Give this isolated bundle a stable identity.
foreach (['autoload.php', 'composer/autoload_real.php', 'composer/autoload_static.php'] as $relative) {
    $file = $root . '/vendor-prefixed/' . $relative;
    file_put_contents($file, preg_replace('/(Composer(?:Autoloader|Static)Init)[a-f0-9]{32}/', '${1}' . $bundle[0], file_get_contents($file)));
}
$autoload = $root . '/vendor-prefixed/composer/autoload_real.php';
file_put_contents($autoload, str_replace('__composer_autoload_files', $bundle[1], file_get_contents($autoload)));
// The bundle root is a build helper, not an installed dependency. Composer's
// inferred branch and commit must not make its metadata depend on the checkout.
$installed = $root . '/vendor-prefixed/composer/installed.php';
[$rootMetadata, $dependencies] = explode("  'versions' =>", file_get_contents($installed), 2);
$rootMetadata = preg_replace(
    ["/'pretty_version' => '[^']*'/", "/'version' => '[^']*'/", "/'reference' => (?:NULL|'[^']*')/"],
    ["'pretty_version' => '1.0.0+no-version-set'", "'version' => '1.0.0.0'", "'reference' => NULL"],
    $rootMetadata,
);
file_put_contents($installed, $rootMetadata . "  'versions' =>" . $dependencies);
$licenses = [];
$iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root . '/vendor-prefixed', FilesystemIterator::SKIP_DOTS));
foreach ($iterator as $file) {
    if ($file->isFile() && preg_match('/^(?:licen[cs]e|copying|copyright|notice)(?:[._-].*)?$/i', $file->getFilename())) {
        $licenses[] = substr($file->getPathname(), strlen($root . '/vendor-prefixed/')) . "\n" . file_get_contents($file->getPathname());
    }
}
sort($licenses, SORT_STRING);
file_put_contents($root . '/vendor-prefixed/THIRD-PARTY-LICENSES.txt', implode("\n\n---\n\n", $licenses));
file_put_contents($root . '/vendor-prefixed/.manifest.json', json_encode(['lock' => hash_file('sha256', $root . '/composer.lock'), 'strauss' => '0.31.1', 'php' => '8.2'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
