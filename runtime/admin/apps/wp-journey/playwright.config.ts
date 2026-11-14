import process from 'node:process';
import { defineConfig } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A fresh folder per run under <tmp>/first-admin-browser (the folder CI uploads on failure), named
// <FIRST_ADMIN_BROWSER_RUN or run>-<random>, so two lanes running the journey at once don't clean
// or overwrite each other's traces and snapshots.
// Chosen once in the runner and passed to the workers through the environment, which they inherit.
if ( ! process.env.FIRST_ADMIN_BROWSER_OUTPUT ) {
	const parent = join( tmpdir(), 'first-admin-browser' );
	mkdirSync( parent, { recursive: true } );
	process.env.FIRST_ADMIN_BROWSER_OUTPUT = mkdtempSync(
		join( parent, `${ process.env.FIRST_ADMIN_BROWSER_RUN ?? 'run' }-` )
	);
	console.log( `browser journey output: ${ process.env.FIRST_ADMIN_BROWSER_OUTPUT }` );
}
export default defineConfig({
	testDir: '.',
	testMatch: [ 'admin.spec.ts', 'screens.spec.ts' ],
	workers: 1,
	retries: 0,
	timeout: 90000,
	expect: { timeout: 20000 },
	reporter: 'list',
	outputDir: process.env.FIRST_ADMIN_BROWSER_OUTPUT,
	use: {
		browserName: 'chromium',
		headless: true,
		viewport: { width: 1440, height: 1000 },
		screenshot: 'on',
		trace: 'retain-on-failure',
	},
});
