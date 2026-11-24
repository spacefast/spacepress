<?php

declare(strict_types=1);

namespace SpacePress\Sync;

use WP_HTML_Processor as Html;

/**
 * Rendered HTML → Markdown for reading (Markdown::renderPost()), on core's HTML Processor, so the HTML is
 * read the way a browser reads it. It writes what a reader sees: headings, paragraphs, lists, quotes,
 * code, tables, rules, links, images, emphasis. Every other element contributes its text, as a block
 * when it is a block-level element. Hidden elements (`hidden`, `<script>`, `<style>`, `<template>`,
 * form controls) contribute nothing.
 *
 * The output is Markdown text, never HTML: text is written as the reader saw it, and the caller
 * escapes any `<` that could start a tag.
 */
final class HtmlMarkdown {

	private const BLOCK    = array(
		'ADDRESS',
		'ARTICLE',
		'ASIDE',
		'DETAILS',
		'DIV',
		'DL',
		'DD',
		'DT',
		'FIELDSET',
		'FIGCAPTION',
		'FIGURE',
		'FOOTER',
		'FORM',
		'HEADER',
		'MAIN',
		'NAV',
		'P',
		'SECTION',
		'SUMMARY',
	);
	private const HEADINGS = array(
		'H1' => 1,
		'H2' => 2,
		'H3' => 3,
		'H4' => 4,
		'H5' => 5,
		'H6' => 6,
	);
	/** Elements whose content a reader never sees. */
	private const SKIP = array(
		'SCRIPT',
		'STYLE',
		'TEMPLATE',
		'NOSCRIPT',
		'IFRAME',
		'OBJECT',
		'EMBED',
		'SVG',
		'MATH',
		'BUTTON',
		'INPUT',
		'SELECT',
		'TEXTAREA',
		'OPTION',
		'LABEL',
		'CANVAS',
		'VIDEO',
		'AUDIO',
		'HEAD',
		'TITLE',
	);

	/** @var list<string> finished Markdown blocks */
	private array $blocks = array();
	/** Inline Markdown of the block being written. */
	private string $line = '';
	/** @var list<array{tag: string, prefix: string, ordered: bool, n: int}> open lists and quotes */
	private array $containers = array();
	/** @var list<string> hrefs of open links */
	private array $links = array();
	private int $pre     = 0;
	private string $code = '';
	/** The fence language of the open `<pre>`: its or its `<code>`'s `language-<x>` class. */
	private string $language = '';
	/** Whether the last block written is a list item, so the next item joins it without a blank line. */
	private bool $listOpen = false;
	private ?array $table  = null;

	public static function convert( string $html ): string {
		if ( trim( $html ) === '' ) {
			return '';
		}
		$converter = new self();
		$processor = Html::create_fragment( $html );
		if ( null === $processor ) {
			return self::fallback( $html );
		}
		$converter->walk( $processor );
		if ( $processor->get_last_error() !== null ) {
			// Markup the HTML Processor doesn't support yet: its text, without structure.
			return self::fallback( $html );
		}
		$converter->flush();

		return implode( "\n\n", $converter->blocks );
	}

