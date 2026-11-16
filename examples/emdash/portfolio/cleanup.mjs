import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const file = resolve(process.argv[2] ?? '');
assert.notEqual(process.argv[2], undefined, 'Usage: node cleanup.mjs /tmp/typedpress-portfolio-evidence-.../studio.json');
const receipt = JSON.parse(await readFile(file, 'utf8'));
assert.match(receipt.root, /^\/tmp\/typedpress-portfolio-studio-[A-Za-z0-9]+$/);
assert.equal(receipt.project, join(receipt.root, 'app'));
assert.equal(receipt.site, join(receipt.project, '.tp/dev/wordpress'));
if (receipt.state === 'deleted') {
  await rm(receipt.root, { recursive: true, force: true });
  console.log(`Already deleted: ${receipt.site}`);
} else {
  const command = async (args) => (await execute(receipt.binary, args, { cwd: receipt.project, timeout: 120000 })).stdout.trim();
  await command(['dev', 'stop', receipt.project]);
  assert.equal(JSON.parse(await command(['dev', 'status', receipt.project])).isOnline, false);
  const deleted = await execute('npx', ['--yes', '--package', 'wp-studio@2.2.0', '--', 'studio', 'delete', '--path', receipt.site, '--no-files'], { cwd: receipt.project, timeout: 120000 });
  await writeFile(join(receipt.evidence, 'cleanup.txt'), `Stopped exact project: ${receipt.project}\nOnline: false\nDeleted exact Studio registration: ${receipt.site}\n${deleted.stdout}${deleted.stderr}`);
  receipt.state = 'deleted';
  await writeFile(file, JSON.stringify(receipt, null, 2) + '\n');
  await rm(receipt.root, { recursive: true, force: true });
  console.log(`Stopped and deleted only ${receipt.site}`);
}
