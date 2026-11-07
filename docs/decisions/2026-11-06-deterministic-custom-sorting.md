# Restrict custom sorting to numeric key differences

JavaScript engines choose comparator call sequences. A callback that changes state, or an inconsistent comparator, can return different observable results across Node and PHP. Matching one engine's sequence would also depend on its version.

We accept numeric subtraction between the two parameters, or matching property paths, in either direction. The compiler records that shape; the runtime sorts by finite primitive keys without invoking user callbacks. Other comparator shapes and nonfinite or object keys receive explicit refusals.

Implementing a pinned V8 sorting algorithm would support more callbacks, but would add an engine-version contract and a second sorting implementation to maintain. We accept a smaller comparator subset and require callers to compute other orderings explicitly before sorting.
