# Static CommonJS modules

Date: 2026-11-07. Status: accepted.

## Context

Zero accepted one CommonJS shape: a single top-level `module.exports = <function>`,
rewritten in place to `export default`. Every other use of `module`, `exports`
or `require` was refused. `files-sdk` 3.1.2 reaches `picomatch` 4.0.7 and
`safe-regex2` 5.1.2, which use relative `require("./x")`, a package
`require("ret")`, `module.exports = { … }`, `exports.name = …`, reads of
`exports.name` inside functions, and `module.exports.name = …` on an exported
function. Those were the two `require` diagnostics in the files-sdk probe.

## Decision

A CommonJS source (`.cjs`, or `.js` with no ESM syntax outside a
`"type": "module"` package) is lowered in `src/loader.rs` to the module IR the
evaluator already runs. Nothing about the Node module wrapper runs at request
time. The build-time evaluator executes the module body once, like Node does,
and the PHP compiler sees the resulting values.

1. **Wrapper bindings.** The module body is preceded by
   `const module = { exports: {} }; const exports = module.exports;` and
   followed by `export default module.exports;`. Writes to `module.exports`
   and `exports.x` work on that object, and reassigning `module.exports`
   leaves `exports` pointing at the original object, as in Node.
2. **Static `require`.** The loader resolves and loads every
   `require("<string literal>")` outside functions, at any expression depth,
   including inside top-level branches. The call stays in place. The
   build-time evaluator runs the target module when it reaches the call, as
   Node does, and returns its `module.exports`. A module runs once, so
   repeated `require` calls share one value, like Node's module cache.
3. **Resolution.** A bare `require("pkg")` resolves with the `require`, then
   `default`, conditions in `exports` object order, and never uses the ESM
   `module` field. A `require` that resolves to an ES module is refused:
   `require(esm)` returns a namespace object, which Zero doesn't model.
4. **Named exports for ESM importers.** Like Node's `cjs-module-lexer`, the
   names assigned as top-level `exports.name = …` or `module.exports.name = …`,
   and the keys of a top-level `module.exports = { … }` literal, are also named
   exports. Their values are read from `module.exports` after the body runs.
5. **Still refused, with a location and a fix:**
   - `require` with a non-literal argument, `require` used as a value
     (`require.resolve`), and `require` inside a function, which Node would
     run at request time;
   - `require` cycles (Node hands out a partial `module.exports`);
   - `module.<anything but exports>`, `module` or `exports` as a declared
     name, reassigning `exports` or `module`;
   - writes rooted at `module` or `exports` inside a function, because they
     would mutate a build-time value at request time;
   - `__filename` and `__dirname`;
   - mixing CommonJS with ESM syntax, and `module.exports` in an ESM package.

## Consequences

- Evaluation order matches Node, because `require` runs at the call. An
  ES module importing a CommonJS module still runs it before its own body, as
  in Node.
- An exported object holding functions (`utils.isObject(x)`) or a function
  with own properties (`picomatch.makeRe`) still needs compile-time member
  resolution of build-time values. That is the separate
  `feat/static-namespace-members` change. Without it, these modules move from
  the `require` refusal to the "captured data contains a function" refusal.
- `this` at CommonJS top level (TypeScript's `__createBinding` helpers in
  `ret`) remains a language-gaps item.
