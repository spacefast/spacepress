#!/usr/bin/env node
// `zero-pages build [project] [--out <wp-content>] [--json]`
// Runs the TypeScript sources directly (Node 22.18+ strips types), like the package's tests.
import { main } from "../src/cli.ts";

process.exitCode = await main(process.argv.slice(2));
