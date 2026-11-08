import { action, defineConfig, text } from "zero";
import { abilities, esc_html, get_post, wp_insert_post } from "php/wordpress";

// Calls another plugin's ability (locked by `zero abilities pull`) and core functions as the
// signed-in user.
export default defineConfig({
  name: "abilities-lane",
  actions: {
    count: action({
      input: { text: text().notNull() },
      access: "anyone",
      async handler(input) {
        const result = await abilities.call("acme/word-count", { text: input.text, unit: "words" });
        return { words: result.count, by: result.by.toUpperCase() };
      },
    }),
    draft: action({
      input: { title: text().notNull() },
      access: "authenticated",
      handler(input) {
        const id = wp_insert_post({ post_title: input.title, post_status: "draft" });
        const post = get_post(id);
        return { id, title: post === null ? "" : esc_html(post.post_title), status: post?.post_status ?? null };
      },
    }),
  },
});
