import { collection, defineConfig, definePlugin, f, type Plugin, mutation } from "spacepress";
import { destructiveMigrations } from "spacepress/danger";

const posts = collection({ title: f.text(), summary: f.text().optional() }, { title: "title" });

// A package's export: options in, a plugin out. No capability list.
function seo(options: { suffix: string }): Plugin {
  return definePlugin<{ posts: typeof posts }>({
    name: "seo",
    hooks: { posts: { beforeCreate({ data }) { data.summary = data.title + options.suffix; } } },
    actions: {
      ping: mutation({ access: "anyone" }, () => { return "pong"; }),
    },
  });
}

defineConfig({ use: [seo({ suffix: " | Site" }), destructiveMigrations(), destructiveMigrations({ requireArchive: true, allowRawSql: false })] });

// @ts-expect-error requireArchive must be boolean
destructiveMigrations({ requireArchive: "yes" });

// @ts-expect-error `use` takes plugins, not package pins.
defineConfig({ use: ["spacepress-plugin-seo"] });
// @ts-expect-error a plugin has no capability list; the lock grants it.
definePlugin({ name: "x", capabilities: { http: ["a.example"] } });
