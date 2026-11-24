<?php

declare(strict_types=1);

/*
 * Host connectors (`connectors.call` / `connectors.enqueue` from "spacepress") on an in-process
 * WordPress (tests/php/wp.php). `call` asks the `sp_connectors_call` filter now and returns its answer.
 * `enqueue` queues the built-in `spacepress.connector` job in the action's transaction: a rollback
 * queues nothing, the host is asked only after commit and outside any transaction, a `key` keeps one
 * queued call, and a failing call is retried with the runner's backoff until it gives up.
 */

use SpacePress\Connectors;
use SpacePress\HttpError;
use SpacePress\Jobs\Runner;
use SpacePress\JsObject;

require __DIR__ . '/wp.php';
require __DIR__ . '/harness.php';

$schema                      = require dirname( __DIR__ ) . '/fixtures/blog/schema.php';
$schema['actions']['ship']   = array(
	'input'      => array(
		'order' => array(
			'type'    => 'text',
			'notNull' => true,
		),
		'fail'  => array( 'type' => 'boolean' ),
	),
	'handler'    => 'action__ship',
	'access'     => array( 'role' => 'anyone' ),
	'agents'     => false,
	'idempotent' => false,
	'signature'  => null,
);
$schema['actions']['lookup'] = array(
	'input'      => array(
		'q' => array(
			'type'    => 'text',
			'notNull' => true,
		),
	),
	'handler'    => 'action__lookup',
	'access'     => array( 'role' => 'anyone' ),
	'agents'     => false,
	'idempotent' => false,
	'signature'  => null,
);
// What `spacepress build` writes for connectors.enqueue(...) and connectors.call(...) (tests/spacepress_cutover.rs).
$functions = file_get_contents( dirname( __DIR__ ) . '/fixtures/blog/functions.php' ) . <<<'PHP'

function action__ship(\SpacePress\JsObject $input, $ctx)
{
    $queued = \SpacePress\Connectors::enqueue('fulfilment', 'create_shipment', new \SpacePress\JsObject(['order' => $input->p['order']]), new \SpacePress\JsObject(['key' => 'ship-' . $input->p['order']]));
    if (($input->p['fail'] ?? false) === true) {
        throw new \SpacePress\HttpError(409, 'rolled_back', 'after queueing');
    }
    return $queued->p['id'];
}

function action__lookup(\SpacePress\JsObject $input, $ctx)
{
    return \SpacePress\Connectors::call('crm', 'find', new \SpacePress\JsObject(['q' => $input->p['q']]));
}
PHP;

$wp         = wpSite(
	'connectors',
	array(
		'schema'    => $schema,
		'functions' => $functions,
	)
);
$jobs       = static fn () => $wp->sql( "SELECT `id`, `state`, `attempts`, `lastError`, `input`, `key` FROM {prefix}sp__jobs WHERE `job` = 'spacepress.connector' ORDER BY `createdAt`, `id`" );
$job        = static fn ( string $id ) => $wp->sql( 'SELECT `state`, `attempts`, `lastError`, `runAt` FROM {prefix}sp__jobs WHERE `id` = ?', array( $id ) )[0];
$due        = static fn ( string $id ) => $wp->sql( "UPDATE {prefix}sp__jobs SET `runAt` = '2000-01-01T00:00:00.000Z' WHERE `id` = ?", array( $id ) );
$connection = \SpacePress\Wp\Runtime::plugin()->connection();

// ---- without a host transport, both refuse before doing anything
[$status, $problem] = $wp->call( 'POST', '/actions/ship', array( 'order' => 'A-1' ) );
eq( 'enqueue without sp_connectors_call is a 503 and queues nothing', array( $status, $problem['code'] ?? null, count( $jobs() ) ), array( 503, 'connectors_unavailable', 0 ) );
[$status, $problem] = $wp->call( 'POST', '/actions/lookup', array( 'q' => 'ada' ) );
eq( 'call without sp_connectors_call is a 503', array( $status, $problem['code'] ?? null ), array( 503, 'connectors_unavailable' ) );

// ---- the host transport: records each call and whether a transaction was open
$calls  = array();
$answer = true;
add_filter(
	'sp_connectors_call',
	static function ( mixed $result, string $role, string $tool, array $args, array $context = array() ) use ( &$calls, &$answer, $connection ): mixed {
		$calls[] = array(
			'role'          => $role,
			'tool'          => $tool,
			'args'          => $args,
			'mode'          => $context['mode'] ?? null,
			'jobId'         => $context['jobId'] ?? null,
			'attempt'       => $context['attempt'] ?? null,
			'inTransaction' => $connection->inTransaction(),
		);
		if ( 'crm' === $role ) {
			return array(
				'found' => array(
					array(
						'name' => 'Ada',
						'q'    => $args['q'],
					),
				),
			);
		}
		return true === $answer ? array( 'shipment' => 'S-' . $args['order'] ) : $answer;
	},
	10,
	5
);

