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
}

const openssl = `<?php
// WordPress Playground's PHP has no OpenSSL config file, so openssl_pkey_new() fails. First's
// sign-in plugin needs it for its signing key. Playground doesn't keep /root between requests.
if (!is_file('/root/install/ssl/openssl.cnf')) {
\t@mkdir('/root/install/ssl', 0777, true);
\t@file_put_contents('/root/install/ssl/openssl.cnf', "[req]\\ndistinguished_name = dn\\n[dn]\\n");
}
`;

export function blueprint({ zipBase, firstPlugins, wordpressPlugins, landingPage, seed }: BlueprintInput) {
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
			...(seed ? [{ step: "runPHP", code: seed }] : []),
		],
	};
}
