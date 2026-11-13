"use strict";
// A getter export, as tsc's re-export helpers write: Node runs it on every read, but compiled code
// reads build-time objects as constants.
let count = 1;
Object.defineProperty(exports, "count", { enumerable: true, get: function () { return count; } });
count = 2;
