import { createClient } from "./client/index.js";

const root = document.getElementById("first-classic-pantry");
const content = document.getElementById("first-pantry-content");
const notice = document.getElementById("first-pantry-notice");
const refresh = document.getElementById("first-pantry-refresh");
const section = root.dataset.section;
const client = createClient({
  url: root.dataset.apiUrl,
  nonce: root.dataset.nonce,
  fetch: (url, options) =>
    fetch(url, { ...options, signal: AbortSignal.timeout(15000) }),
});
let items = [],
  locations = [],
  shopping = [],
  stories = [];
let editing = null,
  dirty = false,
  busy = false,
  reconciliationRequired = false;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function message(text, error = false) {
  notice.replaceChildren(node("p", text));
  notice.className = `notice ${error ? "notice-error" : "notice-success"}`;
}

function lock(value) {
  busy = value;
  root.setAttribute("aria-busy", String(value));
  for (const control of root.querySelectorAll("button, input, select, textarea"))
    control.disabled = value || (reconciliationRequired && control !== refresh);
}

function mayDiscard() {
  return !dirty || window.confirm("Discard your unsaved pantry changes?");
}

window.addEventListener("beforeunload", (event) => {
  if (!dirty && !busy) return;
  event.preventDefault();
  event.returnValue = "";
});

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
      return rows.sort((left, right) =>
        (left.name ?? left.title).localeCompare(right.name ?? right.title),
      );
  }
}

async function load() {
  [items, locations, shopping, stories] = await Promise.all([
    listAll(client.items, { with: { story: true } }),
    listAll(client.locations),
    listAll(client.shoppingList, { with: { item: true } }),
    listAll(client.stories),
  ]);
}

async function reload() {
  if (busy || !mayDiscard()) return;
  lock(true);
  try {
    await load();
    dirty = false;
    reconciliationRequired = false;
    render();
    message("Pantry records refreshed.");
  } catch (error) {
    message(`Could not refresh: ${error.message}`, true);
  } finally {
    lock(false);
    refresh.focus();
  }
}

async function mutate(operation, success) {
  if (busy || reconciliationRequired) return;
  lock(true);
  try {
    await operation();
  } catch (error) {
    reconciliationRequired = !(
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 408
    );
    message(
      reconciliationRequired
        ? `The save result could not be confirmed. Your values are still here. Refresh records before making another change. ${error.message}`
        : error.message,
      true,
    );
    lock(false);
    return;
  }
  dirty = false;
  editing = null;
  content.replaceChildren(node("p", "Saved. Reloading pantry records…"));
  try {
    await load();
    render();
    message(success);
  } catch (error) {
    content.replaceChildren(
      node(
        "p",
        "Your change was saved. Use Refresh records to reload the pantry.",
      ),
    );
    message(`Saved, but records could not reload: ${error.message}`, true);
  } finally {
    lock(false);
    refresh.focus();
  }
}

function button(label, handler, className = "button button-small") {
  const result = node("button", label, className);
  result.type = "button";
  result.addEventListener("click", handler);
  return result;
}

function field(form, label, name, value, options = {}) {
  const row = node("tr");
  const heading = node("th");
  heading.scope = "row";
  const id = `first-pantry-${name}`;
  const caption = node("label", label);
  caption.htmlFor = id;
  heading.append(caption);
  const cell = node("td");
  let input;
  if (options.choices) {
    input = node("select");
    for (const [key, text] of options.choices) {
      const option = node("option", text);
      option.value = String(key);
      input.append(option);
    }
  } else if (options.multiline) {
    input = node("textarea");
    input.rows = 4;
    input.className = "large-text";
  } else {
    input = node("input");
    input.type = options.type ?? "text";
    if (input.type === "checkbox") input.checked = Boolean(value);
    else
      input.className = input.type === "number" ? "small-text" : "regular-text";
  }
  input.id = id;
  input.name = name;
  input.value = value === null || value === undefined ? "" : String(value);
  if (options.required) input.required = true;
  if (options.maxLength) input.maxLength = options.maxLength;
  if (options.type === "number") {
    input.min = "0";
    input.step = "1";
  }
  cell.append(input);
  row.append(heading, cell);
  form.querySelector("tbody").append(row);
  return input;
}

