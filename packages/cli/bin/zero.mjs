#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { compiler, metadata } from '../lib/release.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
  process.stdout.write(`zero ${metadata.version} (npm launcher)\n`);
} else if (args.length === 0 || (args.length === 1 && ['--help', '-h'].includes(args[0]))) {
  process.stdout.write(`Zero ${metadata.version}\n\nUsage: zero <command> [project-dir] [options]\n\n  dev       Start WordPress and watch backend and public files\n  build     Compile the backend and generated TypeScript client\n  check     Check the supported TypeScript backend without writing files\n  doctor    Inspect a built app or a running site\n\n  zero dev stop [project-dir]\n  zero dev status [project-dir]\n  zero dev wp [project-dir] -- <WP-CLI arguments>\n\nCreate an app: npm create @spacefast/zero@${metadata.version} my-app\nLocal compiler: ZERO_BIN=/absolute/path/to/zero\n`);
} else {
  try {
    const child = spawn(await compiler(), args, { stdio: 'inherit' });
    const forward = (signal) => child.kill(signal);
    const interrupt = () => forward('SIGINT');
    const terminate = () => forward('SIGTERM');
    process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
    child.once('error', (error) => { process.stderr.write(`zero: Cannot execute compiler: ${error.message}\n`); process.exitCode = 1; });
    child.once('exit', (code, signal) => {
      process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
      process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
    });
  } catch (error) { process.stderr.write(`zero: ${error.message}\n`); process.exitCode = 1; }
}
