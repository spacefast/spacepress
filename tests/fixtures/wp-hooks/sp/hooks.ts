import { wp, type WP_Post } from "spacepress/server/wp";

// Runs first at priority 10 (registration order).
export const badge = wp.filter("the_content", (_ctx, content: string): string => {
  return content + "[a]";
});

export const frame = wp.filter("the_content", (_ctx, content: string): string => {
  return "<div>" + content + "</div>";
});

// A lower priority runs before the filters at the default 10.
export const early = wp.filter("the_content", { priority: 5 }, (_ctx, content: string): string => {
  return content.trim();
});

// Throws: WordPress gets the title it passed in, and the error is logged.
export const brokenTitle = wp.filter("the_title", (_ctx, title: string, postId: number): string => {
  if (postId > 0) throw new Error("broken title filter");
  return title;
});

// Reads the typed post view, then throws: an action's error is logged and WordPress carries on.
export const onSavePost = wp.action("save_post", (_ctx, postId: number, post: WP_Post, update: boolean) => {
  if (!update && post.post_status === "draft") {
    throw new Error("saw " + post.post_title + " #" + String(post.ID === postId));
  }
});
