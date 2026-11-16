import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const exec = promisify(execFile);

test('release archives reject uncommitted inputs and retain payloads in drive-style output paths', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'typedpress-release-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['scripts/release', 'scripts/deploy', 'packages/cli/lib', 'packages/create-typedpress']) {
    await mkdir(join(root, directory), { recursive: true });
  }
  for (const path of ['scripts/release/archive.mjs', 'scripts/release/version.mjs', 'packages/cli/lib/release.mjs', 'packages/cli/package.json', 'packages/create-typedpress/package.json', 'Cargo.toml', 'rust-toolchain']) {
    await copyFile(new URL(`../../${path}`, import.meta.url), join(root, path));
  }
  const helper = join(root, 'scripts/deploy/local.php');
  await writeFile(helper, '<?php echo "initial";\n');
  const git = (args) => exec('git', args, { cwd: root });
  await git(['init', '--quiet']);
  await git(['add', '.']);
  await git(['-c', 'user.name=TypedPress test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Initial release fixture']);
  const { stdout } = await git(['rev-parse', 'HEAD']);
  const run = (options = {}) => exec(process.execPath, ['--input-type=module', '--eval', `import { archive } from ${JSON.stringify(pathToFileURL(join(root, 'scripts/release/archive.mjs')).href)}; console.log(JSON.stringify(await archive(${JSON.stringify({
    binary: '/unused-compiler', target: 'x86_64-unknown-linux-gnu', output: join(root, 'release'), revision: stdout.trim(),
    ...options,
  })})));`], { cwd: root });
  await writeFile(helper, '<?php echo "modified";\n');
  await assert.rejects(run(), (error) => error.code === 1 && /Compiler\/runtime sources differ from HEAD/.test(error.stderr));
  await git(['restore', 'scripts/deploy/local.php']);
  await writeFile(join(root, 'scripts/deploy/added.php'), '<?php echo "untracked";\n');
  await assert.rejects(run(), (error) => error.code === 1 && /Uncommitted compiler\/runtime source files/.test(error.stderr));
  await rm(join(root, 'scripts/deploy/added.php'));

  for (const directory of ['src', 'runtime', 'types/typedpress']) await mkdir(join(root, directory), { recursive: true });
  await mkdir(join(root, 'licenses'));
  for (const name of ['LICENSE', 'LICENSING.md', 'licenses/GPL-2.0-or-later.txt']) await copyFile(new URL(`../../${name}`, import.meta.url), join(root, name));
  const version = JSON.parse(await readFile(join(root, 'packages/cli/package.json'), 'utf8')).version;
  await writeFile(join(root, 'Cargo.toml'), `[package]\nname = "archive-fixture"\nversion = "${version}"\nedition = "2021"\n`);
  await writeFile(join(root, 'src/lib.rs'), 'pub fn fixture() {}\n');
  await exec('cargo', ['generate-lockfile', '--offline'], { cwd: root });
  await writeFile(join(root, 'types/typedpress/index.d.ts'), 'export interface Fixture {}\n');
  await writeFile(join(root, 'runtime/LICENSE'), 'Retained runtime notice\n');
  const binary = join(root, 'fixture-typedpress');
  await writeFile(binary, 'Compiler fixture bytes\n');
  await git(['add', '.']);
  await git(['-c', 'user.name=TypedPress test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Archive payload fixture']);
  const revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  const output = process.platform === 'win32' ? join(root, 'release output') : 'D: release output';
  const receipt = JSON.parse((await run({ binary, target: 'x86_64-pc-windows-msvc', output, revision })).stdout);
  const directory = resolve(root, output);
  const extracted = join(root, 'extracted');
  await mkdir(extracted);
  await exec('tar', ['-xzf', receipt.name, '-C', extracted], { cwd: directory });
  assert.equal(await readFile(join(extracted, 'typedpress'), 'utf8'), 'Compiler fixture bytes\n');
  assert.equal(await readFile(join(extracted, 'types/index.d.ts'), 'utf8'), 'export interface Fixture {}\n');
  assert.equal(await readFile(join(extracted, 'licenses/runtime/LICENSE'), 'utf8'), 'Retained runtime notice\n');
  for (const name of ['LICENSE', 'LICENSING.md', 'licenses/GPL-2.0-or-later.txt']) {
    assert.equal(await readFile(join(extracted, name), 'utf8'), await readFile(new URL(`../../${name}`, import.meta.url), 'utf8'), name);
  }
  assert.deepEqual(JSON.parse(await readFile(join(extracted, 'licenses/DEPENDENCIES.json'), 'utf8')), []);
  const source = JSON.parse(await readFile(join(extracted, 'SOURCE.json'), 'utf8'));
  assert.equal(source.revision, revision);
  assert.equal(source.sourceKind, 'git-commit');
  assert.equal(source.target, 'x86_64-pc-windows-msvc');
  const sha256 = createHash('sha256').update(await readFile(join(directory, receipt.name))).digest('hex');
  assert.equal(receipt.sha256, sha256);
  assert.equal(await readFile(join(directory, `${receipt.name}.sha256`), 'utf8'), `${sha256}  ${receipt.name}\n`);
});
