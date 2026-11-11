<?php
/**
 * Locale field definition for core user fields collection
 *
 * @package First_Admin
 */

return array(
	'type'          => 'text',
	'label'         => __( 'Admin language', 'first-admin' ),
	'enableSorting' => false,
	'filterBy'      => false,
	'enableHiding'  => false,
	'isValid'       => array(
		'required' => true,
	),
);
