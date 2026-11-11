<?php
/**
 * First name field definition for core user fields collection
 *
 * @package First_Admin
 */

return array(
	'type'               => 'textarea',
	'label'              => __( 'Biography', 'first-admin' ),
	'description'        => __( 'Biographical information to fill out the user’s profile. This may be shown publicly.', 'first-admin' ),
	'enableSorting'      => true,
	'enableHiding'       => true,
	'enableGlobalSearch' => false,
);
