<?php
/**
 * Plugin Name: SpacePress Portfolio frontend
 * Description: Public editorial portfolio for the SpacePress portfolio example. WordPress and SpacePress own all content.
 * License: MIT
 */

declare(strict_types=1);

namespace SpacePressPortfolio;

const TAGS = array(
	'identity'      => 'Identity',
	'editorial'     => 'Editorial',
	'packaging'     => 'Packaging',
	'digital'       => 'Digital',
	'spatial'       => 'Spatial',
	'art-direction' => 'Art direction',
);

function database(): \SpacePress\Db {
	$plugin = \SpacePress\Wp\Plugin::instance();
	if ( null === $plugin || $plugin->schema->name() !== 'portfolio' ) {
		throw new \RuntimeException( 'Activate the generated SpacePress portfolio plugin first.' );
	}
	return $plugin->db();
}

function rows( string $collection, array $options = array() ): array {
	return database()->findMany( $collection, $options, new \SpacePress\Viewer( null ) );
}

function projects( array $where = array(), int $limit = 12, int $offset = 0 ): array {
	return rows(
		'projects',
		array(
			'where'   => array( 'AND' => array( array( 'status' => 'published' ), $where ) ),
			'orderBy' => array(
				'publishedAt' => 'desc',
				'id'          => 'desc',
			),
			'limit'   => $limit,
			'offset'  => $offset,
		)
	);
}

function selected(): array {
	$featured = projects( array( 'featured' => true ) );
	return array() !== $featured ? $featured : projects( array(), 6 );
}

function href( string $path ): string {
	return home_url( $path ); }
function e( mixed $text ): string {
	return esc_html( (string) ( $text ?? '' ) ); }
function link( string $path ): string {
	return esc_url( href( $path ) ); }
function external( mixed $value ): string {
	return is_string( $value ) && preg_match( '~^https?://~i', $value ) ? esc_url( $value, array( 'http', 'https' ) ) : '';
}

function socials( array $social ): array {
	$links = array();
	foreach ( array(
		'twitter'   => array( 'X (Twitter)', 'https://x.com/' ),
		'github'    => array( 'GitHub', 'https://github.com/' ),
		'facebook'  => array( 'Facebook', 'https://www.facebook.com/' ),
		'instagram' => array( 'Instagram', 'https://www.instagram.com/' ),
		'linkedin'  => array( 'LinkedIn', 'https://www.linkedin.com/in/' ),
		'youtube'   => array( 'YouTube', 'https://www.youtube.com/' ),
	) as $key => [$label, $prefix] ) {
		$raw = trim( $social[ $key ] ?? '' );
		if ( '' === $raw ) {
			continue;
		}
		if ( preg_match( '~^https?://~i', $raw ) ) {
			$url = external( $raw );
		} else {
			$handle = ltrim( $raw, '@' );
			if ( '' === $handle ) {
				continue;
			}
			if ( 'youtube' === $key ) {
				$prefix .= ! str_starts_with( $raw, '@' ) && preg_match( '/^UC[\w-]{22}$/', $handle ) ? 'channel/' : '@';
			}
			$url = $prefix . rawurlencode( $handle );
		}
		$links[] = array(
			'label' => $label,
			'href'  => $url,
		);
	}
	return $links;
}

function image( mixed $id, string $size = 'large', string $class = '' ): string {
	return is_numeric( $id ) && (int) $id > 0 ? wp_get_attachment_image(
		(int) $id,
		$size,
		false,
		array(
			'class'   => $class,
			'loading' => 'lazy',
		)
	) : '';
}

function cards( array $items ): void {
	echo '<div class="project-grid" data-selected-work>';
	foreach ( $items as $p ) {
		echo '<article class="card" data-project="' . esc_attr( $p['slug'] ) . '"><a href="' . link( '/work/' . rawurlencode( $p['slug'] ) ) . '"><div class="plate">' . image( $p['cover'] ) . '</div><div class="card-meta"><h3>' . e( $p['title'] ) . '</h3><span>' . e( $p['year'] ) . '</span></div></a><p class="muted">' . e( $p['client'] ) . '</p></article>';
	}
	echo '</div>';
	if ( array() === $items ) {
		echo '<p>No projects yet.</p>';
	}
}

