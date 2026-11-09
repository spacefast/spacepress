<?php
/**
 * Name field definition for core taxonomy term fields collection
 *
 * @package First_Admin
 */

return array(
	'type'               => 'text',
	'label'              => __( 'Name', 'first-admin' ),
	'filterBy'           => false,
	'enableGlobalSearch' => true,
	'enableHiding'       => false,
	'isValid'            => array(
		'required' => true,
	),
);
