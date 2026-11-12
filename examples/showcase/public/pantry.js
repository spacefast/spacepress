import { createClient } from "./client/index.js";

const element = (id) => document.getElementById(id);
const node = (tag, className = "", text) => {
  const result = document.createElement(tag);
  result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
};
const request = (input, init = {}) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(15000) });
const publicClient = createClient({ url: "/__first/api/v1", fetch: request });
let editorClient = null;
let items = [];
let shopping = [];
let busy = false;
let refreshing = false;
const expandedItems = new Set();

function editLink(collection, id, label) {
  const link = node("a", "", label);
  link.href = `/first-admin/collections/${collection}/${encodeURIComponent(id)}`;
  return link;
}

async function session() {
  editorClient = null;
  const text = element("pantry-session");
  try {
    const response = await request(
      "/wp-admin/admin-ajax.php?action=rest-nonce",
      { cache: "no-store" },
    );
    const nonce = (await response.text()).trim();
    if (response.ok && /^[a-zA-Z0-9]+$/.test(nonce) && nonce !== "0") {
      const client = createClient({
        url: "/__first/api/v1",
        nonce,
        fetch: request,
      });
      const user = await client.auth.me();
      if (user && ["admin", "editor"].includes(user.role)) {
        editorClient = client;
        text.textContent =
          `Signed in as ${user.role === "admin" ? "an administrator" : "an editor"}. Stock changes are saved immediately.`;
        return;
      }
    }
  } catch {
    // Public inventory remains usable when the editor session cannot be checked.
  }
  text.replaceChildren(document.createTextNode("Browsing only. "));
  const login = node("a", "", "Sign in to change stock");
  const back = new URL(window.location.href);
  back.hash = "pantry";
  login.href = `/wp-login.php?redirect_to=${encodeURIComponent(back.href)}`;
  text.append(
    login,
    document.createTextNode(
      ", then refresh the pantry. Demo: admin / first-test-admin.",
    ),
  );
}

function storyCover(story) {
  const value = story.cover?.sizes?.card?.url ?? story.cover?.url;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, window.location.href);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const image = node("img");
    image.src = url.href;
    image.alt = story.cover.alt ?? "";
    image.loading = "lazy";
    return image;
  } catch {
    return null;
  }
}

function render() {
  const selected = element("pantry-location").value;
  const visible = items.filter(
    (item) => !selected || String(item.locationId) === selected,
  );
  element("pantry-count").textContent = `(${visible.length})`;
  const cards = visible.map((item) => {
    const card = node("article", "pantry-item");
    card.dataset.itemId = String(item.id);
    const heading = node("div", "pantry-item-heading");
    heading.append(
      node("h4", "", item.name),
      node("span", "stock", `${item.quantity} ${item.unit}`),
    );
    const low = item.quantity <= item.lowStockAt;
    const details = [
      item.location?.name || "No location",
      `Low at ${item.lowStockAt} ${item.unit}`,
    ];
    if (item.expiresOn) details.push(`Expires ${item.expiresOn}`);
    card.append(heading, node("p", "hint", details.join(" · ")));
    if (low) card.append(node("span", "low-stock", "Low stock"));
    const description = node("details", "pantry-item-details");
    description.open = expandedItems.has(item.id);
    description.append(node("summary", "", "Details & cooking notes"));
    description.addEventListener("toggle", () => {
      if (description.open) expandedItems.add(item.id);
      else expandedItems.delete(item.id);
    });
    const facts = node("dl", "pantry-facts");
    for (const [label, value] of [
      ["Brand", item.brand || "Not specified"],
      ["Pack", item.opened ? "Opened" : "Unopened"],
      ["Storage", item.location?.name || "No location"],
    ]) facts.append(node("dt", "", label), node("dd", "", value));
    description.append(facts);
    if (item.notes) description.append(node("p", "pantry-notes", item.notes));
    if (item.story) {
      const story = node("div", "pantry-story");
      const cover = storyCover(item.story);
      if (cover) story.append(cover);
      story.append(node("h5", "", item.story.title));
      if (item.story.details?.subtitle)
        story.append(node("p", "", item.story.details.subtitle));
      const read = node("a", "", "Read cooking notes ↓");
      read.href = `#story-${encodeURIComponent(item.story.id)}`;
      read.addEventListener("click", () => {
        const storyCard = document.getElementById(`story-${item.story.id}`);
        const disclosure = storyCard?.matches("details")
          ? storyCard
          : storyCard?.querySelector("details");
        if (disclosure) disclosure.open = true;
      });
      const native = node("a", "", "Edit story in WordPress ↗");
      native.href = `/wp-admin/post.php?post=${encodeURIComponent(item.story.id)}&action=edit`;
      story.append(read, document.createTextNode(" · "), native);
      description.append(story);
    } else
      description.append(
        node("p", "hint", "No cooking story linked. Link a native WordPress story in the item editor."),
      );
    card.append(description);
    const actions = node("div", "pantry-item-actions");
    const consume = node("button", "", "Use 1");
    consume.type = "button";
    consume.id = `pantry-use-${item.id}`;
    consume.disabled = !editorClient || busy || item.quantity === 0;
    consume.setAttribute("aria-label", `Use 1 ${item.name}`);
    consume.addEventListener("click", () =>
      changeStock("consume", item.id, 1, consume.id),
    );
    actions.append(consume, editLink("items", item.id, "Edit item ↗"));
    const form = node("form", "restock-form");
    const label = node("label", "", `Add stock (${item.unit})`);
    const amount = node("input");
    amount.type = "number";
    amount.min = "1";
    amount.max = String(2147483647 - item.quantity);
    amount.step = "1";
    amount.value = String(Math.max(1, item.lowStockAt - item.quantity + 1));
    amount.required = true;
    amount.id = `pantry-amount-${item.id}`;
    label.htmlFor = amount.id;
    const restock = node("button", "", "Restock");
    restock.id = `pantry-restock-${item.id}`;
    restock.type = "submit";
    restock.disabled = !editorClient || busy;
    restock.setAttribute("aria-label", `Restock ${item.name}`);
    amount.disabled = !editorClient || busy;
    form.append(label, amount, restock);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (form.reportValidity())
        changeStock("restock", item.id, Number(amount.value), restock.id);
    });
    card.append(actions, form);
    return card;
  });
  element("pantry-items").replaceChildren(...cards);
  if (!cards.length)
    element("pantry-items").append(
      node("p", "empty", "Nothing here yet. Add an item in the admin."),
    );
  const pending = shopping.filter((entry) => !entry.done);
  const completed = shopping.filter((entry) => entry.done);
  const list = node("ul", "shopping-list");
  for (const entry of pending) {
    const row = node("li");
    row.append(editLink("items", entry.itemId, entry.name));
    if (entry.item)
      row.append(
        node("small", "", `${entry.item.quantity} ${entry.item.unit} left`),
      );
    list.append(row);
  }
  element("pantry-shopping").replaceChildren(
    pending.length
      ? list
      : node("p", "", "All stocked up. Your list is clear."),
  );
  if (completed.length) {
    const details = node("details", "shopping-done");
    details.append(
      node("summary", "", `Completed (${completed.length})`),
    );
    const done = node("ul");
    for (const entry of completed)
      done.append(node("li", "", `✓ ${entry.name}`));
    details.append(done);
    element("pantry-shopping").append(details);
  }
}

