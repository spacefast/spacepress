<?php
/**
 * Email field definition for core user fields collection
 *
 * @package First_Admin
 */

return array(
	'type'          => 'email',
	'label'         => __( 'Email', 'first-admin' ),
	'enableSorting' => true,
	'isValid'       => array(
		'required' => true,
	),
);
