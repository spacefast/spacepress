// `in` shapes from live 0.8 apps: optional-field checks on input records and union discrimination.
type Payload = { kind: "text"; body: string } | { kind: "link"; url: string };

export function describe(payload: Payload): string {
  return "url" in payload ? `link ${payload.url}` : `text ${payload.body}`;
}

export function present(record: Record<string, string>, key: string): boolean {
  return key in record && !("constructor" in [] === false);
}
