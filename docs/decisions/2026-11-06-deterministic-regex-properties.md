# Refuse regex behavior tied to host Unicode tables

JavaScript and PCRE use different Unicode databases. Unicode properties and ignore-case literals disagree on recently added characters. PCRE also accepts property aliases that JavaScript rejects. A shared alias list cannot make these engines agree.

We refuse Unicode property escapes. Ignore-case matching requires literal ASCII source and ASCII input; encoded character escapes are refused in that mode. Known patterns receive source diagnostics, computed constructors throw SyntaxError, and unsupported subjects throw RangeError. Explicit character classes and case-sensitive Unicode matching remain available. Executable source and runtime refusals own these boundaries.

Pinning one Unicode database and translating its properties and case folding would retain more JavaScript syntax, but adds a large maintained data dependency. Passing these operations to PCRE would preserve familiar syntax at the cost of host-dependent behavior. We accept refusing valid JavaScript programs to keep accepted matching independent of that database difference. Supporting Unicode folding or properties later requires a deterministic implementation rather than a broader alias whitelist.
