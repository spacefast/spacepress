// Imported JavaScript classes: untyped fields, parameters and private names, as bundled npm code writes them.
class Store {
  #items;
  #hooks;
  static #instances = 0;
  constructor(opts) {
    this.#items = opts.items ?? [];
    this.#hooks = opts.hooks;
    this.options = { region: opts.region };
    const hooks = opts.hooks;
    Store.#instances++;
    if (hooks) this.#notify("created");
  }
  #notify(event) {
    if (this.#hooks?.[event]) this.#hooks[event](this.#items.length);
  }
  add(item) {
    this.#items.push(item);
    this.#notify("added");
    return this;
  }
  #find(key) { return this.#items.find((item) => item.key === key); }
  get(key) { return this.#find(key)?.value ?? null; }
  static sizeOf(store) { return store.#items.length; }
  static count() { return Store.#instances; }
  static isStore(value) { return value !== null && typeof value === "object" && #items in value; }
}

class Base {
  #id = 1;
  name;
  constructor(name) { this.name = name; }
  id() { return this.#id; }
  describe() { return `${this.name}#${this.#id}`; }
}
class Derived extends Base {
  #id = "derived";
  extra = this.name + "!";
  describe() { return super.describe() + "/" + this.#id; }
  static make(name) { return new Derived(name); }
}

export function untypedPrivate() {
  const events = [];
  const store = new Store({ items: [{ key: "a", value: 1 }], hooks: { added: (n) => events.push(`added:${n}`), created: (n) => events.push(`created:${n}`) }, region: "eu" });
  store.add({ key: "b", value: 2 }).add({ key: "c", value: 3 });
  let foreign = "";
  try { Store.sizeOf({ items: [] }); } catch (error) { foreign = error.name; }
  return {
    events, options: store.options, keys: Object.keys(store), json: JSON.stringify(store),
    found: [store.get("b"), store.get("z")], count: Store.count(), size: Store.sizeOf(store), branded: [Store.isStore(store), Store.isStore({}), Store.isStore(null)],
    foreign,
  };
}

export function untypedClasses() {
  const d = Derived.make("x");
  const method = d.describe;
  return {
    describe: d.describe(), id: d.id(), keys: Object.keys(d), extra: d.extra,
    instance: [d instanceof Base, d instanceof Derived, new Base("b") instanceof Derived],
    methodType: typeof method, sameMethod: method === new Derived("y").describe,
    called: method.call(d),
  };
}
