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
`check-layout` enforces fifteen WordPress layout rules
implemented by the compiler, using WordPress's own sniff configuration. The
full audit intentionally also reports the rules not yet implemented.

The corpus covers pantry, kitchen-sink and blog compiled functions. The original
baseline had 1199 errors and 73 warnings. Tab indentation and declaration braces
reduced it to 1037 errors; parentheses layout reached 303 errors. Long array
literals reached 127 errors. Operator/index spacing, assignment alignment, helper
bodies and final newlines reached 102 errors and 45 warnings. Multiline
associative arrays and enclosing calls reduce it to 94 errors and 45 warnings
(1105 fewer errors and 28 fewer warnings than baseline). No remaining findings
in this corpus are automatically fixable by PHPCBF. Documentation, naming and
semantic/security checks remain separate work. Schema
and shipped runtime PHP are outside this corpus. Do not edit generated files as a substitute for fixing the compiler.

The compiler applies layout to its assembled functions, including
service and content-page helpers. It copies quoted strings and comments verbatim,
keeps empty argument lists and casts compact, and preserves multiline indentation.
Array literals use long syntax; indexing retains square brackets, with computed
keys spaced and literal string/integer keys compact. Adjacent bare-variable
assignments at the same indentation are aligned, including multiline values.
Multi-item associative arrays use one item per line, aligned keys and a trailing
comma. Enclosing calls are reflowed with one argument per line. Destructuring
is lowered to explicit assignments before layout, rather than PHP destructuring.
The emitter uses quoted PHP strings, not heredocs or inline HTML; keep that
contract when adding new emitters.

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
