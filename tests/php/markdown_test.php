<?php

declare(strict_types=1);

/*
 * Markdown twins, /llms.txt and Content-Signal (docs/spec/rendering.md §5) on a real WordPress
 * (tests/php/wp.php): over HTTP through php -S for what a client sees, in-process for the reading
 * renderer and the `<link>` tag. A second site without a SpacePress app shows WordPress unchanged.
 */

use SpacePress\Sync\Markdown;
use SpacePress\Wp\MarkdownTwins;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema   = array(
	'name'        => 'notes',
	'collections' => array(
		'notes' => array(
			'primaryKey' => 'id',
			'editor'     => true,
			'title'      => 'title',
			'content'    => 'body',
			'slug'       => 'slug',
			'access'     => array(
				'read'   => array( 'role' => 'anyone' ),
				'create' => array( 'role' => 'editor' ),
				'update' => array( 'role' => 'editor' ),
				'delete' => array( 'role' => 'editor' ),
			),
			'columns'    => array(
				'id'    => array(
					'type'          => 'integer',
					'primaryKey'    => true,
					'autoIncrement' => true,
					'notNull'       => true,
				),
				'title' => array(
					'type'    => 'text',
					'notNull' => true,
				),
				'slug'  => array(
					'type'   => 'slug',
					'unique' => true,
					'source' => 'title',
				),
				'body'  => array( 'type' => 'richText' ),
			),
		),
	),
);
$site     = wpSite( 'markdown', array( 'schema' => $schema ) );
$fixtures = dirname( __DIR__ ) . '/fixtures/sync';

// ================================================================ the reading renderer

/** Markup as a post's content would render it: an unsaved post, so renderPost() runs the_content on it. */
function md( string $content ): string {
	return Markdown::renderPost(
		new WP_Post(
			(object) array(
				'ID'           => 0,
				'post_type'    => 'post',
				'post_status'  => 'publish',
				'post_content' => $content,
				'filter'       => 'raw',
			)
		)
	);
}

$document = file_get_contents( "$fixtures/document.md" );
$blocks   = Markdown::toBlocks( $document );
eq( 'blocks Markdown can carry render exactly as fromBlocks writes them', md( $blocks ), Markdown::fromBlocks( $blocks ) );
eq( 'editor-saved blocks render as the sync fixture', md( file_get_contents( "$fixtures/editor.blocks" ) ), file_get_contents( "$fixtures/editor.md" ) );
$mixed = md( file_get_contents( "$fixtures/widget.blocks" ) );
eq( 'an unregistered block renders as nothing; its neighbours render as Markdown', $mixed, "Before\n" );
$rich = <<<'HTML'
<!-- wp:paragraph -->
<p>Intro with <a href="https://example.com/a">a link</a>.</p>
<!-- /wp:paragraph -->

<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group"><!-- wp:heading -->
<h2 class="wp-block-heading">Inside a group</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center"} -->
<p class="has-text-align-center">Centred <strong>text</strong>.</p>
<!-- /wp:paragraph --></div>
<!-- /wp:group -->

<!-- wp:buttons -->
<div class="wp-block-buttons"><!-- wp:button -->
<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="/signup">Sign up</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons -->

