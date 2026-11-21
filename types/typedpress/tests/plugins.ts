import { collection, defineConfig, definePlugin, text, type Plugin, mutation } from "typedpress";
import { destructiveMigrations } from "typedpress/danger";

const posts = collection({ title: text(), summary: text().optional() }, { title: "title" });

// A package's export: options in, a plugin out. No capability list.
function seo(options: { suffix: string }): Plugin {
  return definePlugin<{ posts: typeof posts }>({
    name: "seo",
    hooks: { posts: { beforeCreate(data) { data.summary = data.title + options.suffix; } } },
    actions: {
      ping: mutation({ access: "anyone" }, () => { return "pong"; }),
    },
  });
}

defineConfig({ use: [seo({ suffix: " | Site" }), destructiveMigrations(), destructiveMigrations({ requireArchive: true, allowRawSql: false })] });

// @ts-expect-error requireArchive must be boolean
destructiveMigrations({ requireArchive: "yes" });

// @ts-expect-error `use` takes plugins, not package pins.
defineConfig({ use: ["typedpress-plugin-seo"] });
// @ts-expect-error a plugin has no capability list; the lock grants it.
definePlugin({ name: "x", capabilities: { http: ["a.example"] } });
