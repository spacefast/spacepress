import { opendir, readFile } from 'node:fs/promises';
import path from 'path';

/**
 * Get all routes from the routes directory.
 */
export async function getAllRoutes() {
	const routesDir = 'routes';
	const routes = [];

	let entries;
	try {
		entries = await opendir( routesDir );
	} catch {
		return routes;
	}

	// Collect all directory entries first, then sort for deterministic output.
	const allEntries = [];
	for await ( const entry of entries ) {
		if ( entry.isDirectory() ) {
			allEntries.push( entry );
		}
	}
	allEntries.sort( ( a, b ) => a.name.localeCompare( b.name ) );

	for ( const entry of allEntries ) {
		const routeDir = path.join( routesDir, entry.name );
		const packageJsonPath = path.join( routeDir, 'package.json' );

		try {
			const packageJson = JSON.parse(
				await readFile( packageJsonPath, 'utf8' )
			);
			const routePath = packageJson.route?.path;

			routes.push( {
				name: entry.name,
				dir: routeDir,
				path: routePath,
			} );
		} catch ( error ) {
			console.warn(
				`Failed to read package.json for route ${ entry.name }:`,
				error.message
			);
		}
	}
	return routes;
}

/**
 * Get all dashboard widgets from the dashboard-widgets directory.
 */
export async function getAllDashboardWidgets() {
	const dashboardWidgets = [];
	const dashboardWidgetsDir = 'dashboard-widgets';

	try {
		const dashboardWidgetsEntries = await opendir( dashboardWidgetsDir );

		// Collect all directory entries first, then sort for deterministic output.
		const allEntries = [];
		for await ( const entry of dashboardWidgetsEntries ) {
			if ( entry.isDirectory() ) {
				allEntries.push( entry );
			}
		}
		allEntries.sort( ( a, b ) => a.name.localeCompare( b.name ) );

		for ( const entry of allEntries ) {
			dashboardWidgets.push( {
				name: entry.name,
				dir: path.join( dashboardWidgetsDir, entry.name ),
			} );
		}
	} catch {
		// dashboard-widgets directory doesn't exist
	}

	return dashboardWidgets;
}

/**
 * Get all WP modules from the packages directory.
 */
export async function getAllWpModules() {
	const packagesDir = 'packages';
	const wpModules = [];

	let entries;
	try {
		entries = await opendir( packagesDir );
	} catch {
		return wpModules;
	}

	// Collect all directory entries first, then sort for deterministic output.
	const allEntries = [];
	for await ( const entry of entries ) {
		if ( entry.isDirectory() ) {
			allEntries.push( entry );
		}
	}
	allEntries.sort( ( a, b ) => a.name.localeCompare( b.name ) );

	for ( const entry of allEntries ) {
		const packageDir = path.join( packagesDir, entry.name );
		const packageJsonPath = path.join( packageDir, 'package.json' );

		try {
			const packageJson = JSON.parse(
				await readFile( packageJsonPath, 'utf8' )
			);

			if ( packageJson.wpModule === true ) {
				wpModules.push( {
					name: entry.name,
					dir: packageDir,
					packageName: packageJson.name,
				} );
			}
		} catch ( error ) {
			console.warn(
				`Failed to read package.json for package ${ entry.name }:`,
				error.message
			);
		}
	}

	return wpModules;
}

/**
 * Get all field collections from the fields directory.
 */
export async function getAllFieldCollections() {
	const fieldsDir = 'fields';
	const fieldCollections = [];

	let entries;
	try {
		entries = await opendir( fieldsDir );
	} catch {
		return fieldCollections;
	}

	// Collect all directory entries first, then sort for deterministic output.
	const allEntries = [];
	for await ( const entry of entries ) {
		if ( entry.isDirectory() ) {
			allEntries.push( entry );
		}
	}
	allEntries.sort( ( a, b ) => a.name.localeCompare( b.name ) );

	for ( const entry of allEntries ) {
		const collectionDir = path.join( fieldsDir, entry.name );
		const indexPhpPath = path.join( collectionDir, 'index.php' );
		const packageJsonPath = path.join( collectionDir, 'package.json' );

		// Check if it has both required files
		try {
			await readFile( indexPhpPath, 'utf8' );
			await readFile( packageJsonPath, 'utf8' );

			fieldCollections.push( {
				name: entry.name,
				dir: collectionDir,
			} );
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
		} catch ( error ) {
			console.warn(
				`Skipping field collection ${ entry.name }: missing index.php or package.json`
			);
		}
	}

	return fieldCollections;
}
