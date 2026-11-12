import { action, collection, defineConfig, definePlugin, text, type Plugin } from "first";

const posts = collection({ title: text(), summary: text().optional() }, { title: "title" });

// A package's export: options in, a plugin out. No capability list.
function seo(options: { suffix: string }): Plugin {
  return definePlugin<{ posts: typeof posts }>({
    name: "seo",
    hooks: { posts: { beforeCreate(data) { data.summary = data.title + options.suffix; } } },
    actions: {
      ping: action({ input: {}, access: "anyone", handler() { return "pong"; } }),
    },
  });
}

defineConfig({ collections: { posts }, use: [seo({ suffix: " | Site" })] });

// @ts-expect-error `use` takes plugins, not package pins.
defineConfig({ collections: { posts }, use: ["first-plugin-seo"] });
// @ts-expect-error a plugin has no capability list; the lock grants it.
definePlugin({ name: "x", capabilities: { http: ["a.example"] } });