// ---- call(): synchronous, inside the request, its answer returned as JSON
$calls            = array();
[$status, $found] = $wp->call( 'POST', '/actions/lookup', array( 'q' => 'ada' ) );
eq(
	'call() asks the host now and returns its answer',
	array( $status, $found, count( $calls ), $calls[0]['mode'] ?? null ),
	array(
		200,
		array(
			'found' => array(
				array(
					'name' => 'Ada',
					'q'    => 'ada',
				),
			),
		),
		1,
		'call',
	)
);
add_filter( 'sp_connectors_call', static fn ( mixed $result, string $role ) => 'crm' === $role ? new \WP_Error( 'crm_down', 'CRM is down', array( 'status' => 504 ) ) : $result, 20, 2 );
[$status, $problem] = $wp->call( 'POST', '/actions/lookup', array( 'q' => 'ada' ) );
eq( 'a WP_Error from the host is the call\'s HTTP problem', array( $status, $problem['code'] ?? null, $problem['detail'] ?? null ), array( 504, 'crm_down', 'CRM is down' ) );
remove_all_filters( 'sp_connectors_call', 20 );

// ---- enqueue(): a rollback queues nothing
$calls    = array();
[$status] = $wp->call(
	'POST',
	'/actions/ship',
	array(
		'order' => 'A-1',
		'fail'  => true,
	)
);
eq( 'a handler that throws after enqueue queues nothing and asks no host', array( $status, count( $jobs() ), $calls ), array( 409, 0, array() ) );

// ---- enqueue(): the job commits with the request; the host is asked only when it runs
[$status, $id] = $wp->call( 'POST', '/actions/ship', array( 'order' => 'A-2' ) );
$queued        = $jobs();
eq(
	'enqueue returns the job id, the job holds the call, and nothing is called before the queue runs',
	array( $status, count( $queued ), $queued[0]['id'] === $id, json_decode( $queued[0]['input'], true ), $queued[0]['key'], $queued[0]['state'], $calls ),
	array(
		200,
		1,
		true,
		array(
			'role' => 'fulfilment',
			'tool' => 'create_shipment',
			'args' => array( 'order' => 'A-2' ),
		),
		'ship-A-2',
		'pending',
		array(),
	)
);
[$status, $again] = $wp->call( 'POST', '/actions/ship', array( 'order' => 'A-2' ) );
eq( 'the same key while the call is queued is the same job', array( $status, $again, count( $jobs() ) ), array( 200, $id, 1 ) );
$result = Runner::run( $id );
eq(
	'the runner makes the call once, outside any transaction, with the job id and attempt',
	array( $result['state'] ?? null, count( $calls ), $calls[0]['args'] ?? null, $calls[0]['mode'] ?? null, $calls[0]['jobId'] ?? null, $calls[0]['attempt'] ?? null, $calls[0]['inTransaction'] ?? null ),
	array( 'done', 1, array( 'order' => 'A-2' ), 'queued', $id, 1, false )
);

// ---- a failing call is retried with the runner's backoff, then gives up
$calls       = array();
$answer      = new \WP_Error( 'fulfilment_down', 'Fulfilment API answered 503' );
[, $failing] = $wp->call( 'POST', '/actions/ship', array( 'order' => 'B-1' ) );
$before      = time();
$first       = Runner::run( $failing );
$row         = $job( $failing );
eq(
	'a WP_Error fails the attempt and schedules a retry after the first backoff step',
	array(
		$first['state'] ?? null,
		(int) $row['attempts'],
		str_contains( (string) $row['lastError'], 'Fulfilment API answered 503' ),
		strtotime( $row['runAt'] ) >= $before + Runner::BACKOFF[0] && strtotime( $row['runAt'] ) <= time() + Runner::BACKOFF[0],
	),
	array( 'failed', 1, true, true )
);
$answer = true;
$due( $failing );
$second = Runner::run( $failing );
eq( 'the retry reaches the host again and completes', array( $second['state'] ?? null, count( $calls ), array_column( $calls, 'attempt' ) ), array( 'done', 2, array( 1, 2 ) ) );
add_filter(
	'sp_connectors_call',
	static function ( mixed $result, string $role ): mixed {
		throw new \RuntimeException( 'connector timed out' );
	},
	30,
	2
);
[, $doomed] = $wp->call( 'POST', '/actions/ship', array( 'order' => 'C-1' ) );
$states     = array();
for ( $i = 0; $i < 8; $i++ ) {
	$due( $doomed );
	$states[] = Runner::run( $doomed )['state'] ?? null;
}
eq(
	'a call that keeps throwing is retried, then dead after its retries',
	array( array_count_values( $states ), $job( $doomed )['state'] ),
	array(
		array(
			'failed' => 7,
			'dead'   => 1,
		),
		'dead',
	)
);
remove_all_filters( 'sp_connectors_call', 30 );

