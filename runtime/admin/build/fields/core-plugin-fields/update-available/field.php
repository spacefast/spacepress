<?php
/**
 * Description field definition for core plugins fields collection
 *
 * @package First_Admin
 */

return array(
	'type'         => 'boolean',
	'label'        => __( 'Update Available', 'first-admin' ),
	'enableHiding' => true,
	'filterBy'     => array(
		'operators' => array( 'is', 'isNot' ),
	),
	'elements'     => array(
		array(
			'value' => true,
			'label' => __( 'Yes', 'first-admin' ),
		),
		array(
			'value' => false,
			'label' => __( 'No', 'first-admin' ),
		),
	),
);
