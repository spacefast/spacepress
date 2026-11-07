// Host globals, run once in Node and once as the generated PHP (tests/compiler_contracts.rs).
// Every action is called with input `{}`; HOST_SECRET is " lane secret \n" and HOST_URL names an
// origin that answers /json, /text and /redirect identically on both sides.
import { action, defineConfig } from "zero";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
const nodeCrypto = require("node:crypto");

const text = "zero → php ✓ 😀";

export default defineConfig({
  name: "host-globals",
  actions: {
    digests: action({
      input: {},
      handler: () => [
        createHash("sha256").update(text).digest("hex"),
        createHash("SHA512").update("a").update("b").digest("base64"),
        nodeCrypto.createHash("md5").update(text).digest("base64url"),
        createHash("sha1").update("").digest("hex"),
        createHash("sha384").update(text).digest("hex"),
        createHmac("sha256", "Jefe").update("what do ya want for nothing?").digest("hex"),
        createHmac("sha512", text).update(text).digest("base64"),
      ],
    }),
    secrets: action({
      input: {},
      handler: () => [
        // A key read from process.env is trimmed, as Zero 0.8 did; Node uses it as given.
        createHmac("sha256", process.env.HOST_SECRET!).update(text).digest("hex") ===
          createHmac("sha256", "lane secret").update(text).digest("hex"),
        process.env.HOST_SECRET,
        process.env["HOST_UNSET"],
        process.env.HOST_UNSET === undefined,
        typeof process.env.HOST_UNSET,
        process.env.HOST_UNSET ?? "fallback",
      ],
    }),
    compare: action({
      input: {},
      handler: () => {
        const same = timingSafeEqual(Buffer.from(text), Buffer.from(text));
        const differ = timingSafeEqual(Buffer.from("abc"), Buffer.from("abd"));
        let thrown = "";
        try {
          timingSafeEqual(Buffer.from("é"), Buffer.from("e"));
        } catch (e) {
          thrown = (e as Error).name;
        }
        return [same, differ, thrown, Buffer.byteLength(text), Buffer.byteLength("é", "utf8")];
      },
    }),
    random: action({
      input: {},
      handler: () => {
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
        const a = randomBytes(16).toString("hex");
        return [
          uuid.test(crypto.randomUUID()),
          uuid.test(randomUUID()),
          a.length,
          a !== randomBytes(16).toString("hex"),
          randomBytes(0).toString("hex"),
          randomBytes(9).toString("base64").length,
        ];
      },
    }),
    params: action({
      input: {},
      handler: () => {
        const p = new URLSearchParams("a=1&b=two+words&a=%C3%A9&c");
        p.append("d", "x&y=z ü");
        p.set("b", "*-._~!");
        p.delete("c");
        const fromPairs = new URLSearchParams([["k", "1"], ["k", "2"]]);
        const fromRecord = new URLSearchParams({ q: "a b", r: "" });
        return [p.toString(), p.get("a"), p.getAll("a"), p.has("c"), p.get("missing"), fromPairs.toString(), fromRecord.toString(), new URLSearchParams(p).get("d")];
      },
    }),
    headers: action({
      input: {},
      handler: () => {
        const h = new Headers({ "X-B": " 2 ", "x-a": "1" });
        h.append("X-A", "3");
        h.set("x-c", "c");
        h.delete("x-b");
        const seen: string[] = [];
        h.forEach((value, name) => {
          seen.push(name + ":" + value);
        });
        let invalid = "";
        try {
          new Headers([["bad name", "x"]]);
        } catch (e) {
          invalid = (e as Error).name;
        }
        return [h.get("X-A"), h.has("x-b"), seen, new Headers([["k", "v"]]).get("K"), new Headers(h).get("x-c"), invalid];
      },
    }),
    fetched: action({
      input: {},
      handler: async () => {
        const base = process.env.HOST_URL ?? "";
        const r = await fetch(base + "/json", { headers: [["accept", "application/json"]] });
        const used = r.bodyUsed;
        const data = (await r.json()) as { hello: string };
        let again = "";
        try {
          await r.text();
        } catch (e) {
          again = (e as Error).name;
        }
        const names: string[] = [];
        r.headers.forEach((_value, name) => {
          if (name.startsWith("x-")) names.push(name);
        });
        return [r.status, r.statusText, r.ok, r.redirected, r.url === base + "/json", r.headers.get("Content-Type"), r.headers.has("x-origin"), names, used, r.bodyUsed, data.hello, again];
      },
    }),
    teapot: action({
      input: {},
      handler: async () => {
        const base = process.env.HOST_URL ?? "";
        const r = await fetch(base + "/text", { method: "POST", body: new URLSearchParams({ q: "a b" }) });
        return [r.status, r.statusText, r.ok, await r.text()];
      },
    }),
    shadowed: action({
      input: {},
      handler: () => {
        // Local bindings named like host globals stay the author's, by ordinary scoping.
        const crypto = { randomUUID: () => "local uuid" };
        const process = { env: { HOST_SECRET: "local env" } };
        const fetch = (url: string) => "local fetch " + url;
        return [crypto.randomUUID(), process.env.HOST_SECRET, fetch("x")];
      },
    }),
    redirects: action({
      input: {},
      handler: async () => {
        const base = process.env.HOST_URL ?? "";
        const followed = await fetch(base + "/redirect");
        const manual = await fetch(base + "/redirect", { redirect: "manual" });
        return [followed.status, followed.redirected, followed.url === base + "/json", manual.status, manual.redirected, manual.headers.get("location")];
      },
    }),
  },
});
