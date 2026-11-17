import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
	...base,
	testMatch: 'coediting.spec.ts',
	timeout: 180_000,
	use: { ...base.use, actionTimeout: 30_000 },
});
