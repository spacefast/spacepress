// Calls stay in source form so both Node and First execute the same expressions.
export const probes = [
  {
    name: "url-join",
    version: "5.0.0",
    entry: "lib/url-join.js",
    binding: "urlJoin",
    format: "esm",
    body: `let invalid = ""; try { urlJoin("https://example.com", 42); } catch (error) { invalid = error.name + ":" + error.message; } const parts = ["https:", "example.com/", "/notes", "?q=tea", "?page=2"]; const joined = urlJoin(parts); return { joined, parts, variadic: urlJoin("https://example.com/", "/notes/", "#top"), file: urlJoin("file:", "/tmp", "notes.txt"), empty: urlJoin(), trailing: urlJoin("/notes/", "next///"), invalid };`,
  },
  {
    name: "just-template",
    version: "2.2.0",
    entry: "index.mjs",
    binding: "template",
    format: "esm",
    body: `return {nested: template("Hello {{user.name}} ({{count}})", {user: {name: "Ada"}, count: 2}), repeated: template("{{name}}/{{name}}", {name: "tea"}), falsy: template("{{first}}/{{no}}/{{empty}}/{{missing}}", {first: 0, no: false, empty: ""}), unicode: template("{{name}}!", {name: "école 你好"}), plain: template("Hello", {})};`,
  },
  {
    name: "clsx",
    version: "2.1.1",
    entry: "dist/clsx.mjs",
    binding: "clsx",
    format: "esm",
    body: `return { basic: clsx("card", "active"), nested: clsx(["a", ["b", false]], {selected: true, hidden: false}, 0, 3), empty: clsx(false, null, undefined, "") };`,
  },
  {
    name: "escape-html",
    version: "1.0.3",
    entry: "index.js",
    binding: "escapeHtml",
    format: "cjs-named-function",
    body: `return { plain: escapeHtml("hello"), markup: escapeHtml(${JSON.stringify('<b title="x">&\'你好</b>')}), empty: escapeHtml(""), number: escapeHtml(123) };`,
  },
  {
    name: "ms",
    version: "2.1.3",
    entry: "index.js",
    binding: "ms",
    format: "cjs-anonymous-function",
    body: `return { parse: ms("2 days"), negative: ms("-1.5h"), invalid: ms("nonsense") ?? null, short: ms(5400000), long: ms(5400000, {long: true}), first: ms(0) };`,
  },
  {
    name: "just-clone",
    version: "6.2.0",
    entry: "index.mjs",
    binding: "clone",
    format: "esm",
    fixture: `export function fixture() { return {set: new Set([{value: 2}]), map: new Map([["a", {value: 3}]]), date: new Date(0), pattern: /ab/gi}; }`,
    body: `const original = {title: "before", nested: {value: 1}, list: [1, 2]}; const copied = clone(original); copied.nested.value = 9; copied.list.push(3); const source = fixture(); const special = clone(source); special.map.get("a").value = 4; return {original, copied, primitive: clone(5), empty: clone({}), special: {set: Array.from(special.set), map: Array.from(special.map), sourceMap: Array.from(source.map), epoch: special.date.getTime(), pattern: special.pattern.source, flags: special.pattern.flags, matches: special.pattern.test("AB")}};`,
  },
  {
    name: "just-capitalize",
    version: "3.2.0",
    entry: "index.mjs",
    binding: "capitalize",
    format: "esm",
    body: `let invalid = ""; try { capitalize(null); } catch (error) { invalid = error.name + ":" + error.message; } return { mixed: capitalize("hELLO WORLD"), empty: capitalize(""), unicode: capitalize("éCOLE"), punctuation: capitalize("!WOW"), invalid };`,
  },
  {
    typedAdapter: "unknown-number",
    name: "is-number",
    version: "7.0.0",
    entry: "index.js",
    binding: "isNumber",
    format: "cjs-anonymous-function",
    body: `return { number: isNumber(3), numericString: isNumber("3.5"), whitespace: isNumber("  "), hex: isNumber("0xff"), nan: isNumber(NaN), infinite: isNumber(Infinity), nil: isNumber(null), object: isNumber({}) };`,
  },
  {
    name: "ts-dedent",
    version: "2.3.0",
    entry: "src/index.ts",
    binding: "dedent",
    format: "esm",
    body: `return {plain: dedent("plain"), multiline: dedent("\\n  hello\\n  world\\n"), empty: dedent("")};`,
  },
  {
    name: "@thi.ng/math",
    version: "5.15.17",
    entry: "safe-div.js",
    binding: "safeDiv",
    format: "esm",
    named: true,
    specifier: "@thi.ng/math/safe-div",
    typedAdapter: "number-pair",
    body: `return {fraction: safeDiv(7, 2), first: safeDiv(7, 0), negativeZero: safeDiv(7, -0), negative: safeDiv(-7, 2)};`,
  },
  {
    name: "@thi.ng/strings",
    version: "3.12.8",
    entry: "case.js",
    binding: "upper",
    format: "esm",
    named: true,
    specifier: "@thi.ng/strings/case",
    typedAdapter: "string-callbacks",
    body: `return {ascii: upper("Hello World"), empty: upper(""), unicode: upper("école 你好"), expansion: upper("Straße")};`,
  },
];

export const popularCombined = {
  name: "popular-combined",
  libraries: ["clsx", "escape-html", "just-capitalize"],
  body: `return {title: escapeHtml(capitalize('<HELLO & "WORLD">')), className: clsx("card", {active: true, hidden: false}, ["compact"])};`,
};

export const combined = {
  name: "combined",
  libraries: ["@thi.ng/math", "@thi.ng/strings"],
  body: `return {label: upper("price"), ratio: safeDiv(7, 2), first: safeDiv(7, 0), unicode: upper("école Straße"), empty: upper("")};`,
};

export const applicationCombined = {
  name: "application-combined",
  libraries: ["url-join", "just-template", "escape-html"],
  body: `const cards = [{slug: "tea", title: "Tea & <scones>"}, {slug: "café", title: "Café"}]; return cards.map(card => ({href: urlJoin("https://example.com/", "/notes/", encodeURIComponent(card.slug)), html: template('<a href="{{href}}">{{title}}</a>', {href: urlJoin("/notes", encodeURIComponent(card.slug)), title: escapeHtml(card.title)})}));`,
};
