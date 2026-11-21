import { cart } from "@typedpress/client";

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

class AddDrive extends HTMLElement {
  connectedCallback() {
    const button = this.querySelector("button");
    const status = this.querySelector("[role=status]");
    button.onclick = async () => {
      button.disabled = true;
      try {
        await cart.add(Number(this.dataset.product));
        status.textContent = "Added to your cart.";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  }
}

class DriveCart extends HTMLElement {
  connectedCallback() {
    this.unsubscribe = cart.subscribe((state) => this.render(state));
    cart.get().catch((error) => {
      this.querySelector("[role=status]").textContent = error.message;
    });
  }

  disconnectedCallback() {
    this.unsubscribe?.();
  }

  async change(update, status) {
    if (this.busy) return;
    this.busy = true;
    const controls = this.querySelectorAll("input,button");
    for (const control of controls) control.disabled = true;
    try {
      await update();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      this.busy = false;
      for (const control of this.querySelectorAll("input,button")) control.disabled = false;
    }
  }

  render(data) {
    const status = element("p");
    status.setAttribute("role", "status");
    const list = element("ul");
    list.className = "list";
    const { currencyCode } = data.totals;
    for (const item of data.items) {
      const line = element("li");
      line.append(element("strong", item.name), element("span", `${item.totals.lineTotal} ${currencyCode}`));
      const form = element("form");
      form.className = "inline";
      const label = element("label", "Quantity ");
      const quantity = element("input");
      quantity.type = "number";
      quantity.min = "1";
      quantity.value = String(item.quantity);
      label.append(quantity);
      const update = element("button", "Update");
      const remove = element("button", "Remove");
      remove.type = "button";
      remove.onclick = () => this.change(() => cart.remove(item.key), status);
      form.onsubmit = (event) => {
        event.preventDefault();
        this.change(() => cart.update(item.key, Number(quantity.value)), status);
      };
      form.append(label, update, remove);
      line.append(form);
      list.append(line);
    }
    if (data.items.length === 0) {
      this.replaceChildren(element("p", "Your cart is empty."), status);
      return;
    }
    const checkout = element("a", "Continue to checkout");
    checkout.href = "/checkout";
    checkout.onclick = (event) => { if (this.busy) event.preventDefault(); };
    this.replaceChildren(list, element("p", `Total ${data.totals.totalPrice} ${currencyCode}`), checkout, status);
  }
}

customElements.define("drive-add-to-cart", AddDrive);
customElements.define("drive-cart", DriveCart);
