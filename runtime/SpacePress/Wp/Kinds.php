<?php

declare(strict_types=1);

namespace SpacePress\Wp;

/**
 * The facade's kind registry and the mapping between First rows and core shapes (spec §2.1, §3a).
 * Each kind names the core route that serves it; the mapping is data only.
 *
 * App kinds come from the schema:
 * - post kinds (`/wp/v2/<post type>`) and users (`/wp/v2/users`): core runs the route and decides the
 *   request; each item then carries SpacePress's row as this viewer reads it ({@see ROW}), so field masks,
 *   `{}` in json() values and system fields come out exactly as SpacePress's pipeline gives them. Input
 *   maps the other way: title/content/slug to core's fields, `status`/`publishedAt` to core's, the
 *   rest to `meta`;
 * - tables (`/wp/v2/<table>`): already First rows.
 *
 * WordPress kinds every site has (`builtin`): comments, posts, pages, media, categories, tags,
 * menus and settings, mapped to the field names of spec §2.1. A schema entry with `builtin` (an
 * `.extend()`) or an app kind of the same name replaces the plain built-in. Core decides access for
 * the built-ins, as it does for every other client of these routes.
 *
 * Relations `with` attached sit under `with` on core responses and are flattened onto the row.
 */
final class Kinds {

	/**
	 * Where a post-kind or users response carries SpacePress's row for this viewer during the facade's own
	 * dispatches (PostsController, UserMeta::prepare): null when SpacePress's read rule doesn't cover it.
	 */
	public const ROW = '__sp_row';

	/** The built-in kinds a site has without declaring them (spec §2.1), by name. */
	private const BUILTINS = array(
		'comments'   => array( 'type' => 'comments' ),
		'posts'      => array(
			'type'     => 'wp-post',
			'postType' => 'post',
		),
		'pages'      => array(
			'type'     => 'wp-post',
			'postType' => 'page',
		),
		'media'      => array( 'type' => 'media' ),
		'categories' => array(
			'type'     => 'term',
			'taxonomy' => 'category',
		),
		'tags'       => array(
			'type'     => 'term',
			'taxonomy' => 'post_tag',
		),
		'menus'      => array( 'type' => 'menus' ),
	);

	/** @return array<string, array{name: string, type: string, route: string, spec: array, ...}> */
	public static function all( Plugin $plugin ): array {
		$out  = array();
		$auth = $plugin->schema->auth()['collection'] ?? null;
		foreach ( $plugin->schema->collections() as $name => $spec ) {
			$name = (string) $name;
			if ( isset( $spec['commerce'] ) ) {
				$out[ $name ] = array(
					'name'  => $name,
					'type'  => 'table',
					'route' => '/wp/v2/' . $spec['table'],
					'spec'  => $spec,
				);
			} elseif ( $name === $auth || ( $spec['builtin'] ?? null ) === 'users' ) {
				$out[ $name ] = array(
					'name'  => $name,
					'type'  => 'users',
					'route' => '/wp/v2/users',
					'spec'  => $spec,
				);
			} elseif ( ( $spec['editor'] ?? true ) && ( $spec['wp'] ?? null ) !== null ) {
				$out[ $name ] = array(
					'name'  => $name,
					'type'  => 'post',
					'route' => self::post_route( $spec['wp']['postType'] ),
					'spec'  => $spec,
				)
					+ ( ( $spec['drafts'] ?? false ) ? array( 'drafts' => true ) : array() );
			} elseif ( isset( $spec['table'] ) ) {
				$out[ $name ] = array(
					'name'  => $name,
					'type'  => 'table',
					'route' => '/wp/v2/' . $spec['table'],
					'spec'  => $spec,
				);
			}
		}
		// A `taxonomy()` kind: its core term route, answered through SpacePress's pipeline (TermsController).
		foreach ( $plugin->schema->taxonomies() as $name => $spec ) {
			$out[ (string) $name ] = array(
				'name'  => (string) $name,
				'type'  => isset( $spec['commerce'] ) ? 'table' : 'taxonomy',
				'route' => '/wp/v2/' . ( isset( $spec['commerce'] ) ? 'sp_' . $name : $spec['wp']['taxonomy'] ),
				'spec'  => $spec,
			);
		}
		if ( null !== $auth ) {
			$out['users'] ??= $out[ $auth ]; // the spec's name for the users kind
		}
		foreach ( self::BUILTINS as $name => $builtin ) {
			if ( isset( $out[ $name ] ) ) {
				continue; // the app's own kind of that name answers
			}
			$route = match ( $builtin['type'] ) {
				'comments' => '/wp/v2/comments',
				'wp-post' => self::post_route( $builtin['postType'] ),
				'media' => '/wp/v2/media',
				'term' => self::term_route( $builtin['taxonomy'] ),
				'menus' => '/wp/v2/menu-locations',
			};
			if ( null !== $route ) {
				$out[ $name ] = array(
					'name'  => $name,
					'route' => $route,
					'spec'  => array( 'builtin' => $name ),
				) + $builtin;
			}
		}
		$out['users'] ??= array(
			'name'  => 'users',
			'type'  => 'wp-users',
			'route' => '/wp/v2/users',
			'spec'  => array( 'builtin' => 'users' ),
		);

		return $out;
	}

