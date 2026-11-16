/**
 * Main entry point for @typedpress-admin/wp-build package
 */

export { buildAll } from './build.js';
export { devAll } from './dev.js';
export {
	buildScript,
	devScript,
	buildRoute,
	devRoute,
	buildWpModule,
	devWpModule,
} from './config.js';
export { getAllRoutes, getAllWpModules } from './utils.js';
export { generatePhpIndex } from './php-generator.js';
