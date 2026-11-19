import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const site = process.env.TP_SITE?.replace(/\/$/, '');
const auth = process.env.TP_AUTH;
const otherAuth = process.env.TP_OTHER_AUTH;

assert.ok(site, 'Set TP_SITE to the WordPress site URL.');
assert.ok(auth, 'Set TP_AUTH to username:application-password.');
assert.ok(['http:', 'https:'].includes(new URL(site).protocol), 'TP_SITE must use HTTP or HTTPS.');
assert.equal(new URL(site).username, '', 'Keep credentials in TP_AUTH, not TP_SITE.');
assert.equal(new URL(site).password, '', 'Keep credentials in TP_AUTH, not TP_SITE.');

const api = '/wp-json/typedpress/v1';

async function request(path, { method = 'GET', body, credential = auth, key } = {}) {
  const headers = { accept: 'application/json' };
  if (credential) headers.authorization = `Basic ${Buffer.from(credential).toString('base64')}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (key) headers['idempotency-key'] = key;
  const response = await fetch(`${site}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${path}: HTTP ${response.status}, expected JSON; received ${text.slice(0, 1000)}`);
  }
  const command = `curl ${credential ? '-u "$TP_AUTH" ' : ''}-X ${method} '${site}${path}'${key ? ` -H 'Idempotency-Key: ${key}'` : ''}${body === undefined ? '' : ` -H 'Content-Type: application/json' --data '${JSON.stringify(body)}'`}`;
  console.log(command.replace('"$TP_AUTH"', credential === otherAuth && otherAuth ? '"$TP_OTHER_AUTH"' : '"$TP_AUTH"'));
  console.log(JSON.stringify({ status: response.status, body: json }));
  return { status: response.status, body: json };
}

async function success(path, options = {}) {
  const result = await request(path, options);
  assert.ok(result.status >= 200 && result.status < 300, `${options.method ?? 'GET'} ${path}: HTTP ${result.status}`);
  assert.ok(Object.hasOwn(result.body, 'data'), `${path}: missing TypedPress response data`);
  return result.body.data;
}

async function denied(path, options = {}, statuses = [401, 403, 404]) {
  const result = await request(path, options);
  assert.ok(statuses.includes(result.status), `${options.method ?? 'GET'} ${path}: expected ${statuses.join('/')}, got ${result.status}`);
  return result;
}

const create = (resource, body) => success(`${api}/${resource}`, { method: 'POST', body });
const read = (resource, id) => success(`${api}/${resource}/${id}`);
const action = (name, body, options = {}) => success(`${api}/actions/${name}`, { method: 'POST', body, ...options });
const feedingPath = (petId) => `${api}/feedings?${new URLSearchParams({ where: JSON.stringify({ petId }) })}`;
const current = await request('/wp-json/wp/v2/users/me');
assert.equal(current.status, 200, 'Application-password sign-in failed.');
const ownerId = current.body.id;
assert.ok(Number.isInteger(ownerId) && ownerId > 0, 'WordPress did not return the signed-in user ID.');

const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);
const expiry = new Date(now + 90 * 86_400_000).toISOString().slice(0, 10);
const pet = await create('pets', {
  name: 'Miso', species: 'cat', birthday: '2022-04-12', weightKg: 4.5, dailyGrams: 80,
  ownerId: ownerId === 2_147_483_647 ? 2_147_483_646 : 2_147_483_647,
});
assert.equal(pet.ownerId, ownerId, 'beforeCreate must overwrite a spoofed ownerId.');
const updatedPet = await success(`${api}/pets/${pet.id}`, { method: 'PATCH', body: { weightKg: 4.6 } });
assert.equal(updatedPet.weightKg, 4.6);
assert.equal((await read('pets', pet.id)).name, 'Miso');

const temporary = await create('pets', { name: 'Temporary CRUD check', species: 'cat', dailyGrams: 80 });
await success(`${api}/pets/${temporary.id}`, { method: 'DELETE' });
await denied(`${api}/pets/${temporary.id}`, {}, [404]);

const food = await create('foods', {
  brand: 'North coast', product: 'Salmon kibble', kind: 'dry', bagGrams: 1000, costCents: 1200,
});
const stock = await create('stock', { foodId: food.id, gramsLeft: 100, openedOn: today, expiresOn: expiry });
const note = await create('vet_notes', {
  title: 'Miso annual check', body: '<p>Healthy. Keep an eye on weight and bring the feeding log next time.</p>', petId: pet.id,
});
for (const row of [food, stock, note]) assert.equal(row.ownerId, ownerId);
assert.match((await read('vet_notes', note.id)).body, /Healthy/);

await denied(`${api}/pets`, { credential: null }, [401, 403]);
await denied(`${api}/actions/feed`, {
  method: 'POST', credential: null, body: { petId: pet.id, foodId: food.id, grams: 1 },
}, [401, 403]);

const feedInput = { petId: pet.id, foodId: food.id, grams: 80, fedAt: new Date(now - 60_000).toISOString() };
const key = `pet-food-smoke-${randomUUID()}`;
const fed = await action('feed', feedInput, { key });
assert.equal(fed.grams, 80);
assert.equal(fed.feeding.petId, pet.id);
assert.equal(fed.feeding.foodId, food.id);
assert.equal(fed.feeding.grams, 80);
assert.equal(fed.feeding.costCents, 80 * food.costCents / food.bagGrams);
assert.equal(fed.feeding.ownerId, ownerId);
assert.deepEqual(await action('feed', feedInput, { key }), fed, 'An idempotent replay must return the saved response.');
assert.equal((await read('stock', stock.id)).gramsLeft, 20, 'An idempotent replay must not subtract twice.');
const feedings = await success(feedingPath(pet.id));
assert.equal(feedings.length, 1, 'An idempotent replay must not create another feeding.');

for (const body of [
  { petId: pet.id, foodId: food.id, grams: 21 },
  { petId: pet.id, foodId: food.id, grams: 1, fedAt: new Date(now + 86_400_000).toISOString() },
]) {
  await denied(`${api}/actions/feed`, { method: 'POST', body }, [400, 409, 422]);
  assert.equal((await read('stock', stock.id)).gramsLeft, 20, 'A refused feeding must leave stock unchanged.');
  assert.equal((await success(feedingPath(pet.id))).length, 1, 'A refused feeding must leave the log unchanged.');
}

const projection = await action('runsOutOn', { foodId: food.id });
assert.equal(projection.foodId, food.id);
assert.equal(projection.gramsLeft, 20);
assert.ok(Math.abs(projection.gramsPerDay - 80 / 14) < 0.000001, 'Projection must use grams fed in the last 14 days divided by 14.');
assert.ok(Number.isFinite(Date.parse(projection.runsOutOn)), 'Expected a projected date.');
const monthly = await action('costPerMonth', { petId: pet.id });
assert.equal(monthly.petId, pet.id);
assert.equal(monthly.costCents, Math.round((80 * 1200 / 1000) / 14 * 30), 'Monthly estimate = 14-day feeding cost / 14 * 30, rounded to cents.');
const restock = await action('restockList', {});
assert.ok(Array.isArray(restock), 'restockList must return an array.');
assert.ok(restock.some((item) => item.foodId === food.id), 'The low-stock food must appear in restockList.');
await success(`${api}/shopping_list`);

if (otherAuth) {
  for (const [resource, row] of [['pets', pet], ['foods', food], ['stock', stock], ['vet_notes', note], ['feedings', fed.feeding]]) {
    const rows = await success(`${api}/${resource}`, { credential: otherAuth });
    assert.ok(!rows.some((candidate) => candidate.id === row.id), `${resource}: another user can list the owner's row.`);
    await denied(`${api}/${resource}/${row.id}`, { credential: otherAuth });
  }
  await denied(`${api}/pets/${pet.id}`, { method: 'PATCH', credential: otherAuth, body: { name: 'Stolen' } });
  await denied(`${api}/pets/${pet.id}`, { method: 'DELETE', credential: otherAuth });
  await denied(`${api}/actions/feed`, {
    method: 'POST', credential: otherAuth, body: { petId: pet.id, foodId: food.id, grams: 1 },
  });
  await denied(`${api}/actions/runsOutOn`, { method: 'POST', credential: otherAuth, body: { foodId: food.id } });
  await denied(`${api}/actions/costPerMonth`, { method: 'POST', credential: otherAuth, body: { petId: pet.id } });
  await denied(`${api}/stock`, {
    method: 'POST', credential: otherAuth, body: { foodId: food.id, gramsLeft: 100 },
  });
  await denied(`${api}/vet_notes`, {
    method: 'POST', credential: otherAuth, body: { title: 'Foreign pet', petId: pet.id, body: '<p>Must be refused.</p>' },
  });
  const otherRestock = await action('restockList', {}, { credential: otherAuth });
  assert.ok(!otherRestock.some((item) => item.foodId === food.id));
  assert.equal((await read('pets', pet.id)).name, 'Miso');
  assert.equal((await read('stock', stock.id)).gramsLeft, 20);
} else {
  console.log('Second-user isolation checks not run. Set TP_OTHER_AUTH to enable them.');
}

console.log(JSON.stringify({ verified: true, ownerId, petId: pet.id, foodId: food.id, stockId: stock.id, vetNoteId: note.id, feedingId: fed.feeding.id }));
console.log('Fixtures retained for wp-admin screenshots. Run the separate README Action Scheduler commands to verify the shopping-list job.');
