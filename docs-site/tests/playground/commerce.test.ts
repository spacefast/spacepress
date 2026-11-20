// Native Woo commerce on the same WordPress/PHP-WASM/SQLite runtime as the published Playground.
// Run: cargo build && cd docs-site && pnpm exec node --test tests/playground/commerce.test.ts
// CHROME_CHANNEL=chrome uses an installed Chrome instead of Playwright's downloaded Chromium.
import { runCLI, type RunCLIServer } from '@wp-playground/cli';
import { chromium, expect as baseExpect, type Browser, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const expect = baseExpect.configure({ timeout: 20_000 });
const project = mkdtempSync(path.join(tmpdir(), 'typedpress-commerce-'));
const target = path.resolve(root, process.env.CARGO_TARGET_DIR ?? 'target');
const binary = process.env.TP_BIN ? path.resolve(process.env.TP_BIN) : path.join(target, existsSync(path.join(target, 'debug/typedpress')) ? 'debug/typedpress' : 'release/typedpress');
let wordpress: RunCLIServer;
let browser: Browser;
let credential: string;
let base: string;
const cli = (args: string[], auth = false) => new Promise<{ code: number; text: string }>((resolve, reject) => {
  const child = spawn(binary, args, { env: { ...process.env, TP_TOKEN: '', ...(auth ? { TP_APP_PASSWORD: credential } : {}) } });
  let text = ''; child.stdout.on('data', chunk => { text += chunk; }); child.stderr.on('data', chunk => { text += chunk; });
  child.on('error', reject); child.on('exit', code => resolve({ code: code ?? 1, text }));
});
async function runPhp(site: RunCLIServer, code: string): Promise<any> {
  const result = await site.playground.run({ code: `<?php require '/wordpress/wp-load.php'; ${code}` });
  assert.equal(result.errors, '', result.errors);
  try { return JSON.parse(result.text); } catch { throw new Error(`Playground PHP returned non-JSON: ${result.text.slice(0, 1200)}`); }
}
const php = (code: string) => runPhp(wordpress, code);
async function sync(ok = true) {
  const out = await cli(['sync', project, '--site', base, '--no-commit', '--json'], true);
  const data = JSON.parse(out.text).data;
  assert.equal(out.code === 0 && data.conflicts.length === 0 && data.failed.length === 0 && data.refused.length === 0, ok, out.text);
  return out.text;
}
const api = async (resource: string) => {
  const response = await fetch(new URL(`/__tp/api/v1/${resource}`, base), { headers: { Authorization: `Basic ${Buffer.from(credential).toString('base64')}` } });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};
async function add(page: Page, slug: string) {
  await page.goto(new URL(`/products/${slug}`, base).href);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.getByText('Added to your cart.').waitFor();
}
async function checkout(page: Page, origin = base, country = 'PL') {
  const response = await page.goto(new URL('/checkout', origin).href);
  assert.match(response!.headers()['cache-control']!, /private.*no-store/);
  await page.getByLabel('Email address', { exact: true }).fill('buyer@example.test');
  const sameBilling = page.getByRole('checkbox', { name: 'Use same address for billing', exact: true });
  if (await sameBilling.count()) await sameBilling.check();
  for (const name of ['Shipping address', 'Billing address']) {
    const address = page.getByRole('group', { name, exact: true });
    if (!await address.count()) continue;
    await address.getByLabel('Country/Region', { exact: true }).selectOption(country);
    await address.getByLabel('First name', { exact: true }).fill('Test');
    await address.getByLabel('Last name', { exact: true }).fill('Buyer');
    await address.getByLabel('Address', { exact: true }).fill(country === 'PL' ? 'Rynek 2' : '10 Main Street');
    await address.getByLabel(/^(ZIP|Postal) code$/i).fill(country === 'PL' ? '31-042' : '10001');
    await address.getByLabel('City', { exact: true }).fill(country === 'PL' ? 'Kraków' : 'New York');
    if (country === 'US') {
      await address.getByLabel('State', { exact: true }).selectOption('NY');
      const phone = address.getByLabel('Phone', { exact: false });
      if (await phone.count()) await phone.fill('2125550100');
    }
  }
  await expect(page.getByRole('button', { name: 'Place Order', exact: true })).toBeEnabled();
}

// The Checkout Block sends an address edit 1.5 s after the last keystroke, or at once when an input
// loses focus, and disables Place Order while the answer recalculates shipping. Pressing the button
// with an unsent edit therefore starts the request on mousedown: the button is disabled before
// mouseup, WooCommerce 11.3.0 drops the click, no order is placed and the button comes back enabled.
// A test types faster than 1.5 s, so it sends the edits and waits for the answer before it clicks.
async function placeOrder(page: Page) {
  const settled = () => page.waitForFunction(() => {
    const { select } = (window as any).wp.data;
    return !select('wc/store/cart').isCustomerDataUpdating() && !select('wc/store/checkout').isCalculating();
  });
  await settled();
  const email = page.getByLabel('Email address', { exact: true });
  await email.focus();
  await email.blur();
  await settled();
  await page.getByRole('button', { name: 'Place Order', exact: true }).click();
}

async function bootWoo(project: string, appName: string) {
  const content = path.join(project, 'tp/dist/wp-content');
  const manifest = JSON.parse(readFileSync(path.join(content, 'typedpress-manifest.json'), 'utf8'));
  // A copy is essential: Playground prepares its SQLite integration directory while booting.
  const sqlite = path.join(project, 'sqlite');
  const acquired = await promisify(execFile)('php', ['-r', `require ${JSON.stringify(path.join(root, 'tests/php/wp.php'))}; echo wpPlugin('sqlite-database-integration', WP_SQLITE_VERSION, WP_SQLITE_SHA256);`]);
  cpSync(acquired.stdout.trim(), sqlite, { recursive: true });
  const wordpress = await runCLI({ command: 'server', port: 0, wp: '7.2-beta5', php: '8.4', login: false, verbosity: 'quiet',
    mount: [...readdirSync(path.join(content, 'plugins'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => ({ hostPath: path.join(content, 'plugins', d.name), vfsPath: `/wordpress/wp-content/plugins/${d.name}` })),
      { hostPath: sqlite, vfsPath: '/internal/shared/sqlite-database-integration' }],
    blueprint: { steps: [
      { step: 'defineWpConfigConsts', consts: { WP_DEBUG: true, WP_DEBUG_LOG: true, WP_DEBUG_DISPLAY: false, WP_ENVIRONMENT_TYPE: 'local', WP_MEMORY_LIMIT: '512M' } },
      { step: 'mkdir', path: '/wordpress/wp-content/uploads' },
      { step: 'writeFile', path: '/wordpress/wp-content/uploads/guide.pdf', data: '%PDF-1.4\nTypedPress commerce test\n%%EOF' },
      { step: 'writeFile', path: '/wordpress/wp-content/mu-plugins/commerce-proof.php', data: `<?php
add_filter('pre_wp_mail', static function($pre,$mail){$all=get_option('tp_test_mail',[]);$all[]=$mail;update_option('tp_test_mail',$all);return true;},10,2);
add_filter('woocommerce_allow_tracking','__return_false');
add_action('plugins_loaded',static function(){if(!class_exists('WC_Gateway_COD'))return;
 class TP_Commerce_Test_Gateway extends WC_Gateway_COD {
  public function process_payment($id) {
   if(get_option('tp_test_decline')) {delete_option('tp_test_decline');wc_add_notice('Test payment declined. Retry this order.','error');return ['result'=>'failure'];}
   $order=wc_get_order($id);$order->payment_complete('playground-dummy-'.$id);WC()->cart->empty_cart();return ['result'=>'success','redirect'=>$this->get_return_url($order)];
  }
 }
 add_filter('woocommerce_payment_gateways',static fn($all)=>array_map(static fn($c)=>$c==='WC_Gateway_COD'?'TP_Commerce_Test_Gateway':$c,$all));
},1);
` },
      { step: 'setSiteOptions', options: { permalink_structure: '/%postname%/', woocommerce_custom_orders_table_enabled: 'no', woocommerce_custom_orders_table_data_sync_enabled: 'no' } },
    ] } as never,
  });
  const base = wordpress.serverUrl;
  await wordpress.playground.writeFile('/wordpress/wp-content/mu-plugins/typedpress-commerce.php', readFileSync(path.join(content, 'mu-plugins/typedpress-commerce.php'), 'utf8'));
  for (const slug of [...Object.keys(manifest.requires), 'typedpress-runtime', `typedpress-app-${appName}`, 'typedpress-admin']) {
    const file = slug === 'secure-custom-fields' ? `${slug}/secure-custom-fields.php` : `${slug}/${slug}.php`;
    await runPhp(wordpress, `require_once ABSPATH.'wp-admin/includes/plugin.php';$r=activate_plugin(${JSON.stringify(file)});if(is_wp_error($r)){throw new Exception($r->get_error_message());}echo 'true';`);
  }
  const credential = await runPhp(wordpress, `[$password]=WP_Application_Passwords::create_new_application_password(1,['name'=>'Disposable commerce test']);flush_rewrite_rules(false);echo wp_json_encode('admin:'.$password);`);
  await runPhp(wordpress, `echo wp_json_encode(['products'=>wc_get_products(['limit'=>-1,'return'=>'ids']),'zones'=>array_column(WC_Shipping_Zones::get_zones(),'zone_name')]);`);
  return { wordpress, base, credential };
}

before(async () => {
  writeFileSync(path.join(project, 'typedpress.config.ts'), `import {defineConfig} from 'typedpress'; export default defineConfig({name:'shop'});`);
  for (const args of [['add', 'shop', project], ['build', project]]) {
    const out = await cli(args); assert.equal(out.code, 0, out.text);
    if (args[0] === 'add') {
      const guide = path.join(project, 'content/products/field-guide.md');
      writeFileSync(guide, readFileSync(guide, 'utf8').replace(/file: https:[^\n]+/, 'file: /wordpress/wp-content/uploads/guide.pdf'));
    }
  }
  ({ wordpress, base, credential } = await bootWoo(project, 'shop'));
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_CHANNEL ? { channel: process.env.CHROME_CHANNEL } : {}) });
}, { timeout: 300_000 });
after(async () => { await browser?.close(); await wordpress?.[Symbol.asyncDispose](); rmSync(project, { recursive: true, force: true }); });

