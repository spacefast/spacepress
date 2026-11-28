<?php

declare(strict_types=1);

namespace SpacePress\Wp;

/**
 * The URLs a committed content write changed, announced on the host's `sp_purge_urls` action
 * (docs/runtime-contract.md). Only a host that serves cached pages listens, or the runtime itself
 * where Batcache, the VIP edge cache or Jetpack Boost runs (PageCaches); with no listener this does
 * no work at all (`has_action`).
 *
 * A write to a public post, page or term names, as root-relative paths with their query:
 * - the item's URL before and after the write (a slug, status or parent change moves or hides it);
 * - the home page, the posts page, and the post type's archive, with their first pages;
 * - the archives of every term the post had or has, and its author's archive;
 * - its feeds (the site's posts and comments feeds, the post's comments feed, each term's feed),
 *   `/llms.txt`, the sitemap index and the sitemap file that lists it, and each page
 *   URL's `.md` twin.
 * Older listing pages (`/page/7/`) fall back to the edge's `s-maxage` window. URLs are collected over
 * the request, with the `sp/app/` pages the page cache's read index names (Render\Cache), and
 * announced once, after the outermost transaction commits (or at the end of the request when there
 * is none): one `sp_purge_urls` call and one `Prebuilt::stale` with the same list. More than
 * PURGE_LIMIT paths become `/*`, a whole-host purge. A rolled-back transaction announces nothing.
 */
final class Purges {

	/** Listing pages purged after page 1. */
	public const LISTING_PAGES = 1;
	/** Above this many paths, one announcement purges the whole host. */
	public const PURGE_LIMIT = 200;

	/** @var array<string, true> paths this request's writes changed */
	private static array $paths = array();
	/** @var array<int, list<string>> post id → its URLs before this write */
	private static array $before = array();
	/** @var array<int, true> saves EditorSave::end collected; their wp_after_insert_post callback skips */
	private static array $collected = array();
	private static bool $scheduled  = false;
	/** A write this request changed every page: the announcement is `/*`. */
	private static bool $everything = false;

	/** Post types whose writes change how every page looks: the Site Editor's. */
	public const DESIGN_TYPES = array( 'wp_template', 'wp_template_part', 'wp_global_styles', 'wp_navigation', 'nav_menu_item' );

