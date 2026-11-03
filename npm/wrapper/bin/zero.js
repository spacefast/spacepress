#!/usr/bin/env node
// Runs the platform binary with this process's arguments, stdio and exit status.
import { spawnSync } from "node:child_process";
import { binaryPath } from "../index.js";

let binary;
try {
  binary = binaryPath();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const result = spawnSync(binary, process.argv.slice(2), { stdio: "inherit" });
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