	private static function post_route( string $type ): string {
		$object = get_post_type_object( $type );

		return '/' . ( $object?->rest_namespace ?: 'wp/v2' ) . '/' . ( $object?->rest_base ?: $type ); // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
	}

	private static function term_route( string $taxonomy ): ?string {
		$object = get_taxonomy( $taxonomy );
		if ( ! $object instanceof \WP_Taxonomy || ! $object->show_in_rest ) {
			return null;
		}

		return '/' . ( $object->rest_namespace ?: 'wp/v2' ) . '/' . ( $object->rest_base ?: $taxonomy ); // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
	}

	/** Whether the kind is one SpacePress's own pipeline answers (its rules, `where`, `with`), not core alone. */
	public static function first( array $kind ): bool {
		return in_array( $kind['type'], array( 'post', 'users', 'table', 'taxonomy' ), true );
	}

	/** A core response item as the First row (fields flat, SpacePress's status, relations flattened). */
	public static function row( array $kind, mixed $item ): mixed {
		if ( ! is_array( $item ) ) {
			return $item;
		}
		// Relations attached by SpacePressQuery::attach, an object so that `{}` stays one on core's wire.
		$with = $item['with'] ?? array();
		$with = is_object( $with ) ? get_object_vars( $with ) : ( is_array( $with ) ? $with : array() );
		return match ( $kind['type'] ) {
			'table' => ( static function () use ( $item, $with ): array {
				unset( $item['_links'], $item['with'] );

				return array_replace( $item, $with );
			} )(),
			// SpacePress's row for this viewer, or null: core may list a user SpacePress's read rule hides.
			// `with` wins: a media column loaded with `with` replaces its id with the media row.
			'users', 'post', 'taxonomy' => ( $first = $item[ self::ROW ] ?? null ) === null ? null : array_replace( is_object( $first ) ? get_object_vars( $first ) : (array) $first, $with ), // phpcs:ignore Squiz.PHP.DisallowMultipleAssignments.Found -- Keep the assignment and its test together.
			'wp-post' => self::wp_post_row( $kind, $item ),
			'wp-users' => self::user_row( $item ),
			'comments' => self::comment_row( $item ),
			'media' => self::media_row( $item ),
			'term' => self::term_row( $item ),
			'menus' => $item,
		};
	}

