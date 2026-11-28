import assert from "node:assert/strict";

export function inputFor() {
  return {};
}

export function check(name, _input, expected, actual) {
  if (name === "phpOnlyPbkdf2WorkCap") {
    assert.equal(expected, "accepted");
    assert.equal(actual, "RangeError:ERR_OUT_OF_RANGE");
    return;
  }
  assert.deepEqual(actual, expected);
}
