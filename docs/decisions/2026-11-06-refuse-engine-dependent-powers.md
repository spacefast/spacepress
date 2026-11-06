# Refuse powers whose rounding depends on the engine

Node, Rust and PHP can round the same exponentiation differently. For example,
`3 ** 35` differs in its last digits. Sharing a mathematical formula cannot
make the result match Node, and the previous documented exception contradicted
the accepted-program parity contract.

We accept safe integer powers, integral powers of binary bases, squares,
square roots and IEEE special values. Unsupported literal operands
receive source diagnostics; dynamic operands throw RangeError. The same rule
covers `**`, compound exponentiation and `Math.pow`.

Porting V8's power algorithm would accept more inputs, but would add a large
engine-specific numeric implementation in both Rust and PHP. Using host math
libraries is smaller but preserves silent differences. We accept a narrower
power domain; callers can reformulate their calculation or compute it outside
Zero. Existing negative decimal-power coverage now tests an explicit refusal,
while a binary negative power retains executable accepted-case coverage.

The same restriction applies to `Math.log` and `Math.exp`: log(1), exp(0) and
IEEE special values have deterministic results; other inputs are refused.
Nonbinary reciprocal powers are refused too: Node can round `45.29 ** -1`
differently from `1 / 45.29`. Node and PHP also differ for log(3). Keeping a
method available does not qualify its host math library for arbitrary inputs.
