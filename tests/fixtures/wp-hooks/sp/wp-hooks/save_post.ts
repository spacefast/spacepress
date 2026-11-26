import type { WP_Post } from "spacepress/server/wp";

// Reads the typed post view, then throws: an action's error is logged and WordPress carries on.
export default function (postId: number, post: WP_Post, update: boolean) {
  if (!update && post.post_status === "draft") {
    throw new Error("saw " + post.post_title + " #" + String(post.ID === postId));
  }
}
