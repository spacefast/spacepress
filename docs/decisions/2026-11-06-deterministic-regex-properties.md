# Refuse engine-dependent Unicode regex properties

JavaScript and PCRE apply ignore-case matching to Unicode properties differently:
`/\p{Lu}/iu.test('a')` and `/\P{Ll}/iu.test('a')` both return true in Node,
while PCRE returns false. PCRE also accepts property aliases such as `Xan` that
JavaScript rejects. Passing these patterns through would violate the compiler's
match-or-refuse contract.

Refuse every Unicode property escape under ignore-case matching. Without
ignore-case, accept the short General_Category aliases listed in
`src/builtins.rs`; generate the PHP list from that owner. Refuse other property
names, including otherwise valid script and long category names. Literal
patterns receive source diagnostics; computed constructors fail explicitly.

This deliberately costs some valid JavaScript regex syntax. Supporting more
properties requires adding a qualified contract, rather than trusting PCRE's
larger alias vocabulary or implementing another regex engine. Compiler refusal
cases and shared Node/PHP vectors own the boundary; the PHP parity suite keeps
positive non-ignore-case category matching covered.
