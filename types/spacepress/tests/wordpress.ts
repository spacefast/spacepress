// "spacepress/server/wp" ability calls and wp.action() / wp.filter() hooks.
import { abilities, wp, type WP_Post, type WP_Query } from "spacepress/server/wp";

declare module "spacepress/server/wp" {
  interface Abilities {
    "acme/site-info": { input: { field: "name" | "url" }; output: { value: string } };
    "acme/ping": { input: { loud?: boolean }; output: "pong" };
  }
}

export async function typed(): Promise<string> {
  const info = await abilities.call("acme/site-info", { field: "url" });
  const pong: "pong" = await abilities.call("acme/ping");
  return info.value + pong;
}

export async function refused(): Promise<void> {
  // @ts-expect-error an input value outside the schema's enum
  await abilities.call("acme/site-info", { field: "title" });
  // @ts-expect-error a required input is missing
  await abilities.call("acme/site-info");
  // @ts-expect-error not an ability the app knows
  await abilities.call("acme/unknown", {});
}

export const frame = wp.filter("the_content", { priority: 20 }, (_ctx, content) => `<div>${content}</div>`);
export const saved = wp.action("save_post", (_ctx, postId: number, post: WP_Post, update: boolean) => {
  if (!update && postId > 0) void post.post_title.toUpperCase();
});
export const query = wp.action("pre_get_posts", (_ctx, q: WP_Query) => {
  if (q.is_main_query()) q.set("posts_per_page", 5);
});
// @ts-expect-error a filter returns the filtered value
export const lost = wp.filter("the_content", (_ctx, content) => content.length);
// @ts-expect-error views are read-only
export const write = wp.action("save_post", (_ctx, _id, post) => { post.post_title = "x"; });
