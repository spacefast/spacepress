import { defineConfig, action } from "zero";
import { untypedPrivate, untypedClasses } from "./class-private-lib.mjs";

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

export default defineConfig({
  name: "class-private",
  actions: {
    privateTyped: run(() => {
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
    }),
    privateUntyped: run(() => untypedPrivate()),
    classesUntyped: run(() => untypedClasses()),
  },
});