<!-- wp:html -->
<script>alert(1)</script><p>Raw <em>HTML</em></p>
<!-- /wp:html -->
HTML;
eq(
	'containers, styled blocks, buttons and raw HTML render as readable Markdown, never as markup',
	md( $rich ),
	"Intro with [a link](https://example.com/a).\n\n## Inside a group\n\nCentred **text**.\n\n[Sign up](/signup)\n\nRaw *HTML*\n"
);
eq(
	'a block Markdown has syntax for renders even when sync would refuse it',
	array( md( file_get_contents( "$fixtures/table.blocks" ) ), md( file_get_contents( "$fixtures/aligned.blocks" ) ) ),
	array( "| a | b |\n|---|---|\n", "Centered\n" )
);
eq( 'classic content renders by paragraph', md( "First line.\n\nSecond <em>line</em>." ), "First line.\n\nSecond *line*.\n" );
eq( 'an empty body renders as nothing', md( '' ), '' );
// What the review found: no layer of the renderer may reveal more than WordPress renders.
register_block_type( 'spacepress-test/members', array( 'render_callback' => static fn (): string => '' ) );
$hidden = '<!-- wp:spacepress-test/members --><div><!-- wp:paragraph --><p>Members only.</p><!-- /wp:paragraph --></div><!-- /wp:spacepress-test/members -->';
eq( 'a dynamic block that renders nothing hides its inner blocks too', array( do_blocks( $hidden ), md( $hidden ) ), array( '', '' ) );
eq(
	'text that spells a tag stays text, never markup',
	md( '<!-- wp:html --><p>&lt;script&gt;alert(1)&lt;/script&gt; and <b>&lt;b&gt;</b></p><!-- /wp:html -->' ),
	"\\<script>alert(1)\\</script> and **\\<b>**\n"
);
eq(
	'text that starts like Markdown syntax stays text (as WordPress texturizes it: a dash is no list marker)',
	md(
		'<!-- wp:paragraph --><p># not a heading</p><!-- /wp:paragraph -->'
		. '<!-- wp:paragraph --><p>&gt; not a quote</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>- not an item</p><!-- /wp:paragraph -->'
		. '<!-- wp:paragraph --><p>+ plus</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>2026. A year</p><!-- /wp:paragraph -->'
		. '<!-- wp:paragraph --><p>1) first</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>Line<br>- after a break</p><!-- /wp:paragraph -->'
		. '<!-- wp:heading --><h2 class="wp-block-heading">#hashtag heading</h2><!-- /wp:heading -->'
		. '<!-- wp:paragraph --><p>~~~ tilde fence</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>```js not code</p><!-- /wp:paragraph -->'
		. '<!-- wp:paragraph --><p>Title<br>===</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>Title<br>---</p><!-- /wp:paragraph -->'
		. '<!-- wp:paragraph --><p>---</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>***</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>___</p><!-- /wp:paragraph -->'
	),
	"\\# not a heading\n\n\\> not a quote\n\n– not an item\n\n\\+ plus\n\n2026\\. A year\n\n1\\) first\n\nLine  \n– after a break\n\n## #hashtag heading\n\n\\~~~ tilde fence\n\n“\\`js not code\n\nTitle  \n\\===\n\nTitle  \n—\n\n—\n\n\\*\\*\\*\n\n\\_\\_\\_\n"
);
eq(
	'the converter escapes each marker itself, with no texturize in front',
	\SpacePress\Sync\HtmlMarkdown::convert( '<p>- item</p><p>---</p><p>Title<br>---</p><p>~~~</p><p>1. one</p>' ),
	"\\- item\n\n\\---\n\nTitle  \n\\---\n\n\\~~~\n\n1\\. one"
);
// Strikethrough markup that lines up into a fence is escaped on the assembled line, not per text.
eq(
	'strikethrough tildes never open a fence',
	\SpacePress\Sync\HtmlMarkdown::convert( '<p><del></del> x</p><p><del>~</del> y</p><p>~~<span>~</span> z</p><p>a<br><del></del>b</p>' ),
	"\\~~~~ x\n\n\\~~~~~ y\n\n\\~~~ z\n\na  \n\\~~~~b"
);
eq( 'code keeps its angle brackets', md( Markdown::toBlocks( "Use `<div>` here.\n\n```html\n<p>x</p>\n```\n" ) ), "Use `<div>` here.\n\n```html\n<p>x</p>\n```\n" );
// What the docs site's pages hold takes the round trip sync and the seed require, and keeps its
// text: code with blank lines, a pipe in a table cell, a code block in a list item with text after
// it, a code span holding backticks, and an escaped `\<` in prose.
$kept = array(
	"```ts\nconst a = 1;\n\n\nconst b = 2;\n```\n",
	"| Command | What |\n|---------|------|\n| `a \\| b` | one |\n",
	"1. Sign in:\n\n   ```sh\n   sf login\n\n   sf whoami\n   ```\n\n   It prints a link.\n\n2. Run it.\n",
	"Write ```` ```ts title=\"a.ts\" ```` to title a block.\n",
	"Handlers live in sp/wp-hooks/\\<hook\\>.ts.\n",
);
eq(
	'code, a table pipe, a fence in a list item, backticks in code and an escaped < survive the round trip',
	array_map( static fn ( string $md ): string => Markdown::toBlocks( Markdown::fromBlocks( Markdown::toBlocks( $md ) ) ), $kept ),
	array_map( static fn ( string $md ): string => Markdown::toBlocks( $md ), $kept )
);
eq( 'an escaped < is text, never an element', str_contains( Markdown::toBlocks( "a \\<hook\\> b\n" ), '<hook>' ), false );
$native_checkout = '<!-- wp:woocommerce/checkout --><div class="wp-block-woocommerce-checkout"></div><!-- /wp:woocommerce/checkout -->';
$native_stored   = Markdown::toBlocks( "Before checkout.\n\n" . $native_checkout . "\n\nAfter checkout." );
check( 'native blocks stay serialized between Markdown paragraphs', str_contains( $native_stored, $native_checkout ) && substr_count( $native_stored, '<!-- wp:paragraph -->' ) === 2 );
problem( 'native page blocks cannot round-trip through a Markdown sync record', static fn () => Markdown::fromBlocks( $native_stored ), 422, 'not_representable' );
$quoted_block = Markdown::toBlocks( "```html\n<!-- wp:woocommerce/checkout /-->\n```\n\n" . $native_checkout );
check( 'serialized block examples inside fences remain code', str_contains( $quoted_block, '<!-- wp:code' ) && str_contains( $quoted_block, '&lt;!-- wp:woocommerce/checkout /--&gt;' ) && substr_count( $quoted_block, '<!-- wp:woocommerce/checkout' ) === 1 );
foreach ( array( 'Use `<!-- wp:woocommerce/checkout /-->` to add checkout.', '    <!-- wp:woocommerce/checkout /-->' ) as $example ) {
	$stored = Markdown::toBlocks( $example . "\n\n" . $native_checkout );
	check( 'inline and indented block examples stay literal', substr_count( $stored, '<!-- wp:woocommerce/checkout' ) === 1 && str_contains( $stored, '&lt;!-- wp:woocommerce/checkout /--&gt;' ) );
}
$native_with_code = '<!-- wp:group --><div>```html' . "\n<!-- wp:example /-->\n```" . '</div><!-- /wp:group -->';
eq( 'code markers are restored inside serialized native blocks', Markdown::toBlocks( $native_with_code ), $native_with_code );
eq( 'a comparison is not a tag', md( '<!-- wp:html --><p>1 &lt; 2</p><!-- /wp:html -->' ), "1 < 2\n" );
register_block_type( 'spacepress-test/broken', array( 'render_callback' => static fn (): never => throw new RuntimeException( 'broken block' ) ) );
eq( 'a post whose rendering throws shows nothing, never a partial or unfiltered body', md( '<!-- wp:paragraph --><p>Before.</p><!-- /wp:paragraph --><!-- wp:spacepress-test/broken /--><!-- wp:html --><p>After.</p><!-- /wp:html -->' ), '' );

// ================================================================ content

wp_set_current_user( 1 );
// WordPress's sample post and page, and the category they leave empty, aren't this fixture's.
wp_delete_post( 1, true );
wp_delete_post( 2, true );
update_option( 'blogname', 'Twin Site' );
update_option( 'blogdescription', 'Notes & more' );
update_option( 'permalink_structure', '/%postname%/' );
update_option( 'posts_per_page', 2 );
$category    = wp_insert_term( 'Field notes', 'category', array( 'description' => 'Notes from <b>outside</b>.' ) );
$insert      = static fn ( array $args ): int => (int) wp_insert_post(
	$args + array(
		'post_status' => 'publish',
		'post_type'   => 'post',
	),
	true
);
$hello       = $insert(
	array(
		'post_title'    => 'Hello world',
		'post_name'     => 'hello-world',
		'post_content'  => Markdown::toBlocks( "Hello **there**.\n\n## Next\n\nMore text.\n" ),
		'post_excerpt'  => 'A short hello.',
		'post_category' => array( $category['term_id'] ),
		'post_date'     => '2026-11-01 10:00:00',
	)
);
$second_post = $insert(
	array(
		'post_title'   => 'Second post',
		'post_name'    => 'second-post',
		'post_content' => '<!-- wp:paragraph --><p>Second body.</p><!-- /wp:paragraph -->',
		'post_date'    => '2026-11-02 10:00:00',
	)
);
$third       = $insert(
	array(
		'post_title'   => 'Third post',
		'post_name'    => 'third-post',
		'post_content' => '<!-- wp:paragraph --><p>Third body.</p><!-- /wp:paragraph -->',
		'post_date'    => '2026-11-03 10:00:00',
	)
);
$draft       = $insert(
	array(
		'post_title'   => 'Secret draft',
		'post_name'    => 'secret-draft',
		'post_status'  => 'draft',
		'post_content' => 'Draft body.',
	)
);
$private     = $insert(
	array(
		'post_title'   => 'Private one',
		'post_name'    => 'private-one',
		'post_status'  => 'private',
		'post_content' => 'Private body.',
	)
);
$locked      = $insert(
	array(
		'post_title'    => 'Locked post',
		'post_name'     => 'locked-post',
		'post_password' => 'pw',
		'post_content'  => 'Locked body.',
		'post_date'     => '2026-10-01 10:00:00',
	)
);
$about       = $insert(
	array(
		'post_type'    => 'page',
		'post_title'   => 'About',
		'post_name'    => 'about',
		'post_content' => '<!-- wp:paragraph --><p>About this site.</p><!-- /wp:paragraph -->',
	)
);
$note        = $insert(
	array(
		'post_type'    => 'sp_notes',
		'post_title'   => 'A note',
		'post_name'    => 'a-note',
		'post_content' => 'Note body.',
	)
);
check( 'the fixture content is in place', min( $hello, $second_post, $third, $draft, $private, $locked, $about, $note ) > 0 );
flush_rewrite_rules( false );
$site->actAs( null );

