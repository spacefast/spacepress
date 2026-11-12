// Builds every example the site shows (lib/site-examples.ts) with the native compiler and publishes
// every file of it, so a visitor can open any file `first build` writes, the WordPress plugins
// included.
//
// Each example is copied to .showcase/<name>/ first (its committed migrations come along; nothing
// under examples/ is written) and built there. An example with TSX pages (pages/) is also built by
// `first-pages build`, as `docs/pages.md` says, so its blueprint installs the pages plugin too. An example with npm dependencies gets its locked
// packages installed, since the compiler turns their code into PHP. Then public/files/ gets:
//
//   <name>.json        every path of the example, with the blob that holds each text file
//   blobs/<hash>.txt   each distinct text file once: the runtime is the same for every example
//   <name>.blueprint.json, plugins/<name>/*.zip   the example's WordPress Playground blueprint and zips
//   plugins/<slug>.zip the plugins every app shares (runtime, identity, admin), once, for the
//                      playground page's blueprint of an edited config (lib/blueprint.ts)
//
// The site fetches a blob when someone opens its file, so a page carries only the tree.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { toFirst } from "../lib/names.ts";
import { filesRoot, showcaseRoot, type Manifest } from "../lib/showcase.ts";
import { blueprint, sharedPlugins } from "../lib/blueprint.ts";
import { platformVersions } from "../lib/platform.ts";
import { siteExamples, siteFiles } from "../lib/site-examples.ts";

const site = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const repo = path.dirname(site);
const target = process.env.CARGO_TARGET_DIR ?? path.join(repo, "target");

const run = (command: string, args: string[], cwd: string) => {
	const result = spawnSync(command, args, { cwd, stdio: "inherit" });
	if (result.status !== 0) process.exit(result.status ?? 1);
};

/** Files under `root`, sorted. */
function walk(root: string, rel = ""): string[] {
	const found: string[] = [];
	for (const name of readdirSync(path.join(root, rel)).sort()) {
		const sub = rel ? `${rel}/${name}` : name;
		const stat = lstatSync(path.join(root, sub));
		if (stat.isDirectory()) found.push(...walk(root, sub));
		else if (stat.isFile()) found.push(sub);
	}
	return found;
}

// Files of WordPress.org plugins are shown as their authors wrote them. Everything First wrote reads
// with First names, as the code will after the rename.
// WordPress.org plugins are copied as published: the platform's pinned ones, and the ones an app's
// lock adds (tests/fixtures/platform.json, first/_generated/wp-plugins.lock.json). Only files First
// wrote get First names.
const platformPlugins = Object.keys((JSON.parse(readFileSync(path.join(repo, "tests/fixtures/platform.json"), "utf8")) as { plugins: Record<string, unknown> }).plugins);
const thirdParty = (lock: string[]) => new Set([...platformPlugins, ...lock]);
const firstWrote = (file: string, published: Set<string>) => {
	const plugin = /^first\/dist\/wp-content\/plugins\/([^/.]+)[/.]/.exec(file)?.[1];
	return plugin === undefined || !published.has(plugin);
};

const binary = path.join(target, "release", "first");
if (!existsSync(binary)) run("cargo", ["build", "--locked", "--release"], repo);

// `first-pages build` runs from the package's compiled output, which needs @spacefast/first-blocks
// built first (the `pages` job in .github/workflows/ci.yml does the same).
const firstPages = path.join(repo, "packages/pages/bin/first-pages.mjs");
let pagesBuilt = false;
function buildPagesPackage() {
	if (pagesBuilt) return;
	pagesBuilt = true;
	for (const pkg of ["blocks", "pages"]) {
		run("pnpm", ["install", "--frozen-lockfile"], path.join(repo, "packages", pkg));
		run("pnpm", ["build"], path.join(repo, "packages", pkg));
	}
}

/**
 * The records the runtime seeds a synced collection from, as the host compile writes them
 * (`seed/<collection>.json`): the same parser as `first sync` reads the content files with.
 */
function syncRecords(project: string): Record<string, unknown> {
	const scratch = mkdtempSync(path.join(tmpdir(), "first-showcase-"));
	try {
		run(binary, ["sources", project, "--out", path.join(scratch, "sources")], repo);
		mkdirSync(path.join(scratch, "assets"));
		run(binary, ["compile-sources", path.join(scratch, "sources"), path.join(scratch, "out"), path.join(scratch, "assets")], repo);
		const seed = path.join(scratch, "out/seed");
		if (!existsSync(seed)) return {};
		return Object.fromEntries(readdirSync(seed).sort().map((file) => [path.basename(file, ".json"), JSON.parse(readFileSync(path.join(seed, file), "utf8"))]));
	} finally {
		rmSync(scratch, { recursive: true, force: true });
	}
}

rmSync(showcaseRoot, { recursive: true, force: true });
rmSync(filesRoot, { recursive: true, force: true });
mkdirSync(path.join(filesRoot, "blobs"), { recursive: true });
const written = new Set<string>();

