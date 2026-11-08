# Use what WordPress core ships

Zero runs only inside WordPress (design-wp-only.md), and requires 7.1. The
runtime still bundled private copies of code core already loads on every
request, plus toolkit packages nothing in Zero reaches. WordPress 7.2 is not
released (core version-check and the wordpress-develop tags stop at 7.1.4), so
the floor stays at 7.1; everything below exists in 7.1.

## What changes

1. **HTML API and block parser come from core.** `wp-php-toolkit/html` and
   `wp-php-toolkit/blockparser` duplicate `WP_HTML_Tag_Processor`,
   `WP_HTML_Processor` and `WP_Block_Parser`. Core 7.1.4's copies are newer and
   expose every member the toolkit's subclasses (`BlockMarkupProcessor`,
   `DataLiberationHTMLProcessor`) use. Converting a 35-document Markdown corpus
   through `Zero\Sync\Markdown` gives byte-identical output with either copy.
   The root `composer.json` declares both packages as `replace`d, so Composer
   never installs them and Strauss leaves the toolkit's references pointing at
   the unprefixed core classes.
2. **Block serialization is core's.** `Sync\Blocks` called its own
   `serializeBlock()`, documented as core's byte for byte. It omitted core's
   backslash escape (`\\` becomes `\`), so a backslash in an attribute was
   stored differently from what core writes. It now calls `serialize_blocks()`
   and parses with `parse_blocks()`. Core encodes attributes with
   `wp_json_encode`, so float attributes follow the site's
   `serialize_precision`, as every other core-serialized block does. PHP's
   default (`-1`) gives the same shortest round-trip spelling `Json::encode`
   used.
3. **Packages nothing loads are not bundled.** Starting from every runtime file
   that names `Zero\Vendor` or `Zero_Vendor_` (`Media/S3.php`,
   `Sync/{Blocks,Markdown,Merge}.php`), no class in `bytestream`, `encoding`,
   `filesystem`, `http-client` or `xml` is reachable; they enter only through
   data-liberation's importers, entity readers/writers, URL rewriting and CSS
   processor, which Markdown sync never touches. Those packages are `replace`d
   as well, and Strauss skips the unreached data-liberation subtrees
   (`exclude_from_copy.file_patterns`). Markdown, merge and the small
   data-liberation core they use stay.
4. **Small swaps.** `Identity\Security::hash` calls `wp_hash($v, 'auth',
   'sha256')`, which is the same `hash_hmac('sha256', $v, wp_salt('auth'))`.
   `Js::uuid()` (not JavaScript semantics; it named files and the site id)
   becomes `wp_generate_uuid4()`. `parse_url` becomes `wp_parse_url` in
   WordPress-only runtime code, which also parses request paths such as
   `/a:1` that `parse_url` rejects.

## What stays

- Markdown (CommonMark, YAML front matter) and the line merger: core has
  neither.
- `Scf` keeps `htmlspecialchars` for help text. `esc_html` refuses to
  double-encode existing entities and is filterable, so author help text would
  stop being literal; `Scf::fieldFor` is also exercised without WordPress.
- AsyncAWS S3, the identity libraries, `Jobs::uuid` and the files other work
  owns are out of scope.

## Checks

The vendor drift suite's isolation case declared a foreign
`WP_HTML_Tag_Processor` to prove the bundled copy stayed private. There is no
bundled copy now, so the case proves the bundled YAML and merger still run
while their original names are occupied, and that the bundle answers no
private WordPress class name. The sync suite stores a fenced code block whose
language contains a backslash and expects core's escaping.