	/** A core post or page (spec §2.1): the collection fields plus the type's own. */
	private static function wp_post_row( array $kind, array $item ): array {
		$row = array(
			'id'          => $item['id'] ?? null,
			'title'       => self::text( $item['title'] ?? null ),
			'content'     => self::text( $item['content'] ?? null ),
			'slug'        => $item['slug'] ?? null,
			'status'      => self::status( (string) ( $item['status'] ?? '' ) ),
			'publishedAt' => self::publishedAt( $item ),
			'url'         => $item['link'] ?? null,
			'author'      => ( $item['author'] ?? 0 ) ?: null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
			'createdAt'   => self::gmt( $item['date_gmt'] ?? null ),
			'updatedAt'   => self::gmt( $item['modified_gmt'] ?? null ),
		);

		return $row + match ( $kind['postType'] ) {
			'post' => array(
				'excerpt'       => self::text( $item['excerpt'] ?? null ),
				'categories'    => $item['categories'] ?? array(),
				'tags'          => $item['tags'] ?? array(),
				'featuredImage' => ( $item['featured_media'] ?? 0 ) ?: null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
				'sticky'        => (bool) ( $item['sticky'] ?? false ),
			),
			'page' => array(
				'parent'   => ( $item['parent'] ?? 0 ) ?: null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
				'order'    => (int) ( $item['menu_order'] ?? 0 ),
				'template' => (string) ( $item['template'] ?? '' ),
			),
			default => array(),
		};
	}

	/** A WordPress user without a SpacePress users kind: what core shows this viewer. */
	private static function user_row( array $item ): array {
		return array_filter(
			array(
				'id'        => $item['id'] ?? null,
				'email'     => $item['email'] ?? null,
				'name'      => $item['name'] ?? null,
				'username'  => $item['username'] ?? null,
				'roles'     => $item['roles'] ?? null,
				'avatar'    => is_array( $item['avatar_urls'] ?? null ) ? ( end( $item['avatar_urls'] ) ?: null ) : null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
				'url'       => ( $item['url'] ?? '' ) ?: null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
				'locale'    => $item['locale'] ?? null,
				'createdAt' => isset( $item['registered_date'] ) ? self::iso( (string) $item['registered_date'] ) : null,
			),
			static fn ( $v, $k ) => null !== $v || in_array( $k, array( 'id', 'name', 'avatar', 'url' ), true ),
			ARRAY_FILTER_USE_BOTH
		);
	}

	private static function comment_row( array $item ): array {
		return array(
			'id'          => $item['id'] ?? null,
			'on'          => ( $item['post'] ?? 0 ) ?: null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
			'parent'      => ( $item['parent'] ?? 0 ) ?: null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
			'author'      => ( $item['author'] ?? 0 ) ?: null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
			'authorName'  => $item['author_name'] ?? null,
			'authorEmail' => ( $item['author_email'] ?? '' ) ?: null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
			'content'     => self::text( $item['content'] ?? null ),
			'status'      => match ( $item['status'] ?? null ) {
				'approved', 'approve', '1' => 'approved',
				'hold', 'unapproved', '0' => 'pending',
				default => $item['status'] ?? null,
			},
			'type'        => $item['type'] ?? 'comment',
			'createdAt'   => self::gmt( $item['date_gmt'] ?? null ),
		);
	}

	/** @var array<int, array> SpacePress's media rows read ahead for the page being shaped ({@see rows()}) */
	private static array $media = array();

	/**
	 * A page of core items as SpacePress's rows. For media, SpacePress's own rows are read in one query for the
	 * whole page, not one per item.
	 *
	 * @param list<array> $items
	 * @return list<mixed>
	 */
	public static function rows( array $kind, array $items ): array {
		if ( 'media' !== $kind['type'] || array() === $items ) {
			return array_map( static fn ( array $item ) => self::row( $kind, $item ), $items );
		}
		$db          = Plugin::instance()?->db();
		self::$media = null === $db ? array() : $db->media()->getMany( array_values( array_filter( array_map( static fn ( array $i ) => (int) ( $i['id'] ?? 0 ), $items ) ) ) );
		try {
			return array_map( static fn ( array $item ) => self::row( $kind, $item ), $items );
		} finally {
			self::$media = array();
		}
	}