function choose(id) {
  if (busy || !mayDiscard()) return;
  editing = id;
  dirty = false;
  render();
  document
    .getElementById("first-pantry-form")
    ?.scrollIntoView({ block: "start" });
  document.getElementById("first-pantry-name")?.focus();
}

function editorForm() {
  const records =
    section === "items"
      ? items
      : section === "locations"
        ? locations
        : shopping;
  const record = records.find((row) => row.id === editing);
  if (section === "shopping" && !record) {
    content.append(
      node(
        "p",
        "Low-stock items appear here automatically. Edit an entry to change its name or shopping status.",
      ),
    );
    return;
  }
  if (!record) editing = null;
  const title =
    section === "items"
      ? "pantry item"
      : section === "locations"
        ? "location"
        : "shopping entry";
  const form = node("form");
  form.id = "first-pantry-form";
  form.append(node("h2", `${record ? "Edit" : "Add"} ${title}`));
  const fields = node("table", undefined, "form-table");
  fields.append(node("tbody"));
  form.append(fields);
  field(form, "Name", "name", record?.name ?? "", {
    required: true,
    maxLength: section === "locations" ? 80 : 120,
  });
  if (section === "items") {
    field(form, "Brand", "brand", record?.brand ?? "", { maxLength: 80 });
    field(form, "Storage / cooking notes", "notes", record?.notes ?? "", {
      multiline: true,
      maxLength: 2000,
    });
    field(form, "Opened", "opened", record?.opened ?? false, { type: "checkbox" });
    field(form, "Cooking story", "storyId", record?.storyId ?? "", {
      choices: [
        ["", "No linked story"],
        ...stories.map((story) => [story.id, story.title]),
      ],
    });
    if (record?.story) {
      const related = node("p");
      const link = node("a", `Edit “${record.story.title}” in the native editor`);
      link.href = `/wp-admin/post.php?post=${encodeURIComponent(record.story.id)}&action=edit`;
      related.append(link);
      form.append(related);
    }
    field(form, "Quantity", "quantity", record?.quantity ?? 1, {
      type: "number",
      required: true,
    });
    field(form, "Unit", "unit", record?.unit ?? "pcs", {
      choices: [
        ["pcs", "Pieces"],
        ["g", "Grams"],
        ["ml", "Millilitres"],
      ],
    });
    field(form, "Low stock at", "lowStockAt", record?.lowStockAt ?? 1, {
      type: "number",
      required: true,
    });
    field(form, "Location", "locationId", record?.locationId ?? "", {
      choices: [
        ["", "No location"],
        ...locations.map((row) => [row.id, row.name]),
      ],
    });
    field(form, "Expires on", "expiresOn", record?.expiresOn ?? "", {
      type: "date",
    });
  } else if (section === "locations") {
    field(form, "Kind", "kind", record?.kind ?? "pantry", {
      choices: [
        ["pantry", "Pantry"],
        ["fridge", "Fridge"],
        ["freezer", "Freezer"],
      ],
    });
  } else {
    field(form, "Bought", "done", record.done, { type: "checkbox" });
    form.append(
      node(
        "p",
        "Marking an entry bought does not change stock. Edit the item quantity or buy stock in the pantry tracker.",
      ),
    );
  }
  const actions = node("p", undefined, "submit");
  const submit = node(
    "button",
    record ? "Save changes" : `Add ${title}`,
    "button button-primary",
  );
  submit.type = "submit";
  actions.append(submit, document.createTextNode(" "));
  if (record) actions.append(button("Cancel", () => choose(null), "button"));
  form.append(actions);
  form.addEventListener("input", () => {
    dirty = true;
  });
  form.addEventListener("change", () => {
    dirty = true;
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const values = { name: data.get("name") };
    if (section === "items") {
      Object.assign(values, {
        brand: data.get("brand") || null,
        notes: data.get("notes") || null,
        opened: data.has("opened"),
        storyId: data.get("storyId") ? Number(data.get("storyId")) : null,
        quantity: Number(data.get("quantity")),
        unit: data.get("unit"),
        lowStockAt: Number(data.get("lowStockAt")),
        locationId: data.get("locationId")
          ? Number(data.get("locationId"))
          : null,
        expiresOn: data.get("expiresOn") || null,
      });
    } else if (section === "locations") values.kind = data.get("kind");
    else values.done = data.has("done");
    const collection =
      section === "shopping" ? client.shoppingList : client[section];
    const patch = record
      ? Object.fromEntries(
          Object.entries(values).filter(
            ([key, value]) => value !== (record[key] ?? null),
          ),
        )
      : values;
    if (record && Object.keys(patch).length === 0) {
      dirty = false;
      message("No changes to save.");
      return;
    }
    void mutate(
      () =>
        record
          ? collection.update(record.id, patch)
          : collection.create(values),
      `${title[0].toUpperCase()}${title.slice(1)} saved.`,
    );
  });
  content.append(form);
}

