// Rebuilds a 0.8 capsule directory from a stored finalize payload, so `typedpress-migrate --from zero app` can read
// what a live 0.8 version kept. Nothing here decides acceptance: the stored server bundle has no
// TypeScript types, so the census never counts a rebuilt capsule as accepted.
//
// What the payload keeps, and what the rebuild makes of it:
// - `bundles[0]` is 0.8's `server.qjs.mjs`: esbuild's ESM bundle of the server entry with every
//   local module inlined, whitespace removed and identifiers kept (`createRuntimeBundle` in
//   spacefast/monorepo legacy/zero-0.8/packages/zero-compile/src/compile.ts). It becomes
//   `server/index.ts` after undoing three things esbuild did: `var x = capsule(...)` plus
//   `export { x as default }` becomes `export default capsule(...)`, top-level `var X = class`
//   becomes `class X`, and each untyped query, mutation or action input gets the placeholder
//   type `__Census08Erased` (so the converter reads the handler body instead of stopping at the
//   missing annotation).
// - `artifact.pages[]` lists each page's file and render mode, not its source. A `.md` or `.html`
//   document page becomes an empty file of that name (the converter refuses those by extension).
//   Every TSX page becomes a stub that imports `census:source-not-recoverable`, which the
//   converter refuses as a page it cannot render; the census counts that as missing source.
import fs from "node:fs";
import path from "node:path";

export const ERASED = "__Census08Erased";
export const PAGE_MARKER = "census:source-not-recoverable";

const HANDLER_KINDS = { queries: "query", mutations: "mutation", actions: "action" };

/** The finalize payload's artifact and stored server bundle text, or a reason it has none. */
export function readPayload(finalize) {
  const artifact = finalize?.artifact;
  if (!artifact || artifact.format !== "stattic.zero.capsule.v1") return { error: "not a 0.8 capsule artifact" };
  const bundle = (finalize.bundles ?? []).find((b) => b?.contentBase64);
  return {
    artifact,
    bundle: bundle ? Buffer.from(bundle.contentBase64, "base64").toString("utf8") : null,
  };
}

/** The `@spacefast/zero/server` names the bundle imports, by their exported name. */
export function serverImports(ts, sf) {
  const names = new Map();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.moduleSpecifier.text !== "@spacefast/zero/server") continue;
    for (const el of st.importClause?.namedBindings?.elements ?? []) {
      names.set((el.propertyName ?? el.name).text, el.name.text);
    }
  }
  return names;
}

/** `server/index.ts` source rebuilt from the bundle text. */
export function serverSource(ts, text) {
  const sf = ts.createSourceFile("index.js", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const imports = serverImports(ts, sf);
  const capsule = imports.get("capsule");
  const edits = [];
  const at = (node) => node.getStart(sf);
  let exported = null;
  let capsuleCall = null;
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        if (el.name.text === "default") exported = (el.propertyName ?? el.name).text;
      }
      // Named exports only served other modules, which the bundle already inlined.
      edits.push([at(st), st.end, ""]);
      continue;
    }
    if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression)) {
      exported = st.expression.text;
      edits.push([at(st), st.end, ""]);
      continue;
    }
    if (ts.isExportAssignment(st) && isCall(ts, st.expression, capsule)) capsuleCall = st.expression;
  }
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || st.declarationList.declarations.length !== 1) continue;
    const decl = st.declarationList.declarations[0];
    if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
    const name = decl.name.text;
    if (name === exported && isCall(ts, decl.initializer, capsule)) {
      edits.push([at(st), at(decl.initializer), "export default "]);
      capsuleCall = decl.initializer;
    } else if (ts.isClassExpression(decl.initializer)) {
      // esbuild writes `class X {}` as `var X = class {}`, or `class _X {}` when the body names it.
      const cls = decl.initializer;
      const inner = cls.name?.text;
      edits.push([at(st), at(cls), ""]);
      edits.push([at(cls), cls.name ? cls.name.end : at(cls) + "class".length, `class ${name}`]);
      if (inner && inner !== name) renameWithin(ts, sf, cls, inner, name, edits);
    }
  }
  if (capsuleCall) annotateHandlers(ts, sf, capsuleCall, imports, edits);
  edits.sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [start, end, insert] of edits) out = out.slice(0, start) + insert + out.slice(end);
  return `type ${ERASED} = unknown;\n${out}`;
}

function isCall(ts, node, callee) {
  return Boolean(callee) && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === callee;
}

function renameWithin(ts, sf, root, from, to, edits) {
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === from && node !== root.name) edits.push([node.getStart(sf), node.end, to]);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(root, visit);
}

function annotateHandlers(ts, sf, call, imports, edits) {
  const options = call.arguments[0];
  if (!options || !ts.isObjectLiteralExpression(options)) return;
  for (const prop of options.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isObjectLiteralExpression(prop.initializer)) continue;
    const kind = HANDLER_KINDS[prop.name?.text];
    if (!kind) continue;
    const helper = imports.get(kind);
    for (const handler of prop.initializer.properties) {
      if (!ts.isPropertyAssignment(handler) || !isCall(ts, handler.initializer, helper)) continue;
      const fn = handler.initializer.arguments[0];
      if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) continue;
      for (const param of fn.parameters.slice(1)) {
        if (param.type || param.dotDotDotToken || param.initializer || !ts.isIdentifier(param.name)) continue;
        edits.push([param.name.end, param.name.end, `: ${ERASED}`]);
      }
    }
  }
}

/** A page stub for `page` (the `index`th), or null when its file cannot be placed in a capsule. */
export function pageStub(page, index) {
  let file = String(page?.file ?? "");
  const parts = file.split("/");
  if (!file || path.isAbsolute(file) || parts.some((p) => p === "" || p === "." || p === "..")) return null;
  // A document page bound to content (`content/<dir>/<name>.md`) is still a document page.
  if (!file.startsWith("pages/") && /\.(md|html)$/.test(file)) file = `pages/census-document-${index}.md`;
  if (!file.startsWith("pages/")) return null;
  if (/\.(md|html)$/.test(file)) return { file, text: "" };
  const client = page.render === "client" ? '"use client";\n' : "";
  return {
    file,
    text: `${client}import "${PAGE_MARKER}";\nexport default function Page() {\n  return null;\n}\n`,
  };
}

/** Writes the rebuilt capsule under `dir`; returns what the rebuild found. */
export function writeCapsule(ts, finalize, dir) {
  const { artifact, bundle, error } = readPayload(finalize);
  if (error) return { error };
  fs.mkdirSync(path.join(dir, "server"), { recursive: true });
  const info = { bundle: Boolean(bundle), imageResponse: false };
  if (bundle) {
    const sf = ts.createSourceFile("index.js", bundle, ts.ScriptTarget.ES2022, false, ts.ScriptKind.JS);
    info.imageResponse = serverImports(ts, sf).has("ImageResponse");
    fs.writeFileSync(path.join(dir, "server/index.ts"), serverSource(ts, bundle));
  }
  for (const [index, page] of (artifact.pages ?? []).entries()) {
    const stub = pageStub(page, index);
    if (!stub) continue;
    fs.mkdirSync(path.dirname(path.join(dir, stub.file)), { recursive: true });
    fs.writeFileSync(path.join(dir, stub.file), stub.text);
  }
  return info;
}
