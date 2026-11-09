// Prepares dist/ for a Spacefast Space. Run it after `blume build`, before `sf publish dist`.
//
// 1. _headers: Blume writes rules such as `/*.md` that set a header by file extension. Spacefast
//    allows a wildcard only at the end of a path segment and refuses the whole file otherwise.
//    Those rules set Content-Type, which Spacefast already sets from the extension, and two sandbox
//    headers on Blume's SVG assets. This drops every rule with a mid-segment wildcard and keeps the
//    rest. It also sets `application/wasm` on the playground's compiler. Spacefast sends .wasm as
//    application/octet-stream, which makes the browser read the whole file before compiling it.
//    And it allows any origin to read /files/, where WordPress Playground fetches the examples'
//    blueprints and plugin zips.
// 2. Markdown: Spacefast renders each .md file into a page and keeps the .md itself private.
//    Blume's .md files are the plain-Markdown copies agents read (`/getting-started.md`), so each
//    one gets `raw: true` in its frontmatter, which tells Spacefast to serve the file as written.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "dist");

const headersFile = path.join(dist, "_headers");
const rules = [];
for (const line of readFileSync(headersFile, "utf8").split("\n")) {
	if (line.startsWith("/")) rules.push({ path: line, headers: [] });
	else if (line.trim() && rules.length) rules.at(-1).headers.push(line);
}
// A `*` is allowed only as the whole last segment: `/*` or `/assets/*`.
const allowed = (pattern) => !pattern.includes("*") || /(^|\/)\*$/.test(pattern);
const kept = [
	...rules.filter((rule) => allowed(rule.path)),
	{ path: "/compiler.wasm", headers: ["  Content-Type: application/wasm"] },
	// WordPress Playground runs on playground.wordpress.net and fetches the example blueprints and
	// plugin zips from here, which needs CORS.
	{ path: "/files/*", headers: ["  Access-Control-Allow-Origin: *"] },
];
const dropped = [...new Set(rules.filter((rule) => !allowed(rule.path)).map((rule) => rule.path))];
writeFileSync(headersFile, `${kept.map((rule) => [rule.path, ...rule.headers].join("\n")).join("\n")}\n`);
console.log(`_headers: kept ${kept.length} rules, dropped ${dropped.join(", ")}`);

let raw = 0;
const walk = (dir) => {
	for (const name of readdirSync(dir)) {
		const file = path.join(dir, name);
		if (statSync(file).isDirectory()) walk(file);
		else if (name.endsWith(".md")) {
			const text = readFileSync(file, "utf8");
			if (/^---\n[\s\S]*?^raw: true$/m.test(text.split(/^---$/m).slice(0, 2).join("---"))) continue;
			writeFileSync(file, text.startsWith("---\n") ? `---\nraw: true\n${text.slice(4)}` : `---\nraw: true\n---\n\n${text}`);
			raw++;
		}
	}
};
walk(dist);
console.log(`markdown: ${raw} files marked raw: true`);