function deleteRow(row) {
  if (busy || !mayDiscard()) return;
  const consequence =
    section === "items"
      ? " Its shopping entry will also be removed."
      : section === "locations"
        ? " Items will keep their stock and have no location."
        : " The item and its stock will stay.";
  if (!window.confirm(`Delete “${row.name}”?${consequence}`)) return;
  const collection =
    section === "shopping" ? client.shoppingList : client[section];
  void mutate(() => collection.delete(row.id), "Record deleted.");
}

function list() {
  const table = node("table", undefined, "widefat fixed striped");
  const headings =
    section === "items"
      ? ["Item", "Stock", "Location", "Details", "Actions"]
      : section === "locations"
        ? ["Location", "Kind", "Items", "Actions"]
        : ["Shopping entry", "Current stock", "Status", "Actions"];
  table.setAttribute(
    "aria-label",
    section === "shopping" ? "Shopping list" : `Pantry ${section}`,
  );
  const head = node("thead");
  const header = node("tr");
  for (const label of headings) {
    const cell = node("th", label);
    cell.scope = "col";
    header.append(cell);
  }
  head.append(header);
  const body = node("tbody");
  const records =
    section === "items"
      ? items
      : section === "locations"
        ? locations
        : shopping;
  for (const row of records) {
    const tr = node("tr");
    tr.dataset.recordId = String(row.id);
    const details =
      section === "items"
        ? [
            row.name,
            `${row.quantity} ${row.unit}${row.quantity <= row.lowStockAt ? " — Low stock" : ""}`,
            locations.find((place) => place.id === row.locationId)?.name ??
              "No location",
            [
              row.brand,
              row.opened ? "Opened" : "Unopened",
              row.expiresOn ? `Expires ${row.expiresOn}` : null,
              row.story?.title ? `Story: ${row.story.title}` : null,
            ]
              .filter(Boolean)
              .join(" · "),
          ]
        : section === "locations"
          ? [
              row.name,
              row.kind,
              String(items.filter((item) => item.locationId === row.id).length),
            ]
          : [
              row.name,
              row.item
                ? `${row.item.quantity} ${row.item.unit}`
                : "Item unavailable",
              row.done ? "Bought" : "To buy",
            ];
    for (const detail of details) tr.append(node("td", detail));
    const actions = node("td");
    actions.append(
      button("Edit", () => choose(row.id)),
      document.createTextNode(" "),
    );
    if (section === "shopping") {
      actions.append(
        button(row.done ? "Mark to buy" : "Mark bought", () => {
          if (!mayDiscard()) return;
          void mutate(
            () => client.shoppingList.update(row.id, { done: !row.done }),
            "Shopping status saved.",
          );
        }),
        document.createTextNode(" "),
      );
    }
    actions.append(
      button("Delete", () => deleteRow(row), "button-link-delete"),
    );
    tr.append(actions);
    body.append(tr);
  }
  if (!records.length) {
    const tr = node("tr");
    const cell = node("td", "No records yet.");
    cell.colSpan = headings.length;
    tr.append(cell);
    body.append(tr);
  }
  table.append(head, body);
  content.append(table);
}

function render() {
  content.replaceChildren();
  list();
  editorForm();
}

refresh.addEventListener("click", () => void reload());
void reload();
