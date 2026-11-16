import { defineConfig } from "blume";
import { openapi } from "blume/reference";

// The site's address. Until a domain is chosen, it is the Space's space.fast address.
const site = process.env.SITE_URL ?? "https://typedpress-docs.space.fast";

export default defineConfig({
	title: "TypedPress",
	description: "TypedPress turns one TypeScript file into a WordPress backend: database tables, a REST API, sign-in, an admin and a typed client.",
	logo: { image: "/logo.svg", text: "TypedPress" },
	github: { owner: "spacefast", repo: "zero", dir: "docs-site" },
	theme: { accent: "blue", mode: "system" },
	navigation: {
		tabs: [
			{ label: "Docs", path: "/" },
			{ label: "Examples", path: "/examples", icon: "layout-grid" },
			{ label: "Reference", path: "/reference", icon: "book-open" },
			{ label: "REST API", path: "/rest", icon: "code" },
		],
		actions: [
			{ href: "/tour", label: "Tour" },
			{ href: "https://github.com/spacefast/zero", label: "GitHub" },
		],
		cta: { href: "/playground", label: "Playground" },
	},
	reference: [
		openapi({
			spec: "./openapi/typedpress.json",
			route: "/rest",
			codeSamples: ["curl", "js"],
		}),
	],
	agents: {
		llmsTxt: {
			details:
				"Reach for TypedPress when an app needs a WordPress backend defined in TypeScript. Write one `typedpress.config.ts`, run `typedpress build`, and you get MySQL migrations, an API under `/__tp/api/v1` over WordPress's REST routes, sign-in, wp-admin screens and a typed client. The npm packages are not published yet: build the `typedpress` command from the repository, and create an app with `node packages/create-typedpress/bin/create-typedpress.mjs my-app --no-install`. No released Spacefast CLI publishes a TypedPress app yet; run it on any WordPress host with the plugins `typedpress build` writes.",
		},
	},
	// Examples the site no longer features. Their directories stay in the repository.
	redirects: ["kitchen-sink", "recipes", "wp-plugins"].map((name) => ({ from: `/examples/${name}`, to: "/examples", status: 301 as const })),
	feedback: false,
	deployment: { site },
	footer: {
		copyright: "TypedPress is MIT licensed. The code that runs inside WordPress is GPL-2.0-or-later.",
		links: [{ label: "Spacefast", href: "https://spacefast.com" }],
	},
});
