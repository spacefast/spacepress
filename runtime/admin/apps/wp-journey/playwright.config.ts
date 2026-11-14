import process from 'node:process';
import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({
	testDir: '.',
	testMatch: [ 'admin.spec.ts', 'screens.spec.ts' ],
	workers: 1,
	retries: 0,
	timeout: 90000,
	expect: { timeout: 20000 },
	reporter: 'list',
	outputDir:
		process.env.FIRST_ADMIN_BROWSER_OUTPUT ??
		join(tmpdir(), 'first-admin-browser'),
	use: {
		browserName: 'chromium',
		headless: true,
		viewport: { width: 1440, height: 1000 },
		screenshot: 'on',
		trace: 'retain-on-failure',
	},
});
