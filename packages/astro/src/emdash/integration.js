// firstEmdash(): runs an official EmDash Astro template on a First site, with no code in the
// template. `emdash`, `emdash/ui`, `emdash/page` and `emdash/runtime` resolve to this package, and
// the middleware handles admin links, comment posts, the session and previews.
import { fileURLToPath } from "node:url";

const here = (file) => fileURLToPath(new URL(file, import.meta.url));

export function firstEmdash() {
  return {
    name: "@first/astro/emdash",
    hooks: {
      "astro:config:setup": ({ updateConfig, addMiddleware }) => {
        updateConfig({
          vite: {
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
