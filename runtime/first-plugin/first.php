<?php
/**
 * Plugin Name: First
 * Description: Runs a First app on this site. Activating it installs the plugins First needs; then deploy from a project with `first login` and `first push`.
 * Version: {{firstVersion}}
 * Requires at least: {{wpVersion}}
 * Requires PHP: {{phpVersion}}
 * License: GPL-2.0-or-later
 */
declare(strict_types=1);
defined('ABSPATH') || exit;

define('FIRST_PLUGIN_VERSION', '{{firstVersion}}');
// The plugin's files, by content: `first push` replaces a plugin that isn't the one it carries.
define('FIRST_PLUGIN_HASH', '{{pluginHash}}');
define('FIRST_PLUGIN_FILE', __FILE__);

require_once __DIR__ . '/src/Site.php';
require_once __DIR__ . '/src/Trees.php';
require_once __DIR__ . '/src/Mount.php';
require_once __DIR__ . '/src/Requirements.php';
require_once __DIR__ . '/src/Receiver.php';
require_once __DIR__ . '/src/Setup.php';
require_once __DIR__ . '/src/Deployments.php';

// The site's live build mounts once every plugin has loaded, before WordPress initializes. A build
// that can't mount leaves WordPress serving and is reported on the First screen.
\FirstPlugin\Site::register();
\FirstPlugin\Mount::run();
\FirstPlugin\Receiver::register();
\FirstPlugin\Setup::register();
\FirstPlugin\Deployments::register();
register_activation_hook(__FILE__, [\FirstPlugin\Setup::class, 'activated']);