for (const { name, landing, seed } of siteExamples) {
	const from = path.join(repo, "examples", name);
	const to = path.join(showcaseRoot, name);
	// What the site says about the example (playground.json, the seed) is the site's, not the app's.
	cpSync(from, to, { recursive: true, filter: (file) => !/[/\\](node_modules|\.first|dist)$/.test(file) && !(path.dirname(file) === from && siteFiles.has(path.basename(file))) });
	if (existsSync(path.join(to, "package-lock.json"))) run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], to);
	run(binary, ["build", to, "--quiet"], repo);
	const plugins = path.join(to, "first/dist/wp-content/plugins");
	// The pages plugin, built from the TSX pages against the schema `first build` just wrote.
	// `first build` doesn't zip it, so this does, for the blueprint.
	const pagesPlugins: string[] = [];
	if (existsSync(path.join(to, "pages"))) {
		buildPagesPackage();
		run("node", [firstPages, "build", to], repo);
		const app = (JSON.parse(readFileSync(path.join(to, "first/pages.json"), "utf8")) as { app: string }).app;
		const slug = `first-pages-${app}`;
		if (!existsSync(path.join(plugins, slug))) throw new Error(`examples/${name}: first-pages build wrote no ${slug}/`);
		run("zip", ["-qrX", `${slug}.zip`, slug], plugins);
		pagesPlugins.push(slug);
	}
	// A synced collection (`sync: "content/posts/*.md"`) starts with its content files' rows.
	const syncSeed = syncRecords(to);

	const lock = JSON.parse(readFileSync(path.join(to, "first/_generated/wp-plugins.lock.json"), "utf8")) as { plugins: { slug: string; version: string }[] };
	const published = thirdParty(lock.plugins.map((p) => p.slug));
	// `plugins` lists First's own plugins in the order `first build` writes them: the runtime, then
	// the plugins that require it. WordPress refuses to activate a plugin before the ones it requires.
	const built = JSON.parse(readFileSync(path.join(to, "first/dist/wp-content/first-manifest.json"), "utf8")) as { app: string; plugins: Record<string, string> };
	const manifest: Manifest = {
		app: built.app,
		files: [],
		wordpressPlugins: lock.plugins.map(({ slug, version }) => ({ slug, version })),
		syncSeed,
		...(pagesPlugins[0] ? { pages: { slug: pagesPlugins[0], path: `files/plugins/${name}/${pagesPlugins[0]}.zip` } } : {}),
	};
	for (const file of walk(to).filter((file) => !file.startsWith("node_modules/") && !file.startsWith(".first/"))) {
		const bytes = readFileSync(path.join(to, file));
		const text = new TextDecoder("utf-8", { fatal: true });
		let contents: string | null = null;
		try {
			contents = file.endsWith(".zip") ? null : text.decode(bytes);
		} catch {
			contents = null;
		}
		const shown = firstWrote(file, published) && contents !== null ? toFirst(contents) : contents;
		let blob: string | null = null;
		if (shown !== null) {
			blob = createHash("sha256").update(shown).digest("hex").slice(0, 24);
			if (!written.has(blob)) {
				writeFileSync(path.join(filesRoot, "blobs", `${blob}.txt`), shown);
				written.add(blob);
			}
		}
		manifest.files.push({ path: toFirst(file), blob, size: bytes.length });
	}
	writeFileSync(path.join(filesRoot, `${name}.json`), JSON.stringify(manifest));

	// The Playground blueprint: the plugin zips this build wrote, and the WordPress.org plugins at
	// the versions in the app's lock.
	// The pages plugin requires the app plugin, so it activates last.
	const generated = [...Object.keys(built.plugins).filter((slug) => !published.has(slug)), ...pagesPlugins];
	for (const slug of generated) if (!existsSync(path.join(plugins, `${slug}.zip`))) throw new Error(`examples/${name}: first build wrote no ${slug}.zip`);
	mkdirSync(path.join(filesRoot, "plugins", name), { recursive: true });
	// Copied as built: the folder inside each zip is the plugin's name, so the zip keeps it.
	for (const slug of generated) cpSync(path.join(plugins, `${slug}.zip`), path.join(filesRoot, "plugins", name, `${slug}.zip`));
	// The plugins every app shares are the same bytes whatever the config; a build where they differ
	// would make the playground's blueprint for an edited config install the wrong ones.
	for (const slug of generated.filter((slug) => (sharedPlugins as readonly string[]).includes(slug))) {
		const zip = readFileSync(path.join(plugins, `${slug}.zip`));
		const shared = path.join(filesRoot, "plugins", `${slug}.zip`);
		if (!existsSync(shared)) writeFileSync(shared, zip);
		else if (!readFileSync(shared).equals(zip)) throw new Error(`examples/${name}: ${slug}.zip differs from another example's; it must not depend on the config`);
	}
	const zipBase = `${process.env.SITE_URL ?? "https://first-docs.space.fast"}/files/plugins/${name}/`;
	const firstPlugins = generated.map((slug) => ({ slug, url: `${zipBase}${slug}.zip` }));
	const print = blueprint({ platform: platformVersions(), firstPlugins, wordpressPlugins: lock.plugins, landingPage: landing, seed, syncSeed, prettyPermalinks: pagesPlugins.length > 0 });
	writeFileSync(path.join(filesRoot, `${name}.blueprint.json`), `${JSON.stringify(print, null, "\t")}\n`);
	console.log(`${name}: ${manifest.files.length} files`);
}
console.log(`${written.size} distinct text files in public/files/blobs`);
