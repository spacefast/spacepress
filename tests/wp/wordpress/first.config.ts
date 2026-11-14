import { action, defineConfig, text } from "first";
import { abilities, esc_html, get_post, wp_insert_post } from "php/wordpress";

// Calls another plugin's ability (locked by `first abilities pull`) and core functions as the
// signed-in user.
export const count = action({
  input: { text: text() },
  access: "anyone",
  async handler(input) {
    const result = await abilities.call("acme/word-count", { text: input.text, unit: "words" });
    return { words: result.count, by: result.by.toUpperCase() };
  },
});

export const draft = action({
  input: { title: text() },
  access: "authenticated",
  handler(input) {
    const id = wp_insert_post({ post_title: input.title, post_status: "draft" });
    const post = get_post(id);
    return { id, title: post === null ? "" : esc_html(post.post_title), status: post?.post_status ?? null };
  },
});

export default defineConfig({
  name: "abilities-lane",
});
