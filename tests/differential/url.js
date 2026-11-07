// Plain JavaScript compiled through checked dispatch: every WPT urltestdata case, URLSearchParams
// and URL setters. The same module runs under Node; both outputs must match byte for byte.
const PROPS = ["href", "origin", "protocol", "username", "password", "host", "hostname", "port", "pathname", "search", "hash"];

export function parseAll(cases) {
  return cases.map((c) => {
    const parsed = c.base === null ? URL.parse(c.input) : URL.parse(c.input, c.base);
    if (parsed === null) return null;
    return PROPS.map((p) => parsed[p]);
  });
}

export function searchParams() {
  const p = new URLSearchParams("?a=1&b=2&a=3&c=%20x+y&d");
  const fromPairs = new URLSearchParams([["x", "1"], ["y", "a b"], ["x", "&"]]);
  const fromRecord = new URLSearchParams({ "response-content-disposition": 'attachment; filename="a b.txt"', n: 1 });
  const seen = [];
  p.forEach((value, name) => { seen.push(name + "=" + value); });
  p.append("e", "é");
  p.delete("b");
  p.set("a", "z");
  const before = p.toString();
  p.sort();
  const url = new URL("https://example.com/p?q=1#h");
  url.searchParams.append("r", "two words");
  url.pathname = "/a b";
  url.hash = "";
  url.port = "8443";
  const relative = new URL("../x?y", "http://h/a/b/c");
  // The application/x-www-form-urlencoded set: `*-._` stay, `~!'()` are escaped, and a lone `%zz` stays.
  const encoded = new URLSearchParams("?a=1&b=two words");
  encoded.append("a", "é");
  encoded.append("d", "x&y=z ü");
  encoded.append("t", "*-._~!'()");
  const tilde = new URL("http://h/a~b?c~d#e~f");
  tilde.searchParams.append("x", "~");
  return [p.get("a"), p.get("missing"), p.getAll("a"), p.has("c"), p.has("a", "z"), p.size, seen, before, p.toString(), [...p.keys()], [...fromPairs], fromPairs.toString(), fromRecord.toString(), url.href, url.search, String(url), JSON.stringify({ url }), relative.href, URL.canParse("nope"), URL.canParse("/x", "http://h"), String(encoded), new URLSearchParams("x=%zz").get("x"), String(new URLSearchParams(encoded)), tilde.href];
}

export function invalid() {
  const errors = [];
  const attempts = [() => new URL("nope"), () => new URL("/x", "also nope"), () => new URL("http://[::1")];
  for (const attempt of attempts) {
    try { attempt(); errors.push("parsed"); } catch (e) { errors.push(e.name); }
  }
  return errors;
}
