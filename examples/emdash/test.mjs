import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const suites = {
  publishing: 'examples/emdash/starter/acceptance.test.mjs',
  'publishing-browser': 'examples/emdash/starter/browser.test.mjs',
  marketing: 'examples/emdash/marketing/acceptance.test.mjs',
  portfolio: 'examples/emdash/portfolio/acceptance.test.mjs',
  agents: 'examples/emdash/agents/acceptance.test.mjs',
  platform: 'examples/emdash/platform/acceptance.test.mjs',
  plugins: 'examples/emdash/plugins/acceptance.test.mjs',
  'official-source': 'examples/emdash/official-sites/acceptance.test.mjs',
  lifecycle: 'scripts/dev/acceptance.test.mjs',
};
const requested = process.argv.slice(2);
if (requested.includes('--help') || requested.includes('--list')) {
  console.log('Usage: node examples/emdash/test.mjs [suite ...]\n');
  console.log(Object.keys(suites).join('\n'));
  console.log('\nDefault: all example suites. lifecycle is optional.');
  console.log('Builds SpacePress and installs shared Chromium dependencies. Set SP_BIN to reuse a matching binary.');
} else {
  const selected = requested.length ? [...new Set(requested)] : Object.keys(suites).filter((name) => name !== 'lifecycle');
  const unknown = selected.filter((name) => !Object.hasOwn(suites, name));
  if (unknown.length) throw new Error(`Unknown suite: ${unknown.join(', ')}. Use --list.`);
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  if (selected.includes('official-source') && major === 22 && (minor < 23 || (minor === 23 && patch < 4))) {
    throw new Error('The official-source suite requires Node.js 22.23.4 or newer.');
  }
  const run = (program, args, env = process.env) => {
    console.log(`\n> ${program} ${args.join(' ')}`);
    const result = spawnSync(program, args, { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${program} failed (${result.signal ?? result.status}).`);
  };
  if (!process.env.SP_BIN) {
    run('cargo', ['build', '--locked'], { ...process.env, CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '2' });
  }
  const binary = resolve(root, process.env.SP_BIN ?? join(process.env.CARGO_TARGET_DIR ?? 'target', 'debug/spacepress'));
  const binarySha256 = createHash('sha256').update(await readFile(binary)).digest('hex');
  run('npm', ['--prefix', here, 'ci', '--ignore-scripts']);
  run('npm', ['--prefix', here, 'exec', '--', 'playwright', 'install', 'chromium']);
  if (selected.includes('official-source')) run('npm', ['--prefix', join(here, 'official-sites'), 'ci', '--ignore-scripts']);
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  const changes = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const evidence = await mkdtemp(join(tmpdir(), 'spacepress-emdash-suite-'));
  const receipt = { startedAt: new Date().toISOString(), revision: revision.stdout?.trim(), dirty: changes.stdout?.trim() !== '', binary, binarySha256, suites: [], result: 'running' };
  const save = () => writeFile(join(evidence, 'results.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(`\nSuite receipt: ${join(evidence, 'results.json')}`);
  await save();
  try {
    for (const name of selected) {
      const result = { name, command: ['node', '--test', suites[name]], startedAt: new Date().toISOString(), result: 'running' };
      receipt.suites.push(result);
      await save();
      try {
        run(process.execPath, ['--test', suites[name]], { ...process.env, SP_BIN: binary });
        result.result = 'passed';
      } catch (error) {
        result.result = 'failed';
        throw error;
      } finally {
        result.finishedAt = new Date().toISOString();
        await save();
      }
    }
    receipt.result = 'passed';
    console.log(`\nPASS: ${selected.join(', ')}. Each suite printed its own native evidence and cleanup result.`);
  } catch (error) {
    receipt.result = 'failed';
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    await save();
    console.log(`Suite receipt: ${join(evidence, 'results.json')}`);
  }
}
