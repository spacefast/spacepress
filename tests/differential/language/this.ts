// `this` outside classes, which live Zero 0.8 apps use (zero#138 census): object-literal methods,
// borrowed methods, call/apply and arrows inside methods. Every action runs under Node and as
// compiled PHP; the JSON results must be byte-identical. `this-helpers.mjs` runs the untyped forms.
import { action, defineConfig } from "zero";
import { detached, factory, receivers } from "./this-helpers.mjs";

const run = (handler: () => unknown) => action({ input: {}, handler });

function describe(this: { name: string; role: string }, prefix: string): string {
  return `${prefix}${this.name} (${this.role})`;
}

export default defineConfig({
  name: "language-this",
  actions: {
    thisReceivers: run(() => receivers()),
    thisDetached: run(() => detached()),
    thisFactory: run(() => factory()),
    thisTypedLiteral: run(() => {
      const counter = {
        count: 1,
        label: "c",
        inc(by: number): number { this.count += by; return this.count; },
        describe(): string { return `${this.label}=${this.count}`; },
      };
      counter.inc(2);
      return [counter.inc(3), counter.describe()];
    }),
    thisTypedParameter: run(() => [describe.call({ name: "Ada", role: "admin" }, "Dr "), describe.apply({ name: "Bo", role: "editor" }, [""])]),
  },
});
