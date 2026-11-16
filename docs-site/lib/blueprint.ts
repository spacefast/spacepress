// WordPress Playground blueprints: WordPress in the visitor's browser with an app's plugins installed
// and active. `blueprint` is the general form. `exampleBlueprint` is a built example's, with the zips
// `first build` wrote (scripts/build-showcase.ts publishes both). `editedBlueprint` is the
// playground page's: the config in its editor, compiled in the browser, with the app plugin the
// compiler returned written file by file and First's other plugins from the published zips.
// The page and tests/playground/ both build it with this module, so the tests boot what a visitor gets.
//
// Two steps make up for what Playground lacks, both checked against @wp-playground/cli 3.1.58:
// - Its bundled SQLite Database Integration is 3.1.1; First's runtime needs 3.1.2 or later
//   (src/platform.rs), so the blueprint unpacks that release over it.
// - Its PHP has no OpenSSL config file, so openssl_pkey_new() fails and First's sign-in plugin
//   can't create its signing key on activation. A must-use plugin writes an empty config, before
//   any other plugin loads, on every request (Playground doesn't keep /root between requests).
//
// This module runs in the browser too: no Node APIs.
import type { Output, Request } from "./compiler.ts";

/** tests/fixtures/platform.json's floors (lib/platform.ts reads them). */
export interface Platform {
	php: string;
	sqlite: string;
}

/** One of First's plugins: a published zip, or the files of the plugin folder by path inside it. */
export type FirstPlugin = { slug: string; url: string } | { slug: string; files: Record<string, string> };

export interface BlueprintInput {
	platform: Platform;
	/** First's plugins in activation order: runtime, identity, the app, then admin (first-manifest.json order). */
	firstPlugins: FirstPlugin[];
	/** WordPress.org plugins from the lock, with their exact versions, dependencies first. */
	wordpressPlugins: { slug: string; version: string }[];
	/** Where the visitor lands. */
	landingPage: string;
	/** PHP run after activation, such as sample data written through the app's REST API. */
	seed?: string;
	/**
	 * Content files a synced collection reads (`sync: "content/posts/*.md"`), as the records
	 * `first compile-sources` writes to `seed/<collection>.json`. They go in before `seed`, through the
	 * runtime's own first-sync seed, the one `wp first seed` runs.
	 */
	syncSeed?: Record<string, unknown>;
	/** Pretty permalinks (`/%postname%/`): TSX pages route on the path, as `/notes/`. */
	prettyPermalinks?: boolean;
}

const openssl = `<?php
// WordPress Playground's PHP has no OpenSSL config file, so openssl_pkey_new() fails. First's
// sign-in plugin needs it for its signing key. Playground doesn't keep /root between requests.
if (!is_file('/root/install/ssl/openssl.cnf')) {
\t@mkdir('/root/install/ssl', 0777, true);
\t@file_put_contents('/root/install/ssl/openssl.cnf', "[req]\\ndistinguished_name = dn\\n[dn]\\n");
}
`;

type FileTree = { [name: string]: string | FileTree };

/** `a/b.php` → `{ a: { "b.php": … } }`, the shape Playground's literal directories take. */
function tree(files: Record<string, string>): FileTree {
	const root: FileTree = {};
	for (const [file, contents] of Object.entries(files)) {
		const parts = file.split("/");
		let dir = root;
		for (const part of parts.slice(0, -1)) dir = (dir[part] ??= {}) as FileTree;
		dir[parts.at(-1)!] = contents;
	}
	return root;
}

const seedDirectory = "/internal/first-seed";
// Seeds each synced collection from the records the blueprint wrote, as `wp first seed` does. It
// runs as a cron request: a bare wp-load.php request is not one Polylang serves on a site with no
// languages yet, so a localized collection would have no PLL() and First wouldn't add its languages.
const syncSeedPhp = (directory: string) => `<?php
define('DOING_CRON', true);
require_once '/wordpress/wp-load.php';
\\First\\Sync\\Seed::run(\\First\\Wp\\Runtime::plugin() ?? throw new RuntimeException('No First app is active'), '${directory}');
`;

