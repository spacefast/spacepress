import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { buildTheme, writeTheme, type ThemeBuild } from "../../src/compiler/theme.ts";
import { readPatternHeader } from "../../src/compiler/pattern-file.ts";
import type { Diagnostic } from "../../src/diagnostics.ts";
import { allValid, reparse } from "./helpers.ts";
import { themeDir, withOutDir, withVariant } from "./theme-fixtures.ts";

const decode = (data: Uint8Array) => new TextDecoder().decode(data);
const fileOf = (build: ThemeBuild, name: string) => {
  const file = build.files.find((f) => f.path === name);
  if (!file) throw new Error(`${name} not in build: ${build.files.map((f) => f.path).join(", ")}`);
  return decode(file.data);
};
const errors = (build: ThemeBuild) => build.diagnostics.filter((d) => d.severity === "error");
const codes = (diagnostics: readonly Diagnostic[]) => diagnostics.map((d) => [d.code, d.loc ? path.relative(themeDir, d.loc.file).replace(/^\.\.\/[^/]+\//, "") : null]);
/** `[code, file relative to the theme root]`, for a variant build. */
const where = (dir: string, diagnostics: readonly Diagnostic[]) => diagnostics.map((d) => [d.code, d.loc ? path.relative(dir, d.loc.file) : null]);

let shared: Promise<ThemeBuild> | null = null;
const fixtureBuild = () => (shared ??= buildTheme(themeDir));

test("the fixture theme builds with no error and one warning for its unreferenced part", async () => {
  const build = await fixtureBuild();
  assert.deepEqual(errors(build), []);
  assert.deepEqual(codes(build.diagnostics), [["unused_part", "parts/sidebar.tsx"]]);
  assert.equal(build.slug, "fixture-theme");
});

test("every source becomes the file WordPress reads for it, and assets and the screenshot ride along", async () => {
  const build = await fixtureBuild();
  assert.deepEqual(build.files.map((f) => f.path), [
    "assets/fonts/inter.woff2", "parts/footer.html", "parts/header.html", "parts/sidebar.html", "patterns/cta.php", "patterns/hero.php", "readme.txt", "screenshot.png", "style.css", "styles/dark.json",
    "templates/contact.html", "templates/image.html", "templates/index.html", "templates/landing.html", "templates/single-post.html", "templates/single.html", "theme.json",
  ]);
});

test("every template and part parses back valid through the pinned editor parser", async () => {
  const build = await fixtureBuild();
  for (const file of build.files.filter((f) => f.path.endsWith(".html"))) {
    const parsed = await reparse(decode(file.data));
    assert.ok(parsed.length > 0, file.path);
    assert.ok(allValid(parsed), file.path);
  }
});

test("a template part reference carries the part's tag and area from its declaration", async () => {
  const blocks = await reparse(fileOf(await fixtureBuild(), "templates/single.html"));
  const header = blocks[0]!;
  const footer = blocks.at(-1)!;
  assert.deepEqual([header.name, header.attributes.slug, header.attributes.tagName, header.attributes.area], ["core/template-part", "header", "header", "header"]);
  assert.deepEqual([footer.attributes.slug, footer.attributes.tagName, footer.attributes.area], ["footer", "footer", "footer"]);
});

test("a query loop holds one post template with the per-post blocks, and no-results and pagination beside it", async () => {
  const [, main] = await reparse(fileOf(await fixtureBuild(), "templates/index.html"));
  const query = main!.inner.find((b) => b.name === "core/query")!;
  assert.deepEqual((query.attributes.query as { inherit: boolean }).inherit, true);
  assert.deepEqual(query.inner.map((b) => b.name), ["core/post-template", "core/query-no-results", "core/query-pagination"]);
  assert.deepEqual(query.inner[0]!.inner.map((b) => b.name), ["core/post-title", "core/post-excerpt"]);
});

test("theme.json carries the settings and styles, derived custom templates merged with the declared one, and derived parts", async () => {
  const json = JSON.parse(fileOf(await fixtureBuild(), "theme.json")) as Record<string, unknown>;
  assert.equal(json.version, 3);
  assert.equal(json.$schema, "https://schemas.wp.org/wp/7.1/theme.json");
  assert.deepEqual(json.customTemplates, [
    { name: "contact", title: "Contact", postTypes: ["page"] },
    { name: "image", title: "Image" },
    { name: "landing", title: "Landing (declared)", postTypes: ["page"] },
    { name: "single-post", title: "Single Post" },
  ].filter((t) => t.name === "contact" || t.name === "landing"));
  assert.deepEqual(json.templateParts, [
    { name: "footer", title: "Site Footer", area: "footer" },
    { name: "header", title: "Header", area: "header" },
    { name: "sidebar", title: "Sidebar", area: "uncategorized" },
  ]);
  assert.equal((json.settings as { color: { palette: unknown[] } }).color.palette.length, 3);
  assert.equal((json.styles as { color: { background: string } }).color.background, "var:preset|color|base");
  assert.equal("patterns" in json, false);
});

test("a hierarchy slug (single-post, image) is accepted without a declaration and is not a custom template", async () => {
  const json = JSON.parse(fileOf(await fixtureBuild(), "theme.json")) as { customTemplates: { name: string }[] };
  assert.deepEqual(json.customTemplates.map((t) => t.name), ["contact", "landing"]);
});

test("the pattern file's header reads back through WordPress's own parsing rules", async () => {
  const header = readPatternHeader(fileOf(await fixtureBuild(), "patterns/hero.php"));
  assert.deepEqual(header, {
    Title: "Hero",
    Slug: "fixture-theme/hero",
    Description: "A full-width welcome.",
    "Viewport Width": "1400",
    Inserter: "yes",
    Categories: ["banner", "featured"],
    Keywords: ["welcome"],
    "Block Types": ["core/post-content"],
    "Post Types": ["page"],
  });
});

test("a pattern's explicit slug and inserter:false are written, and unset fields are absent", async () => {
  const header = readPatternHeader(fileOf(await fixtureBuild(), "patterns/cta.php"));
  assert.deepEqual(header, { Title: "Call to action", Slug: "fixture-theme/call-to-action", Inserter: "no", Categories: ["call-to-action"] });
});

test("the pattern file holds nothing executable: a PHP opener, one comment, a closer, then markup", async () => {
  const file = fileOf(await fixtureBuild(), "patterns/hero.php");
  const [prologue, ...rest] = file.split("?>\n");
  assert.match(prologue!, /^<\?php\n\/\*\*\n(?: \* [^\n]*\n)+ \*\/\n$/);
  const markup = rest.join("?>\n");
  assert.equal(markup.includes("<?"), false);
  assert.ok(allValid(await reparse(markup)));
});

test("style.css is a header only, with the defaults the README states", async () => {
  const css = fileOf(await fixtureBuild(), "style.css");
  const headers = Object.fromEntries(css.split("\n").filter((l) => l.includes(": ")).map((l) => l.split(": ") as [string, string]));
  assert.deepEqual(headers, {
    "Theme Name": "Fixture Theme",
    Author: "Zero",
    Description: "The theme the unit suite builds.",
    "Requires at least": "7.1",
    "Requires PHP": "8.2",
    Version: "1.2.3",
    License: "GPL-2.0-or-later",
    "License URI": "https://www.gnu.org/licenses/gpl-2.0.html",
    "Text Domain": "fixture-theme",
    Tags: "blog, one-column",
  });
  assert.equal(css.replace(/\/\*[\s\S]*\*\/\n/, ""), "");
});

test("a style variation is written as a theme.json document with its title", async () => {
  const dark = JSON.parse(fileOf(await fixtureBuild(), "styles/dark.json")) as Record<string, unknown>;
  assert.equal(dark.title, "Dark");
  assert.equal(dark.version, 3);
  assert.equal((dark.styles as { color: { background: string } }).color.background, "var:preset|color|base");
});

test("preset slugs in templates resolve against the palette: a token the theme defines passes", async () => {
  const [, main] = await reparse(fileOf(await fixtureBuild(), "templates/index.html"));
  assert.equal(main!.attributes.backgroundColor, "base");
});

test("a block naming a preset the theme does not define is unknown_preset at the block", () =>
  withVariant(async (v) => {
    v.write("templates/404.tsx", 'import { Group } from "@spacefast/zero-blocks/theme";\nexport default () => <Group backgroundColor="primry"><p>x</p></Group>;\n');
    const build = await buildTheme(v.dir);
    assert.deepEqual(where(v.dir, errors(build)), [["unknown_preset", "templates/404.tsx"]]);
    assert.equal(errors(build)[0]!.hint, 'Did you mean "primary"?');
    assert.equal(errors(build)[0]!.loc?.line, 2);
    assert.deepEqual(build.files, []);
  }));

test("a WordPress default preset passes unless the theme turned the defaults off", () =>
  withVariant(async (v) => {
    v.write("templates/404.tsx", 'import { Group } from "@spacefast/zero-blocks/theme";\nexport default () => <Group fontSize="large"><p>x</p></Group>;\n');
    assert.deepEqual(errors(await buildTheme(v.dir)), []);
    v.write("templates/404.tsx", 'import { Group } from "@spacefast/zero-blocks/theme";\nexport default () => <Group backgroundColor="vivid-red"><p>x</p></Group>;\n');
    assert.deepEqual(where(v.dir, errors(await buildTheme(v.dir))), [["unknown_preset", "templates/404.tsx"]]);
  }));

test("a var:preset reference in styles that names no preset is unknown_preset at the config", () =>
  withVariant(async (v) => {
    const config = readFileSync(path.join(v.dir, "theme.config.ts"), "utf8").replace('preset.color("primary")', 'preset.color("brand")');
    v.write("theme.config.ts", config);
    const build = await buildTheme(v.dir);
    assert.deepEqual(where(v.dir, errors(build)), [["unknown_preset", "theme.config.ts"]]);
    assert.match(errors(build)[0]!.message, /styles\/elements\/link\/color\/text/);
  }));

test("a style variation's own presets count for its styles", () =>
  withVariant(async (v) => {
    v.write("styles/warm.ts", 'import { defineStyleVariation, preset } from "@spacefast/zero-blocks/theme";\nexport default defineStyleVariation({ title: "Warm", settings: { color: { palette: [{ slug: "ember", name: "Ember", color: "#c33" }] } }, styles: { color: { text: preset.color("ember") } } });\n');
    assert.deepEqual(errors(await buildTheme(v.dir)), []);
    v.write("styles/warm.ts", 'import { defineStyleVariation, preset } from "@spacefast/zero-blocks/theme";\nexport default defineStyleVariation({ title: "Warm", styles: { color: { text: preset.color("ember") } } });\n');
    assert.deepEqual(where(v.dir, errors(await buildTheme(v.dir))), [["unknown_preset", "styles/warm.ts"]]);
  }));

test("a missing index template is index_template_missing", () =>
  withVariant(async (v) => {
    v.remove("templates/index.tsx");
    assert.deepEqual(where(v.dir, errors(await buildTheme(v.dir))), [["index_template_missing", "templates/index.tsx"]]);
  }));

test("a template outside the hierarchy with no declaration is unknown_template, with both ways out as the hint", () =>
  withVariant(async (v) => {
    v.write("templates/pricing.tsx", "export default () => <p>x</p>;\n");
    const build = await buildTheme(v.dir);
    assert.deepEqual(where(v.dir, errors(build)), [["unknown_template", "templates/pricing.tsx"]]);
    assert.match(errors(build)[0]!.hint ?? "", /defineTemplate/);
    assert.match(errors(build)[0]!.hint ?? "", /single-<post_type>/);
  }));

test("every derived hierarchy form is accepted without a declaration", () =>
  withVariant(async (v) => {
    for (const slug of ["page-about", "page-42", "archive-product", "category-news", "tag-go", "taxonomy-genre", "taxonomy-genre-jazz", "author-ada", "single-product-widget", "video", "application-pdf", "pdf", "home", "front-page", "privacy-policy"]) {
      v.write(`templates/${slug}.tsx`, "export default () => <p>x</p>;\n");
    }
    const build = await buildTheme(v.dir);
    assert.deepEqual(errors(build), []);
    const json = JSON.parse(fileOf(build, "theme.json")) as { customTemplates: { name: string }[] };
    assert.deepEqual(json.customTemplates.map((t) => t.name), ["contact", "landing"]);
  }));

test("a declared custom template or part whose file does not exist is declared_file_missing at the config", () =>
  withVariant(async (v) => {
    const config = readFileSync(path.join(v.dir, "theme.config.ts"), "utf8")
      .replace('customTemplates: [{ name: "landing", title: "Landing (declared)", postTypes: ["page"] }],', 'customTemplates: [{ name: "landing", title: "Landing (declared)", postTypes: ["page"] }, { name: "ghost", title: "Ghost" }],\n  templateParts: [{ name: "aside", title: "Aside", area: "uncategorized" }],');
    v.write("theme.config.ts", config);
    assert.deepEqual(where(v.dir, errors(await buildTheme(v.dir))), [["declared_file_missing", "theme.config.ts"], ["declared_file_missing", "theme.config.ts"]]);
  }));

test("a template part reference to a part that is not a file is unknown_template_part at the reference", () =>
  withVariant(async (v) => {
    v.write("templates/404.tsx", 'import { TemplatePart } from "@spacefast/zero-blocks/theme";\nexport default () => (\n  <TemplatePart slug="heder" />\n);\n');
    const build = await buildTheme(v.dir);
    assert.deepEqual(where(v.dir, errors(build)), [["unknown_template_part", "templates/404.tsx"]]);
    assert.deepEqual([errors(build)[0]!.loc?.line, errors(build)[0]!.hint], [3, 'Did you mean "header"?']);
  }));

test("a pattern reference resolves to a theme pattern or an external one, and nothing else", () =>
  withVariant(async (v) => {
    v.write("templates/404.tsx", 'import { Pattern } from "@spacefast/zero-blocks/theme";\nexport default () => (\n  <>\n    <Pattern slug="fixture-theme/call-to-action" />\n    <Pattern slug="acme/testimonials" />\n    <Pattern slug="fixture-theme/nope" />\n  </>\n);\n');
    const build = await buildTheme(v.dir);
    assert.deepEqual(where(v.dir, errors(build)), [["unknown_pattern", "templates/404.tsx"]]);
    assert.equal(errors(build)[0]!.loc?.line, 6);
  }));

test("two patterns with one slug is duplicate_slug at the second", () =>
  withVariant(async (v) => {
    // Files are read in name order, so the later name is the duplicate.
    v.write("patterns/zz-hero-again.tsx", 'import { definePattern } from "@spacefast/zero-blocks/theme";\nexport const meta = definePattern({ title: "Hero again", slug: "fixture-theme/hero" });\nexport default () => <p>x</p>;\n');
    assert.deepEqual(where(v.dir, errors(await buildTheme(v.dir))), [["duplicate_slug", "patterns/zz-hero-again.tsx"]]);
  }));

test("a pattern without a title cannot register, so it is refused", () =>
  withVariant(async (v) => {
    v.write("patterns/untitled.tsx", "export default () => <p>x</p>;\n");
    const build = await buildTheme(v.dir);
    assert.deepEqual(where(v.dir, errors(build)), [["theme_config_invalid", "patterns/untitled.tsx"]]);
    assert.match(errors(build)[0]!.message, /definePattern/);
  }));

test("a pattern header value that would end the comment or span lines is refused", () =>
  withVariant(async (v) => {
    v.write("patterns/sneaky.tsx", 'import { definePattern } from "@spacefast/zero-blocks/theme";\nexport const meta = definePattern({ title: "Two\\nlines", description: "ends */ early" });\nexport default () => <p>x</p>;\n');
    assert.deepEqual(where(v.dir, errors(await buildTheme(v.dir))), [["theme_config_invalid", "patterns/sneaky.tsx"], ["theme_config_invalid", "patterns/sneaky.tsx"]]);
  }));

test("a query loop with neither inherit nor a query, or both, is query_mode_required at the loop", () =>
  withVariant(async (v) => {
    v.write("templates/404.tsx", 'import { QueryLoop, PostTitle } from "@spacefast/zero-blocks/theme";\nexport default () => (\n  <>\n    <QueryLoop {...({} as never)}><PostTitle /></QueryLoop>\n    <QueryLoop {...({ inherit: true, query: { postType: "post" } } as never)}><PostTitle /></QueryLoop>\n  </>\n);\n');
    const build = await buildTheme(v.dir);
    assert.deepEqual(where(v.dir, errors(build)), [["query_mode_required", "templates/404.tsx"], ["query_mode_required", "templates/404.tsx"]]);
    assert.deepEqual(errors(build).map((d) => d.loc?.line), [4, 5]);
  }));

test("an explicit query fills WordPress's defaults around the fields given, and does not inherit", () =>
  withVariant(async (v) => {
    v.write("templates/404.tsx", 'import { QueryLoop, PostTitle } from "@spacefast/zero-blocks/theme";\nexport default () => <QueryLoop query={{ postType: "page", perPage: 6, orderBy: "title", order: "asc" }}><PostTitle /></QueryLoop>;\n');
    const build = await buildTheme(v.dir);
    assert.deepEqual(errors(build), []);
    const [query] = await reparse(fileOf(build, "templates/404.html"));
    assert.deepEqual(query!.attributes.query, { perPage: 6, pages: 0, offset: 0, postType: "page", order: "asc", orderBy: "title", author: "", search: "", exclude: [], sticky: "", inherit: false });
  }));

test("a theme.json the schema rejects is theme_json_invalid with the pointer, at the config", () =>
  withVariant(async (v) => {
    const config = readFileSync(path.join(v.dir, "theme.config.ts"), "utf8").replace("appearanceTools: true,", "appearanceTools: true,\n    colour: {},");
    v.write("theme.config.ts", config);
    const build = await buildTheme(v.dir);
    assert.deepEqual(where(v.dir, errors(build)), [["theme_json_invalid", "theme.config.ts"]]);
    assert.match(errors(build)[0]!.message, /theme\.json\/settings\/colour/);
  }));

test("theme.json's patterns key is the Pattern Directory list from the config, passed through and never derived", () =>
  withVariant(async (v) => {
    const config = readFileSync(path.join(v.dir, "theme.config.ts"), "utf8").replace('externalPatterns: ["acme/testimonials"],', 'externalPatterns: ["acme/testimonials"],\n  patterns: ["cora/hero", "twentytwentyfour/banner-hero"],');
    v.write("theme.config.ts", config);
    const build = await buildTheme(v.dir);
    assert.deepEqual(errors(build), []);
    assert.deepEqual((JSON.parse(fileOf(build, "theme.json")) as { patterns: string[] }).patterns, ["cora/hero", "twentytwentyfour/banner-hero"]);
  }));

test("a part area WordPress does not know is refused rather than registered as uncategorized with a warning", () =>
  withVariant(async (v) => {
    v.write("parts/aside.tsx", 'import { definePart } from "@spacefast/zero-blocks/theme";\nexport const meta = definePart({ area: "sidebar" });\nexport default () => <p>x</p>;\n');
    const build = await buildTheme(v.dir);
    assert.deepEqual(where(v.dir, errors(build)), [["theme_config_invalid", "parts/aside.tsx"]]);
    assert.match(errors(build)[0]!.hint ?? "", /"navigation-overlay"/);
  }));

test("a part's area defaults by name: header-*, footer-*, else uncategorized", () =>
  withVariant(async (v) => {
    v.write("parts/header-slim.tsx", "export default () => <p>h</p>;\n");
    v.write("parts/footer-wide.tsx", "export default () => <p>f</p>;\n");
    v.write("parts/aside.tsx", "export default () => <p>a</p>;\n");
    const json = JSON.parse(fileOf(await buildTheme(v.dir), "theme.json")) as { templateParts: { name: string; area: string }[] };
    assert.deepEqual(Object.fromEntries(json.templateParts.map((p) => [p.name, p.area])), { aside: "uncategorized", footer: "footer", "footer-wide": "footer", header: "header", "header-slim": "header", sidebar: "uncategorized" });
  }));

test("a config without a usable slug or name is theme_config_invalid", () =>
  withVariant(async (v) => {
    v.write("theme.config.ts", 'import { defineTheme } from "@spacefast/zero-blocks/theme";\nexport default defineTheme({ name: "X", slug: "Not A Slug" });\n');
    assert.deepEqual(where(v.dir, errors(await buildTheme(v.dir))), [["theme_config_invalid", "theme.config.ts"]]);
    v.write("theme.config.ts", "export default { name: 'X' };\n");
    assert.deepEqual(where(v.dir, errors(await buildTheme(v.dir))), [["theme_config_invalid", "theme.config.ts"]]);
  }));

test("an error inside a template is located in that template, and the build writes nothing", () =>
  withVariant(async (v) => {
    v.write("templates/404.tsx", 'import { PostDate } from "@spacefast/zero-blocks/theme";\nexport default () => (\n  <PostDate {...({ formt: "Y" } as object)} />\n);\n');
    const build = await buildTheme(v.dir);
    assert.deepEqual(where(v.dir, errors(build)), [["unknown_attribute", "templates/404.tsx"]]);
    assert.deepEqual([errors(build)[0]!.loc?.line, errors(build)[0]!.hint], [3, 'Did you mean "format"?']);
    assert.deepEqual(build.files, []);
  }));

test("writeTheme replaces the output directory whole, and a failed build leaves the previous output intact", () =>
  withVariant((v) =>
    withOutDir(async (out) => {
      const first = await buildTheme(v.dir);
      const written = await writeTheme(first, { out });
      assert.equal(written.dir, path.join(out, "fixture-theme"));
      writeFileSync(path.join(out, "fixture-theme", "stale.txt"), "left over");
      v.remove("templates/index.tsx");
      const broken = await buildTheme(v.dir);
      assert.ok(errors(broken).length > 0);
      await assert.rejects(writeTheme(broken, { out }), /nothing to write/);
      assert.equal(readFileSync(path.join(out, "fixture-theme", "stale.txt"), "utf8"), "left over");
      v.write("templates/index.tsx", readFileSync(path.join(themeDir, "templates/index.tsx"), "utf8"));
      await writeTheme(await buildTheme(v.dir), { out });
      assert.equal(existsSync(path.join(out, "fixture-theme", "stale.txt")), false);
      assert.deepEqual(readdirSync(path.join(out, "fixture-theme")).sort(), ["assets", "parts", "patterns", "readme.txt", "screenshot.png", "style.css", "styles", "templates", "theme.json"]);
      assert.equal(readdirSync(out).filter((n) => n.startsWith(".")).length, 0);
    })));

test("the zip lists every theme file under the slug directory, in a fixed order, with fixed timestamps", () =>
  withOutDir(async (out) => {
    const build = await fixtureBuild();
    const written = await writeTheme(build, { out, zip: true });
    const { execFileSync } = await import("node:child_process");
    const listing = execFileSync("unzip", ["-l", written.zip!], { encoding: "utf8" });
    const names = listing.split("\n").map((l) => /\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s+(\S.*)$/.exec(l)?.[1]).filter((n): n is string => n !== undefined);
    assert.deepEqual(names, build.files.map((f) => `fixture-theme/${f.path}`));
    assert.match(listing, /1980-01-01 00:00/);
    assert.equal(execFileSync("unzip", ["-tq", written.zip!], { encoding: "utf8" }).trim(), `No errors detected in compressed data of ${written.zip!}.`);
  }));

test("the same input builds to the same bytes twice", async () => {
  const [first, second] = await Promise.all([buildTheme(themeDir), buildTheme(themeDir)]);
  assert.deepEqual(first.files.map((f) => [f.path, Buffer.from(f.data).toString("base64")]), second.files.map((f) => [f.path, Buffer.from(f.data).toString("base64")]));
});

test("the fixture theme's output is stable (drift guard)", async () => {
  const build = await fixtureBuild();
  const golden = path.join(themeDir, "..", "theme.golden.json");
  const actual = Object.fromEntries(build.files.filter((f) => !f.path.startsWith("assets/") && f.path !== "screenshot.png").map((f) => [f.path, decode(f.data)]));
  if (process.env.UPDATE_GOLDEN) writeFileSync(golden, `${JSON.stringify(actual, null, 2)}\n`);
  assert.deepEqual(actual, JSON.parse(readFileSync(golden, "utf8")));
});
