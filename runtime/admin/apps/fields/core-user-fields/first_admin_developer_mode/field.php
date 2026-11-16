<?php
/**
 * Developer mode (First): classic wp-admin opens on its own and First Admin's sidebar links to it.
 * Saved as the user's `first_admin_developer_mode` meta through core's user route (lib/classic-route.php).
 *
 * @package First_Admin
 */

return array(
	'type'          => 'boolean',
	'label'         => __( 'Developer mode', 'first-admin' ),
	'description'   => __( 'Open classic wp-admin on its own and show it in the sidebar. Off, its pages open inside First Admin.', 'first-admin' ),
	'enableSorting' => false,
	'filterBy'      => false,
	'enableHiding'  => false,
);