	private static function fallback( string $html ): string {
		$html       = (string) preg_replace( '#<(script|style|template)\b.*?</\1>#is', '', $html );
		$text       = html_entity_decode( wp_strip_all_tags( $html ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		$paragraphs = preg_split( '/\n\s*\n/', trim( $text ) ) ?: array();

		return implode( "\n\n", array_filter( array_map( static fn ( string $p ): string => trim( (string) preg_replace( '/\s+/u', ' ', $p ) ), $paragraphs ) ) );
	}

	private function walk( Html $p ): void {
		$skip_depth = null;
		while ( $p->next_token() ) {
			$type  = $p->get_token_type();
			$depth = $p->get_current_depth();
			if ( null !== $skip_depth ) {
				if ( $depth < $skip_depth || ( $depth === $skip_depth && '#tag' === $type && $p->is_tag_closer() ) ) {
					$skip_depth = null;
				}
				continue;
			}
			if ( '#text' === $type ) {
				$this->text( $p->get_modifiable_text() );
				continue;
			}
			if ( '#tag' !== $type ) {
				continue;
			}
			$tag    = (string) $p->get_tag();
			$closer = $p->is_tag_closer();
			if ( ! $closer && ( in_array( $tag, self::SKIP, true ) || $p->get_attribute( 'hidden' ) !== null
				|| strtolower( (string) $p->get_attribute( 'aria-hidden' ) ) === 'true' && 'IMG' !== $tag ) ) {
				if ( $p->expects_closer() !== false ) {
					$skip_depth = $depth;
				}
				continue;
			}
			$closer ? $this->close( $tag ) : $this->open( $tag, $p );
		}
	}

	private function open( string $tag, Html $p ): void {
		if ( null !== $this->table && ! in_array( $tag, array( 'TD', 'TH', 'TR', 'THEAD', 'TBODY', 'TFOOT', 'TABLE' ), true ) ) {
			$this->inline( $tag, $p );

			return;
		}
		match ( true ) {
			isset( self::HEADINGS[ $tag ] ) => $this->start_block( str_repeat( '#', self::HEADINGS[ $tag ] ) . ' ' ),
			in_array( $tag, self::BLOCK, true ) => $this->flush(),
			'UL' === $tag || 'OL' === $tag => $this->open_list( $tag, $p ),
			'LI' === $tag => $this->open_item(),
			'BLOCKQUOTE' === $tag => $this->open_quote(),
			'PRE' === $tag => $this->open_pre( self::language( $p ) ),
			'HR' === $tag => $this->rule(),
			'BR' === $tag => $this->pre > 0 ? $this->code                                  .= "\n" : $this->line .= "  \n",
			'TABLE' === $tag => $this->open_table(),
			'TR' === $tag => null === $this->table ?: $this->table['row']                   = array(),
			'TD' === $tag || 'TH' === $tag => null === $this->table ?: $this->table['cell'] = '',
			default => $this->inline( $tag, $p ),
		};
	}

	private function close( string $tag ): void {
		if ( null !== $this->table && ! in_array( $tag, array( 'TD', 'TH', 'TR', 'TABLE' ), true ) ) {
			$this->inline_close( $tag );

			return;
		}
		match ( true ) {
			isset( self::HEADINGS[ $tag ] ), in_array( $tag, self::BLOCK, true ), 'LI' === $tag => $this->flush(),
			'UL' === $tag || 'OL' === $tag || 'BLOCKQUOTE' === $tag => $this->close_container(),
			'PRE' === $tag => $this->close_pre(),
			'TD' === $tag || 'TH' === $tag => $this->close_cell(),
			'TR' === $tag => $this->close_row(),
			'TABLE' === $tag => $this->close_table(),
			default => $this->inline_close( $tag ),
		};
	}

	private function inline( string $tag, Html $p ): void {
		if ( $this->pre > 0 ) {
			if ( 'CODE' === $tag && '' === $this->language ) {
				$this->language = self::language( $p );
			}

			return;
		}
		match ( $tag ) {
			'STRONG', 'B' => $this->emit( '**' ),
			'EM', 'I' => $this->emit( '*' ),
			'DEL', 'S' => $this->emit( '~~' ),
			'CODE' => $this->emit( '`' ),
			'A' => $this->open_link( (string) $p->get_attribute( 'href' ) ),
			'IMG' => $this->image( (string) $p->get_attribute( 'alt' ), (string) $p->get_attribute( 'src' ) ),
			default => null,
		};
	}

	private function inline_close( string $tag ): void {
		if ( $this->pre > 0 ) {
			return;
		}
		match ( $tag ) {
			'STRONG', 'B' => $this->emit( '**' ),
			'EM', 'I' => $this->emit( '*' ),
			'DEL', 'S' => $this->emit( '~~' ),
			'CODE' => $this->emit( '`' ),
			'A' => $this->close_link(),
			default => null,
		};
	}

	// ================================================================ text and inline

	private function text( string $text ): void {
		if ( $this->pre > 0 ) {
			$this->code .= $text;

			return;
		}
		$text       = (string) preg_replace( '/\s+/u', ' ', $text );
		$target     = $this->target();
		$line_start = '' === $target || str_ends_with( $target, "\n" ) || preg_match( '/^#{1,6} $/', $target ) === 1;
		if ( $line_start || str_ends_with( $target, ' ' ) ) {
			$text = ltrim( $text );
		}
		$text = str_replace( array( '\\', '[', ']', '*', '_', '`' ), array( '\\\\', '\\[', '\\]', '\\*', '\\_', '\\`' ), $text );
		if ( $line_start ) {
			// Text a reader saw as text, never Markdown structure: a heading (`\#`), quote (`\>`), list
			// item (`\-`, `1\.`), `~~~` fence, `---` rule or `===` setext underline. Backticks, `*` and
			// `_` are escaped everywhere above, so ``` fences and `***`/`___` rules can't start here.
			$text = (string) preg_replace( array( '/^(#{1,6}|[>+-])(?=\s|$)/', '/^(\d{1,9})([.)])(?=\s|$)/', '/^(~{3,}|-{2,}|={1,})/' ), array( '\\\\$1', '$1\\\\$2', '\\\\$1' ), $text );
		}
		$this->emit( $text );
	}

	private function emit( string $markdown ): void {
		if ( null !== $this->table && isset( $this->table['cell'] ) ) {
			$this->table['cell'] .= $markdown;
		} else {
			$this->line .= $markdown;
		}
	}

	private function target(): string {
		return null !== $this->table && isset( $this->table['cell'] ) ? $this->table['cell'] : $this->line;
	}

	private function open_link( string $href ): void {
		$this->links[] = $href;
		$this->emit( '[' );
	}

	private function close_link(): void {
		$href = array_pop( $this->links );
		if ( null === $href ) {
			return;
		}
		$this->emit( '](' . self::url( $href ) . ')' );
	}

	private function image( string $alt, string $src ): void {
		if ( '' === $src ) {
			return;
		}
		$this->emit( '![' . str_replace( array( '[', ']' ), '', $alt ) . '](' . self::url( $src ) . ')' );
	}

	private static function url( string $url ): string {
		return str_replace( array( ' ', '(', ')', '<', '>' ), array( '%20', '%28', '%29', '%3C', '%3E' ), $url );
	}

	// ================================================================ blocks

	private function start_block( string $prefix ): void {
		$this->flush();
		$this->line = $prefix;
	}

	/** Finish the block being written, with the open lists' and quotes' prefixes. */
	private function flush(): void {
		$line       = rtrim( (string) preg_replace( '/[ \t]+\n/', "  \n", $this->line ) );
		$this->line = '';
		if ( trim( $line ) === '' || preg_match( '/^#{1,6} *$/', $line ) === 1 ) {
			return;
		}
		// Strikethrough markup (`~~`) can line up into a `~~~` fence at a line start, which the
		// per-text escape never sees: escape it on the assembled line, after each hard break too.
		$line = (string) preg_replace( '/(^|\n)(~{3,})/', '$1\\\\$2', $line );
		$this->push( $line );
	}

	private function push( string $markdown ): void {
		$lines = explode( "\n", $markdown );
		$first = true;
		foreach ( $lines as &$text ) {
			$prefix = '';
			foreach ( $this->containers as $i => &$container ) {
				if ( 'BLOCKQUOTE' === $container['tag'] ) {
					$prefix .= '> ';
				} elseif ( $i === array_key_last( $this->containers ) && $first && $container['pending'] ) {
					$prefix              .= $container['bullet'];
					$container['pending'] = false;
				} else {
					$prefix .= str_repeat( ' ', strlen( $container['bullet'] ) );
				}
			}
			unset( $container );
			$text  = $prefix . $text;
			$first = false;
		}
		unset( $text );
		$in_list  = array() !== $this->containers && 'BLOCKQUOTE' !== end( $this->containers )['tag'];
		$previous = array_key_last( $this->blocks );
		if ( $in_list && null !== $previous && ( $this->blocks[ $previous ][-1] ?? '' ) !== "\n" && $this->listOpen ) {
			$this->blocks[ $previous ] .= "\n" . implode( "\n", $lines );
		} else {
			$this->blocks[] = implode( "\n", $lines );
		}
		$this->listOpen = $in_list;
	}

	private function open_list( string $tag, Html $p ): void {
		$this->flush();
		$start              = (int) ( $p->get_attribute( 'start' ) ?? 1 );
		$this->containers[] = array(
			'tag'     => $tag,
			'ordered' => 'OL' === $tag,
			'n'       => $start - 1,
			'bullet'  => '- ',
			'pending' => false,
		);
	}

	private function open_item(): void {
		$this->flush();
		$last = array_key_last( $this->containers );
		if ( null === $last || 'BLOCKQUOTE' === $this->containers[ $last ]['tag'] ) {
			return;
		}
		$list = &$this->containers[ $last ];
		++$list['n'];
		$list['bullet']  = $list['ordered'] ? $list['n'] . '. ' : '- ';
		$list['pending'] = true;
	}

	private function open_quote(): void {
		$this->flush();
		$this->listOpen     = false;
		$this->containers[] = array(
			'tag'     => 'BLOCKQUOTE',
			'ordered' => false,
			'n'       => 0,
			'bullet'  => '> ',
			'pending' => false,
		);
	}

	private function close_container(): void {
		$this->flush();
		$closed = array_pop( $this->containers );
		// A list nested in an item hands back to its parent list: the next item joins it.
		$this->listOpen = null !== $closed && 'BLOCKQUOTE' !== $closed['tag'] && array() !== $this->containers && 'BLOCKQUOTE' !== end( $this->containers )['tag'];
	}

	private function open_pre( string $language ): void {
		$this->flush();
		++$this->pre;
		$this->code     = '';
		$this->language = $language;
	}

	/** `x` from a `language-x` class, as the code block writes the fence language. */
	private static function language( Html $p ): string {
		return preg_match( '/(?:^|\s)language-([A-Za-z0-9_+#.-]+)/', (string) $p->get_attribute( 'class' ), $m ) === 1 ? $m[1] : '';
	}

	private function close_pre(): void {
		if ( 0 === $this->pre ) {
			return;
		}
		--$this->pre;
		$code           = rtrim( $this->code, "\n" );
		$this->code     = '';
		$fence          = str_repeat( '`', max( 3, self::longest_run( $code, '`' ) + 1 ) );
		$this->listOpen = false;
		$this->push( $fence . $this->language . "\n" . $code . "\n" . $fence );
		$this->language = '';
		$this->listOpen = false;
	}

	private static function longest_run( string $text, string $char ): int {
		preg_match_all( '/' . preg_quote( $char, '/' ) . '+/', $text, $m );

		return array() === $m[0] ? 0 : max( array_map( 'strlen', $m[0] ) );
	}

	private function rule(): void {
		$this->flush();
		$this->listOpen = false;
		$this->push( '---' );
		$this->listOpen = false;
	}

	// ================================================================ tables

	private function open_table(): void {
		$this->flush();
		$this->table = array( 'rows' => array() );
	}

	private function close_cell(): void {
		if ( null === $this->table || ! isset( $this->table['cell'] ) ) {
			return;
		}
		$this->table['row'][] = trim( str_replace( '|', '\\|', (string) preg_replace( '/\s+/u', ' ', $this->table['cell'] ) ) );
		unset( $this->table['cell'] );
	}

	private function close_row(): void {
		if ( null === $this->table ) {
			return;
		}
		$this->close_cell();
		if ( ( $this->table['row'] ?? array() ) !== array() ) {
			$this->table['rows'][] = $this->table['row'];
		}
		$this->table['row'] = array();
	}

	private function close_table(): void {
		if ( null === $this->table ) {
			return;
		}
		$this->close_row();
		$rows        = $this->table['rows'];
		$this->table = null;
		if ( array() === $rows ) {
			return;
		}
		$width = max( array_map( 'count', $rows ) );
		$lines = array();
		foreach ( $rows as $i => $row ) {
			$row     = array_pad( $row, $width, '' );
			$lines[] = '| ' . implode( ' | ', $row ) . ' |';
			if ( 0 === $i ) {
				$lines[] = '|' . str_repeat( '---|', $width );
			}
		}
		$this->listOpen = false;
		$this->push( implode( "\n", $lines ) );
		$this->listOpen = false;
	}
}
