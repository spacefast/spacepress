// "php/wordpress" ability calls type-check against the generated Abilities map.
import { abilities } from "php/wordpress";

declare module "php/wordpress" {
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

import type { Handler, WP_Post, WP_Query } from "php/wordpress";

export const frame: Handler<"the_content"> = (content) => `<div>${content}</div>`;
export const saved: Handler<"save_post"> = (postId: number, post: WP_Post, update: boolean) => {
  if (!update && postId > 0) void post.post_title.toUpperCase();
};
export const query: Handler<"pre_get_posts"> = (q: WP_Query) => {
  if (q.is_main_query()) q.set("posts_per_page", 5);
};
// @ts-expect-error a filter returns the filtered value
export const lost: Handler<"the_content"> = (content) => content.length;
// @ts-expect-error views are read-only
export const write: Handler<"save_post"> = (_id, post) => { post.post_title = "x"; };
