# npm source compatibility probes

Run actual pinned npm library algorithms through Zero and compare the generated
PHP action's JSON result to Node executing the installed package. Every route
must compile, run, and match Node. Unsupported libraries produce `ISSUES` and exit 1.
The package lock includes tarball integrity; lifecycle scripts are unnecessary.

```sh
cd examples/npm-compat
npm ci --ignore-scripts --no-audit --no-fund
ZERO_BIN=/absolute/path/to/zero npm run verify
# Collect a matrix while allowing known unsupported packages:
ZERO_BIN=/absolute/path/to/zero npm run verify -- --report-only
# Independent scratch directory, or one library during development:
ZERO_BIN=/absolute/path/to/zero npm run verify -- --isolated --only clsx
```

The `app/zero.config.ts` example exposes `POST /actions/link` with `slug` and
`title` text inputs. It uses the installed url-join, just-template and escape-html
packages in a real Zero action. See [the compatibility guide](../../docs/npm-compatibility.md)
for build, local WordPress and request instructions. URL joining covers array and
variadic forms, protocol/query normalization, mutation, empty input and a thrown
TypeError. Templates cover nested/repeated keys, missing/falsy values and Unicode.

Concurrent workers can install the lockfile in their own npm directory and set
`NPM_COMPAT_NODE_MODULES=/absolute/path/to/node_modules` with `--isolated`.
`ZERO_WP_PLUGIN_CACHE` can select an independent plugin cache. Original source
hashes must match `provenance.json`; changed installed bytes fail verification.
The verifier executes a private compiler snapshot, so another build cannot
replace the binary between routes.

`ZERO_BIN` defaults to this checkout's `target/debug/zero`. PHP CLI needs the
runtime's normal extensions, including mbstring. No WordPress site, database,
network request, or JavaScript process participates in the PHP execution.
`run-php.php` loads the generated runtime and calls the generated action handler.

`cases.mjs` contains representative calls and observable edge cases. It also
combines url-join + just-template + escape-html for application links,
combines clsx + escape-html + just-capitalize, and separately combines safeDiv
from `@thi.ng/math` with upper from `@thi.ng/strings`. Cloning checks mutation
isolation and Set, Map, Date and RegExp values constructed by a raw JavaScript
fixture, imported into the TypeScript caller. Formatting covers zero/negative values and invalid input; string
cases include empty strings, Unicode, quotes, and HTML metacharacters.

Each library has separate routes:

- `bare`: the real package's bare import and published export format.
- `source`: the real selected file, copied into the project. ESM bytes remain
  unchanged; CommonJS adapts only its one `module.exports` to an ESM export.
  Copies keep their original `.js`, `.mjs`, or `.ts` extension so the compiler
  applies the same language rules as the installed source.
- `typed-source`, when present: the same body with explicit parameter types.
  safeDiv uses number parameters from published `FnN2` in `@thi.ng/api/fn.d.ts`;
  strings case functions use string parameters from `FnS` in the package's
  `api.d.ts`. is-number uses `unknown`, retaining its runtime input checks.
- `typed-installed`: the typed copy is exported by a temporary installed package
  under `@zero-npm-compat/*`, with an exact `exports.import` pointing to its TS
  file. This proves package resolution separately from a package's original JS
  typing. These temporary packages are adapters, not published upstream versions.

No algorithm, `var`, loose comparison, host capability, or runtime branch is
rewritten to obtain a pass. Uncalled exports remain in the selected module; the
compiler chooses which functions to emit. The small math/string positive controls
prove selected helpers and their combination only. They do not establish support
for all exports in either package, nor automatic declaration-file hydration.
`just-clone` also carries a generic `<T extends object>(obj: T): T` declaration;
its raw JS probe retains the actual clone implementation.
`ts-dedent` supplies an actual published `src/index.ts` probe of its callable
string form. Repeated array/interpolation calls still encounter a located typing
refusal; tagged-template syntax is outside Zero's subset. See the guide for the
remaining coercion, sparse-array and borrowed-method boundaries.

All raw compiler diagnostics, exact Node results, PHP stdout/stderr, source byte
counts, hashes, compiler binary identity, and per-route statuses are written to
`.work/report.json`, or the printed temporary directory with `--isolated`. The
work directory also contains the generated source and PHP artifacts for inspection.
A successful route must compile, execute PHP successfully, and match Node by
structural JSON equality. Every route's first blocking diagnostic is retained;
fixing it may reveal another unsupported construct. `--report-only` changes only
the final exit code and never labels blocked routes as passing.

`provenance.json` records registry versions, licenses, source hashes, declared
module formats, unpacked package sizes when available, and observed npm weekly
download counts with their date range and source URL. Refresh it deliberately
with `node provenance.mjs`; verification itself stays offline after `npm ci`.
The unchanged url-join and just-template MIT notices are also retained in
`licenses/`. Upstream licenses remain available in each installed package's LICENSE file
(`ms/license.md` uses a lowercase filename). The initial broad probes are MIT;
the thi.ng positive controls are Apache-2.0.

Resolver policy justified by these probes: resolve only installed packages;
select exact `exports` import/default entries, a `module` entry, or a supported
`main`/index entry; confine selected files to the installed package root; reject
unsupported export shapes with a clear diagnostic. The CommonJS subset accepts
one static top-level `module.exports` assignment to a function; it does not run
`require`, emulate a Node module wrapper, or infer declaration-file types.
Installing packages belongs to the developer's package manager.

Raw JavaScript uses checked PHP dispatch for supported operations. TypeScript
keeps static checking, including guarded `unknown` values. Function-scoped `var`,
ordinary function `arguments`, comma expressions, loose equality and own-key
`for…in` work within this subset. These probes establish the selected exports
and inputs, not arbitrary npm compatibility: Node/browser APIs, arbitrary
prototypes, accessors, sparse arrays, custom iterators and asynchronous library
effects remain outside the contract. JSON replacers/revivers, Error cause options,
Date component constructors and nondecimal number formatting fail explicitly.
