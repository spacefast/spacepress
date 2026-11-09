// Named function expressions and recursive local functions, which esbuild bundles of live 0.8 apps
// contain. Every action runs under Node and as compiled PHP; the JSON results must be
// byte-identical.
import { action, defineConfig } from "first";
import { hoistedVar, named, recursiveLocal } from "./function-expressions-helpers.mjs";

const run = (handler: () => unknown) => action({ input: {}, handler });

function typedRecursion(): number[] {
  function fact(n: number): number { return n <= 1 ? 1 : n * fact(n - 1); }
  const even = function isEven(n: number): boolean { return n === 0 ? true : !isEven(n - 1); };
  const squares = [1, 2, 3].map(function square(x) { return x * x; });
  return [fact(6), even(4) ? 1 : 0, even(7) ? 1 : 0, ...squares];
}

export default defineConfig({
  name: "language-function-expressions",
  actions: {
    functionNamed: run(() => named()),
    functionRecursiveLocal: run(() => recursiveLocal()),
    functionTyped: run(() => typedRecursion()),
    functionHoistedVar: run(() => hoistedVar()),
  },
});
