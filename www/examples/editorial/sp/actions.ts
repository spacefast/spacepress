import { mutation, HttpError } from "spacepress";
import { articles, claps } from "spacepress:db";

export const clap = mutation({ access: "anyone" }, async ({ articleId }: { articleId: number }) => {
  const article = await articles.get(articleId);
  if (!article) throw new HttpError(404, "not_found", "Article not found");
  const existing = await claps.system.get({ articleId });
  if (existing) {
    const updated = await claps.system.update(existing.id, { count: existing.count + 1 });
    return { count: updated.count };
  }
  const created = await claps.system.create({ articleId, count: 1 });
  return { count: created.count };
});
