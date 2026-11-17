Generate the fixed PHP audit corpus from the repository root:

```sh
composer install --working-dir=examples/php-standards
cargo run --locked --example php-standards -- /tmp/tp-php
composer --working-dir=examples/php-standards run check-layout -- /tmp/tp-php
examples/php-standards/vendor/bin/phpcs --standard=WordPress --report=summary /tmp/tp-php
find /tmp/tp-php -name '*.php' -exec php -l {} \;
```

The locked Composer tools use WordPress Coding Standards 3.4.1 for development
and CI only. Ordinary TypedPress builds do not require PHP or Composer for layout.
`check-layout` enforces twenty-one WordPress layout, naming and documentation rules
implemented by the compiler, using WordPress's own sniff configuration. The
full audit intentionally also reports the rules not yet implemented. Kitchen-sink
compiled functions pass the full WordPress standard, which quick CI also enforces.

The corpus covers pantry, kitchen-sink and blog compiled functions. The original
baseline had 1199 errors and 73 warnings; the audit now finds 5 errors and
3 warnings. The expression pass reduces the preceding 27 errors / 38 warnings
by using existing runtime nullish/property checks through two small helpers and
omitting grouping parentheses around standalone assignments. The remaining
findings concern assignments inside lazy expressions/conditions and escaping
of exception arguments. None are automatically fixable by PHPCBF. Exception
messages are serialized into JSON problems by the runtime, so adding HTML
escaping here would alter API data.
Schema and shipped runtime PHP are outside this corpus. Do not edit generated
files as a substitute for fixing the compiler.

The compiler applies layout to its assembled functions, including
service and content-page helpers. It copies quoted strings and comments verbatim,
keeps empty argument lists and casts compact, and preserves multiline indentation.
Array literals use long syntax; indexing retains square brackets, with computed
keys spaced and literal string/integer keys compact. Adjacent simple
assignments at the same indentation are aligned, including property/index targets
and multiline values.
Multi-item associative arrays use one item per line, aligned keys and a trailing
comma. Enclosing calls are reflowed with one argument per line. Destructuring
is lowered to explicit assignments before layout, rather than PHP destructuring.
The emitter uses quoted PHP strings, not heredocs or inline HTML; keep that
contract when adding new emitters.

Compiled source callbacks have PHPDoc with project-relative source locations,
allocated PHP parameter names, their native PHP types and inferred return types.
Types without a known PHP representation use `mixed`. Explicit throw statements
record their exception classes within the current function; this does not attempt
transitive exception analysis. Destructured/rest parameters and async/generator
wrappers document their actual PHP calling conventions. Shared callable helpers
also document their return type. Comments escape source text that could terminate
PHPDoc, and omit source paths outside the project to keep builds reproducible.

Named optional data-property reads evaluate the receiver once through
`Js::optionalDataGet`; computed keys retain a lazy guard. Nullish coalescing uses
`Js::coalesce` only for literal fallbacks with no reads, allocations or side effects.
Other fallbacks retain their lazy expression form. These helpers ship in the runtime
bundled with the compiler. Assignment statements keep target capture and RHS order;
assignments used as values retain their grouping. The PHP/Node regression fixture
`tests/differential/language/php-expressions.ts` checks these distinctions.

For a formatting-only comparison against an earlier generated corpus:

```sh
php examples/php-standards/compare.php /tmp/tp-before /tmp/tp-php
```

The comparison retains string contents, comments, indexing and casts. It ignores
PHP whitespace tokens and line numbers, and normalizes explicit `array(...)`
literals to equivalent square-bracket tokens, ignoring optional trailing array
commas. Trailing commas in function calls are not normalized. Run its positive and negative
checks with `node --test examples/php-standards/compare.test.ts`. Missing, empty,
mismatched or unreadable corpora fail the comparison.

PHP binding spelling uses the existing acronym-aware name conversion and lexical
collision allocator. TypeScript names, object keys and registered action names
retain their source spelling. Only control-flow paths that can fall through emit
the undefined fallback, using the compiler's existing completion analysis.

The token comparator is for formatting revisions. Binding/function renames, the new file
header, omitted unreachable returns and expression lowering intentionally fail
comparison against older revisions; validate those through regression fixtures
and PHP/Node differential tests rather than weakening token comparison.

Generated PHP function names and corresponding handler metadata use snake_case.
The existing function allocator resolves spelling collisions. Async body and job
queue helper names also go through that allocator, including plugin prefixes.
Public action names and object keys retain their source spelling. Direct references
to generated PHP function names need to follow the new build's schema metadata.
