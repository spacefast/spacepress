// Prepares dist/ for a Spacefast Space. Run it after `blume build`, before `sf publish dist`.
//
// 1. _headers: Blume writes rules such as `/*.md` that set a header by file extension. Spacefast
//    allows a wildcard only at the end of a path segment and refuses the whole file otherwise.
//    Rules that set Content-Type are dropped: Spacefast already sets it from the extension, and
//    widened to `/*` they would label every file with one type. Other mid-segment rules, the two
//    sandbox headers on Blume's SVG assets, are widened to their folder. It also sets
//    `application/wasm` on the playground's compiler. Spacefast sends .wasm as
//    application/octet-stream, which makes the browser read the whole file before compiling it.
//    It adds no CORS rule for /files/, where WordPress Playground fetches the examples' blueprints
//    and plugin zips: Spacefast already answers files under /files/ with
//    `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Methods: GET, HEAD`. A rule of ours
//    sends the origin header a second time, which browsers read as `*, *` and refuse.
// 2. Markdown: Spacefast renders each .md file into a page and keeps the .md itself private.
//    Blume's .md files are the plain-Markdown copies agents read (`/getting-started.md`), so each
//    one gets `raw: true` in its frontmatter, which tells Spacefast to serve the file as written.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The folder to prepare: dist/ next to scripts/, or the one named on the command line.
const dist = path.resolve(process.argv[2] ?? path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "dist"));

const headersFile = path.join(dist, "_headers");
const rules = [];
for (const line of readFileSync(headersFile, "utf8").split("\n")) {
	if (line.startsWith("/")) rules.push({ path: line, headers: [] });
	else if (line.trim() && rules.length) rules.at(-1).headers.push(line);
}
// A `*` is allowed only as the whole last segment: `/*` or `/assets/*`. A rule with `*` inside a
// segment is widened to its folder, so Blume's `/blume-assets/*.svg` sandbox still covers its content
// images: everything under /blume-assets/ is a content asset. A rule that sets Content-Type by
// extension (`/*.md`, `/*.txt`) is dropped instead: widened, it would label every file under its
// folder with that type, and Spacefast already sets Content-Type from the extension.
const allowed = (pattern) => !pattern.includes("*") || /(^|\/)\*$/.test(pattern);
const widened = (pattern) => pattern.replace(/\/[^/]*\*[^/]*$/, "/*");
const setsType = (rule) => rule.headers.some((header) => /^\s*content-type\s*:/i.test(header));
const widenable = (rule) => allowed(rule.path) || (!setsType(rule) && allowed(widened(rule.path)));
const kept = [
	...rules.filter(widenable).map((rule) => (allowed(rule.path) ? rule : { ...rule, path: widened(rule.path) })),
	{ path: "/compiler.wasm", headers: ["  Content-Type: application/wasm"] },
];
const dropped = [...new Set(rules.filter((rule) => !widenable(rule)).map((rule) => rule.path))];
writeFileSync(headersFile, `${kept.map((rule) => [rule.path, ...rule.headers].join("\n")).join("\n")}\n`);
console.log(`_headers: kept ${kept.length} rules${dropped.length ? `, dropped ${dropped.join(", ")}` : ""}`);

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
