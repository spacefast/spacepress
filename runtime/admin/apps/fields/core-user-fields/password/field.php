<?php
/**
 * Password field definition for core user fields collection
 *
 * @package First_Admin
 */

return array(
	'type'          => 'password',
	'label'         => __( 'Password', 'first-admin' ),
	'enableSorting' => true,
	'enableHiding'  => false,
	'isValid'       => array(
		'required' => true,
	),
);