	private static function media_row( array $item ): array {
		$details = is_array( $item['media_details'] ?? null ) ? $item['media_details'] : array();
		$sizes   = array();
		foreach ( (array) ( $details['sizes'] ?? array() ) as $name => $size ) {
			if ( is_array( $size ) && isset( $size['source_url'] ) ) {
				$sizes[ (string) $name ] = array(
					'url'    => $size['source_url'],
					'width'  => (int) ( $size['width'] ?? 0 ),
					'height' => (int) ( $size['height'] ?? 0 ),
				);
			}
		}

		// SpacePress's own media row (its named sizes, focal point, file name and size) when SpacePress runs the
		// site; core's fields fill the rest (spec §2.1).
		$first = isset( $item['id'] ) ? ( self::$media[ (int) $item['id'] ] ?? Plugin::instance()?->db()->mediaGet( (int) $item['id'] ) ) : null;

		return ( is_array( $first ) ? $first : array() ) + array(
			'id'        => $item['id'] ?? null,
			'url'       => $item['source_url'] ?? null,
			'alt'       => ( $item['alt_text'] ?? '' ) ?: null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
			'caption'   => self::text( $item['caption'] ?? null ),
			'mime'      => $item['mime_type'] ?? null,
			'width'     => isset( $details['width'] ) ? (int) $details['width'] : null,
			'height'    => isset( $details['height'] ) ? (int) $details['height'] : null,
			'sizes'     => array() === $sizes ? new \stdClass() : $sizes,
			'focal'     => $item['sp_focal'] ?? null,
			'author'    => ( $item['author'] ?? 0 ) ?: null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
			'createdAt' => self::gmt( $item['date_gmt'] ?? null ),
		);
	}

	private static function term_row( array $item ): array {
		return array(
			'id'          => $item['id'] ?? null,
			'name'        => $item['name'] ?? null,
			'slug'        => $item['slug'] ?? null,
			'description' => (string) ( $item['description'] ?? '' ),
			'parent'      => ( $item['parent'] ?? 0 ) ?: null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
			'count'       => (int) ( $item['count'] ?? 0 ),
			'url'         => $item['link'] ?? null,
		);
	}

	/** SpacePress input → core input: core's own fields for title/content/slug/status, `meta` for the rest. */
	public static function input( array $kind, array $data, bool $create = false ): array {
		return match ( $kind['type'] ) {
			'table' => $data,
			'post', 'users' => self::sp_input( $kind, $data, $create ),
			// A term: its name as core's, everything else SpacePress's (TermsController reads `spacepress`).
			'taxonomy' => array_intersect_key( $data, array( 'name' => true ) ) + ( array_diff_key( $data, array( 'name' => true ) ) === array() ? array() : array( 'spacepress' => (object) array_diff_key( $data, array( 'name' => true ) ) ) ),
			'wp-post' => self::rename(
				$data,
				array(
					'content'       => 'content',
					'title'         => 'title',
					'slug'          => 'slug',
					'excerpt'       => 'excerpt',
					'categories'    => 'categories',
					'tags'          => 'tags',
					'featuredImage' => 'featured_media',
					'sticky'        => 'sticky',
					'parent'        => 'parent',
					'order'         => 'menu_order',
					'template'      => 'template',
					'author'        => 'author',
				), self::status_input( $data, $create )
			),
			'comments' => self::rename(
				$data,
				array(
					'on'          => 'post',
					'parent'      => 'parent',
					'content'     => 'content',
					'authorName'  => 'author_name',
					'authorEmail' => 'author_email',
					'type'        => 'type',
				), isset( $data['status'] )
					? array(
						'status' => array(
							'approved' => 'approved',
							'pending'  => 'hold',
						)[ $data['status'] ] ?? $data['status'],
					) : array()
			),
			'media' => self::rename(
				$data,
				array(
					'alt'     => 'alt_text',
					'caption' => 'caption',
					'focal'   => 'sp_focal',
				)
			),
			'term' => self::rename(
				$data,
				array(
					'name'        => 'name',
					'slug'        => 'slug',
					'description' => 'description',
					'parent'      => 'parent',
				)
			),
			default => throw new \SpacePress\HttpError( 405, 'method_not_allowed', "{$kind['name']} is read-only here" ),
		};
	}

