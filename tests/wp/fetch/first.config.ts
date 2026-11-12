import { action, defineConfig, text } from "first";

// Each action calls fetch() and reports what a handler sees, or the refusal code.
export default defineConfig({
  name: "fetch-lane",
  actions: {
    get: action({
      input: { url: text().notNull() },
      access: "anyone",
      async handler(input) {
        const response = await fetch(input.url);
        return {
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          url: response.url,
          redirected: response.redirected,
          type: response.headers.get("content-type"),
          origin: response.headers.get("X-Origin"),
          cookie: response.headers.has("set-cookie"),
          body: await response.text(),
        };
      },
    }),
    manual: action({
      input: { url: text().notNull(), mode: text().notNull() },
      access: "anyone",
      async handler(input) {
        const response = await fetch(input.url, { redirect: input.mode === "manual" ? "manual" : "error" });
        return { status: response.status, location: response.headers.get("location") };
      },
    }),
    form: action({
      input: { url: text().notNull() },
      access: "anyone",
      async handler(input) {
        const response = await fetch(input.url, { method: "POST", headers: [["x-pair", "1"]], body: new URLSearchParams({ q: "a b" }) });
        return (await response.json()) as { received: string };
      },
    }),
    post: action({
      input: { url: text().notNull(), payload: text().notNull() },
      access: "anyone",
      async handler(input) {
        const response = await fetch(input.url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer lane-token", cookie: "lane=1", host: "evil.test" },
          body: input.payload,
        });
        // Whatever the receiver answered: the echo of a JSON post, or a redirect's echo of what it was sent.
        const data = (await response.json()) as Record<string, string | null>;
        return { status: response.status, data };
      },
    }),
  },
});
