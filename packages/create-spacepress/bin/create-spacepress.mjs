#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';

const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const help = `Create SpacePress ${metadata.version}\n\nUsage: npm create spacepress@${metadata.version} <directory> [-- --no-install]\n\nCreates a starter site with pages and sample content, served by WordPress. Installs npm dependencies\nunless --no-install is supplied, then writes AGENTS.md, .mcp.json and skills for coding\nagents (spacepress init). Existing destinations are never overwritten.\n\nNext: cd <directory> && npm run dev\nRequires Node.js 22+ and npm. No Rust toolchain or Docker required.\n`;

// The files a coding agent reads (AGENTS.md, .mcp.json, the skills) come from `spacepress init`, so a new
// project gets the same ones a later `spacepress init` writes, generated from its own config. The
// compiler is the one npm just installed, or SP_BIN when the install was skipped.
async function agentFiles(destination, installed) {
  const first = installed ? join(destination, 'node_modules/.bin', process.platform === 'win32' ? 'spacepress.cmd' : 'spacepress')
    : isAbsolute(process.env.SP_BIN ?? '') ? process.env.SP_BIN : null;
  if (!first) return false;
  return new Promise((done) => {
    const child = spawn(first, ['init', destination], { stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
    child.once('error', () => done(false)); child.once('exit', (code) => done(code === 0));
  });
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) { process.stdout.write(`${metadata.version}\n`); return; }
  if (!args.length || args.includes('--help') || args.includes('-h')) { process.stdout.write(help); return; }
  const directories = args.filter((arg) => !arg.startsWith('-'));
  if (directories.length !== 1 || args.some((arg) => arg.startsWith('-') && arg !== '--no-install')) throw new Error(help);
  const destination = resolve(directories[0]);
  const name = basename(destination).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!name || name.length > 100 || ['node-modules', 'favicon-ico'].includes(name)) throw new Error('Choose a directory name containing letters or numbers (at most 100 characters).');
  try { await mkdir(destination); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Destination already exists: ${destination}. Choose a new directory; nothing was overwritten.`);
    throw error;
  }
  try {
    const template = new URL('../template/', import.meta.url);
    for (const entry of await readdir(template)) {
      await cp(new URL(entry, template), join(destination, entry), { recursive: true, force: false, errorOnExist: true });
    }
    await rename(join(destination, 'gitignore'), join(destination, '.gitignore'));
    for (const file of ['spacepress.config.ts', 'README.md']) {
      const path = join(destination, file);
      await writeFile(path, (await readFile(path, 'utf8')).replaceAll('__SP_APP_NAME__', name));
    }
    await writeFile(join(destination, 'package.json'), JSON.stringify({
      name, version: '0.0.0', private: true, type: 'module', engines: { node: '>=22' },
      scripts: {
        dev: 'spacepress dev', build: 'spacepress build', check: 'spacepress check',
        typecheck: 'spacepress build --quiet && tsc --noEmit',
        stop: 'spacepress dev stop', status: 'spacepress dev status', wp: 'spacepress wp',
      },
      devDependencies: { 'spacepress': process.env.SP_CLI_PACKAGE || metadata.version, '@types/node': '22.19.17', typescript: '5.9.3' },
    }, null, 2) + '\n', { flag: 'wx' });
  } catch (error) {
    await rm(destination, { recursive: true });
    throw error;
  }
  if (!args.includes('--no-install')) {
    const code = await new Promise((done, fail) => {
      const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--include=dev', '--no-audit', '--no-fund'], { cwd: destination, stdio: 'inherit' });
      child.once('error', fail); child.once('exit', (code) => done(code));
    });
    if (code !== 0) throw new Error(`App created at ${destination}, but npm install failed. Fix the reported download/tool error, then run npm install there. Your app was preserved.`);
  }
  const agents = await agentFiles(destination, !args.includes('--no-install'));
  process.stdout.write(`\nCreated ${name}.\n\n  cd ${JSON.stringify(directories[0])}\n${args.includes('--no-install') ? '  npm install\n' : ''}${agents ? '' : '  npx spacepress init    # AGENTS.md, .mcp.json and skills for coding agents\n'}  npm run dev\n\nOpen the Website URL printed by SpacePress.\nStart by editing sp/app/page.tsx. See README.md for the other starter files.\n${agents ? 'AGENTS.md, .mcp.json and the agent skills describe this project to coding agents; run npx spacepress init after changing the config.\n' : ''}`);
}

main().catch((error) => { process.stderr.write(`create-spacepress: ${error.message}\n`); process.exitCode = 1; });
