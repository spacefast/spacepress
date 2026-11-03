import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const example = fileURLToPath(new URL('.', import.meta.url));
const evidence = process.env.ZERO_SERVICES_EVIDENCE;
if (!evidence || !process.env.ZERO_SERVICES_PLAYWRIGHT) throw new Error('Set ZERO_SERVICES_EVIDENCE and ZERO_SERVICES_PLAYWRIGHT (path to an installed Playwright module)');
await mkdir(evidence, { recursive: true });
const { chromium } = await import(pathToFileURL(process.env.ZERO_SERVICES_PLAYWRIGHT).href);
const children = [];
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, 'exit'); child.kill('SIGTERM'); await done;
}
const env = { ...process.env, ZERO_SERVICES_RATE_SECRET: randomBytes(32).toString('hex'), ZERO_SERVICES_MAIL_TO: 'inbox@example.test', ZERO_SERVICES_MAIL_FROM: 'sender@example.test', ZERO_SERVICES_SMTP_ENCRYPTION: '' };
delete env.ZERO_SERVICES_STRIPE_SECRET;
delete env.ZERO_SERVICES_STRIPE_WEBHOOK_SECRET;
let browser;
let site;
try {
  const sink = spawn('python3', [example + 'smtp-sink.py', '--directory', evidence + '/mail'], { env }); children.push(sink);
  const lines = createInterface({ input: sink.stdout });
  const [readyLine] = await once(lines, 'line', { signal: AbortSignal.timeout(10000) }); lines.close();
  const ready = JSON.parse(readyLine);
  env.ZERO_SERVICES_SMTP_HOST = ready.host; env.ZERO_SERVICES_SMTP_PORT = String(ready.port);
  const server = spawn('php', ['-d', 'memory_limit=512M', example + 'run.php'], { env }); children.push(server);
  let log = ''; server.stderr.on('data', (data) => { log += data; });
  let url;
  for await (const line of createInterface({ input: server.stdout })) {
    if (line.startsWith('Example: ')) url = line.slice(9);
    if (line.startsWith('Owned site: ')) { site = line.slice(12); break; }
  }
  assert.ok(url && site, log);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByText('1 published story', { exact: true }).waitFor();
  assert.match(await page.locator('#results').innerText(), /A WordPress workshop for small apps/);
  await page.getByLabel('Your email').fill('visitor@example.test');
  await page.getByLabel('Message', { exact: true }).fill('Browser form through real WordPress and SMTP.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await page.getByText('Thanks — your message is saved. Email notification queued.', { exact: true }).waitFor();
  const worker = spawn('php', ['-d', 'memory_limit=512M', example + 'jobs.php', site], { env }); children.push(worker);
  assert.equal((await once(worker, 'exit'))[0], 0);
  const messages = (await readdir(evidence + '/mail')).filter((name) => name.endsWith('.eml'));
  assert.equal(messages.length, 1);
  assert.match(await readFile(evidence + '/mail/' + messages[0], 'utf8'), /Browser form through real WordPress and SMTP/);
  await page.getByRole('button', { name: 'Open checkout' }).click();
  await page.getByText('This service is not configured yet.', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  await page.screenshot({ path: evidence + '/example.png', fullPage: true });
  await writeFile(evidence + '/result.json', JSON.stringify({ search: 'real WordPress query', form: 'browser → REST → SQLite → Action Scheduler → SMTP bytes', checkout: 'unconfigured provider reported; no provider request', pageErrors: errors }, null, 2));
  process.stdout.write('services browser: search, durable form, SMTP effect and provider-unconfigured state passed\n');
} finally {
  await browser?.close();
  for (const child of children.reverse()) await stop(child);
  let siteRemoved = false;
  if (site) { try { await access(site); } catch { siteRemoved = true; } }
  await writeFile(evidence + '/cleanup.json', JSON.stringify({ site, siteRemoved, childProcessesStopped: children.every((child) => child.exitCode !== null || child.signalCode !== null) }, null, 2));
}
