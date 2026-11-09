<?php
/**
 * Author field definition for core theme fields collection
 *
 * @package First_Admin
 */

return array(
	'type'               => 'text',
	'label'              => __( 'Author', 'first-admin' ),
	'enableSorting'      => false,
	'enableGlobalSearch' => true,
	'filterBy'           => array(
		'operators' => array( 'isAny', 'isNone' ),
	),
);
