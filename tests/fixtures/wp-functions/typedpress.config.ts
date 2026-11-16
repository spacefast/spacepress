import { action, defineConfig, text } from "typedpress";
import { esc_html, get_option, get_post, update_option, wp_insert_post, current_user_can } from "php/wordpress";
// Calls core functions as the signed-in user; an empty title makes wp_insert_post fail.
export const note = action({
  input: { title: text() },
  access: "anyone",
  handler(input) {
    if (!current_user_can("edit_posts")) return { allowed: false };
    update_option("fns_last_note", input.title);
    const id = wp_insert_post({ post_title: input.title, post_status: "draft" });
    const post = get_post(id);
    return { allowed: true, id, title: post === null ? "" : esc_html(post.post_title), last: get_option("fns_last_note") };
  },
});

export default defineConfig({
  name: "fns",
});
