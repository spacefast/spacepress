// Only published drives can appear in the storefront. Apply filters before the price-ordered limit.
import type { InferSelectModel } from "typedpress";
import { drives } from "typedpress:db";
import { CONDITIONS, MEDIA, drives as driveCollection } from "../schema";

type Drive = InferSelectModel<typeof driveCollection>;

export async function catalog(q: string, media: string, condition: string) {
  const where: { status: "published"; media?: Drive["media"]; condition?: Drive["condition"] } = { status: "published" };
  if (media !== "") {
    const value = media as Drive["media"];
    if (!MEDIA.includes(value)) return [];
    where.media = value;
  }
  if (condition !== "") {
    const value = condition as Drive["condition"];
    if (!CONDITIONS.includes(value)) return [];
    where.condition = value;
  }
  return await drives.list({
    where,
    search: q,
    orderBy: { price: "asc" },
    limit: 100,
    columns: {
      name: true, slug: true, summary: true, brand: true, model: true, capacityGb: true,
      media: true, price: true, condition: true, stock: true,
    },
  });
}
