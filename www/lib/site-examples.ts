// The examples the site features, in the order it shows them. Each one is a real app that compiles
// on main, and each covers ground the others do not. Every page shows the example's files and every
// file `spacepress build` writes for them. The rest of examples/ are test harnesses, long demos or
// unfinished work, and stay in the repository.
//
// What the site says about an example lives in the example, so the two never drift:
//
//   examples/<name>/playground.json       title, summary, and `landing`, the page WordPress
//                                         Playground opens
//   examples/<name>/playground-seed.php   optional: PHP the blueprint runs once the plugins are
//                                         active, which writes sample data through the app's own
//                                         API (/wp-json/spacepress/v1), so access rules, hooks and jobs run as they
//                                         would for a real request
//
// Server-only: it reads files. The playground's browser script gets titles and summaries through
// the page's markup instead.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const names = ["reading-list", "pantry", "blog", "full-site"] as const;

/** The site's own files in an example's root. They are not app sources: the compiler, the file explorer and the playground leave them out. */
export const siteFiles = new Set(["playground.json", "playground-seed.php"]);

export type SiteExampleName = (typeof names)[number];

export interface SiteExample {
	name: SiteExampleName;
	title: string;
	summary: string;
	landing: string;
	seed: string | undefined;
}

const root = path.join(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))), "examples");

function read(name: SiteExampleName): SiteExample {
	const dir = path.join(root, name);
	const meta = JSON.parse(readFileSync(path.join(dir, "playground.json"), "utf8")) as Partial<Record<"title" | "summary" | "landing", unknown>>;
	for (const key of ["title", "summary", "landing"] as const) {
		if (typeof meta[key] !== "string" || meta[key] === "") throw new Error(`examples/${name}/playground.json needs a "${key}" string`);
	}
	const seedFile = path.join(dir, "playground-seed.php");
	return {
		name,
		title: meta.title as string,
		summary: meta.summary as string,
		landing: meta.landing as string,
		seed: existsSync(seedFile) ? readFileSync(seedFile, "utf8") : undefined,
	};
}

export const siteExamples: readonly SiteExample[] = names.map(read);
