// The browser compiler agrees with the command line: same envelope for the same sources.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import { Compiler, type Compiled, type Request } from "../../lib/compiler.ts";
import { repo, tpBinary, wasmPath } from "./helpers.ts";

/**
 * Every file under a project except build output (symlinks not followed), as the browser would hold
 * it. Of `tp/`, only the abilities and plugin locks are compiler inputs; the rest is build
 * output. A fixture's `node_modules` holds the plugin packages under test, so it travels too.
 */
function sources(dir: string): Request["files"] {
  const files: Request["files"] = {};
  for (const input of ["tp/_generated/abilities.json", "tp/_generated/plugins.lock.json"]) {
    const lock = path.join(dir, input);
    if (statSync(lock, { throwIfNoEntry: false })?.isFile()) files[input] = readFileSync(lock, "utf8");
  }
  const walk = (sub: string) => {
    for (const name of readdirSync(path.join(dir, sub))) {
      const rel = sub ? `${sub}/${name}` : name;
      // App code under tp/ is an input; what TypedPress wrote there is not (the locks are read above).
      if (name === ".tp" || rel === "tp/_generated" || rel === "tp/dist") continue;
      const full = path.join(dir, rel);
      const stat = lstatSync(full);
      if (stat.isDirectory()) walk(rel);
      else if (stat.isFile()) files[rel] = readFileSync(full, "utf8");
    }
  };
  walk("");
  return files;
}

/** Whether this run refuses plugin grants beyond the lock, as the command line does under CI. */
const frozen = Boolean(process.env.CI) && process.env.CI !== "false";

/** `typedpress check --json`'s one line, as printed. */
function nativeCheck(dir: string): string {
  const run = spawnSync(tpBinary(), ["check", "--json", dir], { encoding: "utf8" });
  assert.equal(run.stderr, "", run.stderr);
  return run.stdout.trimEnd();
}

/** The browser compiler's envelope, as serialized: the text under `check` and the parsed response. */
function browserCheck(request: Request) {
  const json = compiler.compileToJson(request);
  const prefix = '{"check":';
  assert.ok(json.startsWith(prefix), json.slice(0, 40));
  // The envelope is the first value; its text ends where `,"output":` begins at depth 1.
  const end = json.indexOf(',"output":');
  assert.ok(end > 0, json.slice(0, 80));
  return { envelope: json.slice(prefix.length, end), ...(JSON.parse(json) as Compiled) };
}

const compiler = await Compiler.load(readFileSync(wasmPath()));
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

test("a config that builds on the command line builds in the browser, to the same outputs", () => {
  const dir = path.join(repo, "examples/pantry");
  const { envelope, output } = browserCheck({ name: "pantry", files: sources(dir), previous: null });
  assert.equal(envelope, nativeCheck(dir));
  assert.ok(output);
  // A typedpress build: everything is one init migration, from the same snapshot the example commits.
  assert.deepEqual(output.snapshot, JSON.parse(readFileSync(path.join(dir, "tp/_generated/migrations/snapshot.json"), "utf8")));
  assert.deepEqual(output.migrations.map(([name]) => name), ["0001_init.sql"]);
  assert.equal(output.client["types.ts"], readFileSync(path.join(dir, "tp/_generated/client/types.ts"), "utf8"));
  assert.equal(output.client["schema.ts"], readFileSync(path.join(dir, "tp/_generated/client/schema.ts"), "utf8"));
  assert.equal(output.genTs, readFileSync(path.join(dir, "tp/_generated/db.d.ts"), "utf8"));
  // Class lowering and inference run through this same core in both environments.
  const classDir = path.join(repo, "tests/differential");
  const classFiles = { "typedpress.config.ts": readFileSync(path.join(classDir, "classes.ts"), "utf8") };
  const className = `typedpress-classes-${process.pid}`;
  const classProject = path.join("/tmp", className);
  mkdirSync(classProject, { recursive: true });
  try {
    // Native check takes a project, while the browser holds the identical source in memory.
    writeFileSync(path.join(classProject, "typedpress.config.ts"), classFiles["typedpress.config.ts"]);
    const classes = browserCheck({ name: `tmp/${className}`, files: classFiles, previous: null });
    assert.equal(classes.envelope, nativeCheck(classProject));
    assert.equal(classes.check.ok, true);
    assert.ok(classes.output);
  } finally {
    rmSync(classProject, { recursive: true, force: true });
  }
});

