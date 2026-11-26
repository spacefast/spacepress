#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';

const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const help = `Create SpacePress ${metadata.version}\n\nUsage: npm create spacepress@${metadata.version} <directory> [-- --no-install] [-- --dir <app-dir>]\n\nCreates a starter site with pages and sample content, served by WordPress. Installs npm dependencies\nunless --no-install is supplied, then writes AGENTS.md, .mcp.json and skills for coding\nagents (spacepress init). Existing destinations are never overwritten.\n\nOptions:\n  --dir <folder>   App directory inside the project (default: sp)\n  --no-install     Skip npm install\n\nNext: cd <directory> && npm run dev\nRequires Node.js 22+ and npm. No Rust toolchain or Docker required.\n`;

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
  let noInstall = false;
  let appDir = 'sp';
  const directories = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-install') {
      noInstall = true;
    } else if (arg === '--dir') {
      const value = args[++i];
      if (!value || value.startsWith('-')) throw new Error('--dir requires a relative folder name (e.g. --dir cms)');
      appDir = value;
    } else if (arg.startsWith('--dir=')) {
      appDir = arg.slice('--dir='.length);
    } else if (arg.startsWith('-')) {
      throw new Error(help);
    } else {
      directories.push(arg);
    }
  }
  if (directories.length !== 1) throw new Error(help);
  if (!appDir || appDir.startsWith('/') || appDir.endsWith('/') || appDir.includes('\\') || appDir.split('/').some((s) => !s || s === '.' || s === '..' || s.startsWith('.') || s === 'node_modules') || ['public', 'emails'].includes(appDir.split('/')[0])) {
    throw new Error(`Invalid --dir "${appDir}": use a clean relative folder name like "sp" or "cms".`);
  }
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
    if (appDir !== 'sp') {
      const targetDir = join(destination, appDir);
      await mkdir(resolve(targetDir, '..'), { recursive: true });
      await rename(join(destination, 'sp'), targetDir);
      for (const file of ['.gitignore', 'tsconfig.json', 'README.md']) {
        const p = join(destination, file);
        const text = await readFile(p, 'utf8');
        await writeFile(
          p,
          text
            .replaceAll('sp/dist', `${appDir}/dist`)
            .replaceAll('sp/_generated', `${appDir}/_generated`)
            .replaceAll('./sp/_generated', `./${appDir}/_generated`)
            .replaceAll('sp/app', `${appDir}/app`)
            .replaceAll('"sp"', JSON.stringify(appDir))
            .replaceAll('`sp/`', `\`${appDir}/\``),
        );
      }
      const cfgPath = join(destination, 'spacepress.config.ts');
      const cfg = await readFile(cfgPath, 'utf8');
      await writeFile(
        cfgPath,
        cfg.replace('name: "__SP_APP_NAME__",', `name: "__SP_APP_NAME__",\n  dir: ${JSON.stringify(appDir)},`),
      );
    }
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
  if (!noInstall) {
    const code = await new Promise((done, fail) => {
      const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--include=dev', '--no-audit', '--no-fund'], { cwd: destination, stdio: 'inherit' });
      child.once('error', fail); child.once('exit', (code) => done(code));
    });
    if (code !== 0) throw new Error(`App created at ${destination}, but npm install failed. Fix the reported download/tool error, then run npm install there. Your app was preserved.`);
  }
  const agents = await agentFiles(destination, !noInstall);
  process.stdout.write(`\nCreated ${name}.\n\n  cd ${JSON.stringify(directories[0])}\n${noInstall ? '  npm install\n' : ''}${agents ? '' : '  npx spacepress init    # AGENTS.md, .mcp.json and skills for coding agents\n'}  npm run dev\n\nOpen the Website URL printed by SpacePress.\nStart by editing ${appDir}/app/page.tsx. See README.md for the other starter files.\n${agents ? 'AGENTS.md, .mcp.json and the agent skills describe this project to coding agents; run npx spacepress init after changing the config.\n' : ''}`);
}

main().catch((error) => { process.stderr.write(`create-spacepress: ${error.message}\n`); process.exitCode = 1; });
