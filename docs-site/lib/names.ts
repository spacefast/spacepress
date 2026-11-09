// The docs say First everywhere. The code on main may still use the names it had before the
// rename (Zero v2), so text that the generator copies out of the code passes through `toFirst`
// before it reaches a page. Each rule follows the rename table. Once main uses First names, no
// rule matches anything and this file can go.
//
// Zero 0.8 keeps its name: "Zero 0.8", "zero-0.8" and the `@spacefast/zero` packages never match.
const rules: [RegExp, string][] = [
	[/zero\.config\.ts/g, "first.config.ts"],
	[/zero\.gen\.ts/g, "first.gen.ts"],
	[/(from |import\()(["'])zero\2/g, "$1$2first$2"],
	[/"zero":/g, '"first":'],
	// The module in a compiler message: `"zero" has no export named fetch`.
	[/"zero"(?= has no export)/g, '"first"'],
	[/\/wp-json\/zero\/v1/g, "/wp-json/first/v1"],
	[/\bzero\/v1\b/g, "first/v1"],
	// v2 browser paths only. /__zero/auth, /__zero/run, /__zero/config and /__zero/realtime/* are 0.8.
	[/\/__zero\/(api\/v1\/|client\.js|client\.d\.ts|realtime\.js)/g, "/__first/$1"],
	[/zero-identity/g, "first-identity"],
	[/zero-(app|pages)-(?=[a-z<{\\])/g, "first-$1-"],
	[/\bzero-test-(admin|editor)\b/g, "first-test-$1"],
	[/\bpost_type=zero_/g, "post_type=first_"],
	// Post types, ACF groups and meta keys in generated PHP: 'zero_pages', 'group_zero_pages', 'zero_'.
	[/'(group_|field_)?zero_(?=[a-z_]*')/g, "'$1first_"],
	[/\bhooks=zero_/g, "hooks=first_"],
	[/(target\/(?:debug|release))\/zero\b/g, "$1/first"],
	[/\bVITE_ZERO_/g, "VITE_FIRST_"],
	// Inside the runtime plugin, the PHP runtime folder: zero-runtime/zero/Db.php.
	[/zero-runtime\/zero\//g, "first-runtime/first/"],
	[/zero-runtime/g, "first-runtime"],
	[/\bzero-(manifest|deployment)\.json\b/g, "first-$1.json"],
	[/zero-admin/g, "first-admin"],
	[/@spacefast\/zero-(cli|blocks|pages|wasm|bin-)/g, "@spacefast/first-$1"],
	[/@spacefast\/create-zero/g, "@spacefast/create-first"],
	[/\bcreate-zero\b/g, "create-first"],
	[/(?<![\w/@.-])zero-(blocks|pages)\b/g, "first-$1"],
	[/`zero` binary/g, "`first` binary"],
	[/\bwp zero\b/g, "wp first"],
	// abilities, call, queries, types and ls act on 0.8 Spaces and stay `sf zero`.
	[/\bsf zero (?=(build|check|dev|import|init|migrate|sync)\b)/g, "sf first "],
	// The `first` binary's commands. Not after `sf `: `sf zero abilities` and the like act on 0.8 Spaces.
	[/(^|[\s`(])(?<!sf )zero (?=(dev|build|check|doctor|sync|abilities|migrate|deploy|wp|seed|jobs|run|action|find|insert|update|delete|publish-due|identity|help|sources)\b)/gm, "$1first "],
	[/(^|[\s`"'(/])\.zero\//gm, "$1.first/"],
	// The app folder and everything in it. Not `@spacefast/zero/client` (the 0.8 package), the
	// repository (`spacefast/zero/blob`), the REST namespace (`zero/v1`) or `types/zero/`.
	[/(^|[\s`"'(/.])(?<!spacefast\/|types\/)zero\/(?!v1\b)(?=[\w.<-])/gm, "$1first/"],
	[/\bZERO_(?!0)/g, "FIRST_"],
	[/\bZ(\d{4})\b/g, "F$1"],
	[/\bZero(Error|Config)\b/g, "First$1"],
	[/\\Zero\\/g, "\\First\\"],
	[/\bnamespace Zero(App)?\b/g, "namespace First$1"],
	[/\bZeroApp\\/g, "FirstApp\\"],
	[/`zero build`/g, "`first build`"],
	[/\bZero_Admin/g, "First_Admin"],
	[/\bX-Zero-/g, "X-First-"],
	[/\bZero-(Signature|Event-Id)\b/g, "First-$1"],
	[/\{prefix\}zero_/g, "{prefix}first_"],
	[/\bzero__(\w)/g, "first__$1"],
	[/\bzero_identity_/g, "first_identity_"],
	[/\bzero_source_needs_local_capture\b/g, "first_source_needs_local_capture"],
	[/scheme: "zero"/g, 'scheme: "first"'],
	[/`zero-(\\?<name\\?>)`/g, "`first-$1`"],
	[/\b(const|let) zero = /g, "$1 first = "],
	[/(?<![\w.\/-])zero\.(?=[a-z]\w*\.)/g, "first."],
	[/\bZero v2\b/g, "First"],
	// "an original Zero site" and "an earlier Zero" are Zero 0.8.
	[/(?<!(original|earlier|older|old|legacy) )\bZero (?!0\.\d)(?=[A-Za-z])/g, "First "],
	[/\bZero(?=[.,:;)]|$)/gm, "First"],
	[/\bZero's\b/g, "First's"],
];

export function toFirst(text: string): string {
	return rules.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