// ================================================================ over HTTP

$site->startServer();
$url = $site->url();

/** @return array{status: int, headers: array<string, list<string>>, body: string} */
function fetch( string $url, string $method = 'GET', array $headers = array() ): array {
	$ch  = curl_init( $url );
	$out = array();
	curl_setopt_array(
		$ch,
		array(
			CURLOPT_CUSTOMREQUEST  => $method,
			CURLOPT_NOBODY         => 'HEAD' === $method,
			CURLOPT_RETURNTRANSFER => true,
			CURLOPT_TIMEOUT        => 30,
			CURLOPT_HTTPHEADER     => $headers,
			CURLOPT_HEADERFUNCTION => static function ( $ch, string $line ) use ( &$out ): int {
				if ( str_contains( $line, ':' ) ) {
					[$name, $value]                       = explode( ':', $line, 2 );
					$out[ strtolower( trim( $name ) ) ][] = trim( $value );
				}
				return strlen( $line );
			},
		)
	);
	$body = (string) curl_exec( $ch );

	return array(
		'status'  => (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE ),
		'headers' => $out,
		'body'    => $body,
	);
}

$signal = 'search=yes, ai-input=yes, ai-train=no';
$twin   = fetch( "$url/hello-world.md" );
eq( 'a post\'s twin is its title and stored content as Markdown', array( $twin['status'], $twin['body'] ), array( 200, "# Hello world\n\nHello **there**.\n\n## Next\n\nMore text.\n" ) );
eq(
	'the twin is markdown with the content signal',
	array( $twin['headers']['content-type'] ?? null, $twin['headers']['content-signal'] ?? null ),
	array( array( 'text/markdown; charset=UTF-8' ), array( $signal ) )
);
eq( 'the twin names its HTML page as canonical', $twin['headers']['link'] ?? null, array( "<$url/hello-world/>; rel=\"canonical\"" ) );
check( 'the twin never varies on Accept: it is its own URL', ! isset( $twin['headers']['vary'] ) || ! preg_grep( '/accept/i', $twin['headers']['vary'] ), $twin['headers'] );
eq( 'the twin is the same whatever Accept says', fetch( "$url/hello-world.md", headers: array( 'Accept: text/html' ) )['body'], $twin['body'] );
eq( 'a trailing slash form has the same twin', fetch( "$url/hello-world/.md" )['status'], 404 );
eq( 'a page\'s twin', fetch( "$url/about.md" )['body'], "# About\n\nAbout this site.\n" );
eq( 'HEAD answers headers only', array( fetch( "$url/hello-world.md", 'HEAD' )['status'], fetch( "$url/hello-world.md", 'HEAD' )['body'] ), array( 200, '' ) );

$html = fetch( "$url/hello-world/" );
eq(
	'the HTML page links its twin and sends the content signal',
	array( $html['status'], $html['headers']['link'] ?? array(), $html['headers']['content-signal'] ?? null ),
	array( 200, array( "<$url/hello-world.md>; rel=\"alternate\"; type=\"text/markdown\"" ), array( $signal ) )
);
check( 'the HTML page is still HTML', str_starts_with( $html['headers']['content-type'][0] ?? '', 'text/html' ), $html['headers'] );
eq( 'Accept: text/markdown on the HTML URL still gets HTML inside WordPress: the engine answers it first', str_starts_with( fetch( "$url/hello-world/", headers: array( 'Accept: text/markdown' ) )['headers']['content-type'][0] ?? '', 'text/html' ), true );

foreach ( array(
	'secret-draft' => 'a draft',
	'private-one'  => 'a private post',
	'no-such-post' => 'a missing post',
) as $slug => $what ) {
	$r = fetch( "$url/$slug.md" );
	eq( "$what has no twin: 404 without its content", array( $r['status'], str_contains( $r['body'], 'body.' ) ), array( 404, false ) );
}
eq( 'a draft stays hidden even with its preview query', fetch( "$url/?p=$draft&preview=true" )['headers']['link'] ?? array(), array() );
$protected = fetch( "$url/locked-post.md" );
eq( 'a password-protected post\'s twin shows its title, never its body', array( $protected['status'], $protected['body'] ), array( 200, "# Locked post\n\nThis content is password protected.\n" ) );
eq( 'a SpacePress collection post is not public: no twin', array( fetch( "$url/?p=$note" )['headers']['link'] ?? array(), fetch( "$url/?p=$note&post_type=sp_notes" )['headers']['link'] ?? array() ), array( array(), array() ) );

