// Builds every example the site shows (lib/site-examples.ts) with the native compiler and publishes
// every file of it, so a visitor can open any file `first build` writes, the WordPress plugins
// included.
//
// Each example is copied to .showcase/<name>/ first (its committed migrations come along; nothing
// under examples/ is written) and built there. An example with npm dependencies gets its locked
// packages installed, since the compiler turns their code into PHP. Then public/files/ gets:
//
//   <name>.json        every path of the example, with the blob that holds each text file
//   blobs/<hash>.txt   each distinct text file once: the runtime is the same for every example
//
// The site fetches a blob when someone opens its file, so a page carries only the tree.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { toFirst } from "../lib/names.ts";
import { filesRoot, showcaseRoot, type Manifest } from "../lib/showcase.ts";
import { blueprint } from "../lib/blueprint.ts";
import { siteExamples } from "../lib/site-examples.ts";

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

rmSync(showcaseRoot, { recursive: true, force: true });
rmSync(filesRoot, { recursive: true, force: true });
mkdirSync(path.join(filesRoot, "blobs"), { recursive: true });
const written = new Set<string>();

for (const { name, landing, seed } of siteExamples) {
	const from = path.join(repo, "examples", name);
	const to = path.join(showcaseRoot, name);
	cpSync(from, to, { recursive: true, filter: (file) => !/[/\\](node_modules|\.zero|dist)$/.test(file) });
	if (existsSync(path.join(to, "package-lock.json"))) run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], to);
	run(binary, ["build", to, "--quiet"], repo);

	const locked = (JSON.parse(readFileSync(path.join(to, "first/_generated/wp-plugins.lock.json"), "utf8")) as { plugins: { slug: string }[] }).plugins.map((p) => p.slug);
	const published = thirdParty(locked);
	const manifest: Manifest = { app: "", files: [] };
	manifest.app = (JSON.parse(readFileSync(path.join(to, "first/dist/wp-content/first-manifest.json"), "utf8")) as { app: string }).app;
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
	const plugins = path.join(to, "first/dist/wp-content/plugins");
	const generated = readdirSync(plugins).filter((file) => file.endsWith(".zip")).map((file) => file.slice(0, -4)).filter((slug) => !published.has(slug)).sort();
	mkdirSync(path.join(filesRoot, "plugins", name), { recursive: true });
	// Copied as built: the folder inside each zip is the plugin's name, so the zip keeps it.
	for (const slug of generated) cpSync(path.join(plugins, `${slug}.zip`), path.join(filesRoot, "plugins", name, `${slug}.zip`));
	const lock = JSON.parse(readFileSync(path.join(to, "first/_generated/wp-plugins.lock.json"), "utf8")) as { plugins: { slug: string; version: string }[] };
	const zipBase = `${process.env.SITE_URL ?? "https://first-docs.space.fast"}/files/plugins/${name}/`;
	const print = blueprint({ zipBase, firstPlugins: generated, wordpressPlugins: lock.plugins, landingPage: landing, seed });
	writeFileSync(path.join(filesRoot, `${name}.blueprint.json`), `${JSON.stringify(print, null, "\t")}\n`);
	console.log(`${name}: ${manifest.files.length} files`);
}
console.log(`${written.size} distinct text files in public/files/blobs`);
