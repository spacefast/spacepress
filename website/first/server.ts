import { action, json, text, HttpError } from "first";
import { shares } from "first:db";

// Saves a playground edit and answers with its key; /play?s=<key> opens it. Only the files the
// visitor changed are stored, and at most 200 KB of them.
export const share = action({
  access: "anyone",
  input: { example: text().max(40), files: json() },
  async handler({ example, files }) {
    const size = (JSON.stringify(files) ?? "").length;
    if (size > 200_000) throw new HttpError(413, "too_large", "That edit is too large to share: the limit is 200 KB.");
    const key = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
    await shares.system.create({ key, example, files });
    return { key };
  },
});