	public static function register( Plugin $plugin ): void {
		// A save, trash or delete of a template, part, Global Styles or navigation menu changes
		// every page: prebuilt files go, and the page cache purges the whole host.
		$design = static function ( int $id, mixed $post = null ): void {
			$post = $post instanceof \WP_Post ? $post : get_post( $id );
			// Core creates a default navigation menu lazily while a page renders
			// (WP_Navigation_Fallback): not an owner's edit, and a render or prebuild must not throw
			// away the files it is making.
			if ( ! $post instanceof \WP_Post || 'auto-draft' === $post->post_status || self::front_end() ) {
				return;
			}
			if ( in_array( $post->post_type, self::DESIGN_TYPES, true ) ) {
				self::everything();
			}
		};
		add_action( 'save_post', $design, 10, 2 );
		add_action( 'wp_trash_post', $design, 10, 1 );
		add_action( 'before_delete_post', $design, 10, 2 );
		add_action(
			'pre_post_update',
			static function ( int $id ): void {
				if ( self::listening() ) {
					self::$before[ $id ] = self::post_urls( get_post( $id ) );
				}
			},
			10,
			1
		);
		// A save EditorSave holds open (a wp-admin or core REST save of a SpacePress post) collects its URLs
		// from EditorSave::end, before the commit, so they join the transaction's one announcement;
		// by the time this runs that save is committed and collected. Every other save collects here.
		add_action(
			'wp_after_insert_post',
			static function ( int $id, \WP_Post $post ) use ( $plugin ): void {
				self::saved( $plugin, $id, $post );
			},
			PHP_INT_MAX,
			2
		);
		// Trash, delete and status changes that don't go through wp_insert_post (wp_publish_post, cron).
		add_action(
			'transition_post_status',
			static function ( string $new, string $old, \WP_Post $post ) use ( $plugin ): void { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.newFound -- Preserve the existing PHP parameter name.
				if ( self::listening() && $new !== $old ) {
					self::add( $plugin, self::post_urls( $post, 'publish' === $old || 'publish' === $new ) );
					self::planned_post( $plugin, $post );
				}
			},
			10,
			3
		);
		add_action(
			'before_delete_post',
			static function ( int $id ) use ( $plugin ): void {
				if ( self::listening() ) {
					$post = get_post( $id );
					self::add( $plugin, self::post_urls( $post ) );
					self::planned_post( $plugin, $post );
				}
			},
			10,
			1
		);
		add_action(
			'set_object_terms',
			static function ( int $id, array $terms, array $ttIds, string $taxonomy, bool $append, array $old ) use ( $plugin ): void { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$changed  = array_map( 'intval', $ttIds ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				$previous = array_map( 'intval', $old );
				sort( $changed );
				sort( $previous );
				// Term archives list public posts only: a draft's terms show nowhere.
				if ( self::listening() && $changed !== $previous ) {
					self::changed_post_terms( $plugin, $id, $taxonomy, array( ...$changed, ...$previous ) );
				}
			},
			10,
			6
		);
		// wp_remove_object_terms() fires this, not set_object_terms: the terms the post left.
		add_action(
			'deleted_term_relationships',
			static function ( int $id, array $ttIds, string $taxonomy ) use ( $plugin ): void { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				if ( self::listening() && array() !== $ttIds ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
					self::changed_post_terms( $plugin, $id, $taxonomy, array_map( 'intval', $ttIds ) ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				}
			},
			10,
			3
		);
		// A term edit purges its archive before (edit_terms runs before the update, so a slug change
		// still names the old URL) and after; a delete purges it before the term goes.
		$term = static function ( int $termId, string $taxonomy ) use ( $plugin ): void { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$term = get_term( $termId, $taxonomy ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			if ( self::listening() && $term instanceof \WP_Term ) {
				$planned = self::planned_kind_urls( $plugin, 'taxonomy', $taxonomy );
				self::add( $plugin, array( ...self::listings( self::term_urls( array( $term->term_taxonomy_id ), $taxonomy ) ), ...$planned ) );
			}
		};
		add_action( 'edit_terms', $term, 10, 2 );
		add_action(
			'created_term',
			static function ( int $termId, int $ttId, string $taxonomy ) use ( $plugin ): void { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				if ( self::listening() ) {
					self::add( $plugin, self::planned_kind_urls( $plugin, 'taxonomy', $taxonomy ), false );
				}
			},
			10,
			3
		);
		add_action( 'edited_term', static fn ( int $termId, int $ttId, string $taxonomy ) => $term( $termId, $taxonomy ), 10, 3 ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		add_action( 'pre_delete_term', $term, 10, 2 );
		// The shared document shell uses site settings and menus even on a literal page.
		$shell = static function (): void {
			if ( ! self::front_end() ) {
				self::everything();
			}
		};
		foreach ( array(
			'blogname',
			'blogdescription',
			'blog_public',
			'blog_charset',
			'WPLANG',
			'permalink_structure',
			'home',
			'siteurl',
			'site_icon',
			'wpcom_public_coming_soon',
			'wpcom_coming_soon',
			'theme_mods_' . get_option( 'stylesheet' ),
		) as $option ) {
			foreach ( array( 'add_option_', 'update_option_', 'delete_option_' ) as $hook ) {
				add_action( $hook . $option, $shell, 10, 0 );
			}
		}
		foreach ( array( 'wp_update_nav_menu', 'wp_delete_nav_menu', 'switch_theme' ) as $hook ) {
			add_action( $hook, $shell, 10, 0 );
		}
		// A global's fields are options named `<postId>_<field>` (`sp_global_shop_currency`, SCF's
		// options page layout; a repeater's or group's values are further options below its field's
		// name): `db.globals.<name>.update()`, the API and the options page in wp-admin all save them
		// through update_option(), so the option hooks see every write. The pages that read the
		// global are purged with the write's other URLs.
		$prefixes = array();
		foreach ( $plugin->schema->globals() as $name => $global ) {
			$prefixes[ $global['wp']['postId'] . '_' ] = (string) $name;
		}
		$options = array_fill_keys( $plugin->schema->app()['purgeOptions'] ?? array(), true );
		if ( array() !== $prefixes || array() !== $options ) {
			$busy    = false;
			$changed = static function ( mixed $option ) use ( $plugin, $prefixes, $options, &$busy ): void {
				if ( ! is_string( $option ) || $busy || ! self::listening() ) {
					return;
				}
				// Every global whose prefix the option has: `shop` and `shop_hours` share one, and
				// purging the pages of both is correct for either.
				$names = array();
				foreach ( $prefixes as $prefix => $name ) {
					if ( str_starts_with( $option, $prefix ) ) {
						$names[] = $name;
					}
				}
				$tracked = isset( $options[ $option ] );
				if ( ( ! $tracked && array() === $names ) || $plugin->unavailable() !== null ) {
					return;
				}
				$busy = true;
				try {
					$plugin->app(); // the read index is read through the app's store
					if ( $tracked ) {
						\SpacePress\Render\Cache::optionWritten( $option );
					}
					foreach ( $names as $name ) {
						\SpacePress\Render\Cache::globalWritten( $name );
					}
				} finally {
					$busy = false;
				}
			};
			foreach ( array( 'added_option', 'updated_option', 'deleted_option' ) as $hook ) {
				add_action( $hook, $changed, 10, 1 );
			}
		}
	}

	/**
	 * Root-relative paths for a set of URLs, each with its `.md` twin, deduplicated: what
	 * `sp_purge_urls` receives. Feeds, `/llms.txt` and sitemap files have no twin.
	 *
	 * @param list<string> $urls absolute URLs or root-relative paths
	 * @return list<string>
	 */
	public static function paths( array $urls ): array {
		$paths = array();
		$home  = (string) ( wp_parse_url( home_url( '/' ), PHP_URL_HOST ) ?? '' );
		foreach ( $urls as $url ) {
			$parts = wp_parse_url( $url );
			if ( ! is_array( $parts ) || ( isset( $parts['host'] ) && strcasecmp( $parts['host'], $home ) !== 0 ) ) {
				continue;
			}
			$path           = ( $parts['path'] ?? '/' ) . ( isset( $parts['query'] ) && '' !== $parts['query'] ? '?' . $parts['query'] : '' );
			$paths[ $path ] = true;
			$bare           = (string) ( $parts['path'] ?? '/' );
			if ( ! self::feed( $url ) && ! preg_match( '#/llms\.txt$|\.md$|/wp-sitemap[^/]*\.xml$#', $bare ) ) {
				$twin = MarkdownTwins::twin( $path );
				$paths[ (string) ( wp_parse_url( $twin, PHP_URL_PATH ) ?? $twin ) . ( isset( $parts['query'] ) && '' !== $parts['query'] ? '?' . $parts['query'] : '' ) ] = true;
			}
		}

		return array_keys( $paths );
	}

	/** A host's page cache listens, or prebuilt pages need to know what changed. */
	private static function listening(): bool {
		return has_action( 'sp_purge_urls' ) !== false || \SpacePress\Render\Prebuilt::active();
	}

	/**
	 * A saved post's URLs, before and after the save: collected once per save, announced after its
	 * transaction commits (or at the end of the request when there is none).
	 */
	public static function saved( Plugin $plugin, int $id, \WP_Post $post ): void {
		if ( isset( self::$collected[ $id ] ) ) {
			unset( self::$collected[ $id ] ); // EditorSave::end collected this save before its commit
			return;
		}
		if ( ! self::listening() ) {
			return;
		}
		$before = self::$before[ $id ] ?? array();
		unset( self::$before[ $id ] );
		self::add( $plugin, array( ...$before, ...self::post_urls( $post ) ) );
		self::planned_post( $plugin, $post );
	}

	/** EditorSave::end: the save it holds open collects its URLs now, inside the transaction. */
	public static function collect( int $id ): void {
		$plugin = Plugin::instance();
		$post   = get_post( $id );
		if ( null !== $plugin && $post instanceof \WP_Post ) {
			self::saved( $plugin, $id, $post );
			self::$collected[ $id ] = true;
		}
	}

	/** URLs a write changed that no post hook names (SpacePress's own writes): announced with the rest. */
	public static function announce( array $urls ): void {
		$plugin = Plugin::instance();
		if ( null !== $plugin && self::listening() ) {
			self::add( $plugin, $urls );
		}
	}

	/** A front-end request (a page render or a prerender), not a save an owner made. */
	private static function front_end(): bool {
		return \SpacePress\Render\Prebuilt::prerendering()
			|| ( did_action( 'template_redirect' ) > 0 && ! is_admin() && ! ( defined( 'REST_REQUEST' ) && REST_REQUEST ) );
	}

	/**
	 * A write that changes every page (a Site Editor template, part, Global Styles or navigation
	 * menu): one whole-host purge, `/*`, announced with the request's other writes.
	 */
	public static function everything(): void {
		$plugin = Plugin::instance();
		if ( null === $plugin || ! self::listening() ) {
			return;
		}
		self::$everything = true;
		self::add( $plugin, array( home_url( '/' ) ), false );
	}

	/**
	 * `sp/app/` pages whose recorded reads a write changed (Render\Cache, inside the write's
	 * transaction): announced with the rest. `/llms.txt` lists content, not pages, and isn't added.
	 *
	 * @param list<string> $urls
	 */
	public static function recorded( array $urls ): void {
		$plugin = Plugin::instance();
		if ( null !== $plugin && self::listening() ) {
			self::add( $plugin, $urls, false );
		}
	}

	/** @param list<string> $urls */
	private static function add( Plugin $plugin, array $urls, bool $content = true ): void {
		if ( array() === $urls ) {
			return;
		}
		if ( $content ) {
			$urls[] = home_url( '/llms.txt' );
		}
		foreach ( self::paths( $urls ) as $path ) {
			self::$paths[ $path ] = true;
		}
		if ( self::$scheduled ) {
			return;
		}
		self::$scheduled = true;
		$connection      = $plugin->connection();
		if ( $connection->inTransaction() ) {
			$connection->afterCommit( self::flush( ... ) );
			$connection->onRollback(
				static function (): void {
					self::$paths      = array();
					self::$everything = false;
					self::$scheduled  = false;
				}
			);
		} else {
			// A write outside any transaction (wp-admin, core REST) has committed already; one call
			// per request covers every write it makes.
			add_action( 'shutdown', self::flush( ... ), 0 );
		}
	}

	/** Announce what this request's committed writes changed, once. */
	public static function flush(): void {
		$paths            = array_keys( self::$paths );
		$everything       = self::$everything;
		self::$paths      = array();
		self::$scheduled  = false;
		self::$everything = false;
		if ( array() !== $paths && self::listening() ) {
			$paths = $everything || count( $paths ) > self::PURGE_LIMIT ? array( '/*' ) : $paths;
			\SpacePress\Render\Prebuilt::stale( $paths );
			if ( has_action( 'sp_purge_urls' ) !== false ) {
				do_action( 'sp_purge_urls', $paths );
			}
		}
	}

	/**
	 * A post's public URLs: itself, the listings that show it, its terms' and author's archives,
	 * feeds. Nothing for a post nobody can see now, unless $wasPublic (a post that just left `publish`
	 * still has cached copies).
	 *
	 * @return list<string>
	 */
	private static function post_urls( ?\WP_Post $post, bool $wasPublic = false ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		if ( ! $post instanceof \WP_Post || 'revision' === $post->post_type || wp_is_post_autosave( $post ) ) {
			return array();
		}
		$type = get_post_type_object( $post->post_type );
		// A SpacePress kind with a `url` is publicly queryable without being `public` (it stays out of
		// core's public lists), and its items still have public URLs to purge.
		if ( ! $type instanceof \WP_Post_Type || ! ( $type->public || $type->publicly_queryable ) || ( ! $wasPublic && ! is_post_publicly_viewable( $post ) ) ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			return array();
		}
		$permalink = self::permalink( $post );
		// The site's posts and comments feeds, and the post's own comments feed (VIP Cache Manager's set).
		$urls = array( $permalink, home_url( '/' ), get_feed_link(), get_feed_link( 'comments_' . get_default_feed() ), self::comments_feed( $post, $permalink ) );
		if ( 'post' === $post->post_type ) {
			$page = (int) get_option( 'page_for_posts' );
			if ( $page > 0 ) {
				$urls[] = (string) get_permalink( $page );
			}
			$urls[] = Authors::archiveUrl( (int) $post->post_author );
		}
		$archive = get_post_type_archive_link( $post->post_type );
		if ( is_string( $archive ) ) {
			$urls[] = $archive;
		}
		foreach ( get_object_taxonomies( $post->post_type ) as $taxonomy ) {
			$terms = get_the_terms( $post, $taxonomy );
			if ( is_array( $terms ) ) {
				array_push( $urls, ...self::term_urls( array_map( static fn ( \WP_Term $t ): int => $t->term_taxonomy_id, $terms ), $taxonomy ) );
			}
		}
		$urls = array_values( array_filter( $urls, static fn ( mixed $url ): bool => is_string( $url ) && '' !== $url ) );

		// Other addresses that show this post (a `page.md` route answers with and without a trailing
		// slash), and the sitemap files that list it (core's and SpacePress's), which have no twins.
		return array( ...(array) apply_filters( 'sp_post_purge_urls', array( $urls[0], ...self::listings( array_slice( $urls, 1 ) ) ), $post ), ...Sitemap::filesFor( $post ) );
	}

	private static function planned_post( Plugin $plugin, ?\WP_Post $post ): void {
		if ( $post instanceof \WP_Post && 'revision' !== $post->post_type && ! wp_is_post_autosave( $post ) ) {
			self::add( $plugin, self::planned_kind_urls( $plugin, 'postType', $post->post_type ), false );
		}
	}

	/** @param list<int> $ttIds */
	private static function changed_post_terms( Plugin $plugin, int $id, string $taxonomy, array $ttIds ): void { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$post = get_post( $id );
		$urls = self::post_urls( $post );
		if ( array() !== $urls ) {
			self::add( $plugin, array( ...self::listings( self::term_urls( $ttIds, $taxonomy ) ), ...$urls ) ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		}
		self::planned_post( $plugin, $post );
		self::add( $plugin, self::planned_kind_urls( $plugin, 'taxonomy', $taxonomy ), false );
	}

	/** @return list<string> */
	private static function planned_kind_urls( Plugin $plugin, string $wpField, string $wpName ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$urls = array();
		foreach ( $plugin->schema->kinds() as $name => $spec ) {
			if ( ( $spec['wp'][ $wpField ] ?? null ) === $wpName ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
				array_push( $urls, ...\SpacePress\Render\RoutePlan::urls( $plugin, (string) $name ) );
			}
		}
		return $urls;
	}

	/**
	 * Listing URLs with their next LISTING_PAGES pages (`/category/news/page/2/`); feeds have none.
	 *
	 * @param list<string> $urls
	 * @return list<string>
	 */
	private static function listings( array $urls ): array {
		$out = $urls;
		for ( $page = 2; $page <= 1 + self::LISTING_PAGES; $page++ ) {
			foreach ( $urls as $url ) {
				if ( ! self::feed( $url ) ) {
					$out[] = self::paged( $url, $page );
				}
			}
		}

		return $out;
	}

	/**
	 * Archive and feed URLs of terms in a public taxonomy, by term_taxonomy_id.
	 *
	 * @param list<int> $ttIds
	 * @return list<string>
	 */
	private static function term_urls( array $ttIds, string $taxonomy ): array { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		$object = get_taxonomy( $taxonomy );
		if ( ! $object instanceof \WP_Taxonomy || ! $object->public || ! $object->publicly_queryable ) {
			return array();
		}
		$urls = array();
		foreach ( array_unique( $ttIds ) as $ttId ) { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$term = get_term_by( 'term_taxonomy_id', (int) $ttId, $taxonomy ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
			$link = $term instanceof \WP_Term ? get_term_link( $term ) : null;
			if ( is_string( $link ) ) {
				$urls[] = $link;
				// Plain permalinks would spell it `?feed=rss2&amp;cat=3`, escaped for HTML.
				$feed = get_term_feed_link( $term->term_id, $taxonomy );
				if ( is_string( $feed ) && '' !== $feed ) {
					$urls[] = str_replace( '&amp;', '&', $feed );
				}
			}
		}

		return $urls;
	}

	/**
	 * The URL a post is or was published at. Trashing renames the slug (`hello__trashed`) before any
	 * hook sees the post, and an unpublished post's permalink is its `?p=` form: both are spelled as
	 * the published post was.
	 */
	private static function permalink( \WP_Post $post ): string {
		if ( 'publish' === $post->post_status && ! str_ends_with( $post->post_name, '__trashed' ) ) {
			return (string) get_permalink( $post );
		}
		$published              = clone $post;
		$published->post_status = 'publish';
		$desired                = get_post_meta( $post->ID, '_wp_desired_post_slug', true );
		$published->post_name   = is_string( $desired ) && '' !== $desired ? $desired : (string) preg_replace( '/__trashed(-\d+)?$/', '', $post->post_name );

		return (string) get_permalink( $published );
	}

	/**
	 * A post's comments feed, as get_post_comments_feed_link() spells it, from the URL the post is or
	 * was published at (a moved or trashed post's old one). SpacePress sites always use pretty permalinks
	 * (Hardening::permalinks); a front page's feed hangs off its page URL, not the home page.
	 */
	private static function comments_feed( \WP_Post $post, string $permalink ): string {
		if ( get_option( 'show_on_front' ) === 'page' && (int) get_option( 'page_on_front' ) === $post->ID ) {
			$permalink = _get_page_link( $post->ID );
		}

		return trailingslashit( $permalink ) . user_trailingslashit( 'feed', 'single_feed' );
	}

	/** Whether a URL is a feed (`/feed/`, `/category/x/feed/`, `?feed=rss2`): no page 2, no `.md` twin. */
	private static function feed( string $url ): bool {
		$path = (string) ( wp_parse_url( $url, PHP_URL_PATH ) ?? '' );
		parse_str( (string) ( wp_parse_url( $url, PHP_URL_QUERY ) ?? '' ), $query );

		return isset( $query['feed'] ) || preg_match( '#/(feed|rss2?|atom|rdf)(/[a-z0-9]+)?/?$#', $path ) === 1;
	}

	/** Page $page of a listing URL, as WordPress links it. */
	private static function paged( string $url, int $page ): string {
		global $wp_rewrite;
		if ( $wp_rewrite instanceof \WP_Rewrite && $wp_rewrite->using_permalinks() ) {
			return user_trailingslashit( trailingslashit( $url ) . $wp_rewrite->pagination_base . '/' . $page, 'paged' );
		}

		return add_query_arg( 'paged', $page, $url );
	}
}
