import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";

const execute = promisify(execFile);
export async function command(file, args, options = {}) {
  const { stdout, stderr } = await execute(file, args, {
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024,
    ...options,
  });
  return stdout + stderr;
}
export function sourceRevision(files) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
      ),
    )
    .digest("hex");
}
export async function buildApp({ app, first, files, log = () => {} }) {
  await mkdir(app, { recursive: true });
  for (const [name, source] of Object.entries(files)) await writeFile(join(app, name), source);
  const build = async () => log(await command(first, ["build", app, "--quiet"]));
  await build();
  const plugin = join(app, "first/dist/wp-content/plugins/first-app-showcase");
  const generated = join(plugin, "first/app");
  await mkdir(join(app, "public/client"), { recursive: true });
  await copyFile(join(app, "first/_generated/client/client.js"), join(app, "public/client/index.js"));
  await copyFile(join(app, "first/_generated/client/LICENSE"), join(app, "public/client/LICENSE"));
  await copyFile(join(app, "first.config.ts"), join(app, "public/source.ts.txt"));
  await copyFile(join(app, "pantry.ts"), join(app, "public/pantry.ts.txt"));
  await copyFile(join(generated, "functions.php"), join(app, "public/compiled.php.txt"));
  const migrationDir = join(app, "first/_generated/migrations");
  const migrationFiles = (await readdir(migrationDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const output = {};
  for (const name of ["schema.php", "functions.php"])
    output[name] = await readFile(join(generated, name), "utf8");
  for (const name of ["types", "schema"])
    output[`client/${name}.ts`] = await readFile(join(app, `first/_generated/client/${name}.ts`), "utf8");
  for (const name of migrationFiles)
    output[`migrations/${name}`] = await readFile(join(migrationDir, name), "utf8");
  const manifest = {
    name: "showcase",
    files,
    output,
    previous: JSON.parse(await readFile(join(migrationDir, "snapshot.json"), "utf8")),
    migrationFiles,
  };
  manifest.revision = sourceRevision({ files, previous: manifest.previous, migrationFiles });
  await writeFile(join(app, "public/sources.json"), JSON.stringify(manifest));
  await build();
  for (const name of await readdir(generated))
    if (name.endsWith(".php")) log(await command("php", ["-l", join(generated, name)]));
  return { manifest, plugin };
}

export function assertAdditive(before, after) {
  for (const [name, table] of Object.entries(before.tables)) {
    const next = after.tables[name];
    if (!next)
      throw new Error(
        `Apply preserves existing records: removing ${name} requires a separate migration.`,
      );
    const { columns, ...settings } = table;
    const { columns: nextColumns, ...nextSettings } = next;
    if (JSON.stringify(settings) !== JSON.stringify(nextSettings))
      throw new Error(`Apply cannot change storage/editor settings for ${name}.`);
    for (const [column, definition] of Object.entries(columns)) {
      if (JSON.stringify(definition) !== JSON.stringify(nextColumns[column]))
        throw new Error(
          `Apply cannot remove or change the existing field ${name}.${column}. Add a new field instead.`,
        );
    }
    for (const [column, definition] of Object.entries(nextColumns)) {
      if (!(column in columns) && definition.notNull && definition.default === null)
        throw new Error(`New required field ${name}.${column} needs a default before Apply.`);
    }
  }
}
function singleSqlStatement(sql) {
  let quote = null;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    if (quote) {
      if (char === "\\") {
        i++;
        continue;
      }
      if (char === quote) {
        if (sql[i + 1] === quote) i++;
        else quote = null;
      }
    } else if (["'", '"', "`"].includes(char)) quote = char;
    else if (char === ";" && sql.slice(i + 1).trim()) return false;
    else if (sql.slice(i, i + 2) === "/*" || sql.slice(i, i + 2) === "--" || char === "#")
      return false;
  }
  return quote === null && sql.endsWith(";");
}
export function assertAdditiveSql(sql) {
  for (const statement of sql
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (
      !singleSqlStatement(statement) ||
      (!/^CREATE TABLE\s+`[^`]+`\s*\(/i.test(statement) &&
        !/^ALTER TABLE\s+`[^`]+`\s+ADD COLUMN\s+`[^`]+`\s+[^;]+;$/i.test(statement))
    )
      throw new Error(
        "Apply accepts new tables and added columns only. Preview remains available for other migrations.",
      );
  }
}

export async function readAppSchema(plugin) {
  return JSON.parse(
    await command("php", [
      "-r",
      "echo json_encode(require $argv[1], JSON_THROW_ON_ERROR);",
      join(plugin, "first/app/schema.php"),
    ]),
  );
}
export function assertStructuredFields(before, after) {
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function fields(previous, next, path) {
    for (const [name, definition] of Object.entries(previous)) {
      const replacement = next?.[name];
      const at = `${path}.${name}`;
      if (!replacement) throw new Error(`Apply cannot remove the existing field ${at}.`);
      const { fields: nested, layouts, ...settings } = definition;
      const { fields: nextNested, layouts: nextLayouts, ...nextSettings } = replacement;
      if (!equal(settings, nextSettings))
        throw new Error(`Apply cannot change the existing field ${at}.`);
      if (nested) fields(nested, nextNested, at);
      if (layouts)
        for (const [layout, columns] of Object.entries(layouts)) {
          if (!nextLayouts?.[layout])
            throw new Error(`Apply cannot remove the existing layout ${at}.${layout}.`);
          fields(columns, nextLayouts[layout], `${at}.${layout}`);
        }
    }
    for (const [name, definition] of Object.entries(next ?? {})) {
      if (!(name in previous) && definition.notNull && definition.default == null)
        throw new Error(`New required field ${path}.${name} needs a default before Apply.`);
    }
  }
  for (const [name, entity] of Object.entries(before.collections)) {
    const next = after.collections[name];
    if (!next) throw new Error(`Apply cannot remove ${name}.`);
    for (const key of ["title", "content", "slug", "localized", "editor", "drafts", "revisions"]) {
      if (!equal(entity[key], next[key]))
        throw new Error(`Apply cannot change ${name}.${key} storage settings.`);
    }
    fields(entity.columns, next.columns, name);
  }
  for (const [name, global] of Object.entries(before.globals)) {
    const next = after.globals[name];
    if (!next || !equal(global.wp, next.wp))
      throw new Error(`Apply cannot remove or move the global ${name}.`);
    fields(global.fields, next.fields, name);
  }
}
