// tpEmdash(): runs an official EmDash Astro template on a TypedPress site, with no code in the
// template. `emdash`, `emdash/ui`, `emdash/page` and `emdash/runtime` resolve to this package, and
// the middleware handles admin links, comment posts, the session and previews.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (file) => fileURLToPath(new URL(file, import.meta.url));

/** @param {{ pagesAt?: string }} [options] where pages live: "/pages/" (the blog) or "/" (the starter) */
export function tpEmdash(options = {}) {
  return {
    name: "@typedpress/astro/emdash",
    hooks: {
      // The `emdash` modules' types, so a template type-checks with no EmDash package installed.
      "astro:config:done": ({ injectTypes }) => {
        injectTypes({ filename: "emdash.d.ts", content: readFileSync(here("./emdash.d.ts"), "utf8") });
      },
      "astro:config:setup": ({ config, updateConfig, addMiddleware, injectRoute }) => {
        // The live search's endpoint, wherever the site has a server to answer it.
        if (config.output === "server" || config.adapter) injectRoute({ pattern: "/api/search", entrypoint: here("./search-route.js"), prerender: false });
        updateConfig({
          vite: {
            define: { __TP_EMDASH_PAGES_AT__: JSON.stringify(options.pagesAt ?? "/pages/") },
            resolve: {
              // This package's own dependency, resolved from the site's node_modules too: a linked
              // (`file:`) install has no node_modules beside the package's real path.
              dedupe: ["linkedom"],
              alias: [
                { find: /^emdash\/ui\/comments$/, replacement: here("./comments.js") },
                { find: /^emdash\/ui\/search$/, replacement: here("./LiveSearch.astro") },
                { find: /^emdash\/ui$/, replacement: here("./ui.js") },
                { find: /^emdash\/page$/, replacement: here("./page.js") },
                { find: /^emdash\/runtime$/, replacement: here("./client.js") },
                { find: /^emdash$/, replacement: here("./client.js") },
              ],
            },
          },
        });
        addMiddleware({ entrypoint: here("./middleware.js"), order: "pre" });
      },
    },
  };
}
export default tpEmdash;
