#!/usr/bin/env node
import { compiler } from '../lib/release.mjs';

try { await compiler(); }
catch (error) { process.stderr.write(`spacepress: ${error.message}\n`); process.exitCode = 1; }
