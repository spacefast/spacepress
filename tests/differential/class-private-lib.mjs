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

// UploadControl's shape in files-sdk: private state behind getters, toJSON exposing one part.
class Control {
  #state = { status: "idle", loaded: 0 };
  static from(session) { const control = new Control(); control.#state.session = session; return control; }
  get status() { return this.#state.status; }
  get loaded() { return this.#state.loaded; }
  set loaded(value) { this.#state.loaded = value; this.#state.status = "uploading"; }
  get session() { return this.#state.session; }
  static get kind() { return "control"; }
  toJSON() { return this.#state.session; }
}
class Subcontrol extends Control {
  get status() { return "sub:" + super.status; }
}

export function untypedAccessors() {
  const control = Subcontrol.from({ id: "s1" });
  control.loaded = 10;
  let readOnly = "";
  try { control.status = "x"; } catch (error) { readOnly = error.name; }
  const getter = control.status;
  return {
    status: getter, loaded: control.loaded, kind: Subcontrol.kind, keys: Object.keys(control),
    json: JSON.stringify({ control, list: [control] }), readOnly, missing: control.nothing,
  };
}

// FilesError's shape: an Error subclass with own data fields, a cause and static helpers.
class StoreError extends Error {
  code;
  permanent;
  cause;
  constructor(code, message, cause) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.permanent = code === "Invalid" || code === "ReadOnly";
    this.cause = cause;
  }
  static wrap(cause, fallback = "Provider") {
    if (cause instanceof StoreError) return cause;
    const message = cause instanceof Error ? cause.message : String(cause);
    return new StoreError(fallback, message, cause);
  }
}
class NotFound extends StoreError {
  constructor(key) { super("NotFound", `missing ${key}`); Error.captureStackTrace(this, NotFound); }
}
class Plain extends Error {}
class Typed extends TypeError {}

export function untypedErrors() {
  const results = [];
  for (const run of [
    () => { throw new NotFound("a"); },
    () => { throw StoreError.wrap(new RangeError("range")); },
    () => { throw StoreError.wrap("text"); },
    () => { throw { code: "raw" }; },
    () => { throw new Typed("typed"); },
  ]) {
    try { run(); } catch (error) {
      results.push({
        store: error instanceof StoreError, notFound: error instanceof NotFound,
        error: error instanceof Error, type: error instanceof TypeError,
        name: error.name, code: error.code, message: error.message, permanent: error.permanent,
        text: error instanceof Error ? String(error) : "", stack: error instanceof Error ? error.stack.split("\n")[0] : "",
        keys: Object.keys(error), json: JSON.stringify(error), cause: typeof error.cause,
      });
    }
  }
  const plain = new Plain();
  const caused = new StoreError("Invalid", "outer", "inner");
  return {
    results, plain: [String(plain), plain.message, plain.name, Object.hasOwn(plain, "message"), Object.keys(plain).length],
    caused: [caused.cause, caused.permanent, Object.hasOwn(caused, "cause"), Object.keys(caused).length],
    text: String(new NotFound("t")),
  };
}
