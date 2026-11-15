// Drive Store: a used hard-drive shop. Kinds, hooks and the shop settings are in first/schema.ts,
// the actions the storefront's forms post to in first/server.ts, and the storefront itself in
// first/app/. Product names and descriptions are written in English and Turkish.
import { defineConfig } from "first";

export default defineConfig({
  name: "drive-store",
  locales: { default: "en", all: ["en", "tr"] },
});
