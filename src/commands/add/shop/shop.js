import { cart } from '@typedpress/client';
const element = (name, text, className) => { const e = document.createElement(name); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
const amount = (value, currency) => `${value} ${currency}`;
class MiniCart extends HTMLElement {
  connectedCallback() {
    const show = data => { const link = element('a', `Cart (${data.itemsCount})`); link.href = '/cart'; this.replaceChildren(link); };
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
    if (button) button.disabled = true;
    try { await action(); }
    catch (error) { const message = element('p', error.message, 'shop-error'); message.setAttribute('role', 'alert'); this.appendChild(message); }
    finally { if (button) button.disabled = false; }
  }
  render(data) {
    if (!data.items.length) { this.replaceChildren(element('p', 'Your cart is empty. Explore the collection to find something you like.')); return; }
    const list = element('div');
    for (const item of data.items) {
      const line = element('section', undefined, 'cart-line'); const info = element('div');
      info.append(element('h2', item.name), element('span', amount(item.totals.lineTotal, data.totals.currencyCode)));
      const controls = element('div', undefined, 'cart-controls');
      for (const [label, quantity] of [['−', item.quantity - 1], ['+', item.quantity + 1]]) {
        const button = element('button', label); button.type = 'button'; button.setAttribute('aria-label', `${label === '+' ? 'Increase' : 'Decrease'} ${item.name} quantity`);
        button.onclick = () => this.change(() => quantity ? cart.update(item.key, quantity) : cart.remove(item.key), button);
        if (label === '−') controls.append(button, element('span', String(item.quantity))); else controls.append(button);
      }
      const remove = element('button', 'Remove'); remove.type = 'button'; remove.onclick = () => this.change(() => cart.remove(item.key), remove); controls.append(remove);
      line.append(info, controls); list.append(line);
    }
    const parts = [list];
    if (data.needsShipping) {
      const form = element('form', undefined, 'shipping-estimate'); const country = element('select'); country.setAttribute('aria-label', 'Shipping country');
      for (const [code, name] of [['PL', 'Poland'], ['DE', 'Germany']]) { const option = element('option', name); option.value = code; country.append(option); }
      const postcode = element('input'); postcode.name = 'postcode'; postcode.placeholder = 'Postcode'; postcode.setAttribute('aria-label', 'Shipping postcode');
      const button = element('button', 'Estimate shipping'); form.append(country, postcode, button);
      form.onsubmit = event => { event.preventDefault(); this.change(() => cart.updateCustomer({ shipping: { country: country.value, postcode: postcode.value } }), button); };
      parts.push(form);
      for (const pack of data.shippingRates) {
        const rates = element('fieldset'); rates.append(element('legend', pack.name));
        for (const rate of pack.rates) { const label = element('label'); const input = element('input'); input.type = 'radio'; input.name = `shipping-${pack.packageId}`; input.checked = rate.selected; input.onchange = () => this.change(() => cart.selectShipping(pack.packageId, rate.id)); label.append(input, document.createTextNode(`${rate.name} · ${amount(rate.price, rate.currencyCode)}`)); rates.append(label); }
        parts.push(rates);
      }
    }
    const total = element('p', `Total ${amount(data.totals.totalPrice, data.totals.currencyCode)}`, 'cart-total');
    const checkout = element('a', 'Continue to checkout', 'shop-checkout'); checkout.href = '/checkout';
    parts.push(total, checkout); this.replaceChildren(...parts);
  }
}
for (const [name, component] of [['shop-mini-cart', MiniCart], ['shop-add-to-cart', AddToCart], ['shop-cart', Cart]]) { if (!customElements.get(name)) customElements.define(name, component); }
