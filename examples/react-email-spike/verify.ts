import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { render, toPlainText } from "react-email";
import { call, hostFs } from "../../tests/wasm/host-fs.mjs";
import Invitation from "./emails/invitation";

const cases = [
  Invitation.PreviewProps,
  { name: "A & <B>", url: "https://example.test/invite?org=2&code=longer" },
];
const messages = await Promise.all(cases.map(async (props) => {
  const html = await render(createElement(Invitation, props));
  const text = toPlainText(html);
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  assert.ok(html.replaceAll("<!-- -->", "").includes(`Hello, ${escape(props.name)}!`));
  assert.ok(html.includes(`href="${escape(props.url)}"`));
  assert.match(html, /\[if mso\]/);
  assert.ok(text.includes(`Hello, ${props.name}!`));
  assert.ok(text.includes(props.url));
  return { html, plainText: text };
}));
console.log("Upstream React Email rendered and escaped both invitations.");

const target = new URL("../../target/", import.meta.url);
const project = fileURLToPath(new URL(".", import.meta.url));
const native = spawnSync(fileURLToPath(new URL("debug/typedpress", target)), ["check", project], { encoding: "utf8" });
if (native.error) throw native.error;
assert.equal(native.status, 1, native.stderr);
assert.match(native.stderr, /implicit arguments can alias parameters/);
assert.match(native.stderr, /node_modules\/react\/cjs\/react.production.js/);

const binary = readFileSync(new URL("wasm32-unknown-unknown/wasm/typedpress.wasm", target));
let exports: WebAssembly.Exports;
const { instance } = await WebAssembly.instantiate(binary, { host: hostFs(() => exports) });
exports = instance.exports;
const { check } = call(exports, "tp_check", { project });
assert.match(JSON.stringify(check.diagnostics), /implicit arguments can alias parameters/);
console.log("Native and WASM compilers hit the same upstream React CommonJS blocker.");

const layout = call(exports, "tp_check", {
  project: "/email-layout-probe",
  files: {
    "typedpress.config.ts": `import { defineConfig } from "typedpress";
import "./emails/probe";
export default defineConfig({});`,
    "emails/probe.ts": "export const sample = 1;",
  },
});
assert.equal(layout.check.diagnostics[0]?.code, "F1210");
assert.match(layout.check.diagnostics[0]?.message, /emails\/probe.ts.*outside tp\//);
console.log("An isolated app-root email import hits the source boundary.");

const { output } = call(exports, "tp_compile", {
  name: "react-email-transport",
  files: { "typedpress.config.ts": readFileSync(new URL("transport/typedpress.config.ts", import.meta.url), "utf8") },
});
assert.ok(output?.schemaPhp && output.functionsPhp, "WASM must compile the transport control");
const temp = mkdtempSync(join(tmpdir(), "typedpress-email-spike-"));
try {
  writeFileSync(join(temp, "schema.php"), output.schemaPhp);
  writeFileSync(join(temp, "functions.php"), output.functionsPhp);
  const result = spawnSync(process.env.PHP ?? "php", [
    "-d", "zend.assertions=1", fileURLToPath(new URL("verify-transport.php", import.meta.url)), temp,
  ], { input: JSON.stringify(messages), encoding: "utf8" });
  if (result.error) throw result.error;
  process.stdout.write(result.stdout);
  assert.equal(result.status, 0, result.stderr);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
