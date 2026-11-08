// Tagged templates, which live Zero 0.8 apps use (zero#138 census): small `html`/`sql`-style
// tag helpers and String.raw for regex and path text. Every action runs under Node and as
// compiled PHP; the JSON results must be byte-identical. `tagged-templates-helpers.mjs` runs the
// same shapes untyped.
import { action, defineConfig } from "zero";
import { taggedUntyped } from "./tagged-templates-helpers.mjs";

const run = (handler: () => unknown) => action({ input: {}, handler });

/** Escapes each substitution, like a 0.8 app's `html` helper. */
function html(strings: TemplateStringsArray, ...values: (string | number)[]): string {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    const value = String(values[i]).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    out += value + (strings[i + 1] ?? "");
  }
  return out;
}

/** Shows what a tag receives: cooked strings, raw strings and the values. */
function inspect(strings: TemplateStringsArray, ...values: unknown[]): unknown[] {
  return [strings.length, [...strings], strings.raw, values.length, values];
}

function tags(): unknown[] {
  const name = "<Ada & Bo>";
  const count = 3;
  return [
    html`<p>${name} has ${count} items</p>`,
    html`plain`,
    html`${1}${2}`,
    inspect`a${1}b\n${"two"}\u0041\x42`,
    inspect``,
    inspect`${null}`,
  ];
}

function raws(): string[] {
  const dir = "users";
  return [
    String.raw`C:\temp\${dir}\new`,
    String.raw`\d+\.\d+`,
    String.raw`line1\nline2 ${1 + 1} \u00e9`,
    String.raw`${"only"}`,
    String.raw``,
  ];
}

/** Each call site keeps one strings array; different sites get different arrays. */
function identity(): boolean[] {
  const site = (strings: TemplateStringsArray) => strings;
  const again = () => site`x`;
  return [again() === again(), site`x` === site`x`, again().raw === again().raw];
}

/** The tag runs after its substitutions, which run left to right. */
function order(): string[] {
  const log: string[] = [];
  const value = (label: string) => { log.push(label); return label; };
  const tag = (strings: TemplateStringsArray, ...values: string[]) => { log.push(`tag ${values.join(",")}`); return strings.length; };
  log.push(String(tag`${value("a")}-${value("b")}`));
  return log;
}

export default defineConfig({
  name: "language-tagged-templates",
  actions: {
    taggedTags: run(() => tags()),
    taggedRaw: run(() => raws()),
    taggedIdentity: run(() => identity()),
    taggedOrder: run(() => order()),
    taggedUntyped: run(() => taggedUntyped()),
  },
});
