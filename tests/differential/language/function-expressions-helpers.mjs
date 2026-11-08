// Untyped JavaScript for tests/differential/language/function-expressions.ts. Bundlers and npm
// libraries emit named function expressions (`var x = function name() {...}`), often recursive.

export function named() {
  const fact = function f(n) { return n <= 1 ? 1 : n * f(n - 1); };
  const shadowParam = function h(h) { return h; };
  const shadowVar = function k() { var k = 2; return k; };
  const own = function g() { return typeof g; };
  const fib = function fibonacci(n) { return n < 2 ? n : fibonacci(n - 1) + fibonacci(n - 2); };
  const callbacks = [1, 2, 3].map(function square(x) { return x * x; });
  return [fact(5), shadowParam(3), shadowVar(), own(), fib(10), callbacks];
}

export function recursiveLocal() {
  function walk(node) { return node.children.reduce((sum, child) => sum + walk(child), 1); }
  return walk({ children: [{ children: [] }, { children: [{ children: [] }] }] });
}

export function hoistedVar() {
  const fn = function f(flag) { if (flag) { var f; } f = 2; return f; };
  return [fn(true), fn(false)];
}