test('catalog and category links reach products past the first 24', { timeout: 150_000 }, async () => {
  const ids = await php(`
    $term = wp_insert_term('Spring collection', 'product_cat', ['slug' => 'spring-collection', 'parent' => get_term_by('slug', 'home', 'product_cat')->term_id]);
    $ids = [];
    for ($i = 1; $i <= 25; $i++) {
        $p = new WC_Product_Simple(); $p->set_name('Spring item '.$i); $p->set_status('publish');
        $p->set_category_ids([$term['term_id']]); $p->set_regular_price('10'); $p->save(); $ids[] = $p->get_id();
    }
    echo wp_json_encode($ids);
  `);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    for (const listing of ['/shop', '/shop/home/spring-collection']) {
      await page.goto(new URL(listing, base).href);
      const cards = page.locator('.product-card h2');
      await expect(cards).toHaveCount(24);
      const first = await cards.allTextContents();
      await page.getByRole('link', { name: 'Next', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Spring item 25', exact: true })).toBeVisible();
      const second = await cards.allTextContents();
      assert.ok(second.every(name => !first.includes(name)));
      if (listing !== '/shop') assert.deepEqual(second, ['Spring item 25']);
      await expect(page.getByRole('link', { name: 'Next', exact: true })).toHaveCount(0);
      await page.getByRole('link', { name: 'Previous', exact: true }).click();
      await expect(cards).toHaveText(first);
    }
    assert.equal((await page.request.get(new URL('/shop/wrong-parent/spring-collection', base).href)).status(), 404);
  } finally {
    await page.close();
    await php(`foreach ([${ids.join(',')}] as $id) { wc_get_product($id)->delete(true); }
      wp_delete_term(get_term_by('slug', 'spring-collection', 'product_cat')->term_id, 'product_cat'); echo 'true';`);
  }
});

test('storefront offers direct purchase only for simple products', { timeout: 90_000 }, async () => {
  // Woo extensions can make a variable parent purchasable while checkout still needs a variation ID.
  const extension = '/wordpress/wp-content/mu-plugins/variable-purchase-proof.php';
  await wordpress.playground.writeFile(extension, "<?php add_filter('woocommerce_is_purchasable', static fn($ok, $p) => $p->get_slug() === 'workshop-dates' || $ok, 10, 2);");
  const [id, serviceId] = await php(`
    $p = new WC_Product_Variable();
    $p->set_name('Workshop with a choice of dates'); $p->set_slug('workshop-dates'); $p->set_status('publish'); $p->save();
    $v = new WC_Product_Variation(); $v->set_parent_id($p->get_id()); $v->set_regular_price('12'); $v->set_status('publish'); $v->save();
    WC_Product_Variable::sync($p->get_id());
    $service = new WC_Product_Simple(); $service->set_name('Workshop session'); $service->set_slug('workshop-session');
    $service->set_virtual(true); $service->set_regular_price('15'); $service->set_status('publish'); $service->save();
    echo wp_json_encode([$p->get_id(), $service->get_id()]);
  `);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    const products = await api('products');
    assert.equal(products.data.find((product: any) => product.id === id)?.purchasable, true);
    await page.goto(new URL('/products/workshop-dates', base).href);
    await expect(page.getByText('Currently unavailable')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to cart' })).toHaveCount(0);
    await expect(page.getByText('Price unavailable', { exact: true })).toBeVisible();
    await page.goto(new URL('/shop', base).href);
    const card = page.locator('article').filter({ has: page.getByRole('link', { name: 'Workshop session' }) });
    await expect(card.getByText('Available', { exact: true })).toBeVisible();
    await card.getByRole('link').click();
    await expect(page.getByRole('button', { name: 'Add to cart' })).toBeVisible();
    await expect(page.getByText('Digital download, delivered after payment.')).toHaveCount(0);
    await page.goto(new URL('/products/field-guide', base).href);
    await expect(page.getByText('Digital download, delivered after payment.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to cart' })).toBeVisible();
  } finally {
    await page.close();
    await wordpress.playground.unlink(extension);
    await php(`wc_get_product(${id})->delete(true); wc_get_product(${serviceId})->delete(true); echo 'true';`);
  }
});

