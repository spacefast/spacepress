<?php
/**
 * Auto update field definition for core plugins fields collection
 *
 * @package First_Admin
 */

// TODO: Add the field to core-data types, and re-implement this field spec.
return array(
	'type'         => 'boolean',
	'label'        => __( 'Auto-Updates', 'first-admin' ),
	'enableHiding' => true,
	'filterBy'     => array(
		'operators' => array( 'is', 'isNot' ),
	),
	'elements'     => array(
		array(
			'value' => true,
			'label' => __( 'Enabled', 'first-admin' ),
		),
		array(
			'value' => false,
			'label' => __( 'Disabled', 'first-admin' ),
		),
	),
);
