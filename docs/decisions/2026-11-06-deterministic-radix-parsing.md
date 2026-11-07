# Keep large radix parsing deterministic

Zero evaluates numbers in Rust and serves them through PHP. Long non-binary
`parseInt` inputs can produce different results in both languages and Node.
Correct mathematical rounding alone does not reproduce Node's permitted
approximations for these bases.

We support large results in base 10 and power-of-two bases. Other bases require
safe integer results, at most 2^53 − 1 in magnitude. The shared numeric owner
in `src/num.rs` enforces the evaluator boundary. Known unsupported literals
receive source diagnostics; dynamic inputs fail explicitly at runtime.

Reproducing V8's approximation algorithm would accept more inputs, but would
bind the contract to one engine implementation. Arbitrary precision would give
consistent mathematical answers that can still differ from Node. We accept
rejecting some previously accepted inputs. Callers can use decimal or binary
bases, or keep large values as strings.
