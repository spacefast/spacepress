// Tagged-template shapes from live 0.8 apps: an escaping `html` tag and String.raw patterns.
export function html(strings: TemplateStringsArray, ...values: string[]): string {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    out += (values[i] ?? "").replaceAll("<", "&lt;") + (strings[i + 1] ?? "");
  }
  return out;
}

export function card(title: string): string[] {
  return [html`<h1>${title}</h1>`, String.raw`\d+-${title}`];
}
