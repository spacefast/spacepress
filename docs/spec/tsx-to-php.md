# TSX → PHP server rendering (compiler spike)

Owner: the compiler workstream. Gates the renderer in
[rendering.md](rendering.md). Index: [index.md](index.md).

## Question

Can you write React-style TSX pages and components in TypeScript, render them
in PHP per request with no Node or JS at request time, and make parts
interactive in the browser?

## Answer from research (2026-11-08)

Yes, for a checked subset. Nobody ships TSX → PHP today (the closest are PHPX
and xph, which don't compile TS expressions). Languages that render without JS
at request time all compile templates into the server language (Go's Templ,
Elixir's HEEx, Marko's string concatenation). That is what First's compiler
already does for handlers.

What First has at de46201a:

- OXC parsing, a typed TS subset lowered to PHP with JS semantics (`Js::truthy`,
  `Js::map`), classes, npm TS erasure, Node-vs-PHP contract tests, `file:line:col`
  diagnostics.
- JSX is refused (`src/lower.rs`, `src/loader.rs`). Pages are a separate Node
  package that renders once with request data as placeholders.
- `docs/design-pages-and-agents.md` §4.2–4.3 already describes "one component
  source, two compilers", but nothing is built.

React Compiler is not useful here. It only auto-memoizes for React, its IR
models React's reactive scopes and is tied to Babel, and it has no other target.

React `hydrateRoot` is the wrong client. It needs byte-identical markup and does
not patch attribute differences. The WordPress Interactivity API is the right
one: PHP already processes its directives, it is Preact plus signals (about
11 kB), and WordPress ships it.

## Architecture to prove

1. Admit JSX only in `app/`, `components/` and `"use client"` files.
2. Lower JSX into a component IR. Every node records where its value comes from
   (literal, prop, query result, derived) and how it must be escaped (text,
   attribute, URL).
3. Code generator A: a PHP renderer per component that writes into an escaping
   HTML buffer, using the existing PHP lowering for expressions.
4. Code generator B, for `"use client"` components:
   - `useState` becomes Interactivity `context`;
   - derived values become `state` getters, compiled to JS and also to PHP
     `wp_interactivity_state` closures;
   - `onClick` and similar become `data-wp-on--*` directives;
   - server-action calls become fetches to the action endpoint.
5. Code generator C, later: plain React output of the same components for
   external frontends ([external-frontends.md](external-frontends.md)).
6. Parity tests: render every fixture through the IR with a JS renderer under
   Node and with the PHP renderer under PHP, compare normalized HTML, then load
   it in a browser and check the store has no mismatch warnings. Extend the
   existing Node-vs-PHP contract suite.

## Subset

| Accepted | Refused (build error naming the alternative) |
|---|---|
| Async server components, `await` on the query API | `useEffect`, refs, `useLayoutEffect` in server components |
| `&&`, `?:`, `??`, `.map`, `.length`, template strings, string/array methods the compiler already lowers | Context (until a scoped-stack design) |
| Props, children, fragments, keys | Suspense, streaming |
| `"use client"` with `useState`, derived values, handlers, server action calls | Third-party React components with SSR (allowed only with `ssr = false`) |
| CSS imports and CSS modules | CSS-in-JS, `style` objects with request data |

Hard parts to report on:

- `{0 && <b/>}` must render `0`, as in React;
- entity spelling, boolean attributes and whitespace in the output;
- async data, since PHP is synchronous (`await` lowers to blocking calls, as it does for handlers today);
- error messages good enough that the subset feels like React rather than a trap.

## Spike deliverable

A branch that compiles `examples/full-site` pages (rewritten in the [rendering.md](rendering.md)
style, including one `"use client"` counter) to PHP and passes parity tests.
Write a decision file (`docs/decisions/2026-11-08-tsx-to-php.md`) before
coding, and commit work in progress daily.

## Later, not in the spike

- React output (generator C) for sharing components with external frontends.
- Full-page client navigation (waiting for WordPress core).
- Server-side context.
