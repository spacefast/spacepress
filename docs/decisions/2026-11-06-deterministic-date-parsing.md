# Refuse legacy Date parsing

JavaScript engines accept date strings beyond the standard ISO format. PHP's
parser and Zero's small ISO parser cannot reproduce all of V8's legacy rules.
Returning NaN for those inputs silently changes accepted JavaScript behavior.

We accept the existing ISO grammar, including its explicit space and offset
extensions. Other date syntax receives a source diagnostic when literal and
an explicit runtime RangeError after dynamic object coercion. Invalid calendar
components within the supported grammar still produce NaN, matching Node.

Porting V8's legacy parser would accept more inputs but would bind the compiler
to engine-specific rules. Delegating to PHP would reintroduce silent platform
differences. We accept rejecting some valid JavaScript inputs, including legacy
text produced by array/object coercion. Callers can pass ISO text or epoch
milliseconds. Runtime refusal tests replace the previous NaN expectations for
unsupported formats; canonical parsing and object-coercion vectors retain
executable coverage.
