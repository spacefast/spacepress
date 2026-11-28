import assert from "node:assert/strict";

export function inputFor() {
  return {};
}

export function check(name, _input, expected, actual) {
  if (name === "phpOnlyCipherDoesNotReleaseUnauthenticatedBytes") {
    assert.deepEqual(expected, [64, "Error:undefined"]);
    assert.deepEqual(actual, [0, "Error:undefined"]);
    return;
  }
  if (name === "phpOnlyZlibOutputCap") {
    assert.equal(expected, "no error");
    assert.equal(actual, "RangeError:ERR_BUFFER_TOO_LARGE");
    return;
  }
  assert.deepEqual(actual, expected);
}
