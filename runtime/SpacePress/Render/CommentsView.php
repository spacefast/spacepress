<?php

declare(strict_types=1);

namespace SpacePress\Render;

use SpacePress\Html;
use SpacePress\JsObject;
use SpacePress\Wp\Comments;

/**
 * `<Comments for={item} />` (docs/decisions/2026-11-14-comments.md): the item's thread as the visitor
 * may read it, and a form that posts a comment without JavaScript.
 *
 * - The thread is approved comments, plus the visitor's own held ones marked as awaiting
 *   moderation, nested by reply. It is read only when the visitor may read the item: the page
 *   already read the item as the visitor, and this checks again, so a thread is never shown for
 *   an item the visitor can't see.
 * - A signed-out visitor sees the thread and a sign-in link, not a form. A signed-in visitor gets a
 *   form that posts form-encoded to `POST /wp-json/spacepress/v1/comments` ({@see Forms}), and a reply
 *   form under each comment that may take a reply. The policy itself ({@see Comments}) is enforced
 *   where comments are created, never here.
 * - The page shows a signed-in visitor's held comment and the form's flash, so it is never shared:
 *   a signed-in render already is `private, no-store`, and a signed-out one shows only approved
 *   comments, the same for everyone.
 */
final class CommentsView {

	public static function render( string $collection, mixed $item, ?string $class ): Html { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.classFound -- Preserve the existing PHP parameter name.
		$id     = (int) ( $item instanceof JsObject ? ( $item->p['id'] ?? 0 ) : ( is_array( $item ) ? ( $item['id'] ?? 0 ) : 0 ) );
		$viewer = \SpacePress\Wp\CoreAccess::viewer();
		if ( $id <= 0 || null === $viewer || ! \SpacePress\Wp\CoreAccess::covers( $collection, 'read', $id, $viewer ) ) {
			return Html::raw( '' );
		}
		$user_id = (int) ( $viewer->user['id'] ?? 0 );
		// The thread is core's comment query, which no SpacePress counter follows: a live region around
		// it is rendered and compared on every poll, so a new approved comment shows on the next one.
		Live::unseen();
		// A live region around the thread asks again when a comment's approval changes (Comments::seen).
		Live::reads( \SpacePress\Wp\Comments::NOTICE );
		$rows      = Comments::thread( $id, $user_id );
		$depth     = Comments::policy( $collection )['threaded'];
		$by_parent = array();
		foreach ( $rows as $row ) {
			$by_parent[ (int) ( $row['parent'] ?? 0 ) ][] = $row;
		}
		$state  = Forms::state( 'comments' );
		$error  = $state->p['error'] instanceof JsObject ? (string) $state->p['error']->p['message'] : null;
		$posted = $state->p['result'] instanceof JsObject ? (string) ( $state->p['result']->p['status'] ?? '' ) : null;
		$count  = count( array_filter( $rows, static fn ( array $r ): bool => 'approved' === $r['status'] ) );

		return Html::element(
			'section',
			array(
				'className'  => trim( 'spacepress-comments ' . ( $class ?? '' ) ),
				'aria-label' => __( 'Comments' ),
			),
			/* translators: %d: Number of comments. */
			Html::element( 'h2', array(), sprintf( _n( '%d comment', '%d comments', $count ), $count ) ),
			null !== $error ? Html::element(
				'p',
				array(
					'className' => 'spacepress-comments-error',
					'role'      => 'alert',
				),
				$error
			) : null,
			'pending' === $posted ? Html::element(
				'p',
				array(
					'className' => 'spacepress-comments-held',
					'role'      => 'status',
				),
				__( 'Your comment is awaiting moderation.' )
			) : null,
			self::list( $by_parent, 0, 1, $depth, $id, $user_id ),
			$user_id > 0
				? self::form( $id, 0, __( 'Add a comment' ) )
				: Html::element( 'p', array( 'className' => 'spacepress-comments-sign-in' ), Html::element( 'a', array( 'href' => wp_login_url( (string) ( $_SERVER['REQUEST_URI'] ?? '/' ) ) ), __( 'Sign in to comment' ) ) ),
		);
	}

	/** @param array<int, list<array<string, mixed>>> $byParent */
	private static function list( array $by_parent, int $parent, int $level, int $depth, int $post_id, int $user_id ): ?Html { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.parentFound -- Preserve the existing PHP parameter name.
		$rows = $by_parent[ $parent ] ?? array();
		if ( array() === $rows ) {
			return null;
		}
		$items = array();
		foreach ( $rows as $row ) {
			$held    = 'approved' !== $row['status'];
			$items[] = Html::element(
				'li',
				array(
					'id'        => 'comment-' . $row['id'],
					'className' => $held ? 'spacepress-comment spacepress-comment-held' : 'spacepress-comment',
				),
				Html::element(
					'p',
					array( 'className' => 'spacepress-comment-meta' ),
					Html::element( 'strong', array(), (string) $row['authorName'] ),
					' ',
					Html::element( 'time', array( 'dateTime' => (string) $row['createdAt'] ), wp_date( get_option( 'date_format' ) ?: 'Y-m-d', (int) strtotime( (string) $row['createdAt'] ) ) ), // phpcs:ignore Universal.Operators.DisallowShortTernary.Found -- Keep the existing falsey fallback.
					$held ? Html::children( ' ', Html::element( 'em', array(), __( 'Awaiting moderation' ) ) ) : null,
				),
				Html::element( 'div', array( 'className' => 'spacepress-comment-body' ), Markup::kses( wpautop( esc_html( (string) $row['content'] ) ) ) ),
				// A reply goes one level down: offered only where the policy has room, and not on a held comment.
				$user_id > 0 && ! $held && $level < $depth ? self::form( $post_id, (int) $row['id'], __( 'Reply' ) ) : null,
				self::list( $by_parent, (int) $row['id'], $level + 1, $depth, $post_id, $user_id ),
			);
		}

		return Html::element( 0 === $parent ? 'ol' : 'ol', array( 'className' => 0 === $parent ? 'spacepress-comments-list' : 'spacepress-comments-replies' ), ...$items );
	}

	private static function form( int $post_id, int $parent, string $label ): Html { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.parentFound -- Preserve the existing PHP parameter name.
		$field = 'spacepress-comment-' . $post_id . '-' . $parent;
		$form  = Html::element(
			'form',
			array(
				'method'    => 'post',
				'action'    => \SpacePress\Wp\Facade::url( '/comments' ),
				'className' => 0 === $parent ? 'spacepress-comments-form' : 'spacepress-comments-reply',
			) + Forms::enhanced(),
			Html::element(
				'input',
				array(
					'type'  => 'hidden',
					'name'  => 'on',
					'value' => (string) $post_id,
				)
			),
			$parent > 0 ? Html::element(
				'input',
				array(
					'type'  => 'hidden',
					'name'  => 'parent',
					'value' => (string) $parent,
				)
			) : null,
			Html::element( 'label', array( 'htmlFor' => $field ), $label ),
			Html::element(
				'textarea',
				array(
					'id'       => $field,
					'name'     => 'content',
					'required' => true,
					'rows'     => 0 === $parent ? 4 : 2,
				)
			),
			Html::element( 'button', array( 'type' => 'submit' ), 0 === $parent ? __( 'Post comment' ) : __( 'Post reply' ) ),
			Forms::fields( 'comments' ),
		);

		return 0 === $parent ? $form : Html::element( 'details', array(), Html::element( 'summary', array(), $label ), $form );
	}
}
