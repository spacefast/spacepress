// Untyped JavaScript for tests/differential/language/this.ts: function-style objects, borrowed
// methods and call/apply, the shapes live 0.8 bundles use `this` outside classes for.

export function receivers() {
  const counter = { count: 1, inc(by) { this.count += by; return this; }, get() { return this.count; } };
  function who() { return this; }
  const greet = function (greeting) { return `${greeting}, ${this.name}`; };
  const ada = { name: "Ada", greet };
  const arrows = { n: 7, read() { const inner = () => this.n; return inner(); } };
  return [
    counter.inc(2).inc(3).get(),
    typeof who(),
    who.call(5),
    who.apply("s", []),
    greet.call({ name: "Bo" }, "Hi"),
    greet.apply({ name: "Cy" }, ["Yo"]),
    ada.greet("Hey"),
    ada["greet"]("Hello"),
    arrows.read(),
    typeof who.call(undefined),
    who.call(null),
  ];
}

export function detached() {
  const box = { value: 1, read() { return this === undefined ? "undefined this" : this.value; } };
  const read = box.read;
  return [box.read(), read()];
}

export function factory() {
  function makeStack() {
    return {
      items: [],
      push(item) { this.items.push(item); return this; },
      pop() { return this.items.pop(); },
      size() { return this.items.length; },
    };
  }
  const stack = makeStack().push("a").push("b");
  return [stack.pop(), stack.items, stack.size()];
}