// These long journeys issue many PHP-WASM requests; shared CI runners can take over two minutes.
// Keep individual browser/assertion deadlines short so missing UI still fails promptly.
test('fresh storefront, cart, shipping, stock rejection and native stock gateway checkout', { timeout: 240_000 }, async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(20_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const catalog = await page.goto(new URL('/shop', base).href);
  const publicProducts = await (await page.request.get(new URL('/__tp/api/v1/products', base).href)).json();
  const publicGuide = publicProducts.data.find((product: any) => product.sku === 'GUIDE-PDF');
  assert.equal(publicGuide.downloads[0].id, 'field-guide');
  assert.equal('file' in publicGuide.downloads[0], false, 'the public catalog must not disclose backing download locations');
  await expect(page.getByRole('link', { name: 'Everyday objects' })).toBeVisible();
  assert.match(catalog!.headers()['cache-control']!, /public/);
  for (const [old, canonical] of [['/product/ceramic-mug', '/products/ceramic-mug'], ['/product-category/home', '/shop/home'], ['/?post_type=product', '/shop']]) {
    const alias = await page.request.get(new URL(old, base).href, { maxRedirects: 0 });
    assert.equal(alias.status(), 301, old);
    assert.equal(new URL(alias.headers().location!).pathname.replace(/\/$/, ''), canonical);
  }
  await expect(page.getByRole('link', { name: 'Ceramic mug', exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(tmpdir(), 'typedpress-commerce-catalog.png'), fullPage: true });
  await add(page, 'ceramic-mug');
  const cartPage = await page.goto(new URL('/cart', base).href);
  assert.match(cartPage!.headers()['cache-control']!, /private.*no-store/);
  assert.equal(cartPage!.headers()['x-robots-tag'], 'noindex');
  for (const path of ['/%63art', '/%63heckout']) {
    const response = await page.request.get(new URL(path, base).href);
    assert.equal(response.status(), 200, path);
    assert.match(response.headers()['cache-control']!, /private.*no-store/, path);
    assert.equal(response.headers()['x-robots-tag'], 'noindex', path);
  }
  for (const path of ['/cart.md', '/checkout.md']) { assert.equal((await page.request.get(new URL(path, base).href)).status(), 404, path); }
  assert.doesNotMatch(await (await page.request.get(new URL('/llms.txt', base).href)).text(), /\/(?:cart|checkout)\.md/);
  await page.getByRole('button', { name: 'Increase Ceramic mug quantity' }).click();
  await page.getByText('Total 63.00 EUR').waitFor();
  await expect(page.getByRole('button', { name: 'Increase Ceramic mug quantity' })).toBeFocused();
  const miniCart = page.locator('shop-mini-cart a');
  await miniCart.focus();
  await page.evaluate(async () => { const client = await import('@typedpress/client'); await client.cart.get(); });
  await expect(miniCart).toBeFocused();
  let quantityWrites = 0;
  const countQuantity = (request: { url(): string }) => { if (request.url().endsWith('/cart/update-item')) quantityWrites++; };
  page.on('request', countQuantity);
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('shop-cart button'));
    buttons.find(button => button.getAttribute('aria-label') === 'Increase Ceramic mug quantity')!.click();
    buttons.find(button => button.getAttribute('aria-label') === 'Decrease Ceramic mug quantity')!.click();
  });
  await page.getByText('Total 87.00 EUR').waitFor();
  assert.equal(quantityWrites, 1, 'controls stay disabled while a quantity write is pending');
  page.off('request', countQuantity);
  await page.getByRole('button', { name: 'Decrease Ceramic mug quantity' }).click();
  await page.getByText('Total 63.00 EUR').waitFor();
  await page.evaluate(async () => { const { cart } = await import('@typedpress/client'); const data = await cart.get(); await cart.update(data.items[0].key, 9); });
  await expect(page.locator('shop-cart input[type=radio]')).toHaveCount(2);
  const selectedRate = await page.locator('shop-cart input[type=radio]:checked').getAttribute('data-cart-control');
  await page.route('**/cart/select-shipping-rate', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'shipping_failed', message: 'Try shipping again.' }) }));
  await page.locator('shop-cart input[type=radio]:not(:checked)').check();
  await expect(page.getByRole('alert')).toHaveText('Try shipping again.');
  assert.equal(await page.locator('shop-cart input[type=radio]:checked').getAttribute('data-cart-control'), selectedRate);
  await page.unroute('**/cart/select-shipping-rate');
  await page.evaluate(async () => { const { cart } = await import('@typedpress/client'); const data = await cart.get(); await cart.update(data.items[0].key, 2); });
  await page.getByText('Total 63.00 EUR').waitFor();
  await page.getByLabel('Shipping country', { exact: true }).selectOption('DE');
  await page.getByLabel('Shipping postcode', { exact: true }).fill('10115');
  await page.getByRole('button', { name: 'Estimate shipping' }).click();
  await page.getByText('Total 73.00 EUR').waitFor();
  await expect(page.getByLabel('Shipping country', { exact: true })).toHaveValue('DE');
  await expect(page.getByLabel('Shipping postcode', { exact: true })).toHaveValue('10115');
  await expect(page.getByRole('button', { name: 'Estimate shipping' })).toBeFocused();
  await page.screenshot({ path: path.join(tmpdir(), 'typedpress-commerce-cart.png'), fullPage: true });
  await page.getByLabel('Shipping country', { exact: true }).selectOption('PL');
  await page.getByLabel('Shipping postcode', { exact: true }).fill('31-042');
  await page.getByRole('button', { name: 'Estimate shipping' }).click();
  await page.getByText('Total 63.00 EUR').waitFor();
  // Browser and Checkout Block use one cookie session, including recalculated shipping.
  await checkout(page);
  await expect(page.locator('.wc-block-components-totals-footer-item')).toContainText('63.00');
  await page.getByLabel('Country/Region', { exact: true }).selectOption('DE');
  await page.getByLabel('Postal code', { exact: true }).fill('10115');
  await page.getByLabel('City', { exact: true }).fill('Berlin');
  await expect(page.locator('.wc-block-components-totals-footer-item')).toContainText('73.00');
  await page.getByLabel('Country/Region', { exact: true }).selectOption('PL');
  await page.getByLabel('Postal code', { exact: true }).fill('31-042');
  await page.getByLabel('City', { exact: true }).fill('Kraków');
  await expect(page.locator('.wc-block-components-totals-footer-item')).toContainText('63.00');
  await page.screenshot({ path: path.join(tmpdir(), 'typedpress-commerce-checkout.png'), fullPage: true });
  // Replace the test gateway with the stock gateway for this purchase.
  await php(`update_option('tp_test_stock_gateway',true);echo 'true';`);
  await wordpress.playground.writeFile('/wordpress/wp-content/mu-plugins/stock-gateway.php', `<?php add_filter('woocommerce_payment_gateways',static fn($all)=>array_map(static fn($c)=>$c==='TP_Commerce_Test_Gateway'?'WC_Gateway_COD':$c,$all),100);`);
  await placeOrder(page);
  await page.waitForURL('**/checkout/order-received/**');
  await expect(page.getByText('Thank you. Your order has been received.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Everyday objects' })).toBeVisible();
  assert.match((await page.request.get(page.url())).headers()['cache-control']!, /private.*no-store/);
  const orders = await api('orders'); assert.equal(orders.data.at(-1).total, '63.00');
  await wordpress.playground.unlink('/wordpress/wp-content/mu-plugins/stock-gateway.php');
  // Native Store API refuses a coupon and quantities beyond tracked stock.
  await php(`$p=wc_get_product(wc_get_product_id_by_sku('MUG-BLUE'));$p->set_manage_stock(true);$p->set_stock_quantity(1);$p->set_backorders('yes');$p->save();echo 'true';`);
  await page.goto(new URL('/shop', base).href);
  const refused = await page.evaluate(async () => {
    const get = await fetch('/wp-json/wc/store/v1/cart'); const nonce = get.headers.get('Nonce')!;
    const products = await (await fetch('/__tp/api/v1/products')).json();
    const post = (path: string, data: unknown) => fetch(`/wp-json/wc/store/v1/cart/${path}`, { method: 'POST', headers: { Nonce: nonce, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.status);
    return [await post('add-item', { id: products.data.find((p: any) => p.sku === 'MUG-BLUE').id, quantity: 2 }), await post('apply-coupon', { code: 'TEST' })];
  });
  assert.ok(refused.every(status => status >= 400), JSON.stringify(refused));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(new URL('/shop', base).href);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(tmpdir(), 'typedpress-commerce-mobile.png'), fullPage: true });
  await php(`$p=wc_get_product(wc_get_product_id_by_sku('MUG-BLUE'));$p->set_name('Handmade ceramic mug for slow mornings, shared tables and a very long product name');$p->save();echo 'true';`);
  await page.reload();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: path.join(tmpdir(), 'typedpress-commerce-long-title.png'), fullPage: true });
  await php(`$p=wc_get_product(wc_get_product_id_by_sku('MUG-BLUE'));$p->set_name('Ceramic mug');$p->save();echo 'true';`);
  assert.deepEqual(errors, []);
  await page.close();
});