// ---- a queued call no connector answers (the filter passes null through) is retried, not done
add_filter( 'sp_connectors_call', static fn ( mixed $result, string $role ): mixed => 'fulfilment' === $role ? null : $result, 40, 2 );
[, $unanswered] = $wp->call( 'POST', '/actions/ship', array( 'order' => 'E-1' ) );
$result         = Runner::run( $unanswered );
eq( 'a null answer fails the attempt for a retry', array( $result['state'] ?? null, str_contains( (string) $job( $unanswered )['lastError'], 'No connector answered fulfilment:create_shipment' ) ), array( 'failed', true ) );
remove_all_filters( 'sp_connectors_call', 40 );

// ---- undefined fields are left out of the arguments, now and queued alike
$calls = array();
Connectors::call(
	'crm',
	'find',
	new JsObject(
		array(
			'q'      => 'ada',
			'page'   => \SpacePress\JsUndefined::Value,
			'filter' => new JsObject(
				array(
					'tag'  => \SpacePress\JsUndefined::Value,
					'kind' => 'a',
				)
			),
		)
	)
);
$undefined_job = Connectors::enqueue(
	'fulfilment',
	'create_shipment',
	new JsObject(
		array(
			'order' => 'F-1',
			'note'  => \SpacePress\JsUndefined::Value,
		)
	)
);
eq(
	'call() and enqueue() both send JSON-shaped arguments without undefined fields',
	array( $calls[0]['args'] ?? null, json_decode( $wp->sql( 'SELECT `input` FROM {prefix}sp__jobs WHERE `id` = ?', array( $undefined_job->p['id'] ) )[0]['input'], true )['args'] ),
	array(
		array(
			'q'      => 'ada',
			'filter' => array( 'kind' => 'a' ),
		),
		array( 'order' => 'F-1' ),
	)
);

// ---- enqueue checks its input before queueing
$refusal = static function ( callable $fn ): string {
	try {
		$fn();
		return 'ok';
	} catch ( HttpError $e ) {
		return $e->pointer . ' ' . $e->getMessage();
	}
};
eq(
	'bad enqueue input is refused with a pointer, and queues nothing',
	array(
		$refusal( static fn () => Connectors::enqueue( ' ', 'tool' ) ),
		$refusal( static fn () => Connectors::enqueue( 'role', '' ) ),
		$refusal( static fn () => Connectors::enqueue( 'role', 'tool', 'not an object' ) ),
		$refusal( static fn () => Connectors::enqueue( 'role', 'tool', null, new JsObject( array( 'retries' => 3 ) ) ) ),
		$refusal( static fn () => Connectors::enqueue( 'role', 'tool', null, new JsObject( array( 'key' => '' ) ) ) ),
		$refusal( static fn () => Connectors::enqueue( 'role', 'tool', null, new JsObject( array( 'delay' => -1 ) ) ) ),
		count( $jobs() ),
	),
	array(
		'/role Connector role must be a non-empty string.',
		'/tool Connector tool must be a non-empty string.',
		'/args Connector arguments must be an object.',
		'/opts/retries Unknown connector option retries.',
		'/key key must be a string of 1 to 191 characters',
		'/delay delay must be a non-negative number of seconds',
		5,
	)
);
$delayed = Connectors::enqueue(
	'fulfilment',
	'create_shipment',
	new JsObject( array( 'order' => 'D-1' ) ),
	new JsObject(
		array(
			'delay' => 120,
			'key'   => \SpacePress\JsUndefined::Value,
		)
	)
);
$row     = $wp->sql( 'SELECT `runAt`, `key` FROM {prefix}sp__jobs WHERE `id` = ?', array( $delayed->p['id'] ) )[0];
eq( 'delay sets when the call runs, and an undefined key is no key', array( strtotime( $row['runAt'] ) >= time() + 115, $row['key'] ), array( true, null ) );

finish( 'connectors' );
