Generate the fixed WPCS audit corpus from the repository root:

```sh
cargo run --locked --example php-standards -- /tmp/tp-php
phpcs --standard=WordPress --report=summary /tmp/tp-php
find /tmp/tp-php -name '*.php' -exec php -l {} \;
```

Use WordPress Coding Standards 3.4.1 (development tooling only). The corpus
covers pantry, kitchen-sink and blog functions_php. Baseline: 1199 errors,
73 warnings. This first pass changes emitter indentation and declaration brace
placement; it does not claim full WPCS compliance. Call/parenthesis spacing,
short arrays, documentation, naming and WordPress security checks remain separate
work. Do not format generated files as a substitute for fixing their emitters.

For a formatting-only comparison against an earlier generated corpus:

```sh
php examples/php-standards/compare.php /tmp/tp-before /tmp/tp-php
```

The comparison retains string contents and comments and ignores only PHP
whitespace tokens and token line numbers. After this pass: 1062 errors and 73
warnings on the same corpus (137 fewer errors).