// Set once, on a site nobody has used yet; the rewrite rules are written for the new structure.
const permalinksPhp = `<?php
require_once '/wordpress/wp-load.php';
global $wp_rewrite;
$wp_rewrite->set_permalink_structure('/%postname%/');
flush_rewrite_rules();
`;

export function blueprint({ platform, firstPlugins, wordpressPlugins, landingPage, seed, syncSeed = {}, prettyPermalinks = false }: BlueprintInput) {
	const wordpressOrg = (slug: string, version: string) => ({ resource: "url", url: `https://downloads.wordpress.org/plugin/${slug}.${version}.zip` });
	return {
		$schema: "https://playground.wordpress.net/blueprint-schema.json",
		meta: { title: "First example", author: "First" },
		// "beta" is Playground's build of WordPress's current beta or RC (7.2-beta5 today). "latest" is still
		// 7.1, below First's floor (tests/fixtures/platform.json); it goes back to "latest" once 7.2 ships.
		preferredVersions: { php: platform.php, wp: "beta" },
		features: { networking: true },
		login: true,
		landingPage,
		steps: [
			{ step: "unzip", zipFile: wordpressOrg("sqlite-database-integration", platform.sqlite), extractToPath: "/internal/shared" },
			{ step: "writeFile", path: "/wordpress/wp-content/mu-plugins/first-playground-openssl.php", data: openssl },
			...wordpressPlugins.map(({ slug, version }) => ({ step: "installPlugin", pluginData: wordpressOrg(slug, version) })),
			// installPlugin activates each one as it goes, so the order is the activation order.
			...firstPlugins.map((plugin) => ({
				step: "installPlugin",
				pluginData: "url" in plugin
					? { resource: "url", url: plugin.url }
					: { resource: "literal:directory", name: plugin.slug, files: tree(plugin.files) },
			})),
			...(prettyPermalinks ? [{ step: "runPHP", code: permalinksPhp }] : []),
			...(Object.keys(syncSeed).length ? [{ step: "mkdir", path: seedDirectory }] : []),
			...Object.entries(syncSeed).map(([collection, records]) => ({ step: "writeFile", path: `${seedDirectory}/${collection}.json`, data: JSON.stringify(records) })),
			...(Object.keys(syncSeed).length ? [{ step: "runPHP", code: syncSeedPhp(seedDirectory) }] : []),
			...(seed ? [{ step: "runPHP", code: seed }] : []),
		],
	};
}

export type Blueprint = ReturnType<typeof blueprint>;

/** First's plugins that are the same for every app (src/emit.rs `runtime_tree`): one published zip each. */
export const sharedPlugins = ["first-runtime", "first-identity", "first-admin"] as const;

/** Where the site publishes those zips, below its address: `files/plugins/<slug>.zip`. */
export const sharedZip = (site: string, slug: string) => `${site.replace(/\/$/, "")}/files/plugins/${slug}.zip`;

/** What the page knows about a committed example to run an edited copy of it (pages/playground.astro). */
export interface ExampleRun {
	/** The WordPress.org plugins in the example's committed lock. */
	lock: { slug: string; version: string }[];
	landing: string;
	seed?: string;
	/** `schema.php` of the example as committed: the seed runs only against that schema. */
	schemaPhp: string;
	ledger: Ledger;
	/** The synced collections' content rows (BlueprintInput `syncSeed`), for the committed schema. */
	syncSeed: Record<string, unknown>;
	/** The example has `first/app/` pages: they route on the path, so the site needs pretty permalinks. */
	appPages: boolean;
}

export type EditedRun = { blueprint: Blueprint; seeded: boolean } | { refused: string };

