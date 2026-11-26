#!/usr/bin/env node
import { buildFrontend } from '../src/index.mjs';

const [root, ...rest] = process.argv.slice(2);
if (root === '--help' || root === '-h') {
  process.stdout.write('Usage: spacepress-frontend [project]\nBuild browser/index.ts and write sp/_generated/frontend.ts.\n');
} else if (rest.length || root?.startsWith('-')) {
  process.stderr.write('Usage: spacepress-frontend [project]\n');
  process.exitCode = 1;
} else {
  try {
    await buildFrontend({ root });
  } catch (error) {
    process.stderr.write(`spacepress-frontend: ${error.message}\n`);
    process.exitCode = 1;
  }
}
