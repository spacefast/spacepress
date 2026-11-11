<?php
/**
 * Tags field definition for core theme fields collection
 *
 * @package First_Admin
 */

return array(
	'type'               => 'array',
	'label'              => __( 'Tags', 'first-admin' ),
	'enableGlobalSearch' => true,
	'enableSorting'      => false,
	'filterBy'           => array(
		'operators' => array( 'isAny', 'isNone', 'isAll', 'isNotAll' ),
	),
);
