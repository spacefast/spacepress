import { defineConfig, text, mutation } from "spacepress";
import { abilities, esc_html, get_post, wp_insert_post } from "spacepress/server/wp";

// Calls another plugin's ability (locked by `spacepress abilities pull`) and core functions as the
// signed-in user.
export const count = mutation({ access: "anyone" }, async (input: { text: string }) => {
  const result = await abilities.call("acme/word-count", { text: input.text, unit: "words" });
  return { words: result.count, by: result.by.toUpperCase() };
});

export const draft = mutation({ access: "authenticated" }, (input: { title: string }) => {
  const id = wp_insert_post({ post_title: input.title, post_status: "draft" });
  const post = get_post(id);
  return { id, title: post === null ? "" : esc_html(post.post_title), status: post?.post_status ?? null };
});

export default defineConfig({
  name: "abilities-lane",
});
