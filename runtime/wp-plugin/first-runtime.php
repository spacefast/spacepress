<?php
/**
 * Plugin Name: First Runtime
 * Version: {{firstVersion}}
 * Requires at least: {{wpVersion}}
 * Requires PHP: {{phpVersion}}
 * Requires Plugins: secure-custom-fields, action-scheduler, mcp-adapter
 * License: GPL-2.0-or-later
 */
declare(strict_types=1);
defined('ABSPATH') || exit;
require_once __DIR__ . '/first/bootstrap.php';
\First\Wp\Runtime::boot(__FILE__);
