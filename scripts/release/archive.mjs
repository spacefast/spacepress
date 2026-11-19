import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, cp, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { assetName } from '../../packages/cli/lib/release.mjs';
import { releaseVersion, root } from './version.mjs';

const exec = promisify(execFile);

export async function archive({ binary, target, output, revision, workingTree = false }) {
  const version = await releaseVersion();
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Supply the exact 40-character Git source revision.');
  const observed = (await exec('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(root) })).stdout.trim();
  if (observed !== revision) throw new Error('Source revision differs from the observed checkout HEAD.');
  const sourceInputs = ['types', 'src', 'runtime', 'scripts', 'build.rs', 'Cargo.toml', 'Cargo.lock', 'rust-toolchain', 'LICENSE', 'LICENSING.md', 'licenses'];
  const untracked = (await exec('git', ['ls-files', '--others', '--exclude-standard', '--', ...sourceInputs], { cwd: fileURLToPath(root) })).stdout.trim();
  if (untracked && !workingTree) throw new Error('Uncommitted compiler/runtime source files exist; commit the release sources or use --working-tree only for a local test archive.');
  try { await exec('git', ['diff', '--quiet', 'HEAD', '--', ...sourceInputs], { cwd: fileURLToPath(root) }); }
  catch (error) {
    if (error.code !== 1 || !workingTree) throw new Error('Compiler/runtime sources differ from HEAD. Commit the release sources first; --working-tree is only for explicitly labelled local test artifacts.');
  }
  if (!(await lstat(binary)).isFile()) throw new Error('Release binary must be a regular file.');
  const name = assetName({ version, target });
  await mkdir(output, { recursive: true });
  const destination = join(output, name);
  const reserve = await open(destination, 'wx');
  await reserve.close();
  const stage = await mkdtemp(join(tmpdir(), 'typedpress-release-'));
  try {
    await copyFile(binary, join(stage, 'typedpress'));
    await cp(new URL('types/typedpress/', root), join(stage, 'types'), { recursive: true });
    await mkdir(join(stage, 'licenses'));
    for (const name of ['LICENSE', 'LICENSING.md', 'licenses/GPL-2.0-or-later.txt', 'Cargo.lock']) await copyFile(new URL(name, root), join(stage, name));
    async function notices(directory, prefix = '') {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (['node_modules', '.git', 'vendor', 'apps'].includes(entry.name)) continue;
        const source = join(directory, entry.name);
        const relative = join(prefix, entry.name);
        if (entry.isDirectory()) await notices(source, relative);
        else if (/^(?:LICEN[CS]E|COPYING|THIRD-PARTY-LICENSES)(?:[.-].*)?$/i.test(entry.name)) {
          const destination = join(stage, 'licenses', 'runtime', relative);
          await mkdir(dirname(destination), { recursive: true });
          await copyFile(source, destination);
        }
      }
    }
    await notices(fileURLToPath(new URL('runtime/', root)));
    // Cargo.lock owns versions/checksums; retain upstream license text as well as expressions.
    const metadata = JSON.parse((await exec('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', target], {
      cwd: fileURLToPath(root), maxBuffer: 16 * 1024 * 1024,
    })).stdout);
    const dependencies = [];
    const upstreamNotices = new Map();
    for (const dependency of metadata.packages.filter((dependency) => dependency.source !== null)) {
      const directory = dirname(dependency.manifest_path);
      const retained = new Set();
      async function crateNotices(path, prefix = '') {
        for (const entry of await readdir(path, { withFileTypes: true })) {
          const relative = join(prefix, entry.name);
          if (entry.isDirectory() && !['target', '.git'].includes(entry.name)) await crateNotices(join(path, entry.name), relative);
          if (!entry.isFile() || !/^(?:LICEN[CS]E|COPYING|NOTICE|COPYRIGHT|AUTHORS)(?:[.-].*)?$/i.test(entry.name)) continue;
          const destination = join(stage, 'licenses/rust', `${dependency.name}-${dependency.version}`, relative);
          await mkdir(dirname(destination), { recursive: true });
          await copyFile(join(directory, relative), destination);
          retained.add(relative);
        }
      }
      await crateNotices(directory);
      if (dependency.license_file) {
        const relative = dependency.license_file;
        if (relative.startsWith('/') || relative.split(/[\\/]/).includes('..')) throw new Error(`License file escapes dependency ${dependency.name}.`);
        const destination = join(stage, 'licenses/rust', `${dependency.name}-${dependency.version}`, relative);
        await mkdir(dirname(destination), { recursive: true });
        await copyFile(join(directory, relative), destination);
        retained.add(relative);
      }
      let upstreamNotice;
      if (!retained.size) {
        // Some Oxc crates omit the workspace license from their registry tarball.
        // Recover it only from the exact Git revision recorded by Cargo's package.
        const vcs = JSON.parse(await readFile(join(directory, '.cargo_vcs_info.json'), 'utf8'));
        const repository = new URL(dependency.repository);
        if (repository.hostname !== 'github.com' || !/^[a-f0-9]{40}$/.test(vcs.git?.sha1)) throw new Error(`No verifiable original license notice for ${dependency.name}.`);
        // `repository` may point inside the repo (`/owner/repo/tree/main/crate`); raw files live at /owner/repo/<sha>/.
        const [owner, repo] = repository.pathname.split('/').filter(Boolean);
        if (!owner || !repo) throw new Error(`No verifiable original license notice for ${dependency.name}.`);
        const url = `https://raw.githubusercontent.com/${owner}/${repo.replace(/\.git$/, '')}/${vcs.git.sha1}/LICENSE`;
        let bytes = upstreamNotices.get(url);
        if (!bytes) {
          const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
          if (!response.ok) throw new Error(`Cannot retrieve original license for ${dependency.name} from its recorded source revision (HTTP ${response.status}).`);
          bytes = Buffer.from(await response.arrayBuffer());
          if (!bytes.length || bytes.length > 1024 * 1024) throw new Error(`Invalid upstream notice size for ${dependency.name}.`);
          upstreamNotices.set(url, bytes);
        }
        const destination = join(stage, 'licenses/rust', `${dependency.name}-${dependency.version}`, 'LICENSE');
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, bytes);
        retained.add('LICENSE');
        upstreamNotice = { url, sha256: createHash('sha256').update(bytes).digest('hex') };
      }
      dependencies.push({ name: dependency.name, version: dependency.version, source: dependency.source, repository: dependency.repository, license: dependency.license, notices: [...retained].sort(), ...(upstreamNotice ? { upstreamNotice } : {}) });
    }
    await writeFile(join(stage, 'licenses/DEPENDENCIES.json'), JSON.stringify(dependencies.sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)), null, 2) + '\n');
    await writeFile(join(stage, 'SOURCE.json'), JSON.stringify({
      version, target, revision, sourceKind: workingTree ? 'local-working-tree-test' : 'git-commit', source: `https://github.com/spacefast/zero/tree/${revision}`,
      signed: false, licenses: 'LICENSE is MIT, licenses/GPL-2.0-or-later.txt is the GPL, and LICENSING.md maps every component to one of them; runtime notices retain their original paths under licenses/runtime/. Rust notices and metadata are under licenses/rust/ and licenses/DEPENDENCIES.json; exact versions and registry checksums are recorded in Cargo.lock.',
    }, null, 2) + '\n');
    // GNU tar treats a drive letter in the archive argument as a remote host.
    await exec('tar', ['-czf', name, '-C', stage, 'typedpress', 'LICENSE', 'LICENSING.md', 'Cargo.lock', 'SOURCE.json', 'licenses', 'types'], { cwd: output });
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(destination)) hash.update(chunk);
    const sha256 = hash.digest('hex');
    await writeFile(`${destination}.sha256`, `${sha256}  ${name}\n`, { flag: 'wx' });
    return { name, sha256, target, version, revision };
  } catch (error) { await rm(destination, { force: true }); throw error; }
  finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [binary, target, output, revision, mode] = process.argv.slice(2);
  if (!binary || !target || !output || !revision) throw new Error('Usage: node scripts/release/archive.mjs <binary> <rust-target> <output-directory> <source-revision>');
  if (mode && mode !== '--working-tree') throw new Error('Unknown archive option.');
  process.stdout.write(JSON.stringify(await archive({ binary: resolve(binary), target, output: resolve(output), revision, workingTree: mode === '--working-tree' })) + '\n');
}