function socialList( array $settings ): void {
	echo '<ul class="links" aria-label="Social profiles">';
	foreach ( socials( $settings['social'] ?? array() ) as $s ) {
		echo '<li><a href="' . esc_url( $s['href'] ) . '">' . e( $s['label'] ) . '</a></li>';
	}
	echo '</ul>';
}

function layout( array $blocks, array $settings ): void {
	foreach ( $blocks as $i => $b ) {
		$h = 0 === $i && in_array( $b['layout'], array( 'statement', 'contact' ), true ) ? 'h1' : 'h2';
		echo '<section class="block block-' . esc_attr( $b['layout'] ) . '">';
		switch ( $b['layout'] ) {
			case 'statement':
				echo '<p class="label">' . e( $b['label'] ) . '</p><' . $h . ' class="statement">' . nl2br( e( $b['text'] ) ) . '</' . $h . '>';
				break;
			case 'selectedWork':
				echo '<div class="section-head"><h2>' . e( $b['heading'] ) . '</h2><a href="' . link( '/work' ) . '">All work ↗</a></div>';
				cards( selected() );
				break;
			case 'clients':
				echo '<h2 class="label">' . e( $b['heading'] ) . '</h2><ul class="clients">';
				foreach ( $b['clients'] ?? array() as $client ) {
					echo '<li>' . e( $client['name'] ) . '</li>';
				}
				echo '</ul>';
				break;
			case 'contact':
				echo '<p class="label">' . e( $b['label'] ) . '</p><' . $h . ' class="statement">' . e( $b['heading'] ) . '</' . $h . '><p class="lead">' . e( $b['intro'] ) . '</p><p class="email"><a href="mailto:' . esc_attr( sanitize_email( $b['email'] ) ) . '">' . e( $b['email'] ) . '</a></p><dl><div><dt>' . e( $b['emailLabel'] ?? 'Email' ) . '</dt><dd>' . e( $b['email'] ) . '</dd></div>';
				foreach ( $b['details'] ?? array() as $detail ) {
					echo '<div><dt>' . e( $detail['label'] ) . '</dt><dd>' . e( $detail['text'] ) . '<small>' . e( $detail['note'] ) . '</small></dd></div>';
				}
				echo '</dl>';
				socialList( $settings );
		}
		echo '</section>';
	}
}

function pageBody( ?array $page, array $settings, bool $home = false ): void {
	$blocks = $page['layout'] ?? array();
	if ( $home && array() === $blocks ) {
		$items = selected();
		$years = array_filter( array_column( $items, 'year' ) );
		sort( $years );
		$range   = $years ? ( reset( $years ) === end( $years ) ? reset( $years ) : reset( $years ) . '–' . end( $years ) ) : '';
		$blocks  = array(
			array(
				'layout' => 'statement',
				'text'   => $settings['tagline'] ?: $settings['title'],
				'label'  => $range ? 'Selected work ' . $range : '',
			),
			array(
				'layout'  => 'selectedWork',
				'heading' => 'Selected work',
			),
		);
		$clients = array_values( array_unique( array_filter( array_column( $items, 'client' ) ) ) );
		if ( count( $clients ) >= 2 ) {
			$blocks[] = array(
				'layout'  => 'clients',
				'heading' => 'Clients',
				'clients' => array_map( static fn ( $name ) => array( 'name' => $name ), $clients ),
			);
		}
	}
	$blocks_first = isset( $blocks[0] ) && in_array( $blocks[0]['layout'], array( 'statement', 'contact' ), true );
	if ( ! $blocks_first ) {
		echo '<h1' . ( $home ? ' class="sr-only"' : '' ) . '>' . e( $home ? $settings['title'] : $page['title'] ) . '</h1>';
	}
	if ( $blocks_first ) {
		layout( $blocks, $settings );
	}
	if ( ! empty( $page['body'] ) ) {
		echo '<div class="prose">' . do_blocks( wp_kses_post( $page['body'] ) ) . '</div>';
	} elseif ( ! $home && array() === $blocks ) {
		echo '<p>Content coming soon.</p>';
	}
	if ( ! $blocks_first ) {
		layout( $blocks, $settings );
	}
}

