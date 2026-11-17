import { Section, Code } from "../Guide";

export function Config() {
  return (
    <>
      <Section id="config" />
      <Code file="typedpress.config.ts">{`import { defineConfig, env } from "typedpress";

export default defineConfig({
  name: "my-site",
  frontend: false,                                   // or "https://…"; leave out to render on WordPress
  output: "static",                                  // for typedpress export
  media: { sizes: { card: { width: 600, height: 400, fit: "cover" } } },
  uploads: { backend: "s3", bucket: env("UPLOAD_BUCKET"), region: "us-east-1" },
  webhooks: [{ url: env("HOOK_URL"), secret: env("HOOK_SECRET"), events: ["posts.created"] }],
  services: { forms: { contact: { /* fields, recipient, sender */ } } },
  use: [seo({ suffix: " | Site" })],                 // plugin packages
  plugins: { "classic-editor": "1.6.7" },            // WordPress plugins, pinned
  dangerouslyEnablePlugins: true,
  sealed: true,
  admin: false,                                      // leave TypedPress Admin out
  runtimeSchema: true,
});`}</Code>
      <p className="cap">Every key is optional except <code>name</code>. Kinds, functions and jobs are not listed here: they register by being exported from a file in <code>tp/</code>.</p>
    </>
  );
}
