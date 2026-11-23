import { defineConfig, mutation } from "spacepress";
import { esc_html, get_current_user_id, get_option, get_permalink, get_post, get_userdata, update_option, wp_insert_post, current_user_can } from "php/wordpress";
// Calls core functions as the signed-in user; an empty title makes wp_insert_post fail.
export const note = mutation({ access: "anyone" }, (input: { title: string }) => {
  if (!current_user_can("edit_posts")) return { allowed: false };
  update_option("fns_last_note", input.title);
  // "WP_User | false": narrowed by `=== false`, and still narrowed after the calls that follow.
  const author = get_userdata(get_current_user_id());
  if (author === false) return { allowed: false };
  const id = wp_insert_post({ post_title: input.title, post_status: "draft" });
  const post = get_post(id);
  // "string | false": narrowed by truthiness.
  const link = get_permalink(id);
  return {
    allowed: true, id, title: post === null ? "" : esc_html(post.post_title), last: get_option("fns_last_note"),
    author: author.user_login, linked: link ? link.includes("?p=") : false,
  };
});

export default defineConfig({
  name: "fns",
});
