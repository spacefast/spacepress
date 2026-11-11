<?php
/**
 * Author field definition for core plugins fields collection
 *
 * @package First_Admin
 */

return array(
	'type'         => 'text',
	'label'        => __( 'Author', 'first-admin' ),
	'enableHiding' => true,
	'filterBy'     => array(
		'operators' => array( 'contains', 'startsWith', 'is', 'isNot' ),
	),
);
