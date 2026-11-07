import { action, defineConfig, fetch, text } from "zero";

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
    post: action({
      input: { url: text().notNull(), payload: text().notNull() },
      access: "anyone",
      async handler(input) {
        const response = await fetch(input.url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer lane-token", cookie: "lane=1", host: "evil.test" },
          body: input.payload,
        });
        const data = (await response.json()) as { hello: string; method: string; received: string };
        return { status: response.status, data };
      },
    }),
  },
});
