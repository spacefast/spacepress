// Only Object.create(null) and Object.create(Object.prototype) are modeled.
const base = { kind: "default" };
const derived = Object.create(base);
export function make() { return derived.kind; }
