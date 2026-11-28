<?php

declare(strict_types=1);

/*
 * examples/pantry, built by `spacepress build`, on WordPress with Action Scheduler: the `consume` mutation,
 * the `expiringSoon` query, the `notifyLowStock` job its hook queues with `notifyLowStock.enqueue()`, and
 * the `weeklyList` cron schedule. Driven by tests/compiler.rs.
 *
 *   php tests/php/pantry_example.php <wp-content dir>
 */

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$wp     = wpSite(
	'pantry-example',
	array(
		'wpContent' => $argv[1],
		'users'     => array( 'cook' => 'editor' ),
	)
);
$api    = static fn ( string $method, string $path, mixed $body = null ) => $wp->call( $method, $path, $body, 'cook' );
$inDays = static fn ( int $days ): string => gmdate( 'Y-m-d', time() + $days * DAY_IN_SECONDS );

[, $fridge]      = $api(
	'POST',
	'/locations',
	array(
		'name' => 'Fridge',
		'kind' => 'fridge',
	)
);
[$status, $milk] = $api(
	'POST',
	'/items',
	array(
		'name'       => ' Milk ',
		'quantity'   => 2,
		'lowStockAt' => 1,
		'expiresOn'  => $inDays( 2 ),
		'locationId' => $fridge['id'],
	)
);
eq( 'an item is created through the API', array( $status, $milk['name'], $milk['slug'] ), array( 201, 'Milk', 'milk' ) );
$api(
	'POST',
	'/items',
	array(
		'name'      => 'Rice',
		'quantity'  => 5,
		'expiresOn' => $inDays( 300 ),
	)
);

// The query: its input is optional, and the default is the handler's (3 days).
[$status, $soon] = $api( 'POST', '/actions/expiringSoon', (object) array() );
eq( 'expiringSoon lists what expires within its default 3 days', array( $status, array_column( $soon, 'name' ), $soon[0]['where'] ), array( 200, array( 'Milk' ), 'Fridge' ) );
[, $later] = $api( 'POST', '/actions/expiringSoon', array( 'days' => 400 ) );
eq( 'and takes a typed days input', array_column( $later, 'name' ), array( 'Milk', 'Rice' ) );
eq( 'it is a read-only ability', (bool) ( wp_get_ability( 'pantry/expiring-soon' )->get_meta_item( 'annotations' )['readonly'] ?? false ), true );

// The mutation: amount defaults to 1; milk reaches its low-stock mark and the hook queues the job.
[$status, $consumed] = $api( 'POST', '/actions/consume', array( 'itemId' => $milk['id'] ) );
eq( 'consume uses its default amount', array( $status, $consumed['item']['quantity'], $consumed['message'] ), array( 200, 1, 'Milk: 1 pcs left' ) );
$entry = $wp->sql( 'SELECT `name`, `notifiedAt` FROM {prefix}sp_shopping_list WHERE `itemId` = ?', array( $milk['id'] ) )[0] ?? null;
eq( 'the hook put milk on the shopping list, not yet notified', array( $entry['name'] ?? null, array_key_exists( 'notifiedAt', $entry ?? array() ) ? $entry['notifiedAt'] : 'missing' ), array( 'Milk', null ) );
$queued = $wp->sql( "SELECT `input`, `key` FROM {prefix}sp__jobs WHERE `job` = 'notifyLowStock'" );
eq( 'and queued notifyLowStock with notifyLowStock.enqueue()', array( count( $queued ), json_decode( $queued[0]['input'] ?? 'null', true ), $queued[0]['key'] ?? null ), array( 1, array( 'itemId' => $milk['id'] ), 'low-' . $milk['id'] ) );
[$status, $problem] = $api( 'POST', '/actions/consume', array( 'itemId' => 'milk' ) );
eq( 'a mistyped input is refused before the handler runs', array( $status, $problem['pointer'] ?? null ), array( 422, '/itemId' ) );

ActionScheduler_QueueRunner::instance()->run( 'SpacePress tests' );
check( 'Action Scheduler ran the job, which stamped the list entry', is_string( $wp->scalar( 'SELECT `notifiedAt` FROM {prefix}sp_shopping_list WHERE `itemId` = ?', array( $milk['id'] ) ) ) );

// The weekly cron schedule is one Action Scheduler cron action.
do_action( 'action_scheduler_init' );
$schedules = $wp->sql( "SELECT `args`, `schedule` FROM {prefix}actionscheduler_actions WHERE `hook` = 'sp_job_schedule' AND `status` = 'pending'" );
eq(
	'weeklyList is scheduled on Action Scheduler',
	array_map( static fn ( $r ) => array( $r['args'], get_class( unserialize( $r['schedule'] ) ) ), $schedules ),
	array( array( '["weeklyList","cron:0 8 * * 1"]', ActionScheduler_CronSchedule::class ) )
);

finish( 'pantry example' );
