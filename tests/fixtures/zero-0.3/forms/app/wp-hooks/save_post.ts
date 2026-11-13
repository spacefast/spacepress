import type { WP_Post } from "php/wordpress";
export const priority = 20;
export default function (postId: number, post: WP_Post, update: boolean) { if (!update && post.post_type === "post") { void postId; } }
