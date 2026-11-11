<?php
/**
 * Status field definition for core comments fields collection
 *
 * @package First_Admin
 */

$first_admin_comment_statuses = array(
	array(
		'value' => 'approved',
		'label' => __( 'Approved', 'first-admin' ),
	),
	array(
		'value' => 'hold',
		'label' => __( 'Unapproved', 'first-admin' ),
	),
	array(
		'value' => 'spam',
		'label' => __( 'Spam', 'first-admin' ),
	),
	array(
		'value' => 'trash',
		'label' => __( 'Trash', 'first-admin' ),
	),
);

return array(
	'type'          => 'select',
	'label'         => __( 'Status', 'first-admin' ),
	'enableSorting' => false,
	'filterBy'      => false,
	'elements'      => $first_admin_comment_statuses,
);
