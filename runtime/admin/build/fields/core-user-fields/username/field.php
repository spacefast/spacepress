<?php
/**
 * Username field definition for core user fields collection
 *
 * @package First_Admin
 */

return array(
	'type'               => 'text',
	'label'              => __( 'Username', 'first-admin' ),
	'enableSorting'      => true,
	'enableHiding'       => false,
	'enableGlobalSearch' => true,
	'isValid'            => array(
		'required' => true,
	),
);
