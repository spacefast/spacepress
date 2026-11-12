import { action, integer } from "first";

export const like = action({ input: { postId: integer() }, access: "anyone", async handler({ postId }) { return postId + 100; } });
