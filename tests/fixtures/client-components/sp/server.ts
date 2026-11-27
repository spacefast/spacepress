import { table, mutation, f } from "spacepress";

export const like = mutation({ access: "anyone" }, async (_ctx, { postId }: { postId: number }) => { return postId + 100; });

// A kind anyone may read and write, so a browser test can add a row as another visitor and watch
// a `useLive` list pick it up.
export const guestbook = table({ name: f.text() }, { access: { read: "anyone", create: "anyone", update: "admin", delete: "admin" } });
