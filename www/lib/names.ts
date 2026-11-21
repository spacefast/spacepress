// The docs say TypedPress everywhere. The code on main may still use the names it had before the
// rename (Zero v2), so text that the generator copies out of the code passes through `toTypedPress`
// before it reaches a page. Each rule follows the rename table. Once main uses TypedPress names, no
// rule matches anything and this file can go.
//
// Zero 0.8 keeps its name: "Zero 0.8", "zero-0.8" and the `@spacefast/zero` packages never match.
const rules: [RegExp, string][] = [
	[/zero\.config\.ts/g, "typedpress.config.ts"],
	[/zero\.gen\.ts/g, "typedpress.gen.ts"],
	[/(from |import\()(["'])zero\2/g, "$1$2typedpress$2"],
	[/"zero":/g, '"typedpress":'],
	// The module in a compiler message: `"zero" has no export named fetch`.
	[/"zero"(?= has no export)/g, '"typedpress"'],
	[/\/wp-json\/zero\/v1/g, "/wp-json/tp/v1"],
	[/\bzero\/v1\b/g, "tp/v1"],
	// v2 browser paths only. /__zero/auth, /__zero/run, /__zero/config and /__zero/realtime/* are 0.8.
	[/\/__zero\/api\/v1\//g, "/wp-json/typedpress/v1/"],
	[/\/__zero\/(client\.js|client\.d\.ts|realtime\.js)/g, "/__tp/$1"],
	[/zero-identity/g, "typedpress-identity"],
	[/zero-(app|pages)-(?=[a-z<{\\])/g, "typedpress-$1-"],
	[/\bzero-test-(admin|editor)\b/g, "typedpress-test-$1"],
	[/\bpost_type=zero_/g, "post_type=tp_"],
	// Post types, ACF groups and meta keys in generated PHP: 'zero_pages', 'group_zero_pages', 'zero_'.
	[/'(group_|field_)?zero_(?=[a-z_]*')/g, "'$1tp_"],
	[/\bhooks=zero_/g, "hooks=tp_"],
	[/(target\/(?:debug|release))\/zero\b/g, "$1/typedpress"],
	[/\bVITE_ZERO_/g, "VITE_TP_"],
	// Inside the runtime plugin, the PHP runtime folder: zero-runtime/zero/Db.php.
	[/zero-runtime\/zero\//g, "typedpress-runtime/tp/"],
	[/zero-runtime/g, "typedpress-runtime"],
	[/\bzero-(manifest|deployment)\.json\b/g, "typedpress-$1.json"],
	[/zero-admin/g, "typedpress-admin"],
	[/@spacefast\/zero-bin-/g, "@typedpress/bin-"],
	[/@spacefast\/zero-cli\b/g, "typedpress"],
	[/@spacefast\/zero-(blocks|pages|wasm)/g, "@typedpress/$1"],
	[/@spacefast\/create-zero/g, "create-typedpress"],
	[/\bcreate-zero\b/g, "create-typedpress"],
	[/(?<![\w/@.-])zero-(blocks|pages)\b/g, "typedpress-$1"],
	[/`zero` binary/g, "`typedpress` binary"],
	[/\bwp zero\b/g, "wp typedpress"],
	// abilities, call, queries, types and ls act on 0.8 Spaces and stay `sf zero`.
	[/\bsf zero (?=(build|check|dev|import|init|migrate|sync)\b)/g, "sf typedpress "],
	// The `typedpress` binary's commands. Not after `sf `: `sf zero abilities` and the like act on 0.8 Spaces.
	[/(^|[\s`(])(?<!sf )zero (?=(dev|build|check|doctor|sync|abilities|migrate|deploy|wp|seed|jobs|run|action|find|insert|update|delete|publish-due|identity|help|sources)\b)/gm, "$1typedpress "],
	[/(^|[\s`"'(/])\.zero\//gm, "$1.tp/"],
	// The app folder and everything in it. Not `@spacefast/zero/client` (the 0.8 package), the
	// repository (`spacefast/zero/blob`), the REST namespace (`zero/v1`) or `types/zero/`.
	[/(^|[\s`"'(/.])(?<!spacefast\/|types\/)zero\/(?!v1\b)(?=[\w.<-])/gm, "$1tp/"],
	[/\bZERO_(?!0)/g, "TP_"],
	[/\bZ(\d{4})\b/g, "F$1"],
	[/\bZero(Error|Config)\b/g, "TypedPress$1"],
	[/\\Zero\\/g, "\\TypedPress\\"],
	[/\bnamespace Zero(App)?\b/g, "namespace TypedPress$1"],
	[/\bZeroApp\\/g, "TypedPressApp\\"],
	[/`zero build`/g, "`typedpress build`"],
	[/\bZero_Admin/g, "TypedPress_Admin"],
	[/\bX-Zero-/g, "X-TypedPress-"],
	[/\bZero-(Signature|Event-Id)\b/g, "TypedPress-$1"],
	[/\{prefix\}zero_/g, "{prefix}tp_"],
	[/\bzero__(\w)/g, "tp__$1"],
	[/\bzero_identity_/g, "tp_identity_"],
	[/\bzero_source_needs_local_capture\b/g, "tp_source_needs_local_capture"],
	[/scheme: "zero"/g, 'scheme: "typedpress"'],
	[/`zero-(\\?<name\\?>)`/g, "`typedpress-$1`"],
	[/\b(const|let) zero = /g, "$1 tp = "],
	[/(?<![\w.\/-])zero\.(?=[a-z]\w*\.)/g, "tp."],
	[/\bZero v2\b/g, "TypedPress"],
	// "an original Zero site" and "an earlier Zero" are Zero 0.8.
	[/(?<!(original|earlier|older|old|legacy) )\bZero (?!0\.\d)(?=[A-Za-z])/g, "TypedPress "],
	[/\bZero(?=[.,:;)]|$)/gm, "TypedPress"],
	[/\bZero's\b/g, "TypedPress's"],
];

export function toTypedPress(text: string): string {
	return rules.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), text);
}
