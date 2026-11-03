# npm source compatibility probes

Run actual pinned npm library algorithms through Zero and compare the generated
PHP action's JSON result to Node executing the installed package. This is an
exploratory compatibility gate: unsupported libraries produce `ISSUES` and exit 1.
The package lock includes tarball integrity; lifecycle scripts are unnecessary.

```sh
cd examples/npm-compat
npm ci --ignore-scripts --no-audit --no-fund
ZERO_BIN=/absolute/path/to/zero npm run verify
# Collect a matrix while allowing known unsupported packages:
ZERO_BIN=/absolute/path/to/zero npm run verify -- --report-only
```

`ZERO_BIN` defaults to this checkout's `target/debug/zero`. PHP CLI needs the
runtime's normal extensions, including mbstring. No WordPress site, database,
network request, or JavaScript process participates in the PHP execution.
`run-php.php` loads the generated runtime and calls the generated action handler.

`cases.mjs` contains representative calls and observable edge cases. It also
combines clsx + escape-html + just-capitalize, and separately combines safeDiv
from `@thi.ng/math` with upper from `@thi.ng/strings`. Cloning checks mutation
isolation; formatting covers zero/negative values and invalid input; string
cases include empty strings, Unicode, quotes, and HTML metacharacters.

Each library has separate routes:

- `bare`: the real package's bare import and published export format.
- `source`: the real selected file, copied into the project. ESM bytes remain
  unchanged; CommonJS adapts only its one `module.exports` to an ESM export.
  The `.ts` extension allows the existing compiler to parse the copied source.
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
its raw JS probe retains the actual clone implementation and its blockers.
`ts-dedent` supplies an actual published `src/index.ts` probe.

All raw compiler diagnostics, exact Node results, PHP stdout/stderr, source byte
counts, hashes, compiler binary identity, and per-route statuses are written to `.work/report.json`. The
work directory also contains the generated TS and PHP artifacts for inspection.
A successful route must compile, execute PHP successfully, and match Node by
structural JSON equality. Every route's first blocking diagnostic is retained;
fixing it may reveal another unsupported construct. `--report-only` changes only
the final exit code and never labels blocked routes as passing.

`provenance.json` records registry versions, licenses, source hashes, declared
module formats, unpacked package sizes when available, and observed npm weekly
download counts with their date range and source URL. Refresh it deliberately
with `node provenance.mjs`; verification itself stays offline after `npm ci`.
Upstream licenses remain available in each installed package's LICENSE file
(`ms/license.md` uses a lowercase filename). The initial broad probes are MIT;
the thi.ng positive controls are Apache-2.0.

Resolver policy justified by these probes: resolve only installed packages;
select exact `exports` import/default entries or an explicit ESM entry; confine
selected files to the installed package root; reject unsupported export shapes
and CommonJS with a clear diagnostic. Installing packages or executing npm code
belongs to the developer's package manager, not the compiler. Export resolution,
untyped JS, `var` semantics, and host APIs are separate compatibility questions.
