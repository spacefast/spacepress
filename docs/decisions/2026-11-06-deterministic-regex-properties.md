# Refuse engine-dependent Unicode regex properties

JavaScript and PCRE use different Unicode databases. Even `/\p{Lu}/u` disagrees on characters added after PHP's bundled Unicode version. Ignore-case matching also differs, and PCRE accepts property aliases that JavaScript rejects. A shared alias list cannot make these engines agree.

We refuse all Unicode property escapes. Known patterns receive source diagnostics; computed runtime constructors throw an explicit SyntaxError. Callers can use explicit character classes. The compiler and runtime each enforce this boundary, with executable refusal coverage for positive, negated and class properties.

Pinning one Unicode database and translating every property would retain more JavaScript syntax, but adds a large maintained data dependency. Passing properties to PCRE would preserve familiar syntax at the cost of host-dependent behavior. We accept refusing valid JavaScript programs to keep accepted regex behavior independent of that database difference. Supporting properties later requires a deterministic implementation rather than a broader alias whitelist.
