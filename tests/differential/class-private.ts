import { defineConfig, action } from "typedpress";
import { untypedPrivate, untypedClasses, untypedAccessors, untypedErrors } from "./class-private-lib.mjs";

const run = (handler: () => unknown) => action({ input: {}, handler });

class PrivateCounter {
  #count: number = 0;
  #log: string[] = [];
  static #made = 0;
  label = "counter";
  constructor() { PrivateCounter.#made++; }
  #step(n: number): number { this.#count += n; this.#log.push(`+${n}`); return this.#count; }
  bump(): number { this.#count++; return this.#step(2); }
  history(): string[] { return this.#log; }
  static made(): number { return PrivateCounter.#made; }
  static branded(value: unknown): boolean { return typeof value === "object" && value !== null && #count in value; }
  static peek(other: PrivateCounter): number { return other.#count; }
}
// Each class owns its own #count; the subclass never sees the parent's slot.
class PrivateChild extends PrivateCounter {
  #count: string = "child";
  childCount(): string { return this.#count; }
  static childBranded(value: unknown): boolean { return typeof value === "object" && value !== null && #count in value; }
}
class PrivateReader {
  #secret = "s";
  static read(value: unknown): string {
    return value instanceof PrivateReader && #secret in value ? value.#secret : "absent";
  }
}

class Temperature {
  #celsius = 0;
  static #reads = 0;
  get celsius(): number { Temperature.#reads++; return this.#celsius; }
  set celsius(value: number) { this.#celsius = Math.round(value); }
  get fahrenheit() { return this.#celsius * 9 / 5 + 32; }
  static get reads(): number { return Temperature.#reads; }
  toJSON(): { c: number } { return { c: this.#celsius }; }
}
class Kelvin extends Temperature {
  get celsius(): number { return super.celsius + 1000; }
}

class AppError extends Error {
  code = "";
  constructor(code: string, message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = "AppError";
    this.code = code;
  }
}
class QuotaError extends AppError {
  limit = 0;
  constructor(limit: number) { super("Quota", `over ${limit}`); this.limit = limit; }
}
class GlobSyntaxError extends SyntaxError {
  pattern = "";
  constructor(pattern: string) { super(`bad glob ${pattern}`); this.pattern = pattern; }
}
function failWith(kind: number): never {
  if (kind === 0) throw new QuotaError(3);
  if (kind === 1) throw new AppError("Bad", "bad input", { cause: "upstream" });
  throw new TypeError("plain");
}

export const privateTyped = run(() => {
  const a = new PrivateCounter();
  a.bump();
  const second = a.bump();
  const child = new PrivateChild();
  child.bump();
  return {
    second, history: a.history(), made: PrivateCounter.made(), peek: PrivateCounter.peek(child),
    keys: Object.keys(a), json: JSON.stringify(child), spread: { ...a },
    childCount: child.childCount(),
    branded: [PrivateCounter.branded(a), PrivateCounter.branded(child), PrivateCounter.branded({ count: 1 })],
    childBranded: [PrivateChild.childBranded(a), PrivateChild.childBranded(child)],
    cloneBranded: PrivateCounter.branded(structuredClone(a)),
    foreign: [PrivateReader.read(new PrivateReader()), PrivateReader.read({ secret: "x" })],
  };
});

export const accessorsTyped = run(() => {
  const t = new Temperature();
  t.celsius = 36.6;
  t.celsius += 1;
  const k = new Kelvin();
  return {
    celsius: t.celsius, fahrenheit: t.fahrenheit, reads: Temperature.reads,
    keys: Object.keys(t), json: JSON.stringify({ t, list: [t] }), kelvin: k.celsius,
  };
});

export const accessorsUntyped = run(() => untypedAccessors());

export const errorsTyped = run(() => {
  const out: { app: boolean; quota: boolean; error: boolean; name: string; message: string; text: string; stack: string; code: string; limit: number; json: string }[] = [];
  for (const kind of [0, 1, 2]) {
    try { failWith(kind); } catch (e) {
      out.push({
        app: e instanceof AppError, quota: e instanceof QuotaError, error: e instanceof Error,
        name: e.name, message: e.message, text: String(e), stack: (e.stack ?? "").split("\n")[0] ?? "",
        code: e instanceof AppError ? e.code : "", limit: e instanceof QuotaError ? e.limit : -1,
        json: JSON.stringify(e) ?? "",
      });
    }
  }
  return out;
});

export const syntaxErrorsTyped = run(() => {
  const made = new SyntaxError("made");
  const called = SyntaxError("called");
  const glob = new GlobSyntaxError("[");
  const out: (string | boolean)[] = [
    made.name, made.message, String(made), (made.stack ?? "").split("\n")[0] ?? "",
    called.name, called.message, String(SyntaxError()),
    made instanceof SyntaxError, made instanceof Error, made instanceof TypeError, new RangeError("r") instanceof SyntaxError,
    glob instanceof GlobSyntaxError, glob instanceof SyntaxError, glob instanceof Error, glob instanceof RangeError,
    glob.name, glob.message, glob.pattern, String(glob), JSON.stringify(glob),
  ];
  try { JSON.parse("{"); } catch (e) {
    out.push(e instanceof SyntaxError, e instanceof Error, e instanceof TypeError, e.name);
  }
  try { throw new SyntaxError("thrown"); } catch (e) {
    out.push(e instanceof SyntaxError, e.name, e.message);
  }
  try { throw glob; } catch (e) {
    out.push(e instanceof GlobSyntaxError, e instanceof SyntaxError, e instanceof GlobSyntaxError ? e.pattern : "");
  }
  return out;
});

export const errorsUntyped = run(() => untypedErrors());

export const privateUntyped = run(() => untypedPrivate());

export const classesUntyped = run(() => untypedClasses());

export default defineConfig({ name: "class-private" });
