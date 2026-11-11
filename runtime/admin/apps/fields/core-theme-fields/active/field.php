<?php
/**
 * Active field definition for core theme fields collection
 *
 * @package First_Admin
 */

return array(
	'type'     => 'boolean',
	'label'    => __( 'Active?', 'first-admin' ),
	'filterBy' => false,
	'elements' => array(
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
