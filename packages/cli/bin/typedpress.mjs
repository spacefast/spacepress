#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { compiler, metadata } from '../lib/release.mjs';

// The compiler's command table (runtime/TypedPress/Cli/commands.json), so help works before a download.
function help() {
  const packaged = new URL('../lib/commands.json', import.meta.url);
  const checkout = new URL('../../../runtime/TypedPress/Cli/commands.json', import.meta.url);
  let table;
  try { table = JSON.parse(readFileSync(packaged, 'utf8')); } catch { table = JSON.parse(readFileSync(checkout, 'utf8')); }
  const width = Math.max(...[...table.build, ...table.site].map((row) => row.name.length));
  const group = (title, rows) => `${title}:\n${rows.map((row) => `  ${row.name.padEnd(width)}  ${row.summary}`).join('\n')}\n`;
  return `usage: typedpress <command> [options]\n\n${group('Build', table.build)}\n${group('Site (wp typedpress <command>; --site <dir | workspace | @alias>)', table.site)}`;
}

const args = process.argv.slice(2);
if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
  process.stdout.write(`typedpress ${metadata.version} (npm launcher)\n`);
} else if (args.length === 0 || (args.length === 1 && ['--help', '-h', 'help'].includes(args[0]))) {
  process.stdout.write(`TypedPress ${metadata.version}\n\n${help()}\nCreate an app: npm create typedpress@${metadata.version} my-app\nLocal compiler: TP_BIN=/absolute/path/to/typedpress\n`);
} else {
  try {
    const child = spawn(await compiler(), args, { stdio: 'inherit' });
    const forward = (signal) => child.kill(signal);
    const interrupt = () => forward('SIGINT');
    const terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.once('error', (error) => { process.stderr.write(`typedpress: Cannot execute compiler: ${error.message}\n`); process.exitCode = 1; });
    child.once('exit', (code, signal) => {
      process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
      process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
    });
  } catch (error) { process.stderr.write(`typedpress: ${error.message}\n`); process.exitCode = 1; }
}
