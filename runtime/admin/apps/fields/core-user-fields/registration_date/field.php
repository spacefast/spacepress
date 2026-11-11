<?php
/**
 * Registration Date field definition for core user fields collection
 *
 * @package First_Admin
 */

return array(
	'type'          => 'date',
	'label'         => __( 'Registration Date', 'first-admin' ),
	'enableSorting' => true,
	'filterBy'      => array(
		'operators' => array( 'on', 'before', 'after', 'between' ),
	),
);
