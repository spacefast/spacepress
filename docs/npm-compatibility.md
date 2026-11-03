# npm compatibility

Zero compiles selected JavaScript and TypeScript package source into PHP. It does
not run Node.js on the server. Install dependencies with npm, then import the
qualified helpers from an ordinary Zero action.

`examples/npm-compat` compares pinned published packages under Node and freshly
compiled PHP. Each successful route runs the generated action, not just the
compiler. Its provenance file pins the original source SHA-256 and npm tarball
integrity; verification refuses changed source bytes even when the installed
package reports the right version.

The application example at `examples/npm-compat/app/zero.config.ts` builds a link
from user input with these unchanged published libraries:

| Package | Qualified entry | Use | License |
| --- | --- | --- | --- |
| url-join 5.0.0 | `lib/url-join.js` | Join URL paths, query fragments and protocols | MIT |
| just-template 2.2.0 | `index.mjs` | Interpolate text and nested properties | MIT |
| escape-html 1.0.3 | `index.js` | Escape interpolated text and HTML attributes | MIT |

`just-template` does **not** escape HTML. The example explicitly escapes the
values before interpolation. It also preserves upstream's falsy-value behavior:
zero, false and missing values interpolate as empty strings.

From `examples/npm-compat`, with `zero` on PATH:

```sh
npm ci --ignore-scripts --no-audit --no-fund
ZERO_BIN="$(command -v zero)" npm run verify -- --isolated
zero build app
zero dev app --port "$PORT"
```

Choose an unused local port and set `PORT` first. Send an anonymous request to
the website URL printed by `zero dev`:

```sh
curl "$SITE_URL/wp-json/zero/v1/actions/link" \
  -H 'Content-Type: application/json' \
  --data '{"slug":"café & tea","title":"Tea & <scones>"}'
```

The action returns `/notes/caf%C3%A9%20%26%20tea` and an anchor containing
`Tea &amp; &lt;scones&gt;`. WordPress owns the request, validation and application
state. The generated PHP action executes the library algorithms.

To verify in a separate npm installation without changing the example's shared
`node_modules`, set `NPM_COMPAT_NODE_MODULES` to that installation's absolute
`node_modules` path and use `--isolated`. Set `ZERO_WP_PLUGIN_CACHE` to a private
cache when running concurrent builds. Reports and generated projects live under
the printed temporary directory; `--only url-join --only just-template --only
application-combined` selects the new library routes and their composition.

## Boundaries

The probes qualify selected exports and representative inputs. They do not
certify arbitrary npm packages, every export or every overload. Published ESM
source routes preserve the original bytes. CommonJS source routes replace only
the export assignment; typed routes add the explicitly recorded parameter
annotations. Temporary `@zero-npm-compat/*` packages are typed adapters, not
unchanged upstream packages. Declaration files are not automatically hydrated.

Imported JavaScript can read the first-class array `slice` method. Borrowed
`Array.prototype.slice` supports dense arrays and ordinary `arguments`, including
`call`/`apply`, negative indexes, omitted/undefined end and null end. It snapshots
length before converting indexes and reads elements afterward. Arbitrary
array-like receivers and sparse results throw explicit TypeErrors. This is not
support for arbitrary prototype or host behavior. Authored TypeScript `unknown`
stays statically checked.

`ts-dedent` 2.3.0's published JavaScript passes the callable string probe; its
published TypeScript source passes that probe too. Repeated array/interpolation
calls still conservatively lose a captured string/nonempty proof and produce a
located `Z4001` refusal in its interpolation callback. Tagged-template syntax
remains unsupported. No blanket array-index totality is assumed to bypass this.

`fuzzysearch` 1.0.3 remains unsupported: its unchanged source uses a labeled loop,
which produces a located `Z1002` diagnostic. It is not a qualified dependency.
Custom object `toString` during authored `String(value)` conversion remains a
runtime limit. Browser/Node host APIs, asynchronous library effects, arbitrary
prototypes/accessors and package declaration hydration remain outside the
qualified subset.

The generated link action has also been exercised on a disposable WordPress
7.1.4 / PHP 8.5 / SQLite Database Integration 3.1.2 installation with the pinned
platform plugins. That checks real WordPress execution and cleanup; it does not
qualify MariaDB, Studio lifecycle, remote deployment or an external provider.
