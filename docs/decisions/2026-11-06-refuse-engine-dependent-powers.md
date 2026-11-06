# Refuse powers whose rounding depends on the engine

Node, Rust and PHP can round exponentiation differently. For example,
`3 ** 35` differs in its last digits. Host math libraries cannot satisfy
Zero's accepted-program parity contract.

We accept safe integer powers, integral powers of binary bases, squares,
square roots and IEEE special values. Unsupported literals receive source
diagnostics; dynamic operands throw RangeError. This covers `**`, compound
exponentiation and `Math.pow`. Math.log and Math.exp accept exact identities
and IEEE special values. Nonbinary reciprocal powers are also refused:
Node can round `45.29 ** -1` differently from `1 / 45.29`.

Porting V8's algorithms would accept more inputs, but would add substantial
engine-specific numeric code in both Rust and PHP. Host libraries are smaller
but preserve silent differences. We accept a narrower numeric domain; callers
must reformulate unsupported calculations or compute them outside Zero.