	private static function status_input( array $data, bool $create ): array {
		if ( isset( $data['status'] ) ) {
			return array(
				'status' => array(
					'published' => 'publish',
					'scheduled' => 'future',
				)[ $data['status'] ] ?? $data['status'],
			)
				+ ( isset( $data['publishedAt'] ) ? array( 'date_gmt' => substr( (string) $data['publishedAt'], 0, 19 ) ) : array() );
		}

		return ( $create ? array( 'status' => 'publish' ) : array() ) + ( isset( $data['publishedAt'] ) ? array( 'date_gmt' => substr( (string) $data['publishedAt'], 0, 19 ) ) : array() );
	}

	/** @param array<string, string> $names SpacePress field → core field; any other field is refused */
	private static function rename( array $data, array $names, array $out = array() ): array {
		foreach ( $data as $field => $value ) {
			$field = (string) $field;
			if ( 'status' === $field || 'publishedAt' === $field ) {
				continue; // mapped by the caller
			}
			$core         = $names[ $field ] ?? throw \SpacePress\HttpError::invalidInput( "Unknown field '$field'", \SpacePress\HttpError::seg( $field ) );
			$out[ $core ] = $value;
		}

		return $out;
	}

	/** A field another plugin registered on $postType's REST route with register_rest_field, writable. */
	private static function rest_field( string $postType, string $field ): bool { // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
		rest_get_server(); // fires rest_api_init once, where plugins register their fields

		return isset( $GLOBALS['wp_rest_additional_fields'][ $postType ][ $field ]['update_callback'] ); // phpcs:ignore WordPress.NamingConventions.ValidVariableName.VariableNotSnakeCase -- Preserve the existing PHP variable name.
	}

	private static function sp_input( array $kind, array $data, bool $create ): array {
		$spec  = $kind['spec'];
		$out   = array();
		$meta  = array();
		$first = array();
		foreach ( $data as $col => $value ) {
			$col = (string) $col;
			if ( 'users' === $kind['type'] ) {
				// Core's own user fields; UserMeta applies them (and `meta`) through SpacePress's pipeline.
				match ( $col ) {
					'email', 'name', 'password' => $out[ $col ] = $value,
					// A role is one of SpacePress's role names; anything else (null included) is refused as
					// SpacePress refuses it, never handed to core, which would read it as "no roles".
					'role' => $out['roles']  = is_string( $value ) && '' !== $value
						? array( WpUserStore::wpRole( $value ) )
						: throw \SpacePress\HttpError::invalidInput( 'role is required', '/role' ),
					default => $meta[ $col ] = $value,
				};
				continue;
			}
			$designation = match ( $col ) {
				$spec['title'] ?? null => 'title',
				$spec['content'] ?? null => 'content',
				$spec['slug'] ?? null => 'slug',
				$spec['excerpt'] ?? null => 'excerpt',
				default => null,
			};
			if ( null !== $designation ) {
				$out[ $designation ] = $value;
			} elseif ( 'status' === $col && ( $spec['columns']['status']['system'] ?? false ) ) {
				$out['status'] = array(
					'published' => 'publish',
					'scheduled' => 'future',
					'draft'     => 'draft',
					'pending'   => 'pending',
				)[ $value ] ?? $value;
			} elseif ( 'publishedAt' === $col && ( $spec['columns']['publishedAt']['system'] ?? false ) ) {
				$out['date_gmt'] = is_string( $value ) ? substr( $value, 0, 19 ) : $value;
			} elseif ( in_array( $col, array( 'locale', 'translationOf' ), true ) && ( $spec['localized'] ?? false ) ) {
				$out[ $col ] = $value; // a translation's language and group (PostsController::spWrite)
			} elseif ( 'post' === $kind['type'] && self::rest_field( $spec['wp']['postType'], $col ) ) {
				// A field another plugin registered on this post type's REST route (register_rest_field):
				// core's own update of it runs, as for any core client.
				$out[ $col ] = $value;
			} elseif ( isset( PostMeta::fields( $spec )[ $col ] ) ) {
				// A field: core's `meta`, which core's permission check and SpacePress's rules on it read.
				$meta[ $col ] = $value;
			} else {
				// Anything else (`uid`, a typo): SpacePress's pipeline decides it (PostsController::spWrite
				// reads `spacepress`), so an unknown field is SpacePress's 422, not core's silent ignore.
				$first[ $col ] = $value;
			}
		}
		if ( 'post' === $kind['type'] && ! isset( $out['status'] ) && $create ) {
			$out['status'] = 'publish'; // SpacePress's default: a row without a status is published
		}
		if ( 'users' === $kind['type'] && $create ) {
			// Core requires a login and a password; SpacePress generates the login and, without one, a password.
			$out['username']   = 'zm_' . bin2hex( random_bytes( 10 ) );
			$out['password'] ??= wp_generate_password( 32, true, true );
		}
		if ( array() !== $meta ) {
			$out['meta'] = (object) $meta;
		}
		if ( array() !== $first ) {
			$out['spacepress'] = (object) $first;
		}

		return $out;
	}