function work(): int {
	$tag    = isset( $_GET['tag'] ) && is_string( $_GET['tag'] ) ? wp_unslash( $_GET['tag'] ) : '';
	$offset = isset( $_GET['offset'] ) ? filter_var(
		$_GET['offset'],
		FILTER_VALIDATE_INT,
		array(
			'options' => array(
				'min_range' => 0,
				'max_range' => 99999,
			),
		)
	) : 0;
	if ( ( '' !== $tag && ! isset( TAGS[ $tag ] ) ) || false === $offset || isset( $_GET['cursor'] ) ) {
		return 404;
	}
	$items = projects( '' === $tag ? array() : array( 'tags' => array( 'has' => $tag ) ), 13, $offset );
	$more  = count( $items ) > 12;
	$items = array_slice( $items, 0, 12 );
	echo '<h1>Work</h1><p class="lead">An index of every project, newest first.</p><nav class="filters" aria-label="Filter by discipline">';
	foreach ( array( '' => 'All' ) + TAGS as $slug => $label ) {
		echo '<a href="' . link( '/work' . ( $slug ? '?tag=' . rawurlencode( $slug ) : '' ) ) . '"' . ( $tag === $slug ? ' aria-current="page"' : '' ) . '>' . e( $label ) . '</a>';
	}
	echo '</nav><ol class="work-list" start="' . ( $offset + 1 ) . '">';
	foreach ( $items as $p ) {
		echo '<li data-project="' . esc_attr( $p['slug'] ) . '"><a class="work-row" href="' . link( '/work/' . rawurlencode( $p['slug'] ) ) . '"><span class="thumb">' . image( $p['cover'], 'medium' ) . '</span><h2>' . e( $p['title'] ) . '</h2><span>' . e( $p['client'] ) . '</span><span>' . e( implode( ', ', array_map( static fn ( $t ) => TAGS[ $t ] ?? $t, $p['tags'] ) ) ) . '</span><span>' . e( $p['year'] ) . '</span></a></li>';
	}
	echo '</ol>';
	if ( array() === $items ) {
		echo '<h2>' . ( $tag ? 'No ' . e( TAGS[ $tag ] ) . ' projects yet' : 'No projects yet' ) . '</h2><a href="' . link( '/work' ) . '">View all projects</a>';
	}
	if ( $more ) {
		echo '<a class="more" rel="next" href="' . link( '/work?' . http_build_query( array( 'offset' => $offset + 12 ) + ( $tag ? array( 'tag' => $tag ) : array() ) ) ) . '">More projects →</a>';
	}
	return 200;
}

