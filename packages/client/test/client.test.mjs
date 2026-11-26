import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bind, createClient, SpacePressError } from '../src/index.mjs';
import { createHooks, getClient, setClient, sharedState, uploadFile, useLive } from '../src/react.mjs';

const SCHEMA = {
  name: 'demo',
  app: 'demo',
  abilities: {
    collections: {},
    actions: {
      ping: { ability: 'ping', readonly: true },
    },
    globals: {
      settings: 'settings',
    },
  },
  collections: {
    posts: {
      path: 'posts',
      ability: 'posts',
      primaryKey: 'id',
      drafts: true,
      localized: false,
      media: [],
      mediaList: [],
      files: [],
      relations: {},
    },
  },
  globals: ['settings'],
  actions: ['ping'],
  buckets: ['inbox'],
};

test('@spacepress/client bind(SCHEMA) calls WordPress Abilities run routes for kinds, actions, and globals', async () => {
  const calls = [];
  const mockFetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body });
    if (String(url).includes('/abilities/demo/posts-list/run')) {
      return new Response(JSON.stringify({ rows: [{ id: 1, title: 'Hello' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/abilities/demo/ping/run')) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (String(url).includes('/abilities/demo/global-settings-get/run')) {
      return new Response(JSON.stringify({ siteName: 'Demo' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ code: 'not_found', message: 'Not found', data: { status: 404 } }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  };

  const makeClient = bind(SCHEMA);
  const client = makeClient({ url: 'https://demo.test', fetch: mockFetch });
  const posts = await client.posts.list({ limit: 5 });
  assert.deepEqual(posts, [{ id: 1, title: 'Hello' }]);
  assert.match(calls[0].url, /\/wp-json\/wp-abilities\/v1\/abilities\/demo\/posts-list\/run/);

  const pong = await client.actions.ping();
  assert.deepEqual(pong, { ok: true });
  assert.match(calls[1].url, /\/wp-json\/wp-abilities\/v1\/abilities\/demo\/ping\/run/);

  const settings = await client.globals.settings.get();
  assert.deepEqual(settings, { siteName: 'Demo' });
  assert.match(calls[2].url, /\/wp-json\/wp-abilities\/v1\/abilities\/demo\/global-settings-get\/run/);
});

test('@spacepress/client createClient refuses missing SCHEMA and maps WordPress errors to SpacePressError', async () => {
  assert.throws(() => createClient(null), TypeError);
  const client = createClient(SCHEMA, {
    url: 'https://demo.test',
    fetch: async () =>
      new Response(JSON.stringify({ code: 'rest_ability_not_found', message: 'Missing', data: { status: 404 } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
  });
  await assert.rejects(() => client.posts.list(), (err) => {
    assert.ok(err instanceof SpacePressError);
    assert.equal(err.status, 404);
    assert.equal(err.code, 'not_found');
    return true;
  });
});

test('@spacepress/client/react exports hooks and uploadFile uses bound client', async () => {
  const shared = sharedState({ count: 0 });
  assert.deepEqual(shared, { count: 0 });
  assert.deepEqual(useLive('posts', {}, { enabled: false }), { data: undefined, error: undefined, loading: false });
  assert.equal(typeof createHooks, 'function');

  const uploaded = { id: 7, bucket: 'inbox', filename: 'a.txt', mime: 'text/plain', size: 2, ownerId: 1, createdAt: '2026-11-26T00:00:00Z', url: 'https://demo.test/f/7' };
  setClient({
    files: {
      inbox: {
        upload: async () => uploaded,
      },
    },
  });
  assert.ok(getClient());
  assert.deepEqual(await uploadFile('inbox', new Blob(['hi']), { filename: 'a.txt' }), uploaded);
  setClient(null);
  await assert.rejects(() => uploadFile('inbox', new Blob(['hi'])), /requires a bound @spacepress\/client/);
});
