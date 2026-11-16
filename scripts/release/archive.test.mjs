import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const exec = promisify(execFile);

test('committed release packaging refuses modified and untracked embedded inputs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'zero-release-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['scripts/release', 'scripts/deploy', 'packages/cli/lib', 'packages/create-zero']) {
    await mkdir(join(root, directory), { recursive: true });
  }
  for (const path of ['scripts/release/archive.mjs', 'scripts/release/version.mjs', 'packages/cli/lib/release.mjs', 'packages/cli/package.json', 'packages/create-zero/package.json', 'Cargo.toml', 'rust-toolchain']) {
    await copyFile(new URL(`../../${path}`, import.meta.url), join(root, path));
  }
  const helper = join(root, 'scripts/deploy/local.php');
  await writeFile(helper, '<?php echo "initial";\n');
  const git = (args) => exec('git', args, { cwd: root });
  await git(['init', '--quiet']);
  await git(['add', '.']);
  await git(['-c', 'user.name=Zero test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Initial release fixture']);
  const { stdout } = await git(['rev-parse', 'HEAD']);
  const script = `import { archive } from ${JSON.stringify(pathToFileURL(join(root, 'scripts/release/archive.mjs')).href)}; await archive(${JSON.stringify({
    binary: '/unused-compiler', target: 'x86_64-unknown-linux-gnu', output: join(root, 'release'), revision: stdout.trim(),
  })});`;
  const run = () => exec(process.execPath, ['--input-type=module', '--eval', script], { cwd: root });
  await writeFile(helper, '<?php echo "modified";\n');
  await assert.rejects(run(), (error) => error.code === 1 && /Compiler\/runtime sources differ from HEAD/.test(error.stderr));
  await git(['restore', 'scripts/deploy/local.php']);
  await writeFile(join(root, 'scripts/deploy/added.php'), '<?php echo "untracked";\n');
  await assert.rejects(run(), (error) => error.code === 1 && /Uncommitted compiler\/runtime source files/.test(error.stderr));
});
