<?php
/** Import the pinned upstream seed once into a newly owned native SpacePress site. */
[$mode, $seed_file, $site] = $args;
if ( ! in_array( $mode, array( 'starter', 'blog' ), true ) || realpath( ABSPATH ) !== realpath( $site ) ) {
	WP_CLI::error( 'Site ownership mismatch.' );
}
if ( get_option( 'sp_official_mode' ) ) {
	WP_CLI::error( 'This site is already seeded; refusing to overwrite content.' );
}
$seed = json_decode( file_get_contents( $seed_file ), true, 512, JSON_THROW_ON_ERROR );
function zof_seed_html( $blocks ) {
	$html = '';
	foreach ( $blocks as $block ) {
		if ( ( $block['_type'] ?? '' ) !== 'block' ) {
			WP_CLI::error( 'Unsupported upstream seed block.' );
		}
		$style = $block['style'] ?? 'normal';
		$tag   = in_array( $style, array( 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote' ), true ) ? $style : 'p';
		$text  = '';
		foreach ( $block['children'] ?? array() as $span ) {
			$part = esc_html( $span['text'] ?? '' );
			foreach ( $span['marks'] ?? array() as $mark ) {
				if ( 'strong' === $mark ) {
					$part = '<strong>' . $part . '</strong>';
				} elseif ( 'em' === $mark ) {
					$part = '<em>' . $part . '</em>';
				} elseif ( 'code' === $mark ) {
					$part = '<code>' . $part . '</code>';
				} else {
					foreach ( $block['markDefs'] ?? array() as $def ) {
						if ( ( $def['_key'] ?? '' ) === $mark && ( $def['_type'] ?? '' ) === 'link' ) {
												$part = '<a href="' . esc_url( $def['href'] ) . '">' . $part . '</a>';
						}
					}
				}
			}
			$text .= $part;
		}
		$name  = str_starts_with( $tag, 'h' ) ? 'heading' : ( 'blockquote' === $tag ? 'quote' : 'paragraph' );
		$level = 'heading' === $name ? ' {"level":' . substr( $tag, 1 ) . '}' : '';
		$html .= '<!-- wp:' . $name . $level . ' --><' . $tag . '>' . $text . '</' . $tag . '><!-- /wp:' . $name . ' -->';
	}
	return $html;
}
update_option( 'sp_official_mode', $mode );
update_option( 'blogname', $seed['settings']['title'] );
update_option( 'blogdescription', $seed['settings']['tagline'] );
update_option( 'sp_official_menus', $seed['menus'] );
$locations = get_nav_menu_locations();
foreach ( $seed['menus'] as $menu_seed ) {
	$menu_id = wp_create_nav_menu( $menu_seed['label'] );
	if ( is_wp_error( $menu_id ) ) {
		WP_CLI::error( $menu_id->get_error_message() );
	}
	foreach ( $menu_seed['items'] as $item ) {
		wp_update_nav_menu_item(
			$menu_id,
			0,
			array(
				'menu-item-title'  => $item['label'],
				'menu-item-url'    => $item['url'],
				'menu-item-type'   => 'custom',
				'menu-item-status' => 'publish',
			)
		);
	}
	$locations[ $menu_seed['name'] ] = $menu_id;
}
set_theme_mod( 'nav_menu_locations', $locations );
update_option( 'sp_official_widgets', $seed['widgetAreas'] );
update_option( 'comment_moderation', 1 );
update_option( 'comment_previously_approved', 0 );
update_option( 'comments_notify', 0 );
update_option( 'moderation_notify', 0 );
foreach ( $seed['taxonomies'] as $taxonomy ) {
	foreach ( $taxonomy['terms'] as $term ) {
		$result = wp_insert_term( $term['label'], 'tag' === $taxonomy['name'] ? 'post_tag' : 'category', array( 'slug' => $term['slug'] ) );
		if ( is_wp_error( $result ) && $result->get_error_code() !== 'term_exists' ) {
			WP_CLI::error( $result->get_error_message() );
		}
	}
}
$bylines = array();
foreach ( $seed['bylines'] ?? array() as $byline ) {
	$term = wp_insert_term( $byline['displayName'], 'sp_credit', array( 'slug' => $byline['slug'] ) );
	if ( is_wp_error( $term ) ) {
		WP_CLI::error( $term->get_error_message() );
	}
	$bylines[ $byline['id'] ] = (int) $term['term_id'];
}
$receipt = array();
foreach ( $seed['content'] as $collection => $entries ) {
	foreach ( $entries as $index => $entry ) {
		$id = wp_insert_post(
			array(
				'post_type'      => 'sp_' . $collection,
				'post_status'    => 'published' === $entry['status'] ? 'publish' : 'draft',
				'post_title'     => $entry['data']['title'],
				'post_name'      => $entry['slug'],
				'post_author'    => 1,
				'post_content'   => zof_seed_html( $entry['data']['content'] ?? array() ),
				'post_date'      => gmdate( 'Y-m-d H:i:s', time() - ( $index + 1 ) * DAY_IN_SECONDS ),
				'comment_status' => 'blog' === $mode && 'posts' === $collection ? 'open' : 'closed',
				'meta_input'     => array( 'sp_excerpt' => $entry['data']['excerpt'] ?? '' ),
			),
			true
		);
		if ( is_wp_error( $id ) ) {
			WP_CLI::error( $id->get_error_message() );
		}
		foreach ( $entry['taxonomies'] ?? array() as $taxonomy => $slugs ) {
			wp_set_object_terms( $id, $slugs, 'tag' === $taxonomy ? 'post_tag' : 'category' );
		}
		foreach ( $entry['bylines'] ?? array() as $credit ) {
			wp_set_object_terms( $id, array( $bylines[ $credit['byline'] ] ), 'sp_credit', true );
			if ( isset( $credit['roleLabel'] ) ) {
				update_term_meta( $bylines[ $credit['byline'] ], 'sp_role', $credit['roleLabel'] );
			}
		}
			$receipt[] = array(
				'id'         => $id,
				'collection' => $collection,
				'slug'       => $entry['slug'],
				'image'      => $entry['data']['featured_image']['$media'] ?? null,
			);
	}
}
echo wp_json_encode( $receipt );