$home = fetch( "$url/index.md" );
eq(
	'the blog index twin lists the newest posts with summaries and links',
	array( $home['status'], $home['body'] ),
	array(
		200,
		implode(
			"\n",
			array(
				'# Twin Site',
				'',
				"- [Third post]($url/third-post.md): Third body.",
				"- [Second post]($url/second-post.md): Second body.",
				'',
				"[Next page]($url/page/2.md)",
				'',
			)
		),
	)
);
eq( 'the home page links /index.md', fetch( "$url/" )['headers']['link'] ?? array(), array( "<$url/index.md>; rel=\"alternate\"; type=\"text/markdown\"" ) );
$page2 = fetch( "$url/page/2.md" );
eq(
	'pagination twins link both ways',
	$page2['body'],
	implode(
		"\n",
		array(
			'# Twin Site',
			'',
			"- [Hello world]($url/hello-world.md): A short hello.",
			"- [Locked post]($url/locked-post.md)",
			'',
			"[Previous page]($url/index.md)",
			'',
		)
	)
);
$archive = fetch( "$url/category/field-notes.md" );
eq(
	'a term archive twin has the term name, description and entries',
	$archive['body'],
	implode(
		"\n",
		array(
			'# Category: Field notes',
			'',
			'Notes from outside.',
			'',
			"- [Hello world]($url/hello-world.md): A short hello.",
			'',
		)
	)
);
eq( 'a query string stays on the twin', fetch( "$url/?s=second" )['headers']['link'] ?? array(), array( "<$url/index.md?s=second>; rel=\"alternate\"; type=\"text/markdown\"" ) );
eq( 'search results have a twin', fetch( "$url/index.md?s=second" )['body'], "# Search results for “second”\n\n- [Second post]($url/second-post.md): Second body.\n" );

$llms = fetch( "$url/llms.txt" );
eq( 'llms.txt is plain text with the content signal', array( $llms['status'], $llms['headers']['content-type'] ?? null, $llms['headers']['content-signal'] ?? null ), array( 200, array( 'text/plain; charset=UTF-8' ), array( $signal ) ) );
eq(
	'llms.txt lists public kinds and terms with twin links',
	$llms['body'],
	implode(
		"\n",
		array(
			'# Twin Site',
			'',
			'> Notes & more',
			'',
			"Every page has a Markdown version at its URL plus `.md`; the home page is [/index.md]($url/index.md).",
			'',
			'## Posts',
			'',
			"- [Third post]($url/third-post.md): Third body.",
			"- [Second post]($url/second-post.md): Second body.",
			"- [Hello world]($url/hello-world.md): A short hello.",
			"- [Locked post]($url/locked-post.md)",
			"- [All Posts]($url/index.md)",
			'',
			'## Pages',
			'',
			"- [About]($url/about.md): About this site.",
			'',
			'## Categories',
			'',
			"- [Uncategorized]($url/category/uncategorized.md)",
			"- [Field notes]($url/category/field-notes.md): Notes from outside.",
			'',
		)
	)
);
check( 'llms.txt names no draft, private post or SpacePress collection row', ! preg_match( '/Secret draft|Private one|A note/', $llms['body'] ), $llms['body'] );
$robots = fetch( "$url/robots.txt" );
check( 'robots.txt carries the content signal', str_contains( $robots['body'], "User-agent: *\nContent-Signal: $signal" ), $robots['body'] );
eq( 'a .md path under the REST prefix stays REST\'s', fetch( "$url/wp-json/wp/v2/posts/$hello.md" )['headers']['content-type'][0] ?? null, 'application/json; charset=UTF-8' );
eq( 'a POST to a twin is WordPress\'s, not a twin', str_starts_with( fetch( "$url/hello-world.md", 'POST' )['headers']['content-type'][0] ?? '', 'text/markdown' ), false );

// ================================================================ in-process: the <link> tag and the API

eq(
	'twin(): pretty URLs, home and query strings',
	array(
		MarkdownTwins::twin( "$url/hello-world/" ),
		MarkdownTwins::twin( "$url/" ),
		MarkdownTwins::twin( '/a/b?x=1' ),
		MarkdownTwins::twin( $url ),
	),
	array( "$url/hello-world.md", "$url/index.md", '/a/b.md?x=1', "$url/index.md" )
);
eq( 'post() is the twin body', MarkdownTwins::post( get_post( $hello ) ), $twin['body'] );
$_SERVER['REQUEST_URI'] = '/hello-world/';
wp();
ob_start();
do_action( 'wp_head' );
$head = (string) ob_get_clean();
check( 'wp_head prints the matching <link rel="alternate">', str_contains( $head, "<link rel=\"alternate\" type=\"text/markdown\" href=\"$url/hello-world.md\" />" ), $head );
// WordPress/ai's Markdown Feeds names the active plugins that also serve Markdown: the app is one.
require_once ABSPATH . 'wp-admin/includes/plugin.php';
$conflicting = apply_filters( 'wpai_markdown_feeds_conflicting_plugins', array( 'llm-markdown/llm-markdown.php' => 'LLM Markdown' ) );
eq(
	'the app names itself on WordPress/ai\'s list of plugins that serve Markdown',
	$conflicting,
	array(
		'llm-markdown/llm-markdown.php'                 => 'LLM Markdown',
		'spacepress-app-notes/spacepress-app-notes.php' => 'Notes (SpacePress app)',
	)
);
eq( 'WordPress/ai finds the app active under that key', array_values( array_filter( $conflicting, 'is_plugin_active', ARRAY_FILTER_USE_KEY ) ), array( 'Notes (SpacePress app)' ) );
add_filter( 'sp_content_signal', static fn (): string => '' );
eq( 'sp_content_signal set to "" sends no signal', MarkdownTwins::robots( "User-agent: *\n" ), "User-agent: *\n" );

