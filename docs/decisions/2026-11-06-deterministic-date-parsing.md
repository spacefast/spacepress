# Refuse legacy Date parsing

JavaScript engines accept date strings beyond the standard ISO format. PHP's
parser and Zero's small ISO parser cannot reproduce all of V8's legacy rules.
Returning NaN for those inputs silently changes accepted JavaScript behavior.

We accept ISO date syntax, with T separating a complete date from its time
and colon-separated numeric offsets. Space separators, compact offsets and
partial dates with times are refused. Unsupported syntax receives a source
diagnostic when literal and a runtime RangeError after dynamic object coercion. Invalid calendar
components within the supported grammar still produce NaN, matching Node.

Porting V8's legacy parser would accept more inputs but would bind the compiler
to engine-specific rules. Delegating to PHP would reintroduce silent platform
differences. We accept rejecting some valid JavaScript inputs, including legacy
text produced by array/object coercion. Callers can pass ISO text or epoch
milliseconds. Runtime refusal tests replace the previous NaN expectations for
unsupported formats; canonical parsing and object-coercion vectors retain
executable coverage.
