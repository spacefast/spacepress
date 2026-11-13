import { collection, table, text, integer, richText } from "first";

export const articles = collection({
  title: text(),
  body: richText().optional(),
  rating: integer().optional(),
});

export const votes = table({ article: integer(), weight: integer().default(1) });
