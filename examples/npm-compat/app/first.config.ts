import { action, defineConfig, text } from "first";
import urlJoin from "url-join";
import template from "just-template";
import escapeHtml from "escape-html";

export const link = action({
  access: "anyone",
  input: { slug: text(), title: text() },
  handler: (input) => {
    const href = urlJoin("/notes/", encodeURIComponent(input.slug));
    return {
      href,
      html: template('<a href="{{href}}">{{title}}</a>', {
        href: escapeHtml(href),
        title: escapeHtml(input.title),
      }),
    };
  },
});

export default defineConfig({
  name: "npm-links",
});