	/**
	 * `menus` (spec §2.1): each registered location with its menu's items as a tree, read through
	 * core's own menu routes as the viewer (public locations open to anyone, {@see Facade}).
	 *
	 * @param array<string, array> $locations core's `/wp/v2/menu-locations` answer
	 * @param callable(int): list<array> $items a menu's items from `/wp/v2/menu-items?menus=<id>`
	 */
	public static function menus( array $locations, callable $items ): array {
		$out = array();
		foreach ( $locations as $location ) {
			if ( ! is_array( $location ) ) {
				continue;
			}
			$menu  = (int) ( $location['menu'] ?? 0 );
			$out[] = array(
				'location' => (string) ( $location['name'] ?? '' ),
				'items'    => $menu > 0 ? self::tree( $items( $menu ) ) : array(),
			);
		}

		return $out;
	}

	/** @param list<array> $items core menu items, flat */
	private static function tree( array $items, int $parent = 0 ): array { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.parentFound -- Preserve the existing PHP parameter name.
		$out = array();
		usort( $items, static fn ( array $a, array $b ) => ( $a['menu_order'] ?? 0 ) <=> ( $b['menu_order'] ?? 0 ) );
		foreach ( $items as $item ) {
			if ( (int) ( $item['parent'] ?? 0 ) !== $parent ) {
				continue;
			}
			$out[] = array(
				'label'    => self::text( $item['title'] ?? null ),
				'url'      => $item['url'] ?? null,
				'item'     => ( $item['object_id'] ?? 0 ) && ( $item['type'] ?? '' ) !== 'custom' ? array(
					'kind' => (string) ( $item['object'] ?? '' ),
					'id'   => (int) $item['object_id'],
				) : null,
				'children' => self::tree( $items, (int) ( $item['id'] ?? 0 ) ),
			);
		}

		return $out;
	}

	/** `settings` (spec §2.1) from core's `/wp/v2/settings` and the index's public site fields. */
	public static function settings( array $index, ?array $settings ): array {
		return array(
			'title'     => $settings['title'] ?? $index['name'] ?? '',
			'tagline'   => $settings['description'] ?? $index['description'] ?? '',
			'timezone'  => ( $settings['timezone'] ?? $index['timezone_string'] ?? '' ) ?: 'UTC', // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
			'locale'    => $settings['language'] ?? str_replace( '-', '_', (string) get_bloginfo( 'language' ) ),
			'icon'      => ( (int) ( $settings['site_icon'] ?? $index['site_icon'] ?? 0 ) ) ?: null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
			'logo'      => ( (int) ( $settings['site_logo'] ?? $index['site_logo'] ?? 0 ) ) ?: null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
			'frontPage' => ( $settings['show_on_front'] ?? get_option( 'show_on_front' ) ) === 'page'
				? ( ( (int) ( $settings['page_on_front'] ?? get_option( 'page_on_front' ) ) ) ?: null ) : null, // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
		);
	}