test("the previous snapshot and migration files drive the next migration like they do on disk", () => {
  const dir = path.join(repo, "examples/pantry");
  const previous = JSON.parse(readFileSync(path.join(dir, "tp/_generated/migrations/snapshot.json"), "utf8"));
  const migrationFiles = readdirSync(path.join(dir, "tp/_generated/migrations"));
  const unchanged = compiler.compile({ name: "pantry", files: sources(dir), previous, migrationFiles });
  assert.deepEqual(unchanged.output?.migrations, []);
  const files = sources(dir);
  files["typedpress.config.ts"] = files["typedpress.config.ts"]!.replace("expiresOn: date().optional(),", "expiresOn: date().optional(),\n  note: text().optional(),");
  const changed = compiler.compile({ name: "pantry", files, previous, migrationFiles });
  assert.deepEqual(
    changed.output?.migrations.map(([name, sql]) => [name, /ALTER TABLE/.test(sql)]),
    [["0004_update.sql", true]],
  );
});

test("without a snapshot the migration files still number the next one, like on disk", () => {
  const dir = path.join(repo, "examples/pantry");
  const migrationFiles = readdirSync(path.join(dir, "tp/_generated/migrations"));
  const { output } = compiler.compile({ name: "pantry", files: sources(dir), previous: null, migrationFiles });
  assert.deepEqual(output?.migrations.map(([name]) => name), ["0004_update.sql"]);
});

test("a snapshot from another version is refused like on the command line", () => {
  const dir = path.join(repo, "examples/pantry");
  const { check } = compiler.compile({ name: "pantry", files: sources(dir), previous: { version: 1, tables: {} } });
  assert.equal(check.ok, false);
  assert.match(check.diagnostics[0]?.message ?? "", /version 1 snapshot/);
});

/** Whether anything under `dir` is a symlink: a refusal about one needs the disk. */
function hasSymlink(dir: string): boolean {
  return readdirSync(dir).some((name) => {
    const stat = lstatSync(path.join(dir, name));
    return stat.isSymbolicLink() || (stat.isDirectory() && hasSymlink(path.join(dir, name)));
  });
}

test("every refused fixture is refused with the command line's envelope", async (t) => {
  const fixtures = path.join(repo, "tests/fixtures");
  const refused = readdirSync(fixtures).filter(
    (name) => name.startsWith("reject-") && statSync(path.join(fixtures, name, "typedpress.config.ts"), { throwIfNoEntry: false }),
  );
  assert.ok(refused.length > 20, `only ${refused.length} fixtures`);
  for (const name of refused) {
    await t.test(name, () => {
      const dir = path.join(fixtures, name);
      const native = nativeCheck(dir);
      const { envelope, check, output } = browserCheck({ name, files: sources(dir), previous: null, frozen });
      if (hasSymlink(dir)) {
        // The browser holds sources only, no directories, so a sync directory that is a symlink out of
        // the project cannot be seen there; the config itself is fine and builds.
        assert.equal(check.ok, true);
        return;
      }
      assert.equal(envelope, native);
      assert.equal(output, null);
    });
  }
});

