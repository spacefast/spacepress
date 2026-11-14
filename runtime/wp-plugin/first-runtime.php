<?php
/**
 * Plugin Name: First Runtime
 * Version: {{firstVersion}}
 * Requires at least: {{wpVersion}}
 * Requires PHP: {{phpVersion}}
 * Requires Plugins: {{runtimeRequires}}
 * License: GPL-2.0-or-later
 */
declare(strict_types=1);
defined('ABSPATH') || exit;
// The runtime's files, by content: what a prebuilt page was rendered with (First\Render\Prebuilt).
defined('FIRST_RUNTIME_HASH') || define('FIRST_RUNTIME_HASH', '{{runtimeHash}}');
require_once __DIR__ . '/first/bootstrap.php';
\First\Wp\Runtime::boot(__FILE__);
