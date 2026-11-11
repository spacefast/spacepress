#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { buildAll } from '../lib/build.js';
import { devAll } from '../lib/dev.js';

function showHelp() {
	console.log( `
@first-admin/wp-build - WordPress Plugin Build Tool

Usage:
  wp-build <command>

Commands:
  build    Build for production
  dev      Start development server with watch mode
  help     Show this help message

Options:
	--meta   Generate \`meta.json\` files for each build
	--meta                Generate per-target \`meta.json\` files
	--meta-out <filepath> Aggregate all per-target metafiles into one JSON file

Examples:
  wp-build build
  wp-build dev
  wp-build --meta build
  wp-build --meta --meta-out build/meta.json build
` );
}

async function main() {
	const options = {
		meta: {
			type: 'boolean',
		},
		'meta-out': {
			type: 'string',
		},
	};

	const { positionals, values } = parseArgs( {
		options,
		allowPositionals: true,
	} );
	const command = positionals[ 0 ];

	switch ( command ) {
		case 'build':
			await buildAll( {
				meta: values.meta,
				metaOut: values[ 'meta-out' ],
			} );
			break;
		case 'dev':
			await devAll();
			break;
		case 'help':
		case '--help':
		case '-h':
			showHelp();
			break;
		default:
			console.error( `Unknown command: ${ command || '(none)' }` );
			showHelp();
			process.exit( 1 );
	}
}

main().catch( ( error ) => {
	console.error( '❌ wp-build failed:', error );
	process.exit( 1 );
} );