async function listAll(collection, options = {}) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const page = await collection.list({
      ...options,
      orderBy: { id: "asc" },
      limit: 100,
      offset,
    });
    rows.push(...page);
    if (page.length < 100)
      return rows.sort((left, right) => left.name.localeCompare(right.name));
  }
}

async function load() {
  const [newItems, locations, newShopping] = await Promise.all([
    listAll(publicClient.items, { with: { location: true, story: true } }),
    listAll(publicClient.locations),
    listAll(publicClient.shoppingList, { with: { item: true } }),
  ]);
  items = newItems;
  shopping = newShopping;
  const filter = element("pantry-location");
  const selected = filter.value;
  const all = node("option", "", "Everywhere");
  all.value = "";
  filter.replaceChildren(
    all,
    ...locations.map((location) => {
      const option = node("option", "", location.name);
      option.value = String(location.id);
      return option;
    }),
  );
  filter.value = locations.some((location) => String(location.id) === selected)
    ? selected
    : "";
  render();
}

async function refresh() {
  if (busy || refreshing) return;
  refreshing = true;
  element("pantry-refresh").disabled = true;
  element("pantry-status").textContent = "Refreshing pantry…";
  try {
    await session();
    await load();
    element("pantry-status").textContent =
      "Up to date. Use 1 to try the stock → shopping-list loop.";
    element("pantry-status").className = "";
  } catch (error) {
    editorClient = null;
    render();
    element("pantry-status").textContent =
      `Could not refresh. ${items.length ? "Previously loaded stock is still shown. " : ""}${error.message}`;
    element("pantry-status").className = "error";
  } finally {
    refreshing = false;
    element("pantry-refresh").disabled = false;
  }
}

async function changeStock(action, itemId, amount, focusId) {
  if (!editorClient || busy || refreshing) return;
  busy = true;
  render();
  element("pantry-refresh").disabled = true;
  let saved = false;
  try {
    const result = await editorClient.actions[action]({ itemId, amount });
    saved = true;
    await load();
    element("pantry-status").textContent = result.message;
    element("pantry-status").className = "";
  } catch (error) {
    element("pantry-status").textContent = saved
      ? `Stock saved, but the display could not refresh. Refresh before another change. ${error.message}`
      : `Could not confirm the stock change. Refresh before trying again. ${error.message}`;
    element("pantry-status").className = "error";
    editorClient = null;
  } finally {
    busy = false;
    element("pantry-refresh").disabled = false;
    render();
    const previous = element(focusId);
    (previous && !previous.disabled
      ? previous
      : element("pantry-refresh")
    ).focus({ preventScroll: true });
  }
}

element("pantry-refresh").addEventListener("click", refresh);
element("pantry-location").addEventListener("change", render);
await refresh();
