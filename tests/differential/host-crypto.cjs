// Static CommonJS beside host-globals.ts: `require("node:crypto")` resolves through the same
// built-in module lookup as `import` (builtins::module), destructured and as a namespace.
const { createHmac } = require("node:crypto");
const nodeCrypto = require("crypto");
exports.mac = function (key, text) {
  return createHmac("sha256", key).update(text).digest("hex");
};
exports.digest = function (text) {
  return nodeCrypto.createHash("sha1").update(text).digest("base64");
};