// The engine's Accept lane: a must-use plugin stands in for the engine. Right after wp-load.php
// (wp_loaded), before the main query, it calls negotiate() for requests that ask for Markdown and
// sends the answer as the engine would.
file_put_contents(
	"$site->content/mu-plugins/engine-accept-lane.php",
	<<<'PHP'
<?php
add_action('wp_loaded', static function (): void {
    if (str_contains((string) ($_SERVER['HTTP_ACCEPT'] ?? ''), 'text/markdown') && isset($_SERVER['HTTP_X_TEST_ENGINE'])) {
        $answer = \SpacePress\Wp\MarkdownTwins::negotiate((string) $_SERVER['REQUEST_URI']);
        if ($answer !== null) {
            status_header($answer['status']);
            foreach ($answer['headers'] as $name => $value) {
                header("$name: $value");
            }
            echo $answer['body'];
            exit;
        }
    }
});
PHP
);
// Every way WordPress hides content from a signed-out visitor hides it from every Markdown surface too:
// the twin, listings, search, /llms.txt and REST ?format=md render first and convert what rendered.
file_put_contents(
	"$site->content/mu-plugins/members-block.php",
	<<<'PHP'
<?php
add_action('init', static fn () => register_block_type('spacepress-test/members-site', [
    'render_callback' => static fn (array $a, string $content): string => is_user_logged_in() ? $content : '',
]));
// A plugin hiding blocks by class through render_block, and a members shortcode.
add_filter('render_block', static fn (string $html, array $block): string => !is_user_logged_in() && str_contains((string) ($block['attrs']['className'] ?? ''), 'members-only') ? '' : $html, 10, 2);
add_shortcode('members', static fn (array|string $atts, ?string $content = null): string => is_user_logged_in() ? (string) $content : '');
// A paywall as PMPro, MemberPress and RCP do it: the_content swapped for a teaser when signed out.
add_filter('the_content', static fn (string $html): string => !is_user_logged_in() && get_post_meta((int) get_the_ID(), 'paywalled', true) === '1'
    ? '<p>Subscribe to read.</p>' : $html, 99);
// A per-post rule in render_block that asks get_the_ID() which post it is rendering.
add_filter('render_block', static fn (string $html, array $block): string => !is_user_logged_in() && ($block['blockName'] ?? '') === 'core/paragraph'
    && get_post_meta((int) get_the_ID(), 'members_paragraphs', true) === '1' && !str_contains($html, 'Public intro.') ? '' : $html, 10, 2);
PHP
);
$hiders = array(
	'a members-only dynamic block'               => '<!-- wp:spacepress-test/members-site --><div><!-- wp:paragraph --><p>SECRET-%s</p><!-- /wp:paragraph --></div><!-- /wp:spacepress-test/members-site -->',
	'core\'s Hide block on a paragraph'          => '<!-- wp:paragraph {"metadata":{"blockVisibility":false}} --><p>SECRET-%s</p><!-- /wp:paragraph -->',
	'core\'s Hide block on a group'              => '<!-- wp:group {"metadata":{"blockVisibility":false}} --><div class="wp-block-group"><!-- wp:paragraph --><p>SECRET-%s</p><!-- /wp:paragraph --></div><!-- /wp:group -->',
	'a render_block filter on a group'           => '<!-- wp:group {"className":"members-only"} --><div class="wp-block-group members-only"><!-- wp:paragraph --><p>SECRET-%s</p><!-- /wp:paragraph --></div><!-- /wp:group -->',
	'a render_block filter on a paragraph'       => '<!-- wp:paragraph {"className":"members-only"} --><p class="members-only">SECRET-%s</p><!-- /wp:paragraph -->',
	'a [members] shortcode in a paragraph'       => '<!-- wp:paragraph --><p>[members]SECRET-%s[/members]</p><!-- /wp:paragraph -->',
	'a the_content paywall filter'               => '<!-- wp:paragraph --><p>SECRET-%s</p><!-- /wp:paragraph -->',
	'a render_block filter reading get_the_ID()' => '<!-- wp:paragraph --><p>SECRET-%s</p><!-- /wp:paragraph -->',
);
$meta   = array(
	'a the_content paywall filter'               => 'paywalled',
	'a render_block filter reading get_the_ID()' => 'members_paragraphs',
);
wp_set_current_user( 1 );
$hidden = array();
$day    = 5;
foreach ( $hiders as $how => $markup ) {
	$marker = 'SECRET-' . strtoupper( substr( md5( $how ), 0, 8 ) );
	$id     = $insert(
		array(
			'post_title'   => "Members $day",
			'post_name'    => "members-$day",
			'post_date'    => sprintf( '2026-10-%02d 10:00:00', $day ),
			'post_content' => '<!-- wp:paragraph --><p>Public intro.</p><!-- /wp:paragraph -->' . sprintf(
				$markup,
				substr( $marker, 7 )
			),
		)
	);
	if ( isset( $meta[ $how ] ) ) {
		update_post_meta( $id, $meta[ $how ], '1' );
	}
	$hidden[ $how ] = array( $id, "members-$day", $marker );
	++$day;
}
$members = $hidden['a members-only dynamic block'][0];
wp_set_current_user( 0 );
$shared = array(
	'the blog index twin' => fetch( "$url/index.md" )['body'] . fetch( "$url/page/2.md" )['body'] . fetch( "$url/page/3.md" )['body'] . fetch( "$url/page/4.md" )['body'],
	'/llms.txt'           => fetch( "$url/llms.txt" )['body'],
	'search'              => fetch( "$url/index.md?s=public+intro" )['body'] . fetch( "$url/index.md?s=public+intro&paged=2" )['body'] . fetch( "$url/index.md?s=public+intro&paged=3" )['body'],
);
foreach ( $hidden as $how => [$id, $slug, $marker] ) {
	// What WordPress shows a signed-out visitor: core REST's content.rendered runs the_content as them.
	// The test router has no theme (WP_USE_THEMES false), so the HTML page itself is not compared.
	$rendered = (string) ( json_decode( fetch( "$url/wp-json/wp/v2/posts/$id" )['body'], true )['content']['rendered'] ?? '' );
	check( "$how: WordPress itself hides it (the check below means something)", '' !== $rendered && ! str_contains( $rendered, $marker ), $rendered );
	$surfaces = array(
		'its twin'        => fetch( "$url/$slug.md" )['body'],
		'REST ?format=md' => fetch( "$url/wp-json/wp/v2/posts/$id?format=md" )['body'],
	) + $shared;
	foreach ( $surfaces as $where => $body ) {
		check( "$how stays hidden in $where", ! str_contains( $body, $marker ) && ! str_contains( $body, '[members]' ), $body );
	}
	$visible = isset( $meta[ $how ] ) && 'paywalled' === $meta[ $how ] ? 'Subscribe to read.' : 'Public intro.';
	check( "$how: the twin shows what WordPress shows ($visible)", str_contains( fetch( "$url/$slug.md" )['body'], $visible ) && str_contains( $rendered, $visible ), array( fetch( "$url/$slug.md" )['body'], $rendered ) );
}
$surfaces = array( 'the blog index twin' => fetch( "$url/index.md?s=public+intro" )['body'] );
check( 'the listing summary is the rendered text', (bool) preg_match( '#\[Members \d+\]\(' . preg_quote( $url, '#' ) . '/members-\d+\.md\): Public intro\.\n#', $surfaces['the blog index twin'] ), $surfaces['the blog index twin'] );
wp_set_current_user( 1 );
wp_update_post(
	array(
		'ID'           => $members,
		'post_excerpt' => 'Hand <b>&lt;i&gt;</b> excerpt.',
	)
);
wp_set_current_user( 0 );
check( 'a hand-written excerpt is plain text, a spelled tag kept inert', str_contains( fetch( "$url/llms.txt" )['body'], '): Hand &lt;i> excerpt.' ), fetch( "$url/llms.txt" )['body'] );

