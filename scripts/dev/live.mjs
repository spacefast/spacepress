import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';

export async function liveUpdates({ bind, site, publish }) {
  const path = `/${randomUUID()}`;
  const origin = new URL(site).origin;
  const clients = new Set();
  let revision = 0;
  let diagnostics = [];
  const send = (client) => {
    if (client.writableLength > 1024 * 1024) client.destroy();
    else client.write(`data: ${JSON.stringify({ revision, diagnostics })}\n\n`);
  };
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== path || request.headers.origin !== origin) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'access-control-allow-origin': origin,
      'cache-control': 'no-store',
      'content-type': 'text/event-stream',
    });
    clients.add(response);
    response.once('close', () => clients.delete(response));
    send(response);
  });
  server.listen(0, bind);
  await once(server, 'listening');
  const host = bind.includes(':') ? `[${bind}]` : bind;
  const events = `http://${host}:${server.address().port}${path}`;
  try {
    await publish({ events, revision });
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    async updated(reload) {
      if (reload) {
        await publish({ events, revision: revision + 1 });
        revision++;
      }
      diagnostics = [];
      for (const client of clients) send(client);
    },
    failed(error) {
      diagnostics = error.diagnostics ?? [{ message: error.message }];
      for (const client of clients) send(client);
    },
    close() {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      return closed;
    },
  };
}
