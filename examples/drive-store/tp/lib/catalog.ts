import type { InferSelectModel } from "typedpress";
import { drives } from "typedpress:db";
import { drives as driveKind } from "../schema";

type Drive = InferSelectModel<typeof driveKind>;

export async function catalog(q: string, media: Drive["media"], condition: Drive["condition"]) {
  const where: {
    status: "published";
    media?: NonNullable<Drive["media"]>;
    condition?: NonNullable<Drive["condition"]>;
    OR?: { name?: { like: string }; model?: { like: string }; brand?: { like: string }; description?: { like: string } }[];
  } = { status: "published" };
  if (media) where.media = media;
  if (condition) where.condition = condition;
  if (q) {
    const term = { like: `%${q}%` };
    where.OR = [{ name: term }, { model: term }, { brand: term }, { description: term }];
  }
  return await drives.list({
    where,
    orderBy: { price: "asc" },
    limit: 100,
    columns: {
      name: true, slug: true, shortDescription: true, brand: true, model: true, capacityGb: true,
      media: true, price: true, condition: true, availability: true, stockQuantity: true,
    },
  });
}