// ?format=md on core item routes: the item as post(), after core's own permission check.
$rest = fetch( "$url/wp-json/wp/v2/posts/$hello?format=md" );
eq(
	'?format=md on a core item route answers the twin body as Markdown',
	array( $rest['status'], $rest['headers']['content-type'] ?? null, $rest['body'] ),
	array( 200, array( 'text/markdown; charset=UTF-8' ), MarkdownTwins::post( get_post( $hello ) ) )
);
file_put_contents( "$site->content/mu-plugins/count-content.php", '<?php add_filter("the_content", static function (string $html): string { $GLOBALS["sp_test_content_runs"] = ($GLOBALS["sp_test_content_runs"] ?? 0) + 1; header("X-Content-Runs: " . $GLOBALS["sp_test_content_runs"]); return $html; }, PHP_INT_MAX);' );
eq( '?format=md runs the_content once', fetch( "$url/wp-json/wp/v2/posts/$hello?format=md" )['headers']['x-content-runs'] ?? null, array( '1' ) );
unlink( "$site->content/mu-plugins/count-content.php" );
eq( 'the same route without format is still JSON', str_starts_with( fetch( "$url/wp-json/wp/v2/posts/$hello" )['headers']['content-type'][0] ?? '', 'application/json' ), true );
eq( 'core\'s permission check decides: a draft is still 401 JSON', array( fetch( "$url/wp-json/wp/v2/posts/$draft?format=md" )['status'], str_starts_with( fetch( "$url/wp-json/wp/v2/posts/$draft?format=md" )['headers']['content-type'][0] ?? '', 'application/json' ) ), array( 401, true ) );
$note_rest = fetch( "$url/wp-json/wp/v2/sp_notes/$note?format=md" );
eq( 'a SpacePress collection row answers as core and its access rules decide (readable by anyone here)', array( $note_rest['status'], $note_rest['body'] ), array( 200, MarkdownTwins::post( get_post( $note ) ) ) );
eq( 'a list route is not an item route: JSON', str_starts_with( fetch( "$url/wp-json/wp/v2/posts?format=md" )['headers']['content-type'][0] ?? '', 'application/json' ), true );
// ?format=md trims the response only where it then answers Markdown: other routes keep their JSON.
$pages_list = json_decode( fetch( "$url/wp-json/wp/v2/pages?format=md" )['body'], true );
check( 'a list route keeps every field with ?format=md', is_array( $pages_list ) && isset( $pages_list[0]['title'], $pages_list[0]['link'] ), json_encode( $pages_list ) );
$type_object = json_decode( fetch( "$url/wp-json/wp/v2/types/post?format=md" )['body'], true );
eq( 'a non-post item route keeps its JSON with ?format=md', $type_object['slug'] ?? null, 'post' );
$index = json_decode( fetch( "$url/wp-json/?format=md" )['body'], true );
check( 'the REST index keeps its JSON with ?format=md', isset( $index['namespaces'] ), substr( json_encode( $index ), 0, 200 ) );
// Another collection's item with a hidden post's numeric id: core checked that object, not the post.
// Make categories until one has each hidden post's id, so the route answers 200.
$shadow_terms = array();
for ( $i = 0; $i < 40 && ( ! get_term( $draft, 'category' ) || ! get_term( $private, 'category' ) ); $i++ ) {
	$shadow_terms[] = wp_insert_term( "Shadow $i", 'category' )['term_id'] ?? 0;
}
check( 'categories with the hidden posts\' ids exist', get_term( $draft, 'category' ) instanceof \WP_Term && get_term( $private, 'category' ) instanceof \WP_Term );
foreach ( array( "categories/$draft", "categories/$private", 'users/1' ) as $other ) {
	$shadow = fetch( "$url/wp-json/wp/v2/$other?format=md" );
	check( "$other?format=md is not a post item route: no post Markdown", ! str_starts_with( $shadow['headers']['content-type'][0] ?? '', 'text/markdown' ) && ! preg_match( '/Draft body|Private body/', $shadow['body'] ), $shadow['body'] );
}
foreach ( $shadow_terms as $term ) {
	wp_delete_term( $term, 'category' );
}
eq( 'a protected post without its password: title and note', fetch( "$url/wp-json/wp/v2/posts/$locked?format=md" )['body'], "# Locked post\n\nThis content is password protected.\n" );
eq( 'with the right password, as core shows it: the body', fetch( "$url/wp-json/wp/v2/posts/$locked?format=md&password=pw" )['body'], "# Locked post\n\nLocked body.\n" );
eq( 'with a wrong password core refuses as before', fetch( "$url/wp-json/wp/v2/posts/$locked?format=md&password=no" )['status'], 403 );
eq( 'a page item route works the same', fetch( "$url/wp-json/wp/v2/pages/$about?format=md" )['body'], fetch( "$url/about.md" )['body'] );

// A plugin that renders a URL itself (the pages add-on's code Pages) takes the twin away.
file_put_contents( "$site->content/mu-plugins/own-about.php", '<?php add_filter("sp_markdown_twin", static fn (bool $twin, WP_Post $post): bool => $twin && $post->post_name !== "about", 10, 2);' );
eq( 'sp_markdown_twin false: no twin and no link', array( fetch( "$url/about.md" )['status'], fetch( "$url/about/" )['headers']['link'] ?? array() ), array( 404, array() ) );
check( '…and llms.txt links no twin for it', ! str_contains( fetch( "$url/llms.txt" )['body'], '/about.md' ), fetch( "$url/llms.txt" )['body'] );
unlink( "$site->content/mu-plugins/own-about.php" );
// A dynamic block renders as an anonymous visitor, even for a signed-in request.
wp_set_current_user( 1 );
wp_update_post(
	array(
		'ID'           => $second_post,
		'post_content' => '<!-- wp:paragraph --><p>Second body.</p><!-- /wp:paragraph --><!-- wp:loginout /-->',
	)
);
wp_set_current_user( 0 );
$cookie = 'Cookie: ' . LOGGED_IN_COOKIE . '=' . rawurlencode( wp_generate_auth_cookie( 1, time() + 3600, 'logged_in' ) );
eq( 'a signed-in request gets the anonymous twin', fetch( "$url/second-post.md", headers: array( $cookie ) )['body'], fetch( "$url/second-post.md" )['body'] );
check( 'the anonymous twin shows the log-in link', str_contains( fetch( "$url/second-post.md" )['body'], '[Log in](' ), fetch( "$url/second-post.md" )['body'] );

