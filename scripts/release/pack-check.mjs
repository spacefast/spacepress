// Checks what `npm pack` would publish for each of the repository's npm packages: the files a
// package must carry (license texts, README, entry points), and nothing it must not (tests,
// fixtures, environment files, keys, local state, sources of other packages). Reads only the
// file list npm prints and the packed text files' contents; it publishes nothing.
//
//   node scripts/release/pack-check.mjs [--dry-run | <directory with the packed .tgz files>]
//
// --dry-run (the default) runs `npm pack --dry-run --json` in each package, which runs its
// prepack script. With a directory, it reads the tarballs `npm pack` already wrote there.
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));

/** Per package: files that must be in the tarball, and the license npm must report. */
export const PACKAGES = {
  typedpress: {
    directory: 'packages/cli', license: 'MIT',
    required: ['package.json', 'README.md', 'LICENSE', 'bin/typedpress.mjs', 'bin/install.mjs', 'lib/release.mjs', 'lib/commands.json', 'types/index.d.ts'],
  },
  'create-typedpress': {
    directory: 'packages/create-typedpress', license: 'MIT',
    required: ['package.json', 'README.md', 'LICENSE', 'bin/create-typedpress.mjs', 'template/typedpress.config.ts', 'template/gitignore'],
  },
  '@typedpress/astro': {
    directory: 'packages/astro', license: 'MIT',
    required: ['package.json', 'README.md', 'LICENSE', 'src/index.js', 'src/index.d.ts', 'src/emdash/integration.js'],
  },
  '@typedpress/blocks': {
    directory: 'packages/blocks', license: 'MIT AND GPL-2.0-or-later',
    required: ['package.json', 'README.md', 'LICENSE', 'LICENSE-GPL', 'CHANGELOG.md', 'bin/typedpress-blocks.mjs', 'dist/index.js', 'dist/index.d.ts', 'vendor/wp.cjs', 'vendor/NOTICE.md', 'vendor/wp.cjs.LEGAL.txt', 'vendor/licenses/@wordpress/blocks/'],
  },
};

/** Paths no published package may contain. */
const FORBIDDEN = [
  [/(^|\/)(test|tests|__tests__|fixtures?|e2e)\//, 'tests or fixtures'],
  [/\.test\.[cm]?[jt]sx?$/, 'a test file'],
  [/(^|\/)\.env(\.|$)/, 'an environment file'],
  [/(^|\/)(\.npmrc|\.git|\.github|\.tp|\.spacefast|\.claude|node_modules)(\/|$)/, 'local or repository state'],
  [/\.(pem|key|p12|pfx|sqlite|sqlite3|db|sql|log|tgz)$/, 'a key, database, log or tarball'],
  [/(^|\/)(id_rsa|id_ed25519|credentials|secrets?)(\.|$)/i, 'a credential file'],
  [/(^|\/)wp-entry\.mjs$/, 'a build-only bundle entry'],
  [/\.(rs|php)$/, 'compiler or runtime source'],
];

/** Text that must not appear in any packed text file: private keys and common token shapes. */
const SECRETS = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/, 'a private key'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b/, 'a GitHub token'],
  [/\bnpm_[A-Za-z0-9]{36}\b/, 'an npm token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}\b/, 'a Slack token'],
  [/\bsk_live_[A-Za-z0-9]{20,}\b/, 'a Stripe live key'],
  [/\.ts\.net\b|\/home\/[a-z][a-z0-9_-]*\/|\/Users\/[A-Za-z][A-Za-z0-9_-]*\//, 'a private host name or local user path'],
];

/** Problems with one package's packed file list; `read(path)` returns a packed text file. */
export async function check(name, pack, read) {
  const spec = PACKAGES[name];
  const problems = [];
  if (pack.name !== name) problems.push(`packed name is ${pack.name}`);
  const files = pack.files.map((file) => file.path);
  for (const path of spec.required) {
    if (!files.some((file) => path.endsWith('/') ? file.startsWith(path) : file === path)) problems.push(`missing ${path}`);
  }
  for (const file of files) {
    for (const [pattern, what] of FORBIDDEN) if (pattern.test(file)) problems.push(`${file} is ${what}`);
  }
  const manifest = JSON.parse(await read('package.json'));
  if (manifest.license !== spec.license) problems.push(`license is ${manifest.license}, expected ${spec.license}`);
  if (manifest.repository?.url !== 'https://github.com/spacefast/zero.git' || manifest.repository?.directory !== spec.directory) problems.push('repository must name spacefast/zero and the package directory');
  if (!manifest.homepage) problems.push('no homepage');
  if (name.startsWith('@') && manifest.publishConfig?.access !== 'public') problems.push('a scoped package needs publishConfig.access "public"');
  for (const file of files) {
    if (!/\.(m?[jt]sx?|c?js|json|md|txt|astro|d\.ts)$|(^|\/)(LICENSE[^/]*|gitignore|\.editorconfig)$/.test(file)) continue;
    const text = await read(file);
    for (const [pattern, what] of SECRETS) if (pattern.test(text)) problems.push(`${file} contains ${what}`);
  }
  return problems;
}

async function dryRun(name) {
  const directory = join(repo, PACKAGES[name].directory);
  const { stdout } = await exec('npm', ['pack', '--dry-run', '--json', '--ignore-scripts=false'], { cwd: directory, maxBuffer: 64 * 1024 * 1024 });
  const [pack] = JSON.parse(stdout.slice(stdout.indexOf('[')));
  return { pack, read: (path) => readFile(join(directory, path), 'utf8') };
}

async function tarball(directory, name) {
  const prefix = name.replace(/^@/, '').replace('/', '-');
  const files = (await readdir(directory)).filter((file) => new RegExp(`^${prefix}-\\d+\\.\\d+\\.\\d+.*\\.tgz$`).test(file));
  if (files.length !== 1) throw new Error(`Expected one ${prefix}-<version>.tgz in ${directory}, found ${files.length}.`);
  const archive = join(directory, files[0]);
  const { stdout } = await exec('tar', ['-tzf', archive], { maxBuffer: 64 * 1024 * 1024 });
  const paths = stdout.split('\n').filter((line) => line && !line.endsWith('/')).map((line) => line.replace(/^package\//, ''));
  const read = async (path) => (await exec('tar', ['-xOzf', archive, `package/${path}`], { maxBuffer: 256 * 1024 * 1024 })).stdout;
  const manifest = JSON.parse(await read('package.json'));
  return { pack: { name: manifest.name, files: paths.map((path) => ({ path })) }, read };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [source = '--dry-run'] = process.argv.slice(2);
  let failed = false;
  for (const name of Object.keys(PACKAGES)) {
    const { pack, read } = source === '--dry-run' ? await dryRun(name) : await tarball(resolve(source), name);
    const problems = await check(name, pack, read);
    process.stdout.write(`${problems.length ? 'FAIL' : 'ok'}: ${name} (${pack.files.length} files)\n`);
    for (const problem of problems) process.stdout.write(`  ${problem}\n`);
    failed ||= problems.length > 0;
  }
  if (failed) process.exitCode = 1;
}