test('dummy gateway decline/retry, native paid download grants, receipt and email', { timeout: 90_000 }, async () => {
  await php(`update_option('tp_test_decline',true);echo 'true';`);
  const context = await browser.newContext(); const page = await context.newPage();
  await add(page, 'field-guide'); await checkout(page);
  await placeOrder(page);
  await page.getByText('Test payment declined. Retry this order.', { exact: true }).first().waitFor();
  await placeOrder(page);
  await page.waitForURL('**/checkout/order-received/**');
  await expect(page.getByText('Thank you. Your order has been received.')).toBeVisible();
  const download = page.locator('a[href*="download_file="]').first();
  await expect(download).toBeVisible();
  const url = (await download.getAttribute('href'))!;
  const response = await context.request.get(url);
  if (response.status() !== 200) {
    console.log('download diagnostic', await php(`$p=wc_get_product(wc_get_product_id_by_sku('GUIDE-PDF'));echo wp_json_encode(['downloads'=>array_map(static fn($d)=>$d->get_data(),$p->get_downloads()),'file'=>file_exists(ABSPATH.'wp-content/uploads/guide.pdf'),'login'=>get_option('woocommerce_downloads_require_login')]);`));
  }
  assert.equal(response.status(), 200, (await response.body()).toString().replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]*>/g, '').slice(-1800));
  assert.match((await response.body()).toString(), /^%PDF/);
  const denied = new URL(url); denied.searchParams.set('key', 'invalid');
  assert.ok((await context.request.get(denied.href)).status() >= 400);
  const result = await php(`$all=wc_get_orders(['limit'=>1,'orderby'=>'id','order'=>'DESC']);$o=$all[0];echo wp_json_encode(['paid'=>$o->is_paid(),'downloads'=>$o->get_downloadable_items(),'mail'=>get_option('tp_test_mail',[])]);`);
  assert.equal(result.paid, true); assert.equal(result.downloads[0].download_id, 'field-guide');
  assert.ok(result.mail.some((m: any) => m.message.includes('download_file=') && m.message.includes('field-guide')));
  await page.screenshot({ path: path.join(tmpdir(), 'typedpress-commerce-receipt.png'), fullPage: true });
  await context.close();
});