$negotiated = fetch( "$url/hello-world/", headers: array( 'Accept: text/markdown', 'X-Test-Engine: 1' ) );
eq( 'negotiate() answers the twin', array( $negotiated['status'], $negotiated['body'] ), array( 200, $twin['body'] ) );
eq(
	'negotiate() keeps the answer out of shared caches and names the twin',
	array(
		$negotiated['headers']['content-type'] ?? null,
		$negotiated['headers']['cache-control'] ?? null,
		$negotiated['headers']['vary'] ?? null,
		$negotiated['headers']['content-location'] ?? null,
	),
	array( array( 'text/markdown; charset=UTF-8' ), array( 'private, no-store' ), array( 'Accept' ), array( "$url/hello-world.md" ) )
);
eq( 'negotiate() keeps the query string', fetch( "$url/?s=second", headers: array( 'Accept: text/markdown', 'X-Test-Engine: 1' ) )['body'], fetch( "$url/index.md?s=second" )['body'] );
eq( 'negotiate() on a missing page is the twin 404', fetch( "$url/no-such-post/", headers: array( 'Accept: text/markdown', 'X-Test-Engine: 1' ) )['status'], 404 );

// A password cookie, a signed-in visitor or a conditional request never changes what a twin says.
require_once ABSPATH . WPINC . '/class-phpass.php';
$pass_cookie = 'Cookie: wp-postpass_' . COOKIEHASH . '=' . rawurlencode( ( new PasswordHash( 8, true ) )->HashPassword( 'pw' ) );
eq( 'a password cookie leaves a protected post locked in its twin', fetch( "$url/locked-post.md", headers: array( $pass_cookie ) )['body'], $protected['body'] );
wp_set_current_user( 1 );
$loop = $insert(
	array(
		'post_title'   => 'Loop page',
		'post_name'    => 'loop-page',
		'post_type'    => 'page',
		'post_content' => '<!-- wp:query {"query":{"perPage":10,"postType":"post","inherit":false}} --><div class="wp-block-query"><!-- wp:post-template --><!-- wp:post-content /--><!-- /wp:post-template --></div><!-- /wp:query -->',
	)
);
wp_set_current_user( 0 );
$loop_twin = fetch( "$url/loop-page.md" );
check( 'a Query Loop in a twin shows public bodies, not protected ones', str_contains( $loop_twin['body'], 'Third body.' ) && ! str_contains( $loop_twin['body'], 'Locked body.' ), $loop_twin['body'] );
check( '…not even with the password cookie', ! str_contains( fetch( "$url/loop-page.md", headers: array( $pass_cookie ) )['body'], 'Locked body.' ) );
wp_set_current_user( 1 );
$insert(
	array(
		'post_title'   => 'Private second',
		'post_name'    => 'private-second',
		'post_status'  => 'private',
		'post_content' => 'second private',
		'post_date'    => '2026-11-04 10:00:00',
	)
);
wp_set_current_user( 0 );
eq(
	'a signed-in admin gets the anonymous listing and pagination',
	array( fetch( "$url/index.md", headers: array( $cookie ) )['body'], fetch( "$url/index.md?s=second", headers: array( $cookie ) )['body'] ),
	array( fetch( "$url/index.md" )['body'], fetch( "$url/index.md?s=second" )['body'] )
);
eq(
	'a feed has no twin, even conditionally',
	array(
		fetch( "$url/feed.md" )['status'],
		fetch( "$url/feed.md", headers: array( 'If-Modified-Since: ' . gmdate( 'D, d M Y H:i:s', time() + 86400 ) . ' GMT' ) )['status'],
		fetch( "$url/feed.md", headers: array( 'If-Modified-Since: ' . gmdate( 'D, d M Y H:i:s', time() + 86400 ) . ' GMT' ) )['headers']['content-type'] ?? null,
	),
	array( 404, 404, array( 'text/markdown; charset=UTF-8' ) )
);
$conditional = fetch( "$url/feed/", headers: array( 'Accept: text/markdown', 'X-Test-Engine: 1', 'If-Modified-Since: ' . gmdate( 'D, d M Y H:i:s', time() + 86400 ) . ' GMT' ) );
eq( 'negotiate() on a feed is the private twin 404', array( $conditional['status'], $conditional['headers']['cache-control'] ?? null, $conditional['headers']['vary'] ?? null ), array( 404, array( 'private, no-store' ), array( 'Accept' ) ) );
eq( 'negotiate() is anonymous too', fetch( "$url/locked-post/", headers: array( 'Accept: text/markdown', 'X-Test-Engine: 1', $pass_cookie, $cookie ) )['body'], $protected['body'] );
wp_set_current_user( 1 );
$slashed = $insert(
	array(
		'post_title'   => 'Back\\\\slash term',
		'post_name'    => 'backslash',
		'post_content' => 'Has back\\\\slash.',
	)
);
wp_set_current_user( 0 );
eq( 'negotiate() keeps backslashes in query values', fetch( "$url/?s=back%5Cslash", headers: array( 'Accept: text/markdown', 'X-Test-Engine: 1' ) )['body'], fetch( "$url/index.md?s=back%5Cslash" )['body'] );
check( '…and finds the post', str_contains( fetch( "$url/index.md?s=back%5Cslash" )['body'], '/backslash.md' ), fetch( "$url/index.md?s=back%5Cslash" )['body'] );
// Servers that set PATH_INFO (index.php/…-style front controllers) are rewritten the same way.
$reflection           = new ReflectionMethod( MarkdownTwins::class, 'rewrite' );
$_SERVER['PATH_INFO'] = '/index.md';
$reflection->invoke( null, '/' );
$root_info            = $_SERVER['PATH_INFO'];
$_SERVER['PATH_INFO'] = '/hello-world.md';
$reflection->invoke( null, '/hello-world' );
eq( 'PATH_INFO follows REQUEST_URI, /index.md included', array( $root_info, $_SERVER['PATH_INFO'] ), array( '/', '/hello-world' ) );
unset( $_SERVER['PATH_INFO'] );
eq( 'the next browser request still gets HTML', str_starts_with( fetch( "$url/hello-world/" )['headers']['content-type'][0] ?? '', 'text/html' ), true );

// ================================================================ purges: sp_purge_urls after a committed write

