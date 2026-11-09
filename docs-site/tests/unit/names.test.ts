// Text copied out of the code reads with First names, and Zero 0.8 keeps its own.
import { test } from "node:test";
import assert from "node:assert/strict";

import { toFirst } from "../../lib/names.ts";

const cases: [string, string][] = [
	["Convert a Zero 0.8 app", "Convert a Zero 0.8 app"],
	["--from zero-0.8 <capsule-dir>", "--from zero-0.8 <capsule-dir>"],
	["--from emdash|payload|sanity|zero <input>", "--from emdash|payload|sanity|zero <input>"],
	["move content from an original Zero site", "move content from an original Zero site"],
	["@spacefast/zero 0.8.1", "@spacefast/zero 0.8.1"],
	["Zero Identity accounts", "First Identity accounts"],
	["const zero = createClient(); zero.posts.list()", "const first = createClient(); first.posts.list()"],
	["e instanceof ZeroError", "e instanceof FirstError"],
	['import { table } from "zero";', 'import { table } from "first";'],
	["write the WordPress plugins to .zero/wp-content", "write the WordPress plugins to .first/wp-content"],
	["commit zero/_generated/migrations", "commit first/_generated/migrations"],
	["zero.config.ts and zero.gen.ts", "first.config.ts and first.gen.ts"],
	["`zero build` and `wp zero jobs`", "`first build` and `wp first jobs`"],
	["/wp-json/zero/v1/actions/hello", "/wp-json/first/v1/actions/hello"],
	["/__zero/client.js", "/__first/client.js"],
	["ZERO_APP_PASSWORD", "FIRST_APP_PASSWORD"],
	["Z1101", "F1101"],
	["`zero-blocks content <file.tsx>`", "`first-blocks content <file.tsx>`"],
	["independent of the `zero` binary's", "independent of the `first` binary's"],
];

for (const [input, expected] of cases) {
	test(input, () => assert.equal(toFirst(input), expected));
}
