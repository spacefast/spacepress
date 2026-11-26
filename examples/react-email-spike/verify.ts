import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { render, toPlainText } from "react-email";
import { call, hostFs } from "../../tests/wasm/host-fs.mjs";
import Invitation from "./emails/invitation";
import OrganizationInvite from "./transport/emails/identity/organization-invite";
import Welcome from "./transport/emails/welcome";

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
const binary = readFileSync(new URL("wasm32-unknown-unknown/wasm/spacepress.wasm", target));
let exports: WebAssembly.Exports;
const { instance } = await WebAssembly.instantiate(binary, { host: hostFs(() => exports) });
exports = instance.exports;
// CI discovers working examples by their config filename. Keep the intentional failure in a temporary app.
const project = mkdtempSync(join(tmpdir(), "spacepress-react-email-direct-import-"));
try {
  copyFileSync(new URL("direct-import-probe.ts", import.meta.url), join(project, "spacepress.config.ts"));
  mkdirSync(join(project, "emails"));
  copyFileSync(new URL("emails/invitation.tsx", import.meta.url), join(project, "emails/invitation.tsx"));
  symlinkSync(fileURLToPath(new URL("node_modules/", import.meta.url)), join(project, "node_modules"), "dir");
  const native = spawnSync(fileURLToPath(new URL("debug/spacepress", target)), ["check", project], { encoding: "utf8" });
  if (native.error) throw native.error;
  assert.equal(native.status, 1, native.stderr);
  assert.match(native.stderr, /implicit arguments can alias parameters/);
  assert.match(native.stderr, /node_modules\/react\/cjs\/react.production.js/);
  const { check } = call(exports, "sp_check", { project });
  assert.match(JSON.stringify(check.diagnostics), /implicit arguments can alias parameters/);
} finally {
  rmSync(project, { recursive: true, force: true });
}
console.log("Native and WASM compilers hit the same upstream React CommonJS blocker.");

const layout = call(exports, "sp_check", {
  project: "/email-layout-probe",
  files: {
    "spacepress.config.ts": `import { defineConfig } from "spacepress";
import "./emails/probe";
export default defineConfig({});`,
    "emails/probe.ts": "export const sample = 1;",
  },
});
assert.equal(layout.check.diagnostics[0]?.code, "F1210");
assert.match(layout.check.diagnostics[0]?.message, /emails\/probe.ts.*outside sp\//);
console.log("An isolated app-root email import hits the source boundary.");

const appFiles = Object.fromEntries(
  ["spacepress.config.ts", "emails/welcome.tsx", "emails/_components/Footer.tsx"]
    .map((path) => [path, readFileSync(new URL(`transport/${path}`, import.meta.url), "utf8")]),
);
const { output } = call(exports, "sp_compile", { name: "react-email-transport", files: appFiles });
assert.ok(output?.schemaPhp && output.functionsPhp, "WASM must compile the transport control");
const temp = mkdtempSync(join(tmpdir(), "spacepress-email-spike-"));
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

const welcomeCases = [
  { email: "ada@example.test", ...Welcome.PreviewProps },
  { email: "b@example.test", name: "A & <B>", dashboardUrl: "https://example.test/dashboard?team=2&tab=billing", siteName: "Example site" },
].map(({ siteName, ...input }) => input);
const welcomeTemp = mkdtempSync(join(tmpdir(), "spacepress-email-welcome-"));
try {
  writeFileSync(join(welcomeTemp, "schema.php"), output.schemaPhp);
  writeFileSync(join(welcomeTemp, "functions.php"), output.functionsPhp);
  const result = spawnSync(process.env.PHP ?? "php", [
    "-d", "zend.assertions=1", fileURLToPath(new URL("verify-welcome.php", import.meta.url)), welcomeTemp,
  ], { input: JSON.stringify(welcomeCases), encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const sent = JSON.parse(result.stdout);
  assert.equal(sent.length, welcomeCases.length);
  for (const [index, { email, ...props }] of welcomeCases.entries()) {
    const upstream = await render(createElement(Welcome, { ...props, siteName: "Example site" }));
    // The PHP JSX renderer coalesces adjacent text nodes.
    assert.equal(sent[index].html.replaceAll("<!-- -->", ""), upstream.replaceAll("<!-- -->", ""));
    assert.equal(sent[index].text, toPlainText(upstream));
  }
} finally {
  rmSync(welcomeTemp, { recursive: true, force: true });
}
console.log("An action rendered emails/welcome.tsx with live props and WordPress sent both bodies.");

const templatePath = "emails/identity/organization-invite.tsx";
const invitationProject = fileURLToPath(new URL("transport/", import.meta.url));
const nativeInvite = spawnSync(fileURLToPath(new URL("debug/spacepress", target)), ["check", invitationProject], { encoding: "utf8" });
if (nativeInvite.error) throw nativeInvite.error;
assert.equal(nativeInvite.status, 0, nativeInvite.stderr);

const invitationFiles = {
  ...appFiles,
  [templatePath]: readFileSync(new URL(`transport/${templatePath}`, import.meta.url), "utf8"),
};
const checkTemplate = (source: string) => call(exports, "sp_check", {
  project: "/email-diagnostic-probe",
  files: { ...invitationFiles, [templatePath]: source },
}).check.diagnostics;
const source = invitationFiles[templatePath];
assert.match(checkTemplate(source.replace("Button, Html", "Link as Button, Html"))[0]?.message,
  /React Email component `Link` is not supported/);
assert.match(checkTemplate('import * as Email from "react-email";\n' + source)[0]?.message,
  /import supported React Email components by name/);
assert.match(checkTemplate(source.replace("siteName: string", "siteName: number"))[0]?.message,
  /number/);

const invitation = call(exports, "sp_compile", { name: "react-email-transport", files: invitationFiles });
assert.ok(invitation.output?.schemaPhp && invitation.output.functionsPhp, JSON.stringify(invitation.check));
const capture = call(exports, "sp_sources", { project: invitationProject, packages: false });
assert.ok(JSON.parse(capture.app).files[templatePath], "hosted source capture must include the template");

const inviteTemp = mkdtempSync(join(tmpdir(), "spacepress-organization-invite-"));
try {
  for (const [kind, compiled] of [["override", invitation.output], ["fallback", output]] as const) {
    writeFileSync(join(inviteTemp, "schema.php"), compiled.schemaPhp);
    writeFileSync(join(inviteTemp, "functions.php"), compiled.functionsPhp);
    const result = spawnSync(process.env.PHP ?? "php", [
      "-d", "zend.assertions=1", fileURLToPath(new URL("verify-invitation.php", import.meta.url)), inviteTemp, kind,
    ], { encoding: "utf8" });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr || result.stdout);
    if (kind === "override") {
      const captured = JSON.parse(result.stdout);
      for (const { props, html, text } of captured) {
        const upstream = await render(createElement(OrganizationInvite, props));
        // The PHP JSX renderer coalesces adjacent text nodes.
        assert.equal(html.replaceAll("<!-- -->", ""), upstream.replaceAll("<!-- -->", ""));
        assert.equal(text, toPlainText(upstream));
      }
    }
    console.log(`WordPress sent and redeemed the ${kind} invitation.`);
  }
} finally {
  rmSync(inviteTemp, { recursive: true, force: true });
}