test('real CLI sync pushes, pulls, conflicts, retries and preserves Woo operational data', { timeout: 240_000 }, async () => {
  await sync();
  const file = path.join(project, 'content/products/ceramic-mug.md');
  const original = readFileSync(file, 'utf8');
  writeFileSync(file, original.replace('price: "24.00"', 'price: "26.00"'));
  await sync();
  let mug = (await api('products')).data.find((p: any) => p.sku === 'MUG-BLUE'); assert.equal(mug.price, '26.00');
  await php(`$p=wc_get_product(wc_get_product_id_by_sku('MUG-BLUE'));$p->set_name('Merchant mug');$p->save();echo 'true';`);
  await sync(); assert.match(readFileSync(file, 'utf8'), /Merchant mug/);
  writeFileSync(file, readFileSync(file, 'utf8').replace('Merchant mug', 'Source mug'));
  await php(`$p=wc_get_product(wc_get_product_id_by_sku('MUG-BLUE'));$p->set_name('Conflicting mug');$p->save();echo 'true';`);
  assert.match(await sync(false), /conflict/i);
  // Resolve through the normal source-wins workflow, then prove a failed item can be retried.
  const conflict = path.join(project, '.tp/conflicts', `${mug.uid}.md`);
  writeFileSync(conflict, readFileSync(conflict, 'utf8').replace(/<<<<<<<[^\n]*\n([\s\S]*?)\|\|\|\|\|\|\| base\n[\s\S]*?>>>>>>>[^\n]*\n/g, '$1'));
  const resolve = await cli(['sync', 'resolve', mug.uid, project, '--site', base, '--no-commit', '--json'], true);
  assert.equal(resolve.code, 0, resolve.text);
  await sync();
  writeFileSync(file, readFileSync(file, 'utf8').replace('price: "26.00"', 'price: "27.00"'));
  writeFileSync(path.join(project, 'content/products/retry.md'), '---\nuid: zr_aaaaaaaaaaaaaaaaaaaa\nname: Retry product\nsku: MUG-BLUE\nprice: "5.00"\n---\nRetry\n');
  await sync(false);
  assert.equal((await api('products')).data.find((p: any) => p.sku === 'MUG-BLUE').price, '27.00', 'a failed item must not undo another successful sync');
  const retry = path.join(project, 'content/products/retry.md');
  writeFileSync(retry, readFileSync(retry, 'utf8').replace('sku: MUG-BLUE', 'sku: RETRY'));
  await sync();
  const created = readdirSync(path.dirname(retry)).find(name => readFileSync(path.join(path.dirname(retry), name), 'utf8').includes('zr_aaaaaaaaaaaaaaaaaaaa'))!;
  rmSync(path.join(path.dirname(retry), created)); await sync();
  assert.ok((await api('products')).data.some((p: any) => p.sku === 'RETRY'), 'file removal must not delete a product');
  const native = await php(`$p=wc_get_product(wc_get_product_id_by_sku('MUG-BLUE'));$o=wc_get_orders(['limit'=>-1]);echo wp_json_encode(['stock'=>$p->get_stock_quantity(),'orders'=>count($o),'downloads'=>array_keys(wc_get_product(wc_get_product_id_by_sku('GUIDE-PDF'))->get_downloads())]);`);
  assert.equal(native.stock, 1); assert.ok(native.orders >= 2); assert.deepEqual(native.downloads, ['field-guide']);
  const guide = path.join(project, 'content/products/field-guide.md');
  const grants = () => php(`$all=WC_Data_Store::load('customer-download')->get_downloads(['product_id'=>wc_get_product_id_by_sku('GUIDE-PDF')]);echo wp_json_encode(array_map(static fn($d)=>[$d->get_id(),$d->get_download_id(),$d->get_order_id()],$all));`);
  const permissions = await grants(); assert.ok(permissions.length > 0);
  const before = readFileSync(guide, 'utf8'); await sync(); assert.equal(readFileSync(guide, 'utf8'), before);
  assert.deepEqual(await grants(), permissions, 'unchanged sync preserves native download entitlements');
});

