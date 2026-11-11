// The docs say First everywhere. The code on main may still use the names it had before the
// rename (First), so text that the generator copies out of the code passes through `toFirst`
// before it reaches a page. Each rule follows the rename table. Once main uses First names, no
// rule matches anything and this file can go.
//
// Zero 0.8 keeps its name: "Zero 0.8", "zero-0.8" and the `@spacefast/zero` packages never match.
const rules: [RegExp, string][] = [
	[/first\.config\.ts/g, "first.config.ts"],
	[/first\.gen\.ts/g, "first.gen.ts"],
	[/(from |import\()(["'])first\2/g, "$1$2first$2"],
	[/"first":/g, '"first":'],
	// The module in a compiler message: `"first" has no export named fetch`.
	[/"first"(?= has no export)/g, '"first"'],
	[/\/wp-json\/first\/v1/g, "/wp-json/first/v1"],
	[/\bzero\/v1\b/g, "first/v1"],
	// v2 browser paths only. /__zero/auth, /__zero/run, /__zero/config and /__zero/realtime/* are 0.8.
	[/\/__zero\/(api\/v1\/|client\.js|client\.d\.ts|realtime\.js)/g, "/__first/$1"],
	[/first-identity/g, "first-identity"],
	[/zero-(app|pages)-(?=[a-z<{\\])/g, "first-$1-"],
	[/\bzero-test-(admin|editor)\b/g, "first-test-$1"],
	[/\bpost_type=first_/g, "post_type=first_"],
	// Post types, ACF groups and meta keys in generated PHP: 'first_pages', 'group_first_pages', 'first_'.
	[/'(group_|field_)?first_(?=[a-z_]*')/g, "'$1first_"],
	[/\bhooks=first_/g, "hooks=first_"],
	[/(target\/(?:debug|release))\/first\b/g, "$1/first"],
	[/\bVITE_ZERO_/g, "VITE_FIRST_"],
	// Inside the runtime plugin, the PHP runtime folder: first-runtime/first/Db.php.
	[/first-runtime\/first\//g, "first-runtime/first/"],
	[/first-runtime/g, "first-runtime"],
	[/\bzero-(manifest|deployment)\.json\b/g, "first-$1.json"],
	[/first-admin/g, "first-admin"],
	[/@spacefast\/zero-(cli|blocks|pages|wasm|bin-)/g, "@spacefast/first-$1"],
	[/@spacefast\/create-first/g, "@spacefast/create-first"],
	[/\bcreate-zero\b/g, "create-first"],
	[/(?<![\w/@.-])zero-(blocks|pages)\b/g, "first-$1"],
	[/`first` binary/g, "`first` binary"],
	[/\bwp first\b/g, "wp first"],
	// abilities, call, queries, types and ls act on 0.8 Spaces and stay `sf first`.
	[/\bsf first (?=(build|check|dev|import|init|migrate|sync)\b)/g, "sf first "],
	// The `first` binary's commands. Not after `sf `: `sf zero abilities` and the like act on 0.8 Spaces.
	[/(^|[\s`(])(?<!sf )first (?=(dev|build|check|doctor|sync|abilities|migrate|deploy|wp|seed|jobs|run|action|find|insert|update|delete|publish-due|identity|help|sources)\b)/gm, "$1first "],
	[/(^|[\s`"'(/])\.zero\//gm, "$1.first/"],
	// The app folder and everything in it. Not `@spacefast/zero/client` (the 0.8 package), the
	// repository (`spacefast/first/blob`), the REST namespace (`first/v1`) or `types/first/`.
	[/(^|[\s`"'(/.])(?<!spacefast\/|types\/)first\/(?!v1\b)(?=[\w.<-])/gm, "$1first/"],
	[/\bZERO_(?!0)/g, "FIRST_"],
	[/\bZ(\d{4})\b/g, "F$1"],
	[/\bZero(Error|Config)\b/g, "First$1"],
	[/\\First\\/g, "\\First\\"],
	[/\bnamespace First(App)?\b/g, "namespace First$1"],
	[/\bZeroApp\\/g, "FirstApp\\"],
	[/`first build`/g, "`first build`"],
	[/\bZero_Admin/g, "First_Admin"],
	[/\bX-Zero-/g, "X-First-"],
	[/\bZero-(Signature|Event-Id)\b/g, "First-$1"],
	[/\{prefix\}first_/g, "{prefix}first_"],
	[/\bzero__(\w)/g, "first__$1"],
	[/\bzero_identity_/g, "first_identity_"],
	[/\bzero_source_needs_local_capture\b/g, "first_source_needs_local_capture"],
	[/scheme: "first"/g, 'scheme: "first"'],
	[/`zero-(\\?<name\\?>)`/g, "`first-$1`"],
	[/\b(const|let) first = /g, "$1 first = "],
	[/(?<![\w.\/-])first\.(?=[a-z]\w*\.)/g, "first."],
	[/\bZero v2\b/g, "First"],
	// "an original Zero site" and "an earlier Zero" are Zero 0.8.
	[/(?<!(original|earlier|older|old|legacy) )\bZero (?!0\.\d)(?=[A-Za-z])/g, "First "],
	[/\bZero(?=[.,:;)]|$)/gm, "First"],
	[/\bZero's\b/g, "First's"],
];

export function toFirst(text: string): string {
	return rules.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
