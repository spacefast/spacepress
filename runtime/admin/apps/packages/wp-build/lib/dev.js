#!/usr/bin/env node

import { cpus } from 'node:os';
import { Listr } from 'listr2';
import {
	devRoute,
	devWpModule,
	devDashboardWidget,
	devFieldCollection,
} from './config.js';
import {
	getAllRoutes,
	getAllWpModules,
	getAllDashboardWidgets,
	getAllFieldCollections,
} from './utils.js';
import { generatePhpIndex } from './php-generator.js';

export async function devAll() {
	console.log( '🔧 Starting WordPress plugin development server...\n' );

	const contexts = [];

	// Share a single Dart Sass compiler across all esbuild contexts.
	// Without this, each sassPlugin instance spawns its own Dart VM
	// (75 contexts × 2 plugins = 150 Dart processes, ~2.2 GB RSS).
	const { initAsyncCompiler } = await import( 'sass-embedded' );
	const compiler = await initAsyncCompiler();

	try {
		const concurrent = cpus().length;
		const [ wpModules, dashboardWidgets, routes, fieldCollections ] =
			await Promise.all( [
				getAllWpModules(),
				getAllDashboardWidgets(),
				getAllRoutes(),
				getAllFieldCollections(),
			] );

		// Start WP modules in watch mode
		if ( wpModules.length > 0 ) {
			console.log(
				`👀 Starting watchers for ${ wpModules.length } WP module(s)...`
			);

			const wpModuleTasks = wpModules.map( ( wpModule ) => ( {
				title: wpModule.name,
				task: async () => {
					const wpModuleContext = await devWpModule(
						wpModule.dir,
						wpModule.name,
						wpModule.packageName,
						{ compiler }
					);
					await wpModuleContext.rebuild();
					await wpModuleContext.watch();
					contexts.push( wpModuleContext );
				},
			} ) );

			await new Listr( wpModuleTasks, { concurrent } ).run();

			console.log();
		}

		// Start dashboard widgets in watch mode
		if ( dashboardWidgets.length > 0 ) {
			console.log(
				`👀 Starting watchers for ${ dashboardWidgets.length } dashboard widget(s)...`
			);

			const dashboardWidgetTasks = dashboardWidgets.map( ( widget ) => ( {
				title: widget.name,
				task: async () => {
					const widgetContext = await devDashboardWidget(
						widget.dir,
						widget.name,
						{ compiler }
					);
					await widgetContext.rebuild();
					await widgetContext.watch();
					contexts.push( widgetContext );
				},
			} ) );

			await new Listr( dashboardWidgetTasks, { concurrent } ).run();

			console.log();
		}

		if ( routes.length === 0 ) {
			console.log( 'ℹ️  No routes found to watch\n' );
		} else {
			console.log(
				`👀 Starting watchers for ${ routes.length } route(s)...`
			);

			// Start all route watchers
			await new Listr(
				routes.map( ( route ) => ( {
					title: route.name,
					task: async () => {
						const routeContexts = await devRoute(
							route.dir,
							route.name,
							{ compiler }
						);
						contexts.push( ...routeContexts );
					},
				} ) ),
				{ concurrent }
			).run();

			console.log();
		}

		// Start field collections in watch mode
		if ( fieldCollections.length > 0 ) {
			console.log(
				`👀 Starting watchers for ${ fieldCollections.length } field collection(s)...`
			);

			const fieldCollectionTasks = fieldCollections.map(
				( collection ) => ( {
					title: collection.name,
					task: async () => {
						const collectionContext = await devFieldCollection(
							collection.dir,
							collection.name,
							{ compiler }
						);
						await collectionContext.rebuild();
						await collectionContext.watch();
						contexts.push( collectionContext );
					},
				} )
			);

			await new Listr( fieldCollectionTasks, { concurrent } ).run();

			console.log();
		}

		// Generate PHP index file
		console.log( '📝 Generating build/index.php...' );
		await generatePhpIndex();

		console.log( '\n🎉 Development server started successfully!' );
		console.log( '📝 Watching for changes... (Press Ctrl+C to stop)' );

		// Setup graceful shutdown
		const cleanup = async () => {
			console.log( '\n🛑 Shutting down development server...' );

			try {
				await Promise.all( contexts.map( ( ctx ) => ctx.dispose() ) );
				await compiler.dispose();
				console.log( '✅ All watchers stopped successfully' );
				process.exit( 0 );
			} catch ( error ) {
				console.error( '❌ Error during cleanup:', error.message );
				process.exit( 1 );
			}
		};

		// Handle signals
		process.on( 'SIGINT', cleanup );
		process.on( 'SIGTERM', cleanup );
		process.on( 'SIGQUIT', cleanup );

		// Keep the process alive
		return new Promise( () => {
			// This promise never resolves, keeping the process running
		} );
	} catch ( error ) {
		console.error(
			'\n❌ Development server failed to start:',
			error.message
		);

		// Cleanup any started contexts and the shared compiler
		console.log( '🧹 Cleaning up...' );
		try {
			await Promise.all( contexts.map( ( ctx ) => ctx.dispose() ) );
			await compiler.dispose();
		} catch ( cleanupError ) {
			console.error( '❌ Error during cleanup:', cleanupError.message );
		}

		process.exit( 1 );
	}
}
