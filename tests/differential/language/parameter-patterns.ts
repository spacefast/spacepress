// Destructured parameters in imported JavaScript, which npm libraries use for option bags (p-map's
// `{ concurrency, backpressure = concurrency } = {}`). Every action runs under Node and as compiled
// PHP; the JSON results must be byte-identical.
import { action, defineConfig } from "zero";
import { missing, nested, options, pair, rest, strings } from "./parameter-patterns-helpers.mjs";

const run = (handler: () => unknown) => action({ input: {}, handler });

export default defineConfig({
  name: "language-parameter-patterns",
  actions: {
    patternOptions: run(() => [options(1), options(2, { concurrency: 3 }), options(3, { backpressure: 1, preserveOrder: false }), options(4, { concurrency: undefined })]),
    patternRest: run(() => [rest({ a: 1, b: 2, c: 3 }), rest({ b: 2 }), rest({})]),
    patternArrays: run(() => [pair([4]), pair([4, 5], 6, 7), pair([])]),
    patternNested: run(() => [nested({}), nested({ outer: { inner: "x" }, list: [1, 2, 3] }), nested({ outer: {} })]),
    patternStrings: run(() => [strings("héllo"), strings("")]),
    patternMissing: run(() => [missing({ field: 1 }), missing({}), missing(null), missing(undefined)]),
  },
});
