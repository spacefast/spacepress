<?php

declare(strict_types=1);

/*
 * Content sync on a site whose trash is off (`EMPTY_TRASH_DAYS` 0, wp-config.php). WordPress's
 * wp_trash_post() then deletes the post for good. A sync never deletes: its trash is refused before
 * anything is written, and the post, its revisions and the rows that depend on it stay.
 */

define( 'EMPTY_TRASH_DAYS', 0 );

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$editor = array(
	'read'   => array( 'role' => 'anyone' ),
	'create' => array( 'role' => 'editor' ),
	'update' => array( 'role' => 'editor' ),
	'delete' => array( 'role' => 'editor' ),
);
$api    = array(
	'list'   => true,
	'get'    => true,
	'create' => true,
	'update' => true,
	'delete' => true,
);
$uid    = array(
	'type'   => 'text',
	'unique' => true,
	'system' => true,
	'rules'  => array(
		'pattern' => array(
			'source' => '^zr_[0-9a-f]{20}$',
			'flags'  => '',
		),
	),
);
$schema = array(
	'name'        => 'notrash',
	'collections' => array(
		'notes'    => array(
			'primaryKey' => 'id',
			'editor'     => true,
			'uid'        => true,
			'sync'       => array(
				'dir'    => 'content/notes',
				'format' => 'md',
			),
			'title'      => 'title',
			'content'    => 'body',
			'drafts'     => true,
			'revisions'  => true,
			'access'     => $editor,
			'api'        => $api,
			'relations'  => array(),
			'hooks'      => array(),
			'columns'    => array(
				'id'          => array(
					'type'          => 'integer',
					'primaryKey'    => true,
					'autoIncrement' => true,
					'notNull'       => true,
				),
				'title'       => array(
					'type'    => 'text',
					'notNull' => true,
				),
				'body'        => array( 'type' => 'richText' ),
				'status'      => array(
					'type'    => 'text',
					'notNull' => true,
					'enum'    => array( 'draft', 'published', 'scheduled' ),
					'default' => array( 'value' => 'draft' ),
					'system'  => true,
				),
				'publishedAt' => array(
					'type'   => 'timestamp',
					'system' => true,
				),
				'uid'         => $uid,
			),
		),
		'comments' => array(
			'primaryKey' => 'id',
			'editor'     => false,
			'table'      => 'sp_comments',
			'uid'        => false,
			'sync'       => null,
			'access'     => $editor,
			'api'        => $api,
			'relations'  => array(),
			'hooks'      => array(),
			'columns'    => array(
				'id'     => array(
					'type'          => 'integer',
					'primaryKey'    => true,
					'autoIncrement' => true,
					'notNull'       => true,
				),
				'noteId' => array(
					'type'       => 'integer',
					'notNull'    => true,
					'references' => array(
						'collection' => 'notes',
						'column'     => 'id',
						'onDelete'   => 'cascade',
					),
				),
			),
		),
	),
	'globals'     => array(),
	'actions'     => array(),
);

$wp  = wpSite(
	'sync-notrash',
	array(
		'schema' => $schema,
		'users'  => array( 'ed' => 'editor' ),
	)
);
$app = $wp->app();
$db  = \SpacePress\db();

$note = $db->insert(
	'notes',
	array(
		'title' => 'Keep me',
		'body'  => '<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->',
	),
	true
)[0];
$db->insert( 'comments', array( 'noteId' => $note['id'] ) );
$before             = get_post_status( $note['id'] );
[, $page]           = $wp->call( 'GET', '/sync/notes', null, 'ed' );
$item               = $page['records'][0];
[$status, $problem] = $wp->call(
	'POST',
	'/sync/notes/trash',
	array(
		'uid'    => $item['record']['uid'],
		'expect' => $item['digest'],
	),
	'ed'
);
eq( 'a sync trash with the trash off is refused', array( $status, $problem['code'] ?? null ), array( 409, 'trash_disabled' ) );
clean_post_cache( $note['id'] );
eq( 'the post is still there, as it was', array( get_post_status( $note['id'] ), false !== $before ), array( $before, true ) );
eq( 'the row that depends on it is kept', count( $db->findMany( 'comments', array( 'where' => array( 'noteId' => $note['id'] ) ) ) ), 1 );

finish( 'sync_notrash' );
