import { defineConfig, query } from "spacepress";
import urlJoin from "url-join";
import template from "just-template";
import escapeHtml from "escape-html";

export const link = query({ access: "anyone" }, (_ctx, input: { slug: string; title: string }) => {
  const href = urlJoin("/notes/", encodeURIComponent(input.slug));
  return {
    href,
    html: template('<a href="{{href}}">{{title}}</a>', {
      href: escapeHtml(href),
      title: escapeHtml(input.title),
    }),
  };
});

export default defineConfig({
  name: "npm-links",
});
