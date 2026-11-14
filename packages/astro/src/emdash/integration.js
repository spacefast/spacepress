// firstEmdash(): runs an official EmDash Astro template on a First site, with no code in the
// template. `emdash`, `emdash/ui`, `emdash/page` and `emdash/runtime` resolve to this package, and
// the middleware handles admin links, comment posts, the session and previews.
import { fileURLToPath } from "node:url";

const here = (file) => fileURLToPath(new URL(file, import.meta.url));

/** @param {{ pagesAt?: string }} [options] where pages live: "/pages/" (the blog) or "/" (the starter) */
export function firstEmdash(options = {}) {
  return {
    name: "@first/astro/emdash",
    hooks: {
      "astro:config:setup": ({ config, updateConfig, addMiddleware, injectRoute }) => {
        // The live search's endpoint, wherever the site has a server to answer it.
        if (config.output === "server" || config.adapter) injectRoute({ pattern: "/api/search", entrypoint: here("./search-route.js"), prerender: false });
        updateConfig({
          vite: {
            define: { __FIRST_EMDASH_PAGES_AT__: JSON.stringify(options.pagesAt ?? "/pages/") },
            resolve: {
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
export default firstEmdash;
