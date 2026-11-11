# Sort with V8's TimSort instead of restricting comparators

Supersedes [2026-11-06-deterministic-custom-sorting](2026-11-06-deterministic-custom-sorting.md).

files-sdk 3.1.2 sorts with no comparator (`Object.keys(PROVIDERS).toSorted()`), with a three-way string comparator, and with `(a, b) => a.key < b.key ? -1 : 1`, which never returns 0 and so is not a consistent comparator. The earlier decision refused all three: it accepted only numeric key differences, because an inconsistent or effectful comparator can give a different result under a different sorting algorithm.

We now run the algorithm Node runs. V8 sorts with TimSort (third_party/v8/builtins/array-sort.tq, ported from CPython's listsort), and so do `src/sort.rs` (configuration evaluation) and `runtime/First/JsSort.php` (compiled code), step for step: the same run detection, minimum run length, binary insertion, merge pattern and galloping thresholds. A comparator therefore receives the same pairs in the same order as under Node, and returns the same order even when it is inconsistent, effectful or random. The differential test records every comparator call and checks call counts and checksums over random, presorted, descending and block patterns up to 1000 elements; changing the gallop threshold in either port makes it fail.

The cost is an engine-version contract: the ports follow V8 12.4 (Node 22). V8 has used this TimSort since 7.0 (2018); if it changes, effectful or inconsistent comparators may then differ from Node until the ports follow. Consistent comparators are unaffected, because every stable sort gives the same result for them.

Kept: a compiled numeric key-difference comparator (`(a, b) => a.rank - b.rank`) still sorts by keys read once, but only when every key is a finite number, string, boolean or null in an own data property. Then the comparator is a consistent total order without effects, and any stable sort gives V8's order. Otherwise the comparator runs. Default sorting converts primitives to strings once; objects convert at every comparison, as in V8, because their toString can count calls.