function caseStudy( array $p ): void {
	echo '<article data-case-study="' . esc_attr( $p['slug'] ) . '"><a class="label" href="' . link( '/work' ) . '">← Index</a><h1>' . e( $p['title'] ) . '</h1><div class="case-intro"><p class="lead">' . e( $p['summary'] ) . '</p><dl><div><dt>Client</dt><dd>' . e( $p['client'] ) . '</dd></div><div><dt>Year</dt><dd>' . e( $p['year'] ) . '</dd></div><div><dt>Disciplines</dt><dd>';
	foreach ( $p['tags'] as $tag ) {
		echo '<a href="' . link( '/work?tag=' . rawurlencode( $tag ) ) . '">' . e( TAGS[ $tag ] ?? $tag ) . '</a> ';
	}
	echo '</dd></div>';
	if ( $url = external( $p['website'] ) ) {
		echo '<div><dt>Website</dt><dd><a target="_blank" rel="noopener noreferrer" href="' . $url . '">' . e( wp_parse_url( $url, PHP_URL_HOST ) ) . ' ↗<span class="sr-only"> (opens in a new tab)</span></a></dd></div>';
	}
	echo '</dl></div><div class="cover">' . image( $p['cover'], 'full' ) . '</div><div class="prose">' . do_blocks( wp_kses_post( $p['body'] ?? '' ) ) . '</div><div class="gallery">';
	$figures = array_values( array_filter( $p['gallery'] ?? array(), static fn ( $g ) => ! empty( $g['image'] ) ) );
	foreach ( $figures as $i => $g ) {
		$half = 2 === $i % 3 || ( 1 === $i % 3 && $i < count( $figures ) - 1 );
		echo '<figure class="' . ( $half ? 'half' : 'full' ) . '">' . image( $g['image'], 'full' ) . '<figcaption><span class="label">' . str_pad( (string) ( $i + 1 ), 2, '0', STR_PAD_LEFT ) . '</span> ' . e( $g['caption'] ) . '</figcaption></figure>';
	}
	echo '</div>';
	$older = empty( $p['publishedAt'] ) ? projects( array(), 1 ) : projects( array( 'OR' => array( array( 'publishedAt' => array( 'lt' => $p['publishedAt'] ) ), array( 'AND' => array( array( 'publishedAt' => $p['publishedAt'] ), array( 'id' => array( 'lt' => $p['id'] ) ) ) ) ) ), 1 );
	if ( $older ) {
		echo '<nav class="next-project"><span class="label">Next project</span><a rel="next" href="' . link( '/work/' . rawurlencode( $older[0]['slug'] ) ) . '">' . e( $older[0]['title'] ) . ' →</a></nav>';
	}
	echo '</article>';
}

function rss( array $settings ): void {
	header( 'Content-Type: application/rss+xml; charset=utf-8' );
	header( 'Cache-Control: public, max-age=0, must-revalidate' );
	$x = static fn ( $value ) => htmlspecialchars( (string) $value, ENT_QUOTES | ENT_XML1, 'UTF-8' );
	echo '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>' . $x( $settings['title'] ) . '</title><description>' . $x( $settings['tagline'] ?: $settings['title'] ) . '</description><link>' . $x( href( '/' ) ) . '</link><atom:link href="' . $x( href( '/rss.xml' ) ) . '" rel="self" type="application/rss+xml"/><language>en-us</language><lastBuildDate>' . gmdate( DATE_RSS ) . '</lastBuildDate>';
	foreach ( projects( array(), 20 ) as $p ) {
		if ( empty( $p['publishedAt'] ) ) {
			continue;
		}
		$url = href( '/work/' . rawurlencode( $p['slug'] ) );
		echo '<item><title>' . $x( $p['title'] ) . '</title><link>' . $x( $url ) . '</link><guid isPermaLink="true">' . $x( $url ) . '</guid><pubDate>' . gmdate( DATE_RSS, strtotime( $p['publishedAt'] ) ) . '</pubDate><description>' . $x( $p['summary'] ) . '</description></item>';
	}
	echo '</channel></rss>';
}

add_filter(
	'post_type_link',
	static function ( string $url, \WP_Post $post ): string {
		if ( 'sp_projects' === $post->post_type ) {
			return href( '/work/' . $post->post_name );
		}
		if ( 'sp_pages' === $post->post_type ) {
			return href( 'home' === $post->post_name ? '/' : '/' . $post->post_name );
		}
		return $url;
	},
	10,
	2
);