/**
 * The blueprint for a config as the playground compiled it. The app plugin is the compiler's
 * `appPlugin`, the same files `first build` packs into `first-app-<name>.zip`; the other First plugins
 * don't depend on the config, so they come from the site's published zips. WordPress.org plugins
 * come from the example's lock, at the versions it pins: a config that needs any other plugin or
 * version is refused, since Playground would install something no build here has checked.
 *
 * The example's seed writes sample data through the app's REST API for the committed schema, so it
 * runs only while the schema is unchanged; an edited schema starts empty. The same goes for the
 * synced content rows. `first/app/` pages are in the app plugin the compiler returned, so an edited
 * page runs as edited. The landing page stays the example's unless the edit took away the post type
 * it lists; then it is WordPress's plugin screen.
 */
export function editedBlueprint({ output, example, site, platform }: { output: Output; example: ExampleRun; site: string; platform: Platform }): EditedRun {
	const locked = new Map(example.lock.map(({ slug, version }) => [slug, version]));
	const missing = output.wordpressPlugins.filter(({ slug, version }) => locked.get(slug) !== version);
	if (missing.length > 0) {
		const names = missing.map(({ slug, version }) => `${slug} ${version}`).join(", ");
		return { refused: `This config needs ${names}, which this example's WordPress doesn't install, so it can't run in WordPress here. \`first build\` installs it when you build the app yourself.` };
	}
	const app = output.firstPlugins.find((slug) => !(sharedPlugins as readonly string[]).includes(slug));
	if (!app) throw new Error("the compiler returned no app plugin");
	const prefix = `${app}/`;
	const files = Object.fromEntries(Object.entries(output.appPlugin).filter(([file]) => file.startsWith(prefix)).map(([file, text]) => [file.slice(prefix.length), text]));
	const unchanged = output.schemaPhp === example.schemaPhp;
	const firstPlugins: FirstPlugin[] = output.firstPlugins.map((slug) => (slug === app ? { slug, files } : { slug, url: sharedZip(site, slug) }));
	const landingOpens = unchanged || opens(example.landing, output.schemaPhp);
	return {
		seeded: unchanged && example.seed !== undefined,
		blueprint: blueprint({
			platform,
			firstPlugins,
			wordpressPlugins: output.wordpressPlugins,
			landingPage: landingOpens ? example.landing : "/wp-admin/plugins.php",
			seed: unchanged ? example.seed : undefined,
			syncSeed: unchanged ? example.syncSeed : {},
			prettyPermalinks: example.appPages,
		}),
	};
}

/** Whether the post type a wp-admin landing page lists is still in this schema. */
function opens(landing: string, schemaPhp: string): boolean {
	const postType = /[?&]post_type=([\w-]+)/.exec(landing)?.[1];
	return postType === undefined || schemaPhp.includes(`'postType' => '${postType}'`);
}

/** Playground with the blueprint in the URL fragment, encoded once, as Playground's docs recommend. */
export const playgroundUrl = (print: Blueprint) => `https://playground.wordpress.net/#${encodeURIComponent(JSON.stringify(print))}`;

/**
 * What an example has on disk beside its sources that `first build` puts in the app plugin: the
 * committed migration ledger (`first/_generated/migrations/`, its snapshot and SQL files by name)
 * and the project's `public/` files by path below it.
 */
export interface Ledger {
	snapshot: unknown;
	files: Record<string, string>;
	public: Record<string, string>;
}

/**
 * The compile request for running sources in WordPress: the ledger goes along, so the compiler
 * numbers new migrations after the committed ones and the app plugin carries all of them, as
 * `first build` does in the example's folder. The project's `public/` goes along too, since the app
 * plugin carries it. `files` uses the names the compiler reads.
 */
export function runRequest(name: string, files: Record<string, string>, ledger: Ledger): Request {
	const sql = Object.fromEntries(Object.entries(ledger.files).map(([file, text]) => [`first/_generated/migrations/${file}`, text]));
	const publicFiles = Object.fromEntries(Object.entries(ledger.public).map(([file, text]) => [`public/${file}`, text]));
	return { name, files: { ...files, ...publicFiles, ...sql }, previous: ledger.snapshot ?? null, migrationFiles: Object.keys(ledger.files) };
}
