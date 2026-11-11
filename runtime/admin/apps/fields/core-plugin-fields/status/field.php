<?php
/**
 * Status field definition for core plugins fields collection
 *
 * @package First_Admin
 */

return array(
	'type'         => 'text',
	'label'        => __( 'Status', 'first-admin' ),
	'enableHiding' => true,
	'filterBy'     => array(
		'operators' => array( 'isAny', 'isNone' ),
	),
	'elements'     => array(
		array(
			'value' => 'active',
			'label' => __( 'Active', 'first-admin' ),
		),
		array(
			'value' => 'inactive',
			'label' => __( 'Inactive', 'first-admin' ),
		),
	),
);
