import { defineConfig, type WordPressPlugin } from "zero";

const plugins = [
  { slug: "classic-editor", version: "1.6.7" },
  {
    slug: "akismet",
    version: "5.4",
    pluginData: { resource: "wordpress.org/plugins", slug: "akismet.5.4.zip" },
    requires: ["classic-editor"],
  },
  {
    slug: "company-plugin",
    version: "1.0.0-rc1",
    pluginData: { resource: "url", url: "https://example.org/company-plugin.zip" },
    sha256: "a".repeat(64),
  },
] satisfies readonly WordPressPlugin[];

defineConfig({ schema: {}, wordpress: { plugins } });

// @ts-expect-error URL archives require an authored checksum.
const unpinned: WordPressPlugin = { slug: "company-plugin", version: "1.0", pluginData: { resource: "url", url: "https://example.org/plugin.zip" } };
// @ts-expect-error Blueprint runtime steps aren't artifact declarations.
defineConfig({ schema: {}, wordpress: { steps: [{ step: "runPHP", code: "<?php" }] } });
// @ts-expect-error Activation is a deployment concern.
const activation: WordPressPlugin = { slug: "akismet", version: "5.4", activate: true };
// @ts-expect-error Only the supported resource subset is accepted.
const git: WordPressPlugin = { slug: "custom", version: "1.0", pluginData: { resource: "git:directory", url: "https://example.org/repo" } };
