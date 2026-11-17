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
`check-layout` enforces the five WordPress indentation and parentheses rules
implemented by the compiler, using WordPress's own sniff configuration. The
full audit intentionally also reports the rules not yet implemented.

The corpus covers pantry, kitchen-sink and blog compiled functions. The original
baseline had 1199 errors and 73 warnings. Tab indentation and declaration braces
reduced it to 1037 errors; parentheses layout reduces it to 303 errors (896 fewer
than baseline, 734 fewer than the indentation pass). Warnings remain at 73.
Short arrays, array spacing/alignment, documentation, naming and WordPress
security checks remain separate work. Schema and shipped runtime PHP are outside
this corpus. Do not edit generated files as a substitute for fixing the compiler.

The compiler applies parentheses spacing to its assembled functions, including
service and content-page helpers. It copies quoted strings and comments verbatim,
keeps empty argument lists and casts compact, and preserves multiline indentation.
The emitter uses quoted PHP strings, not heredocs or inline HTML; keep that
contract when adding new emitters.

For a formatting-only comparison against an earlier generated corpus:

```sh
php examples/php-standards/compare.php /tmp/tp-before /tmp/tp-php
```

The comparison retains string contents and comments and ignores only PHP
whitespace tokens and token line numbers. Missing, empty, mismatched or unreadable
corpora fail the comparison.
