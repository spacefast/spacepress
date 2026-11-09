// @ts-check
// Publish the browser client that `zero build` already emits. Run after `zero build`.
import { copyFileSync, mkdirSync } from "node:fs";

const here = (p) => new URL(p, import.meta.url);
mkdirSync(here("public/client/"), { recursive: true });
copyFileSync(here("zero/_generated/client/LICENSE"), here("public/client/LICENSE"));
copyFileSync(here("zero/_generated/client/client.js"), here("public/client/index.js"));
console.log("wrote public/client/index.js and LICENSE");