$announced = array();
$listen    = static function ( array $paths ) use ( &$announced ): void {
	$announced[] = $paths;
};
$writes    = static function ( callable $write ) use ( &$announced ): array {
	$announced = array();
	$write();
	\SpacePress\Wp\Purges::flush();

	return $announced;
};
wp_set_current_user( 1 );
eq(
	'no listener (off Spacefast): a write announces nothing',
	$writes(
		static fn () => wp_update_post(
			array(
				'ID'           => $hello,
				'post_excerpt' => 'Still short.',
			)
		)
	),
	array()
);
add_action( 'sp_purge_urls', $listen );
$edit = $writes(
	static fn () => wp_update_post(
		array(
			'ID'        => $hello,
			'post_name' => 'hello-again',
		)
	)
);
eq( 'one write, one announcement', count( $edit ), 1 );
$paths = $edit[0] ?? array();
foreach ( array(
	'/hello-world/',
	'/hello-world.md',
	'/hello-again/',
	'/hello-again.md',
	'/',
	'/index.md',
	'/page/2/',
	'/page/2.md',
	'/category/field-notes/',
	'/category/field-notes.md',
	'/author/admin/',
	'/author/admin.md',
	'/feed/',
	'/llms.txt',
	// The feeds VIP Cache Manager purges too: comments, the post's own comments, its terms'.
	'/comments/feed/',
	'/hello-world/feed/',
	'/hello-again/feed/',
	'/category/field-notes/feed/',
) as $path ) {
	check( "a slug change purges $path", in_array( $path, $paths, true ), $paths );
}
check( 'feeds and llms.txt get no .md twin, and feeds no page 2', array_filter( $paths, static fn ( string $p ): bool => (bool) preg_match( '#/feed(/page/2/?|\.md)|llms\.txt\.md#', $p ) ) === array(), $paths );
eq( 'every path is root-relative and listed once', array( count( $paths ), count( array_unique( $paths ) ), array_filter( $paths, static fn ( string $p ): bool => ! str_starts_with( $p, '/' ) ) ), array( count( $paths ), count( $paths ), array() ) );
$cat   = wp_insert_term( 'Elsewhere', 'category' );
$moved = $writes( static fn () => wp_set_post_categories( $hello, array( $cat['term_id'] ) ) )[0] ?? array();
foreach ( array( '/category/field-notes/', '/category/field-notes/page/2/', '/category/field-notes/page/2.md', '/category/elsewhere.md', '/category/elsewhere/page/2/' ) as $path ) {
	check( "moving a post between terms purges $path", in_array( $path, $moved, true ), $moved );
}
$tag = wp_insert_term( 'Loose', 'post_tag' );
$writes( static fn () => wp_set_post_tags( $hello, array( 'Loose' ), true ) ); // its own announcement, not the one measured
$removed = $writes( static fn () => wp_remove_object_terms( $hello, array( $tag['term_id'] ), 'post_tag' ) )[0] ?? array();
foreach ( array( '/tag/loose/', '/tag/loose.md', '/tag/loose/page/2/', '/tag/loose/page/2.md', '/hello-again/' ) as $path ) {
	check( "removing a term from a post (wp_remove_object_terms) purges $path", in_array( $path, $removed, true ), $removed );
}
$trashed = $writes( static fn () => wp_trash_post( $second_post ) )[0] ?? array();
check( 'trashing a published post purges where it was', in_array( '/second-post/', $trashed, true ) && in_array( '/index.md', $trashed, true ), $trashed );
eq(
	'a draft that stays a draft purges nothing',
	$writes(
		static fn () => wp_update_post(
			array(
				'ID'           => $draft,
				'post_content' => 'Still a draft.',
			)
		)
	),
	array()
);
eq(
	'a SpacePress collection row (not public) purges nothing',
	$writes(
		static fn () => wp_update_post(
			array(
				'ID'           => $note,
				'post_content' => 'New note.',
			)
		)
	),
	array()
);
$term_edit = $writes( static fn () => wp_update_term( $category['term_id'], 'category', array( 'description' => 'New description.' ) ) )[0] ?? array();
foreach ( array( '/category/field-notes/', '/category/field-notes.md', '/category/field-notes/page/2/', '/category/field-notes/page/2.md' ) as $path ) {
	check( "editing a term purges $path", in_array( $path, $term_edit, true ), $term_edit );
}
$renamed = $writes( static fn () => wp_update_term( $category['term_id'], 'category', array( 'slug' => 'field-log' ) ) )[0] ?? array();
foreach ( array( '/category/field-notes/', '/category/field-notes/page/2.md', '/category/field-log/', '/category/field-log/page/2/' ) as $path ) {
	check( "renaming a term's slug purges $path", in_array( $path, $renamed, true ), $renamed );
}
$gone = $writes( static fn () => wp_delete_term( $cat['term_id'], 'category' ) )[0] ?? array();
check( 'deleting a term purges its archive pages', in_array( '/category/elsewhere/', $gone, true ) && in_array( '/category/elsewhere/page/2/', $gone, true ), $gone );
$connection = $site->connection();
$inside     = null;
$committed  = $writes(
	static function () use ( $connection, $about, &$announced, &$inside ): void {
		$connection->transaction(
			static function () use ( $about, &$announced, &$inside ): void {
				wp_update_post(
					array(
						'ID'           => $about,
						'post_content' => 'About, edited.',
					)
				);
				wp_update_post(
					array(
						'ID'         => $about,
						'post_title' => 'About us',
					)
				);
				$inside = $announced;
			}
		);
	}
);
eq( 'inside a transaction nothing is announced; after its commit, one announcement for every write', array( $inside, count( $committed ), in_array( '/about.md', $committed[0] ?? array(), true ) ), array( array(), 1, true ) );
$rolled = $writes(
	static function () use ( $connection, $about ): void {
		try {
			$connection->transaction(
				static function () use ( $about ): void {
					wp_update_post(
						array(
							'ID'           => $about,
							'post_content' => 'Never saved.',
						)
					);
					throw new RuntimeException( 'roll back' );
				}
			);
		} catch ( RuntimeException ) {
		}
	}
);
eq( 'a rolled-back write announces nothing', $rolled, array() );
remove_action( 'sp_purge_urls', $listen );
wp_set_current_user( 0 );

// ================================================================ WordPress without a SpacePress app is unchanged

deactivate_plugins( 'spacepress-app-notes/spacepress-app-notes.php', true );
$plain = fetch( "$url/hello-world/" );
eq( 'without the app: no twin link, no content signal', array( $plain['headers']['link'] ?? array(), $plain['headers']['content-signal'] ?? array() ), array( array(), array() ) );
eq( 'without the app: /llms.txt and twins are WordPress 404s', array( fetch( "$url/llms.txt" )['status'], fetch( "$url/hello-world.md" )['status'] ), array( 404, 404 ) );
check( 'without the app: robots.txt has no content signal', ! str_contains( fetch( "$url/robots.txt" )['body'], 'Content-Signal' ) );

finish( 'markdown' );
