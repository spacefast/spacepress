// A WordPress Playground blueprint for a built example: WordPress in the visitor's browser with the
// app's plugins installed and active. Everything comes from the build: the WordPress.org plugins at
// the versions in the app's plugin lock, and First's own plugins as the zips `first build` wrote.
//
// Two steps make up for what Playground lacks, both checked against @wp-playground/cli 3.1.62:
// - Its bundled SQLite Database Integration is 3.1.1; First's runtime needs 3.1.2 or later
//   (src/platform.rs), so the blueprint unpacks that release over it.
// - Its PHP has no OpenSSL config file, so openssl_pkey_new() fails and First's sign-in plugin
//   can't create its signing key on activation. A must-use plugin writes an empty config, before
//   any other plugin loads, on every request (Playground doesn't keep /root between requests).
import { platformVersions } from "./platform.ts";

export interface BlueprintInput {
	/** URL the site serves the generated plugin zips from, ending in "/". */
	zipBase: string;
	/** The generated plugins, in activation order: runtime, identity, the app, then admin (first-manifest.json order). */
	firstPlugins: string[];
	/** WordPress.org plugins from the lock, with their exact versions. */
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

export function blueprint({ zipBase, firstPlugins, wordpressPlugins, landingPage, seed, syncSeed = {}, prettyPermalinks = false }: BlueprintInput) {
	const { php, sqlite } = platformVersions();
	const wordpressOrg = (slug: string, version: string) => ({ resource: "url", url: `https://downloads.wordpress.org/plugin/${slug}.${version}.zip` });
	return {
		$schema: "https://playground.wordpress.net/blueprint-schema.json",
		meta: { title: "First example", author: "First" },
		preferredVersions: { php, wp: "latest" },
		features: { networking: true },
		login: true,
		landingPage,
		steps: [
			{ step: "unzip", zipFile: wordpressOrg("sqlite-database-integration", sqlite), extractToPath: "/internal/shared" },
			{ step: "writeFile", path: "/wordpress/wp-content/mu-plugins/first-playground-openssl.php", data: openssl },
			...wordpressPlugins.map(({ slug, version }) => ({ step: "installPlugin", pluginData: wordpressOrg(slug, version) })),
			...firstPlugins.map((slug) => ({ step: "installPlugin", pluginData: { resource: "url", url: `${zipBase}${slug}.zip` } })),
			...(prettyPermalinks ? [{ step: "runPHP", code: permalinksPhp }] : []),
			...(Object.keys(syncSeed).length ? [{ step: "mkdir", path: seedDirectory }] : []),
			...Object.entries(syncSeed).map(([collection, records]) => ({ step: "writeFile", path: `${seedDirectory}/${collection}.json`, data: JSON.stringify(records) })),
			...(Object.keys(syncSeed).length ? [{ step: "runPHP", code: syncSeedPhp(seedDirectory) }] : []),
			...(seed ? [{ step: "runPHP", code: seed }] : []),
		],
	};
}