test('Drive Store carries the generated cart session into native checkout and logs the sale', { timeout: 360_000 }, async () => {
  const drive = mkdtempSync(path.join(tmpdir(), 'typedpress-drive-woo-'));
  let site: Awaited<ReturnType<typeof bootWoo>> | undefined;
  const page = await browser.newPage();
  try {
    const example = path.join(root, 'examples/drive-store');
    for (const entry of ['typedpress.config.ts', 'tp', 'content', 'public']) {
      cpSync(path.join(example, entry), path.join(drive, entry), {
        recursive: true,
        filter: (source) => !['dist', '.tp', 'drive-source'].includes(path.basename(source)),
      });
    }
    const build = await cli(['build', drive]);
    assert.equal(build.code, 0, build.text);
    site = await bootWoo(drive, 'drive-store');
    const { wordpress: driveWordPress } = site;
    const run = (code: string) => runPhp(driveWordPress, code);
    await run(`update_option('tp_test_stock_gateway',true);
      $p=wc_get_product(wc_get_product_id_by_sku('SEAGATE-EXOS-X16'));
      wc_update_product_stock($p, 2, 'increase');
      echo 'true';`);
    await site.wordpress.playground.writeFile('/wordpress/wp-content/mu-plugins/stock-gateway.php', `<?php add_filter('woocommerce_payment_gateways',static fn($all)=>array_map(static fn($c)=>$c==='TP_Commerce_Test_Gateway'?'WC_Gateway_COD':$c,$all),100);`);
    await page.goto(new URL('/drives/seagate-exos-x16', site.base).href);
    await expect(page.getByText('2 in stock')).toBeVisible();
    await expect(page.getByText('SMART power-on hours')).toBeVisible();
    await page.getByRole('button', { name: 'Add to cart' }).click();
    await expect(page.getByText('Added to your cart.')).toBeVisible();
    await page.getByRole('link', { name: 'View cart' }).click();
    await expect(page.getByText('Seagate Exos X16 16 TB')).toBeVisible();
    await page.getByRole('spinbutton', { name: 'Quantity' }).fill('2');
    await page.getByRole('button', { name: 'Update' }).click();
    await expect(page.getByText('278.00 USD', { exact: true })).toBeVisible();
    await checkout(page, site.base, 'US');
    await expect(page.locator('.wc-block-components-totals-footer-item')).toContainText('286.00');
    await placeOrder(page);
    await page.waitForURL('**/checkout/order-received/**');
    const result = await run(`
      $id=wc_get_product_id_by_sku('SEAGATE-EXOS-X16');
      $order=wc_get_orders(['status'=>'processing','limit'=>1])[0];
      $plugin=\\TypedPress\\Wp\\Runtime::plugin();
      $viewer=new \\TypedPress\\Viewer(['id'=>1,'name'=>'Admin','role'=>'admin']);
      $rows=$plugin->app()->db->findMany('stock_movements', ['where'=>['reason'=>'sale']], $viewer);
      echo wp_json_encode(['stock'=>wc_get_product($id)->get_stock_quantity(),'order'=>$order->get_id(),
        'recorded'=>$rows[0]['order']??null,'change'=>$rows[0]['change']??null]);`);
    assert.deepEqual(result, { stock: 0, order: result.order, recorded: result.order, change: -2 });
    await page.goto(new URL('/drives/seagate-exos-x16', site.base).href);
    await expect(page.getByText('Sold out')).toBeVisible();
  } finally {
    await page.close();
    await site?.wordpress[Symbol.asyncDispose]();
    rmSync(drive, { recursive: true, force: true });
  }
});
