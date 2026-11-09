<?php
/**
 * Date field definition for core comments fields collection
 *
 * @package First_Admin
 */

return array(
	'type'          => 'date',
	'header'        => __( 'Posted on', 'first-admin' ),
	'label'         => __( 'Date', 'first-admin' ),
	'enableSorting' => true,
	'filterBy'      => array(
		'operators' => array( 'on', 'beforeInc', 'afterInc', 'between' ),
	),
	'placeholder'   => __( 'No date', 'first-admin' ),
);
