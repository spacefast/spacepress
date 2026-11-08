# Crypto parity with Zero 0.8

`expected.json` holds the original runtime's output for `cases.json` (inline
keys) and `named.json` (keys read from a variable). It was produced by the 0.8
runner's own functions, `hmac_sha256_hex` and `timing_safe_equal` from
`crates/stattic-zero-runner/src/legacy/zero-0.8/crypto.rs` (spacefast/monorepo
`zero-v2-cutover` at `0cc0293a04`), built against `ring` 0.17 and `subtle` 2.
The SHA-256 is `ring::digest::SHA256`, as `artifacts::sha256_hex` uses, and the
key is trimmed with Rust's `str::trim`, as `key_value` does.

The inputs mix ASCII, control characters, NUL, combining and astral characters,
and Unicode whitespace around keys. `tests/php/crypto_test.php` checks
`Zero\Crypto` against every case.
