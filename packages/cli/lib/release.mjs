import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { constants, createReadStream } from 'node:fs';
import { access, chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
export const targets = Object.freeze({
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
});

export function releaseTarget({ platform = process.platform, arch = process.arch } = {}) {
  const target = targets[`${platform}-${arch}`];
  if (!target) throw new Error(`No prebuilt First compiler for ${platform}/${arch}. Supported: macOS and glibc Linux, arm64 or x64. Set FIRST_BIN to an absolute path to your own compatible compiler.`);
  if (platform === 'linux' && platform === process.platform && arch === process.arch) {
    const glibc = process.report.getReport().header.glibcVersionRuntime;
    const [major, minor] = (glibc || '').split('.').map(Number);
    if (!glibc || major < 2 || (major === 2 && minor < 39)) throw new Error('The Linux download requires glibc 2.39+ (Ubuntu 24.04 or newer). On older glibc or musl/Alpine, provide a compatible compiler with FIRST_BIN.');
  }
  return target;
}

export function assetName({ version = metadata.version, target }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid First release version: ${version}`);
  if (![...Object.values(targets), "aarch64-unknown-linux-musl", "x86_64-unknown-linux-musl", "x86_64-pc-windows-msvc"].includes(target)) throw new Error(`Unsupported First release target: ${target}`);
  return `first-v${version}-${target}.tar.gz`;
}

function baseURL(env, version) {
  const url = new URL(env.FIRST_RELEASE_BASE_URL || `https://github.com/spacefast/zero/releases/download/v${version}/`);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  if (!['https:', 'file:'].includes(url.protocol) && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw new Error('FIRST_RELEASE_BASE_URL must use HTTPS, file://, or loopback HTTP for a local release test.');
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('Release base URLs cannot contain credentials, queries or fragments.');
  return url;
}

async function download(url, destination, maxBytes) {
  const output = await open(destination, 'wx', 0o600);
  let length = 0;
  try {
    if (url.protocol === 'file:') {
      for await (const chunk of createReadStream(fileURLToPath(url))) {
          length += chunk.byteLength;
          if (length > maxBytes) throw new Error('Release asset exceeds the download size limit.');
          await output.writeFile(chunk);
      }
    } else {
      let location = url;
      let response;
      for (let redirects = 0; redirects <= 5; redirects++) {
        if (location.protocol !== 'https:' && !(location.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname))) throw new Error('Refusing an insecure release redirect.');
        if (location.username || location.password) throw new Error('Refusing a release redirect with embedded credentials.');
        response = await fetch(location, { signal: AbortSignal.timeout(120000), redirect: 'manual' });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        await response.body?.cancel();
        const next = response.headers.get('location');
        if (!next || redirects === 5) throw new Error('Invalid or excessive release redirects.');
        location = new URL(next, location);
      }
      if (!response.ok) throw new Error(`Release asset unavailable (HTTP ${response.status}): ${url}`);
      for await (const chunk of response.body) {
        length += chunk.byteLength;
        if (length > maxBytes) throw new Error('Release asset exceeds the download size limit.');
        await output.writeFile(chunk);
      }
    }
  } finally { await output.close(); }
}

async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function executable(path) {
  if (!(await lstat(path)).isFile()) throw new Error(`Compiler is not a regular file: ${path}`);
  await access(path, constants.X_OK);
  return path;
}

async function cached(directory, { version, target }) {
  try {
    if (!(await lstat(directory)).isDirectory()) throw new Error(`Compiler cache must be a real directory: ${directory}`);
  } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  try {
    const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
    const binary = join(directory, 'first');
    if (receipt.version !== version || receipt.target !== target || receipt.binarySha256 !== await digest(binary)) {
      throw new Error(`Cached First compiler failed integrity verification. Inspect and remove ${directory}, then retry.`);
    }
    return await executable(binary);
  } catch (error) {
    throw new Error(`Cannot use cached First at ${directory}: ${error.message}. Inspect and remove this cache entry before retrying.`);
  }
}

export async function compiler({ env = process.env } = {}) {
  if (env.FIRST_BIN) {
    if (!isAbsolute(env.FIRST_BIN)) throw new Error('FIRST_BIN must be an absolute path to a provided First compiler, not a command or relative path.');
    try { return await executable(env.FIRST_BIN); }
    catch (error) { throw new Error(`Cannot use FIRST_BIN=${env.FIRST_BIN}: ${error.message}`); }
  }
  const version = metadata.version;
  const target = releaseTarget();
  const cache = env.FIRST_CACHE_DIR || join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'first/npm');
  if (!isAbsolute(cache)) throw new Error('FIRST_CACHE_DIR and XDG_CACHE_HOME must be absolute paths.');
  const directory = join(cache, version, target);
  const installed = await cached(directory, { version, target });
  if (installed) return installed;
  if (env.FIRST_OFFLINE === '1' || env.npm_config_offline === 'true') {
    throw new Error(`First ${version} (${target}) is not cached and downloads are disabled. Supply FIRST_BIN or install once while online.`);
  }
  const name = assetName({ version, target });
  const base = baseURL(env, version);
  const temporary = await mkdtemp(join(tmpdir(), 'first-download-'));
  let stage;
  try {
    const archive = join(temporary, name);
    const checksum = join(temporary, 'checksum');
    await download(new URL(`${name}.sha256`, base), checksum, 4096);
    const entry = (await readFile(checksum, 'utf8')).trim().split(/\s+/);
    if (entry.length !== 2 || !/^[a-f0-9]{64}$/.test(entry[0]) || entry[1] !== name) throw new Error(`Invalid SHA-256 receipt for ${name}.`);
    await download(new URL(name, base), archive, 256 * 1024 * 1024);
    if (await digest(archive) !== entry[0]) throw new Error(`SHA-256 checksum mismatch for ${name}; no compiler was installed.`);
    await mkdir(dirname(directory), { recursive: true });
    stage = `${directory}.${randomUUID()}.tmp`;
    await mkdir(stage, { mode: 0o700 });
    // Stream only the named regular payload; never extract archive paths or symlinks.
    const { stdout } = await exec('tar', ['-xOzf', archive, 'first'], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
    if (!stdout.length) throw new Error('Release archive contains an empty compiler.');
    const binary = join(stage, 'first');
    await writeFile(binary, stdout, { flag: 'wx', mode: 0o755 });
    await chmod(binary, 0o755);
    await writeFile(join(stage, 'receipt.json'), JSON.stringify({ version, target, archiveSha256: entry[0], binarySha256: await digest(binary) }) + '\n', { flag: 'wx' });
    try { await rename(stage, directory); }
    catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
    const verified = await cached(directory, { version, target });
    if (!verified) throw new Error('Compiler cache disappeared during installation; retry the install.');
    return verified;
  } catch (error) {
    throw new Error(`Cannot install First ${version} for ${target}: ${error.message}\nNo Rust build or alternate executable was attempted. Check that this release has been published, or supply FIRST_BIN.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
    if (stage) await rm(stage, { recursive: true, force: true });
  }
}
