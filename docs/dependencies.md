# Bundled PHP dependencies

End-user builds need neither Composer nor Strauss. The binary embeds the committed
`runtime/Zero/vendor-prefixed` tree and copies it into both runtime targets.

| Root | Package | Locked version | Purpose | Transitive packages |
|---|---|---|---|---|
| runtime | `wp-php-toolkit/markdown` | 0.10.1 | WordPress-maintained Markdown to Gutenberg conversion and front matter parsing for sync | 7 shared toolkit packages |
| runtime | `wp-php-toolkit/merge` | 0.10.1 | Server-side line differ and three-way merge, shared by both targets | 0 additional |

The seven shared packages are `bytestream`, `data-liberation`, `encoding`,
`filesystem`, `html`, `http-client` and `xml`, all locked at 0.10.1. Markdown
also contains its upstream-patched CommonMark, Symfony YAML and Webuni front
matter implementations. Strauss prefixes those nested definitions too.
The generated tree currently occupies about 6.1 MiB before packaging; embedding
omits dependency tests, docs and Markdown files. Its aggregated license file and
original license files ship with the runtime.

All bundled classes, functions and constants use `Zero\\Vendor`, `Zero_Vendor_`
and `ZERO_VENDOR_` prefixes. Composer's autoload-files registry has a separate
Zero key so another plugin's unprefixed library cannot suppress its loading.
The `override_autoload` entries normalize the toolkit's `./` classmaps to `.`
for Strauss while retaining the upstream file/exclusion metadata.

Regenerate after changing a lock with PHP 8.2, Composer 2 and:

```sh
scripts/vendor.sh runtime
tests/php/run.sh vendor
```

`scripts/vendor.sh all` also regenerates the identity root when its Composer
manifest exists. `STRAUSS_PHAR` may point at an existing PHAR; its SHA-256 must
match the pinned Strauss 0.31.1 release. The default downloads it into ignored
`scripts/.tools`. Commit the lock, prefixed tree and `.manifest.json` together.
The manifest records the lock hash and generation toolchain. The drift suite
checks that relationship and executes the real bundled parser and merger while
foreign YAML and WordPress HTML class names are already occupied. The vendor CI
job regenerates the tree on PHP 8.2 with pinned Composer 2.10.3 and checks for
tracked changes and new untracked bundle files.

The Markdown consumer and line merger work without WordPress. The toolkit's
Markdown producer calls WordPress `parse_blocks`; the sync lane must supply its
standalone block-parser integration before offering round trips there. These
dependencies alone do not enable sync. Identity is an inert placeholder until
its implementation lane adds the separate identity dependency root.
