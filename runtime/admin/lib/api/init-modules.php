<?php
/**
 * First Admin SPA
 *
 * This file provides the API for registering init modules in the First Admin SPA.
 *
 * @package First_Admin
 */

// Global storage for registered init modules.
global $first_admin_init_modules;
$first_admin_init_modules = array();

/**
 * Register a module for the First Admin SPA. These are loaded during boot.
 *
 * @since 1.0.0
 *
 * @param array $module The module data.
 */
function first_admin_register_init_module( $module ) {
	global $first_admin_init_modules;
	$first_admin_init_modules[] = $module;
}

/**
 * Get all registered init modules.
 *
 * @return array Array of registered init modules.
 */
function first_admin_get_init_modules() {
	global $first_admin_init_modules;
	return $first_admin_init_modules;
}