test("a project without typedpress.config.ts is the command line's diagnostic", () => {
  // The browser's project lives at /<name>, so the native check runs on a directory by that path.
  const name = `typedpress-site-test-${process.pid}`;
  const dir = path.join("/tmp", name);
  mkdirSync(dir, { recursive: true });
  try {
    const native = nativeCheck(dir);
    const { envelope, output } = browserCheck({ name: realpathSync(dir).slice(1), files: {} });
    assert.equal(envelope, native);
    assert.equal(output, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// This seam owns browser/native normalization and generated-client typing; the
// differential oracle owns PHP execution of the language constructs.
test("finite type algebra preserves native outputs and strict client boundaries in WASM", () => {
  const fixture = path.join(repo, "tests/fixtures/type-semantics");
  const name = `typedpress-type-semantics-${process.pid}`;
  const dir = path.join("/tmp", name);
  mkdirSync(dir, { recursive: true });
  try {
    const files = sources(fixture);
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), text);
    }
    const { envelope, check, output } = browserCheck({ name, files });
    assert.equal(envelope, nativeCheck(dir));
    assert.equal(check.ok, true);
    assert.ok(output);
    const built = spawnSync(tpBinary(), ["build", dir], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    const plugins = path.join(dir, "tp/dist/wp-content/plugins");
    const app = readdirSync(plugins).find((name) => name.startsWith("typedpress-app-"));
    assert.ok(app);
    assert.equal(output.functionsPhp, readFileSync(path.join(plugins, app, "tp/app/functions.php"), "utf8"));
    for (const [name, text] of Object.entries(output.client)) {
      assert.equal(text, readFileSync(path.join(dir, "tp/_generated/client", name), "utf8"));
    }
    const typed = spawnSync(process.execPath, [tsc, "-p", path.join(fixture, "tsconfig.json")], { encoding: "utf8" });
    assert.equal(typed.status, 0, typed.stdout + typed.stderr);
    const wire = spawnSync("php", ["-r", String.raw`require $argv[1]; $schema=require $argv[2].'/schema.php';require $argv[2].'/functions.php';$out=[];foreach(['wireUndefinedTuple','wireUndefinedObject','wireDestructuredObject'] as $name){$fn='\TypedPressApp\\'.$schema['actions'][$name]['handler'];$out[]=\TypedPress\Seam::toWire($fn());}echo json_encode($out);`, path.join(plugins, "typedpress-runtime/tp/bootstrap.php"), path.join(plugins, app, "tp/app")], { encoding: "utf8" });
    assert.equal(wire.status, 0, wire.stderr);
    assert.equal(wire.stderr, "");
    assert.deepEqual(JSON.parse(wire.stdout), JSON.parse(JSON.stringify([[undefined], { x: undefined }, { x: undefined }])));
    const client = spawnSync(process.execPath, [tsc, "--noEmit", "--strict", "--target", "es2023", "--module", "preserve", "--moduleResolution", "bundler", "--allowImportingTsExtensions", path.join(dir, "client.ts")], { encoding: "utf8" });
    assert.equal(client.status, 0, client.stdout + client.stderr);

    // Backend queries and wire types retain the authored null/undefined domains.
    const storedSource = `import { table, group, json, text, select, slug, email, userProjection, defineConfig, action, db, type InferSelectModel, type InferInsertModel } from "typedpress";
type Domain = { title: string; note?: string | null; state: "draft" | "published"; items?: { label?: string }[] };
type Payload = Required<Pick<Domain, "title">> & Partial<Omit<Domain, "title">>;
class View { constructor(public payload: Payload) {} read(): string { return this.payload.title; } }
export const source = table({ body: json<Payload>().localized(), label: select(["first", "second"]), slug: slug({ source: "label" }), details: group({ nullable: text().optional(), defaulted: text().default("source") }).optional() }, { uid: true });
type Selected = InferSelectModel<typeof source>;
type Inserted = InferInsertModel<typeof source>;
export const members = userProjection({ email: email().unique().max(191), name: text() });
type Member = InferSelectModel<typeof members>;
class MemberView { constructor(public row: Member) {} read(): string { return this.row.name; } }
class SelectedView { constructor(public payload: Selected) {} read(): string { return this.payload.body.title; } }
type WithoutLocale = Omit<Inserted, "locale">;
class InsertedView { constructor(public payload: Inserted) {} read(): string { return this.payload.body.title; } }
class TranslationView { constructor(public payload: WithoutLocale) {} read(): string { return this.payload.body.title; } }
export const documents = table({ payload: json<Payload>(), metadata: group({ payload: json<Payload>() }), selected: json<Selected>(), inserted: json<Inserted>(), translation: json<WithoutLocale>() });
export const read = action({ input: {}, handler: async () => {
  const inserted: Inserted = { body: { title: "fresh" }, label: "first" };
  const translated: Inserted = { body: { title: "translated" }, translationOf: 1 };
  const member = await db.query.members.findFirst();
  const memberName = !member ? "" : new MemberView(member).read();
  const selected = await db.query.source.findFirst();
  const sourceTitle = !selected ? "" : new SelectedView(selected).read();
  const row = await db.query.documents.findFirst();
  return !row ? null : memberName + sourceTitle + new InsertedView(inserted).read() + new InsertedView(translated).read() + new View(row.payload).read() + new View(row.metadata.payload).read() + new SelectedView(row.selected).read() + new InsertedView(row.inserted).read() + new TranslationView(row.translation).read();
} });
export default defineConfig({ locales: { default: "en", all: ["en", "de"] } });`;
    writeFileSync(path.join(dir, "typedpress.config.ts"), storedSource);
    const stored = browserCheck({ name, files: { "typedpress.config.ts": storedSource } });
    assert.equal(stored.envelope, nativeCheck(dir));
    assert.equal(stored.check.ok, true, stored.envelope);
    const storedBuild = spawnSync(tpBinary(), ["build", dir], { encoding: "utf8" });
    assert.equal(storedBuild.status, 0, storedBuild.stderr);
    writeFileSync(path.join(dir, "stored-client.ts"), `import type { Document } from "./tp/_generated/client/types";
const wire: Document["payload"] = { title: "wire", state: undefined, items: [{ label: undefined }] };
// @ts-expect-error optional string values do not admit null
const invalidWire: Document["payload"] = { title: "wire", items: [{ label: null }] };
const selected: Document["selected"] = { id: 1, uid: "zr_12345678901234567890", slug: "first", body: wire, label: "first", details: null, locale: "en", translations: { de: 2 } };
const inserted: Document["inserted"] = { body: wire, label: "second" };
const translated: Document["inserted"] = { body: wire, translationOf: 1 };
void selected; void inserted; void invalidWire;`);
    writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, target: "ES2023", module: "Preserve", moduleResolution: "Bundler", paths: { typedpress: [path.join(repo, "types/typedpress/index.d.ts")] } },
      include: ["typedpress.config.ts", "tp/_generated/db.d.ts", "stored-client.ts"],
    }));
    const storedTypes = spawnSync(process.execPath, [tsc, "-p", path.join(dir, "tsconfig.json")], { encoding: "utf8" });
    assert.equal(storedTypes.status, 0, storedTypes.stdout + storedTypes.stderr);

    const recursiveModel = `import { table, json, defineConfig, type InferSelectModel } from "typedpress";
type Payload = InferSelectModel<typeof source>;
export const source = table({ body: json<Payload>().optional() });
export default defineConfig({});`;
    writeFileSync(path.join(dir, "typedpress.config.ts"), recursiveModel);
    const recursive = browserCheck({ name, files: { "typedpress.config.ts": recursiveModel } });
    assert.equal(recursive.envelope, nativeCheck(dir));
    assert.equal(recursive.check.ok, false);
    assert.match(recursive.check.diagnostics[0]?.message ?? "", /recursive JSON model annotations/);
    assert.equal(recursive.check.diagnostics[0]?.location?.file, "typedpress.config.ts");

    const modelTables = Array.from({ length: 15 }, (_, i) => `export const model${i} = table({ left: json<${i === 0 ? "{ label: string }" : `InferSelectModel<typeof model${i - 1}>`}>(), right: json<${i === 0 ? "{ label: string }" : `InferSelectModel<typeof model${i - 1}>`}>() });`).join("\n");
    const modelExpansion = `import { table, json, defineConfig, type InferSelectModel } from "typedpress";
${modelTables}
export default defineConfig({});`;
    writeFileSync(path.join(dir, "typedpress.config.ts"), modelExpansion);
    const expandedModel = browserCheck({ name, files: { "typedpress.config.ts": modelExpansion } });
    assert.equal(expandedModel.envelope, nativeCheck(dir));
    assert.equal(expandedModel.check.ok, false);
    assert.match(expandedModel.check.diagnostics[0]?.message ?? "", /type expansion.*16384-step limit/);
    assert.equal(expandedModel.check.diagnostics[0]?.location?.file, "typedpress.config.ts");
    const modelTypes = spawnSync(process.execPath, [tsc, "-p", path.join(dir, "tsconfig.json")], { encoding: "utf8" });
    assert.equal(modelTypes.status, 0, modelTypes.stdout + modelTypes.stderr);

    // Each annotation root fits its own budget. Compiling C from the nested
    // annotation must accept the same program as compiling it from new C first.
    const aliases = Array.from({ length: 30 }, (_, i) => `type A${i} = ${i === 29 ? "string" : `A${i + 1}`};`).join("\n");
    const nestedType = "Box<".repeat(75) + "C" + ">".repeat(75);
    const nestedValue = "{ value: ".repeat(75) + "new C()" + " }".repeat(75);
    const budgetSource = (prime: boolean) => `import { action, defineConfig } from "typedpress";
type Box<T> = { value: T };
${aliases}
class C { label: string = "ok"; read(): string { const text: A0 = "ok"; return text; } }
export const run = action({ input: {}, handler: () => {
  ${prime ? "new C();" : ""}
  const x: ${nestedType} = ${nestedValue}; return x;
} });
export default defineConfig({});`;
    writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, target: "ES2023", module: "Preserve", moduleResolution: "Bundler", paths: { typedpress: [path.join(repo, "types/typedpress/index.d.ts")] }, skipLibCheck: true },
      include: ["typedpress.config.ts"],
    }));
    for (const prime of [false, true]) {
      const source = budgetSource(prime);
      writeFileSync(path.join(dir, "typedpress.config.ts"), source);
      const result = browserCheck({ name, files: { "typedpress.config.ts": source } });
      assert.equal(result.envelope, nativeCheck(dir));
      assert.equal(result.check.ok, true, result.envelope);
      assert.ok(result.output);
      const strict = spawnSync(process.execPath, [tsc, "-p", path.join(dir, "tsconfig.json")], { encoding: "utf8" });
      assert.equal(strict.status, 0, strict.stdout + strict.stderr);
    }

    // Compact intersections must be bounded before their Cartesian expansion.
    // Nine binary unions reach the supported boundary; fifteen used to create
    // 32,768 distinct objects without exhausting the annotation-visit budget.
    const binaryParts = (count: number) => Array.from({ length: count }, (_, i) => `({ k${i}: "a" } | { k${i}: "b" })`);
    const binaryValue = (count: number) => Array.from({ length: count }, (_, i) => `k${i}: "a"`).join(", ");
    const wideFields = Array.from({ length: 512 }, (_, i) => `field${i}: number`).join("; ");
    const wideValue = Array.from({ length: 512 }, (_, i) => `field${i}: 1`).join(", ");
    for (const probe of [
      { parts: binaryParts(9), value: binaryValue(9), error: null },
      { parts: binaryParts(15), value: binaryValue(15), error: /intersection expansion.*512-alternative limit/ },
      // Thirty-two alternatives fit the candidate limit, but merging 512
      // properties into each must consume the shared resolution-work budget.
      {
        parts: [`(${Array.from({ length: 32 }, (_, i) => `{ tag: "t${i}" }`).join(" | ")})`, `{ ${wideFields} }`],
        value: `tag: "t0", ${wideValue}`,
        error: /type expansion.*16384-step limit/,
      },
      {
        parts: [`{ ${wideFields} }`, `(${Array.from({ length: 32 }, (_, i) => `{ tag: "t${i}" }`).join(" | ")})`],
        value: `tag: "t0", ${wideValue}`,
        error: /type expansion.*16384-step limit/,
      },
    ]) {
      const source = `import { action, defineConfig } from "typedpress";
type Expanded = ${probe.parts.join(" & ")};
export const run = action({ input: {}, handler: () => {
  const x: Expanded = { ${probe.value} }; return x;
} });
export default defineConfig({});`;
      writeFileSync(path.join(dir, "typedpress.config.ts"), source);
      const result = browserCheck({ name, files: { "typedpress.config.ts": source } });
      assert.equal(result.envelope, nativeCheck(dir));
      assert.equal(result.check.ok, probe.error === null, result.envelope);
      if (probe.error === null) {
        assert.ok(result.output);
      } else {
        assert.equal(result.output, null);
        assert.match(result.check.diagnostics[0]?.message ?? "", probe.error);
        assert.equal(result.check.diagnostics[0]?.location?.file, "typedpress.config.ts");
      }
      const strict = spawnSync(process.execPath, [tsc, "-p", path.join(dir, "tsconfig.json")], { encoding: "utf8" });
      assert.equal(strict.status, 0, strict.stdout + strict.stderr);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shared builtin vectors emit byte-identical PHP in native and WASM", () => {
  const vectors: unknown = JSON.parse(readFileSync(path.join(repo, "tests/differential/builtin-vectors.json"), "utf8"));
  assert.ok(Array.isArray(vectors));
  const declarations: string[] = [];
  const actions: string[] = [];
  const javascript: string[] = [];
  const files: Request["files"] = {};
  function addVector(value: unknown) {
    assert.ok(value !== null && typeof value === "object");
    assert.ok("name" in value && typeof value.name === "string");
    assert.ok("expression" in value && typeof value.expression === "string");
    assert.ok("fold" in value && typeof value.fold === "boolean");
    let expression = value.expression;
    if ("files" in value) {
      assert.ok(value.files !== null && typeof value.files === "object" && !Array.isArray(value.files));
      const entries: Array<[string, unknown]> = Object.entries(value.files);
      for (const [name, source] of entries) {
        assert.ok(typeof source === "string");
        // App modules load only from tp/; the generated config below lives there too.
        files[`tp/${name}`] = source;
      }
    }
    if ("declarations" in value) {
      assert.ok(typeof value.declarations === "string");
      declarations.push(value.declarations);
    }
    if ("javascript" in value && value.javascript === true) {
      javascript.push(`export const js_${value.name} = () => (${expression});`);
      declarations.push(`import {js_${value.name}} from './helper.js';`);
      expression = `js_${value.name}()`;
    }
    actions.push(`export const ${value.name} = action({ input: {}, handler: () => (${expression}) });`);
    if (value.fold) {
      declarations.push(`const folded_${value.name}_value = ${value.expression};`);
      actions.push(`export const folded_${value.name} = action({ input: {}, handler: () => folded_${value.name}_value });`);
    }
  }
  vectors.forEach(addVector);
  files["tp/helper.js"] = javascript.join("\n");
  files["tp/app.ts"] = `import { action, defineConfig } from 'typedpress';\n${declarations.join("\n")}\n${actions.join("\n")}\nexport default defineConfig({name:'builtinparity'});`;
  files["typedpress.config.ts"] = "export { default } from './tp/app.ts';\n";
  const dir = path.join(repo, "target", `builtin-wasm-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  try {
    for (const [name, source] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      writeFileSync(path.join(dir, name), source);
    }
    const { envelope, check, output } = browserCheck({ name: "builtinparity", files });
    assert.equal(envelope, nativeCheck(dir));
    assert.equal(check.ok, true);
    assert.ok(output);
    const built = spawnSync(tpBinary(), ["build", dir], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
    const app = path.join(dir, "tp/dist/wp-content/plugins/typedpress-app-builtinparity/tp/app");
    assert.equal(output.functionsPhp, readFileSync(path.join(app, "functions.php"), "utf8"));
    assert.equal(output.schemaPhp, readFileSync(path.join(app, "schema.php"), "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