add_action(
	'template_redirect',
	function (): void {
		if ( is_admin() || wp_doing_ajax() || ( defined( 'REST_REQUEST' ) && REST_REQUEST ) ) {
			return;
		}
		$path   = rawurldecode( (string) wp_parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH ) );
		$prefix = rtrim( (string) wp_parse_url( home_url( '/' ), PHP_URL_PATH ), '/' );
		$path   = '/' . trim( substr( $path, strlen( $prefix ) ), '/' );
		if ( '/home' === $path ) {
			wp_safe_redirect( href( '/' ) . ( ! empty( $_SERVER['QUERY_STRING'] ) ? '?' . $_SERVER['QUERY_STRING'] : '' ), 301 );
			exit; }
		if ( ! class_exists( \SpacePress\Wp\Plugin::class ) ) {
			return;
		}
		$buffer = false;
		try {
			$settings = database()->globalGet( 'settings', new \SpacePress\Viewer( null ) );
			if ( '/rss.xml' === $path ) {
				status_header( 200 );
				rss( $settings );
				exit; }
			$p          = null;
			$preview    = null;
			$preview_id = ( $_GET['preview'] ?? '' ) === 'true' && isset( $_GET['p'] ) ? absint( $_GET['p'] ) : 0;
			if ( $preview_id > 0 && current_user_can( 'edit_post', $preview_id ) ) {
				$type = get_post_type( $preview_id );
				if ( in_array( $type, array( 'sp_projects', 'sp_pages' ), true ) ) {
					$preview = database()->findFirst( 'sp_projects' === $type ? 'projects' : 'pages', array( 'where' => array( 'id' => $preview_id ) ), new \SpacePress\Viewer( \SpacePress\Wp\WpAuth::current() ) );
					if ( null !== $preview ) {
						$path = 'sp_projects' === $type ? '/work/' . $preview['slug'] : ( 'home' === $preview['slug'] ? '/' : '/' . $preview['slug'] );
					}
				}
			}
			if ( preg_match( '~^/work/([^/]+)$~', $path, $m ) ) {
				$p = projects( array( 'slug' => $m[1] ), 1 )[0] ?? null;
			}
			$page = ! str_starts_with( $path, '/work' ) ? ( rows(
				'pages',
				array(
					'where' => array( 'slug' => '/' === $path ? 'home' : ltrim( $path, '/' ) ),
					'limit' => 1,
				)
			)[0] ?? null ) : null;
			if ( null !== $preview ) {
				if ( get_post_type( $preview_id ) === 'sp_projects' ) {
					$p = $preview;
				} else {
					$page = $preview;
				}
			}
			if ( '/' !== $path && '/work' !== $path && null === $p && null === $page && ! str_starts_with( $path, '/work/' ) ) {
				return;
			}
			$status = str_starts_with( $path, '/work/' ) && null === $p ? 404 : 200;
			ob_start();
			$buffer = true;
			if ( null !== $preview ) {
				echo '<p class="preview-notice">Preview — only editors can see unpublished content.</p>';
			}
			if ( 404 === $status ) {
				echo '<h1>Page not found</h1><a href="' . link( '/work' ) . '">Back to work</a>';
			} elseif ( '/work' === $path ) {
				$status = work();
				if ( 404 === $status ) {
					echo '<h1>Page not found</h1><a href="' . link( '/work' ) . '">Back to work</a>';
				}
			} elseif ( null !== $p ) {
				caseStudy( $p );
			} else {
				pageBody( $page, $settings, '/' === $path );
			}
			$body   = ob_get_clean();
			$buffer = false;
			status_header( $status );
			header( 'Content-Type: text/html; charset=utf-8' );
			nocache_headers();
			$entry = $p ?? $page;
			$title = $entry['seo']['title'] ?? ( '/work' === $path ? 'Work' : ( $entry['title'] ?? $settings['title'] ) );
			if ( '/' === $path ) {
				$title = $entry['seo']['title'] ?? $settings['title'];
			}
			if ( 404 === $status ) {
				$title = 'Page not found';
			}
			$full_title  = $title === $settings['title'] ? $title : $title . ' ' . ( $settings['separator'] ?: '—' ) . ' ' . $settings['title'];
			$description = $entry['seo']['description'] ?? ( $p['summary'] ?? $settings['tagline'] );
			$cover       = $p ? wp_get_attachment_url( (int) $p['cover'] ) : false;
			$asset       = plugin_dir_url( __FILE__ );
			$theme       = in_array( $_COOKIE['theme'] ?? '', array( 'light', 'dark' ), true ) ? $_COOKIE['theme'] : '';
			?><!doctype html>
<html lang="en" class="<?php echo esc_attr( $theme ); ?>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title><?php echo e( $full_title ); ?></title>
  <meta name="description" content="<?php echo esc_attr( $description ?? '' ); ?>">
  <link rel="canonical" href="<?php echo link( $path ); ?>">
  <meta property="og:title" content="<?php echo esc_attr( $full_title ); ?>">
  <meta property="og:description" content="<?php echo esc_attr( $description ?? '' ); ?>">
  <meta property="og:type" content="<?php echo $p ? 'article' : 'website'; ?>">
  <meta property="og:url" content="<?php echo link( $path ); ?>"><?php if ( $cover ) : ?>
  <meta property="og:image" content="<?php echo esc_url( $cover ); ?>">
<?php endif; if ( null !== $preview || ! empty( $entry['seo']['noindex'] ) ) : ?>
  <meta name="robots" content="noindex,follow">
<?php endif; ?>
  <link rel="alternate" type="application/rss+xml" title="<?php echo esc_attr( $settings['title'] ); ?>" href="<?php echo link( '/rss.xml' ); ?>">
  <link rel="stylesheet" href="<?php echo esc_url( $asset . 'style.css' ); ?>">
  <script defer src="<?php echo esc_url( $asset . 'theme.js' ); ?>"></script>
</head>
<body><a class="skip" href="#main">Skip to content</a>
<header class="frame site-header"><a class="brand" href="<?php echo link( '/' ); ?>"><?php echo ! empty( $settings['logo'] ) ? image( $settings['logo'], 'medium' ) : e( $settings['title'] ); ?></a>
    <nav aria-label="Main navigation">
<?php
			foreach ( $settings['navigation'] ?? array() as $nav ) :
				?>
<a href="<?php echo esc_url( $nav['href'] ); ?>"><?php echo e( $nav['label'] ); ?></a>
<?php endforeach; ?>
</nav>
</header>
  <main id="main" class="frame" tabindex="-1"><?php echo $body; ?></main>
  <footer class="frame">
    <div class="footer-cta"><h2>Have a project in mind?</h2>
<?php
			foreach ( $settings['footer'] ?? array() as $nav ) :
				?>
<a href="<?php echo esc_url( $nav['href'] ); ?>"><?php echo e( $nav['label'] ); ?> ↗</a>
<?php endforeach; ?>
</div>
    <div class="footer-grid"><p><?php echo e( $settings['tagline'] ); ?></p><?php socialList( $settings ); ?><div><p class="label">Appearance</p><div class="themes" aria-label="Appearance">
<?php
			foreach ( array( 'light', 'dark', 'system' ) as $choice ) :
				?>
<button type="button" data-theme="<?php echo $choice; ?>" aria-pressed="<?php echo ( $theme ? $theme : 'system' ) === $choice ? 'true' : 'false'; ?>"><?php echo ucfirst( $choice ); ?></button>
<?php endforeach; ?>
</div></div></div>
    <p class="wordmark" aria-hidden="true"><?php echo e( $settings['title'] ); ?></p>
    <div class="footer-bottom"><p>© <?php echo gmdate( 'Y' ); ?> <?php echo e( $settings['title'] ); ?></p><a href="<?php echo esc_url( admin_url() ); ?>">Edit in WordPress</a><a href="<?php echo link( '/rss.xml' ); ?>">RSS</a></div>
  </footer>
</body>
</html><?php
			exit;
		} catch ( \Throwable $error ) {
			if ( $buffer ) {
				ob_end_clean();
			}
			error_log( 'SpacePress Portfolio: ' . $error->getMessage() );
			status_header( 503 );
			header( 'Retry-After: 5' );
			echo 'The portfolio could not be loaded. Please try again.';
			exit;
		}
	},
	1
);
