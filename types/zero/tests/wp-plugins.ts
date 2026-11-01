import { defineConfig, type WordPressPlugin } from "zero";

const plugins = {
  "classic-editor": "1.6.7",
  akismet: {
    version: "5.4",
    pluginData: { resource: "wordpress.org/plugins", slug: "akismet.5.4.zip" },
    requires: ["classic-editor"],
  },
  "company-plugin": {
    version: "1.0.0-rc1",
    pluginData: { resource: "url", url: "https://example.org/company-plugin.zip" },
    sha256: "a".repeat(64),
  },
} satisfies Readonly<Record<string, WordPressPlugin>>;

defineConfig({ schema: {}, plugins });
// The optional admin screens are a boolean opt-in.
defineConfig({ schema: {}, admin: true });
// @ts-expect-error admin is a boolean, not a settings object
defineConfig({ schema: {}, admin: { menu: true } });

// @ts-expect-error URL archives require an authored checksum.
const unpinned: WordPressPlugin = { version: "1.0", pluginData: { resource: "url", url: "https://example.org/plugin.zip" } };
// @ts-expect-error Blueprint runtime steps aren't artifact declarations.
defineConfig({ schema: {}, plugins: [{ step: "runPHP", code: "<?php" }] });
// @ts-expect-error Activation is a deployment concern.
const activation: WordPressPlugin = { version: "5.4", activate: true };
// @ts-expect-error Only the supported resource subset is accepted.
const git: WordPressPlugin = { version: "1.0", pluginData: { resource: "git:directory", url: "https://example.org/repo" } };

// @ts-expect-error Plugins are top-level package entries.
defineConfig({ schema: {}, wordpress: { plugins: [] } });