	/** `settings` input → core's `/wp/v2/settings` body (admins only, by core's rules). */
	public static function settingsInput( array $data ): array { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return self::rename(
			$data,
			array(
				'title'     => 'title',
				'tagline'   => 'description',
				'timezone'  => 'timezone',
				'locale'    => 'language',
				'icon'      => 'site_icon',
				'logo'      => 'site_logo',
				'frontPage' => 'page_on_front',
			)
		);
	}

	/**
	 * `?format=md` on an item: the post exactly as its Markdown twin renders it ({@see MarkdownTwins::post()}),
	 * the same producer as core's `?format=md`. Tables and other non-post kinds have no Markdown form.
	 */
	public static function markdown( array $kind, mixed $item ): ?string {
		if ( ! in_array( $kind['type'], array( 'post', 'wp-post' ), true ) || ! is_array( $item ) ) {
			return null;
		}
		$post = get_post( (int) ( $item['id'] ?? 0 ) );

		return $post instanceof \WP_Post ? MarkdownTwins::post( $post ) : null;
	}

	/** `GET /wp-json/spacepress/v1`: the app's kinds (with their routes), fields, globals and actions. */
	public static function describe( Plugin $plugin ): array {
		$described = \SpacePress\Extensions::describe( $plugin->schema->describe() );
		$kinds     = array();
		foreach ( self::all( $plugin ) as $name => $kind ) {
			$kinds[ $name ] = array(
				'route' => $kind['route'],
				'type'  => self::first( $kind ) ? $kind['type'] : 'builtin',
			)
				+ ( self::first( $kind ) ? ( $described['collections'][ $kind['spec']['key'] ?? $name ] ?? $described['collections'][ $name ] ?? array() ) : array() );
		}
		$kinds['settings'] = array(
			'route' => '/wp/v2/settings',
			'type'  => 'builtin',
		);
		$actions           = array();
		foreach ( $plugin->schema->actions() as $name => $a ) {
			if ( ( $a['signature'] ?? null ) !== null ) {
				continue;
			}
			$actions[ $name ] = ( $described['actions'][ $name ] ?? array() ) + array(
				'readonly'    => (bool) ( $a['readonly'] ?? false ),
				'destructive' => (bool) ( $a['destructive'] ?? false ),
				'output'      => $a['output'] ?? null,
			);
		}

		return array_diff_key(
			$described,
			array(
				'collections' => true,
				'actions'     => true,
			)
		)
			+ array(
				'name'    => $plugin->schema->name(),
				'kinds'   => $kinds,
				'globals' => $described['globals'] ?? array(),
				'actions' => $actions,
			);
	}

	private static function text( mixed $v ): mixed {
		return is_array( $v ) ? ( $v['raw'] ?? $v['rendered'] ?? null ) : $v;
	}

	private static function status( string $status ): string {
		return match ( $status ) {
			'publish' => 'published',
			'future' => 'scheduled',
			'pending' => 'pending',
			'private' => 'private',
			default => 'draft',
		};
	}

	private static function publishedAt( array $item ): ?string { // phpcs:ignore WordPress.NamingConventions.ValidFunctionName.MethodNameInvalid -- Preserve the existing PHP method name.
		return in_array( $item['status'] ?? null, array( 'publish', 'future' ), true ) && is_string( $item['date_gmt'] ?? null ) ? $item['date_gmt'] . '.000Z' : null;
	}

	private static function gmt( mixed $v ): ?string {
		return is_string( $v ) && '' !== $v ? $v . '.000Z' : null;
	}

	private static function iso( string $v ): string {
		$t = strtotime( $v );

		return false === $t ? $v : gmdate( 'Y-m-d\TH:i:s', $t ) . '.000Z';
	}
}
