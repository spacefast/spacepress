#!/usr/bin/env node
import { buildFrontend } from '../src/index.mjs';

const [root, ...rest] = process.argv.slice(2);
if (root === '--help' || root === '-h') {
  process.stdout.write('Usage: typedpress-frontend [project]\nBuild browser/index.ts and write tp/_generated/frontend.ts.\n');
} else if (rest.length || root?.startsWith('-')) {
  process.stderr.write('Usage: typedpress-frontend [project]\n');
  process.exitCode = 1;
} else {
  try {
    await buildFrontend({ root });
  } catch (error) {
    process.stderr.write(`typedpress-frontend: ${error.message}\n`);
    process.exitCode = 1;
  }
}
