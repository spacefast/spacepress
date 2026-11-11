import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const { url } = JSON.parse(readFileSync(process.env.FIRST_SPACEFAST_HARNESS, 'utf8'));
const request = (path, token, options = {}) => fetch(`${url}/wp-json/${path}`, {
  ...options, headers: { Cookie: `__Host-sfi_session=${token}`, ...options.headers },
});
test('imported cookie authenticates, survives upgrade, refuses forgeries and logs out', async () => {
  const schema = await request('first/v1/_schema', 'old-token');
  assert.equal(schema.status, 200);
  const response = await request('first/v1/me', 'old-token');
  assert.equal(response.status, 200);
  const me = await response.json();
  assert.equal(me.data.name, 'Imported Member');
  assert.match(response.headers.get('set-cookie'), /zi_session=old-token/);
  const second = await fetch(`${url}/wp-json/first/v1/me`, { headers: { Cookie: 'zi_session=old-token' } });
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), me);
  for (const token of ['0'.repeat(64), 'native-legacy-shaped', 'expired-token', 'revoke-token']) {
    const forged = await request('first/v1/me', token);
    const body = await forged.json();
    assert.equal(body.data, null, `reject ${token}`);
  }
  const csrf = await request('first/v1/posts', 'old-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'CSRF attempt' }) });
  assert.equal(csrf.status, 403);
  const logout = await request('first-identity/v1/sign-out', 'logout-token', {
    method: 'POST', headers: { Origin: url, 'X-Identity-CSRF': 'b'.repeat(64), 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(logout.status, 200);
  assert.equal((await logout.json()).data.signed_out, true);
  assert.equal((await (await request('first/v1/me', 'logout-token')).json()).data, null);
});
