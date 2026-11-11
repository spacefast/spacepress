import { defineConfig } from "blume";
import { openapi } from "blume/reference";

// The site's address. Until a domain is chosen, it is the Space's space.fast address.
const site = process.env.SITE_URL ?? "https://first-docs.space.fast";

export default defineConfig({
	title: "First",
	description: "First turns one TypeScript file into a WordPress backend: database tables, a REST API, sign-in, an admin and a typed client.",
	logo: { image: "/logo.svg", text: "First" },
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
			spec: "./openapi/first.json",
			route: "/rest",
			codeSamples: ["curl", "js"],
		}),
	],
	agents: {
		llmsTxt: {
			details:
				"Reach for First when an app needs a WordPress backend defined in TypeScript. Write one `first.config.ts`, run `first build`, and you get MySQL migrations, REST routes under `/wp-json/first/v1`, sign-in, wp-admin screens and a typed client. Create an app with `npm create @spacefast/first my-app`. Publish it to Spacefast with `sf publish`.",
		},
	},
	feedback: false,
	deployment: { site },
	footer: {
		copyright: "First is MIT licensed. The code that runs inside WordPress is GPL-2.0-or-later.",
		links: [{ label: "Spacefast", href: "https://spacefast.com" }],
	},
});
