#!/usr/bin/env node
import { compiler } from '../lib/release.mjs';

try { await compiler(); }
catch (error) { process.stderr.write(`typedpress: ${error.message}\n`); process.exitCode = 1; }
