import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const { url } = JSON.parse(readFileSync(process.env.TP_SPACEFAST_HARNESS, 'utf8'));

test('imported users sign in on the destination with a new session', async () => {
  const api = `${url}/wp-json/typedpress/v1`;
  const old = await fetch(`${api}/me`, { headers: { Cookie: '__Host-sfi_session=old-token' } });
  assert.equal((await old.json()).data, null);

  const signedIn = await fetch(`${url}/wp-json/typedpress-identity/v1/sign-in/password`, {
    method: 'POST',
    headers: { Origin: url, 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: 'imported-member', password: 'disposable-member-password' }),
  });
  assert.equal(signedIn.status, 200, await signedIn.clone().text());
  const cookie = signedIn.headers.getSetCookie().find((value) => value.startsWith('zi_session='));
  assert.ok(cookie);
  const me = await fetch(`${api}/me`, { headers: { Cookie: cookie.split(';', 1)[0] } });
  assert.equal((await me.json()).data.name, 'Imported Member');
});
