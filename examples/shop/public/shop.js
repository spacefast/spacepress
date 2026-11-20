import { cart } from '@typedpress/client';
const element = (name, text, className) => { const e = document.createElement(name); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
const amount = (value, currency) => `${value} ${currency}`;
class MiniCart extends HTMLElement {
  connectedCallback() {
    const link = this.querySelector('a') || this.appendChild(element('a')); link.href = '/cart';
    const show = data => {
      link.textContent = `Cart (${data.itemsCount})`;
      const asset = document.querySelector('meta[name="tp-woo-checkout-script"]')?.content;
      if (data.itemsCount && asset && !document.head.querySelector('[data-shop-checkout-prefetch]')) {
        const hint = element('link'); hint.rel = 'prefetch'; hint.as = 'script'; hint.href = asset;
        hint.setAttribute('data-shop-checkout-prefetch', ''); document.head.appendChild(hint);
      }
    };
    this.stop = cart.subscribe(show); cart.get().catch(() => {});
  }
  disconnectedCallback() { this.stop?.(); }
}
class AddToCart extends HTMLElement {
  connectedCallback() {
    this.button = this.querySelector('button');
    this.button.onclick = async () => {
      this.button.disabled = true;
      const status = this.querySelector('[role=status]') || this.appendChild(element('p'));
      status.setAttribute('role', 'status'); status.textContent = '';
      try { await cart.add(Number(this.dataset.product)); status.textContent = 'Added to your cart.'; }
      catch (error) { status.textContent = error.message; }
      finally { this.button.disabled = false; }
    };
  }
}
class Cart extends HTMLElement {
  connectedCallback() {
    this.stop = cart.subscribe(data => this.render(data));
    cart.get().catch(error => this.replaceChildren(element('p', error.message, 'shop-error')));
  }
  disconnectedCallback() { this.stop?.(); }
  async change(action, button) {
    if (this.busy) return;
    this.busy = true;
    this.focusControl = this.contains(document.activeElement) ? document.activeElement.dataset.cartControl : undefined;
    for (const control of this.querySelectorAll('button,input,select')) control.disabled = true;
    this.querySelector('.shop-checkout')?.setAttribute('aria-disabled', 'true');
    try { await action(); }
    catch (error) { if (this.data) this.render(this.data); const message = element('p', error.message, 'shop-error'); message.setAttribute('role', 'alert'); this.appendChild(message); }
    finally { this.busy = false; for (const control of this.querySelectorAll('button,input,select')) control.disabled = false; this.querySelector('.shop-checkout')?.removeAttribute('aria-disabled'); this.focusControl = undefined; }
  }
  render(data) {
    this.data = data;
    const focus = this.focusControl || (this.contains(document.activeElement) ? document.activeElement.dataset.cartControl : undefined);
    const previousCountry = this.querySelector('[aria-label="Shipping country"]');
    const previousPostcode = this.querySelector('[name="postcode"]');
    if (previousCountry) this.destination = { country: previousCountry.value, postcode: previousPostcode.value };
    if (!data.items.length) { const empty = element('p', 'Your cart is empty. Explore the collection to find something you like.'); empty.tabIndex = -1; this.replaceChildren(empty); if (focus) empty.focus(); return; }
    const list = element('div');
    for (const item of data.items) {
      const line = element('section', undefined, 'cart-line'); const info = element('div');
      info.append(element('h2', item.name), element('span', amount(item.totals.lineTotal, data.totals.currencyCode)));
      const controls = element('div', undefined, 'cart-controls');
      for (const [label, quantity] of [['−', item.quantity - 1], ['+', item.quantity + 1]]) {
        const button = element('button', label); button.type = 'button'; button.setAttribute('aria-label', `${label === '+' ? 'Increase' : 'Decrease'} ${item.name} quantity`);
        button.dataset.cartControl = `${item.key}:${label}`;
        button.onclick = () => this.change(() => quantity ? cart.update(item.key, quantity) : cart.remove(item.key), button);
        if (label === '−') controls.append(button, element('span', String(item.quantity))); else controls.append(button);
      }
      const remove = element('button', 'Remove'); remove.type = 'button'; remove.dataset.cartControl = `${item.key}:remove`; remove.onclick = () => this.change(() => cart.remove(item.key), remove); controls.append(remove);
      line.append(info, controls); list.append(line);
    }
    const parts = [list];
    if (data.needsShipping) {
      const form = element('form', undefined, 'shipping-estimate'); const country = element('select'); country.setAttribute('aria-label', 'Shipping country');
      for (const [code, name] of [['PL', 'Poland'], ['DE', 'Germany']]) { const option = element('option', name); option.value = code; country.append(option); }
      const postcode = element('input'); postcode.name = 'postcode'; postcode.placeholder = 'Postcode'; postcode.setAttribute('aria-label', 'Shipping postcode');
      country.value = this.destination?.country || 'PL'; postcode.value = this.destination?.postcode || '';
      country.dataset.cartControl = 'country'; postcode.dataset.cartControl = 'postcode';
      const button = element('button', 'Estimate shipping'); form.append(country, postcode, button);
      button.dataset.cartControl = 'estimate';
      form.onsubmit = event => { event.preventDefault(); this.change(() => cart.updateCustomer({ shipping: { country: country.value, postcode: postcode.value } }), button); };
      parts.push(form);
      for (const pack of data.shippingRates) {
        const rates = element('fieldset'); rates.append(element('legend', pack.name));
        for (const rate of pack.rates) { const label = element('label'); const input = element('input'); input.type = 'radio'; input.name = `shipping-${pack.packageId}`; input.dataset.cartControl = `shipping-${pack.packageId}:${rate.id}`; input.checked = rate.selected; input.onchange = () => this.change(() => cart.selectShipping(pack.packageId, rate.id)); label.append(input, document.createTextNode(`${rate.name} · ${amount(rate.price, rate.currencyCode)}`)); rates.append(label); }
        parts.push(rates);
      }
    }
    const total = element('p', `Total ${amount(data.totals.totalPrice, data.totals.currencyCode)}`, 'cart-total');
    const checkout = element('a', 'Continue to checkout', 'shop-checkout'); checkout.href = '/checkout';
    // Checkout must read the cart Woo confirmed, so the link waits for a pending write.
    checkout.onclick = event => { if (this.busy) event.preventDefault(); };
    if (this.busy) checkout.setAttribute('aria-disabled', 'true');
    parts.push(total, checkout); this.replaceChildren(...parts);
    if (focus) (Array.from(this.querySelectorAll('[data-cart-control]')).find(control => control.dataset.cartControl === focus) || this.querySelector('[data-cart-control]'))?.focus();
  }
}
for (const [name, component] of [['shop-mini-cart', MiniCart], ['shop-add-to-cart', AddToCart], ['shop-cart', Cart]]) { if (!customElements.get(name)) customElements.define(name, component); }
