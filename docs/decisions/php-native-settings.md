# Keep PHP configuration with the site owner

Loading Zero no longer sets `precision`, `serialize_precision`, `display_errors`
or `log_errors`. A plugin bootstrap runs in the same PHP request as WordPress and
every other plugin; changing these values there changed their numeric output and
diagnostic policy too.

Zero's JavaScript JSON and numeric spelling already use `Js::numStr`, whose
shortest-round-trip calculation uses explicit `sprintf` precision. They do not
need a global `precision` setting. Js's remaining `json_encode` calls handle only
strings, keys, booleans and null, so host numeric configuration cannot affect
them.

Native PHP data has a different encoding boundary. `Json::encode` mirrors PHP's
value, flags, depth and string-or-false interface. It scopes `serialize_precision`
to `-1` only while PHP encodes Zero's native data and restores the previous value
in `finally`, including failed encodings, invalid arguments and exceptions from
JsonSerializable callbacks. If the site already selects `-1`, it need not change
the setting. PHP exposes this policy as an ini setting rather than a json_encode
argument; callbacks invoked by that encoding run inside its numeric scope.

First-party native JSON call sites now name that boundary explicitly: deployment
metadata, service payloads and fingerprints, rule/schema hashes, database JSON
contexts and block attributes. Native arrays stay native arrays, and existing
JSON flags and failure behavior are preserved. There is no temporary change to
`precision` or diagnostic settings. Vendored libraries and WordPress retain their
own encoding policies. The pre-existing Sync canonical and Js encoders continue
to own their explicit number spelling.

The offline deploy adapter is also runnable without bootstrap or an autoloader.
Its entry point explicitly requires Json.php, and the Rust CLI includes that file
beside Artifact.php and Local.php in its temporary standalone bundle. The source
entry point and extracted CLI bundle run the same artifact success/refusal tests.

The bootstrap behavior test sets deliberately restrictive numeric precision and
distinct diagnostic settings before loading Zero. It verifies that bootstrap,
successful and failed native JSON, nested serializer exceptions, Js serialization
and canonical sync encoding leave those settings intact. It also verifies the
host still gets its chosen truncated JSON/string output after a Zero encoding,
while Zero preserves the complete float. The test runs in the ordinary `env`
suite. The complete PHP behavior suite validates the migrated callers.

Unexpected Zero exceptions still follow App's existing problem/logging boundary.
The WordPress/site owner controls PHP warning display and logging; Zero no longer
silently overrides those choices for the rest of the site. This is a correctness
and ownership change, with no latency claim.
