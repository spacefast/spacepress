import assert from 'node:assert/strict';
import { watch } from 'node:fs';
import { access } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';

async function request(socketPath, payload) {
  return new Promise((done, fail) => {
    const socket = createConnection(socketPath);
    let buffer = Buffer.alloc(0);
    socket.setTimeout(10000, () => socket.destroy(new Error('Owned Studio daemon cleanup timed out.')));
    socket.once('error', fail);
    socket.once('connect', () => {
      const body = Buffer.from(JSON.stringify(payload));
      const header = Buffer.alloc(4); header.writeUInt32BE(body.length);
      socket.write(Buffer.concat([header, body]));
    });
    socket.on('data', (chunk) => { buffer = Buffer.concat([buffer, chunk]); });
    socket.once('end', () => {
      try {
        if (buffer.length < 4 || buffer.length !== buffer.readUInt32BE(0) + 4) throw new Error('Incomplete Studio daemon response.');
        const response = JSON.parse(buffer.subarray(4).toString('utf8'));
        if (response.type !== 'result') throw new Error(`Studio daemon cleanup rejected: ${response.error?.message}`);
        done(response.payload);
      } catch (error) { fail(error); }
    });
  });
}

// Pinned Studio 2.2.0 IPC (unchanged since 2.1.1), used only to close the test's own daemon after CLI site deletion.
export async function stopOwnedDaemon(work) {
  if (!resolve(work).startsWith('/tmp/typedpress-framework-setup-')) throw new Error('Refusing daemon cleanup outside the owned setup test root.');
  const directory = join(work, 'studio-daemon');
  const socket = join(directory, 'daemon.sock');
  try { await access(socket); }
  catch (error) { if (error.code === 'ENOENT') return 'No owned Studio daemon was started.'; throw error; }
  const { processes } = await request(socket, { type: 'list-processes' });
  assert.deepEqual(processes, [], 'Owned Studio daemon still has running services; stop the site before shutdown.');
  const removed = new Promise((done, fail) => {
    const watcher = watch(directory, () => check());
    const timeout = setTimeout(() => finish(new Error('Owned Studio daemon socket remains after shutdown.')), 10000);
    const finish = (error) => { clearTimeout(timeout); watcher.close(); error ? fail(error) : done(); };
    const check = () => access(socket).catch((error) => { if (error.code === 'ENOENT') finish(); else finish(error); });
    watcher.once('error', finish);
    void check();
  });
  await request(socket, { type: 'kill-daemon' });
  await removed;
  return 'Owned Studio daemon acknowledged shutdown and its control socket was removed; no managed services remain.';
}
