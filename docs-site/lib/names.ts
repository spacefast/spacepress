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
	[/\/wp-json\/zero\/v1/g, "/wp-json/first/v1"],
	[/\bzero\/v1\b/g, "first/v1"],
	[/\/__zero\//g, "/__first/"],
	[/zero-identity/g, "first-identity"],
	[/zero-app-/g, "first-app-"],
	[/zero-runtime/g, "first-runtime"],
	[/zero-admin/g, "first-admin"],
	[/@spacefast\/zero-(cli|blocks|pages|wasm)/g, "@spacefast/first-$1"],
	[/@spacefast\/create-zero/g, "@spacefast/create-first"],
	[/\bcreate-zero\b/g, "create-first"],
	[/(?<![\w/@.-])zero-(blocks|pages)\b/g, "first-$1"],
	[/`zero` binary/g, "`first` binary"],
	[/\bwp zero\b/g, "wp first"],
	[/\bsf zero\b/g, "sf first"],
	[/(^|[\s`(])zero (?=(dev|build|check|doctor|sync|abilities|migrate|deploy|wp|seed|jobs|run|action|find|insert|update|delete|publish-due|identity|help|sources)\b)/gm, "$1first "],
	[/(^|[\s`"'(/])\.zero\//gm, "$1.first/"],
	[/(^|[\s`"'(/])zero\/(_generated|client|dist|migrations|app|abilities\.json|plugins\.lock\.json|wp-plugins\.lock\.json)/gm, "$1first/$2"],
	[/\bZERO_(?!0)/g, "FIRST_"],
	[/\bZ(\d{4})\b/g, "F$1"],
	[/\bZero(Error|Config)\b/g, "First$1"],
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
