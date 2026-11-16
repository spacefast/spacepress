<?php declare(strict_types=1); defined('ABSPATH') || exit; ?>
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Everyday app services · TypedPress</title>
<style>
body{font:17px/1.5 system-ui,sans-serif;background:#f8f6f0;color:#17291d;margin:auto;max-width:900px;padding:40px 20px}h1{font-size:clamp(2rem,6vw,3.6rem);line-height:1.05}section{background:white;border:1px solid #d6decf;border-radius:14px;padding:24px;margin:24px 0}label{display:block;margin:12px 0}input,textarea,button{font:inherit;padding:10px;border-radius:6px;border:1px solid #a8b5a2}input,textarea{box-sizing:border-box;width:100%}button{background:#213e2a;color:white;cursor:pointer}button:disabled{opacity:.6}output{display:block;margin-top:14px;white-space:pre-wrap}.trap{position:absolute;left:-10000px}a{color:#245538}.muted{color:#5d685d}
</style></head><body>
<p>TYPEDPRESS / WORDPRESS</p><h1>Small app. Useful services.</h1>
<p>Send a message, find a published story, or open a secure hosted checkout.</p>
<section><h2>Leave a message</h2><form id="contact">
<label>Your email<input name="email" type="email" required maxlength="191" autocomplete="email"></label>
<label>Message<textarea name="message" required minlength="3" maxlength="2000" rows="4"></textarea></label>
<label class="trap" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
<button>Send message</button><output id="contact-state" aria-live="polite"></output></form></section>
<section><h2>Find a story</h2><form id="search"><label>Search published stories<input name="q" required minlength="2" maxlength="100" value="workshop"></label><button>Search</button></form><output id="search-state" aria-live="polite"></output><ul id="results"></ul></section>
<section><h2>Join the workshop</h2><p>WordPress workshop · $19 USD</p><button id="checkout">Open checkout</button> <button id="refresh" hidden>Refresh status</button><output id="checkout-state" aria-live="polite"></output><a id="checkout-link" hidden rel="noreferrer">Continue to secure checkout</a><p class="muted">Payment happens on Stripe. Your card details never enter this app. Checkout needs a configured provider.</p></section>
<script>
const api = <?= json_encode($api, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?>;
const byId = (id) => document.getElementById(id);
async function request(path, options = {}) {
  const response = await fetch(api + path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || 'Request failed');
  return body.data;
}
const post = (path, body, key) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
let formKey = crypto.randomUUID();
byId('contact').addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true;
  const input = new FormData(form);
  try {
    const result = await post('/forms/contact', { website: input.get('website'), data: { email: input.get('email'), message: input.get('message') } }, formKey);
    byId('contact-state').textContent = result.message + ' Email notification queued.'; form.reset(); formKey = crypto.randomUUID();
  } catch (error) { byId('contact-state').textContent = error.message; }
  finally { button.disabled = false; }
});
// Editing a failed request creates a new intent; retrying unchanged bytes keeps the same key.
byId('contact').addEventListener('input', () => { formKey = crypto.randomUUID(); });
byId('search').addEventListener('submit', async (event) => {
  event.preventDefault(); byId('results').replaceChildren();
  try {
    const result = await request('/search?collection=posts&q=' + encodeURIComponent(new FormData(event.currentTarget).get('q')));
    byId('search-state').textContent = result.results.length + (result.results.length === 1 ? ' published story' : ' published stories');
    for (const row of result.results) { const li = document.createElement('li'); li.textContent = row.title + (row.excerpt ? ' — ' + row.excerpt : ''); byId('results').append(li); }
  } catch (error) { byId('search-state').textContent = error.message; }
});
let checkoutToken = sessionStorage.getItem('typedpress-services-checkout');
let checkoutKey = crypto.randomUUID();
async function refresh() {
  if (!checkoutToken) return;
  byId('refresh').hidden = false;
  try {
    const status = await request('/checkout/' + checkoutToken);
    byId('checkout-state').textContent = 'Payment: ' + status.state + ' · checkout job: ' + status.delivery.state;
    byId('checkout-link').hidden = !status.checkoutUrl || ['paid', 'expired', 'failed'].includes(status.state);
    if (status.checkoutUrl) byId('checkout-link').href = status.checkoutUrl;
    if (status.delivery.state === 'dead' || ['paid', 'expired', 'failed'].includes(status.state)) checkoutKey = crypto.randomUUID();
  } catch (error) { byId('checkout-state').textContent = error.message; }
}
byId('checkout').addEventListener('click', async () => {
  byId('checkout').disabled = true;
  try { const result = await post('/checkout', { product: 'workshop' }, checkoutKey); checkoutToken = result.token; sessionStorage.setItem('typedpress-services-checkout', checkoutToken); await refresh(); }
  catch (error) { byId('checkout-state').textContent = error.message; }
  finally { byId('checkout').disabled = false; }
});
byId('refresh').addEventListener('click', refresh);
refresh();
</script></body></html>
