import { action, integer, table, text } from "typedpress";

export const like = action({ input: { postId: integer() }, access: "anyone", async handler({ postId }) { return postId + 100; } });

// A kind anyone may read and write, so a browser test can add a row as another visitor and watch
// a `useLive` list pick it up.
export const guestbook = table({ name: text() }, { access: { read: "anyone", create: "anyone", update: "admin", delete: "admin" } });
