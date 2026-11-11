<?php
/**
 * First pages runtime, copied into each generated `first-pages-<app>` plugin.
 *
 * Self-contained on purpose: First core does not depend on the optional pages
 * add-on, and the add-on uses only First's public runtime seams (Runtime::plugin,
 * Db reads with a Viewer, Connection locks/transactions, Extensions::onWrite).
 */
declare(strict_types=1);
defined('ABSPATH') || exit;

foreach (['Request', 'Renderer', 'Routes', 'Plugin'] as $zeroPagesClass) {
    if (!class_exists('First\\Pages\\' . $zeroPagesClass, false)) {
        require_once __DIR__ . '/' . $zeroPagesClass . '.php';
    }
}
unset($zeroPagesClass);
