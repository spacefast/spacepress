import { defineConfig, mutation } from "spacepress";
import { esc_html, get_option, get_post, update_option, wp_insert_post, current_user_can } from "php/wordpress";
export const note = mutation({ access: "anyone" }, (input: { title: string }) => {
  if (!current_user_can("edit_posts")) return { allowed: false };
  update_option("first_last_note", input.title);
  const id = wp_insert_post({ post_title: input.title, post_status: "draft" });
  const post = get_post(id);
  return { allowed: true, id, title: post === null ? "" : esc_html(post.post_title), last: get_option("first_last_note") };
});

export const config = defineConfig({ name: "fns" });

// @ts-expect-error get_post takes a post id
get_post("1");
// @ts-expect-error wp_insert_post's fields are typed
wp_insert_post({ post_title: 1 });
