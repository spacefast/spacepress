import { action, integer } from "first";

export const like = action({ input: { postId: integer().notNull() }, access: "anyone", async handler({ postId }) { return postId + 100; } });
