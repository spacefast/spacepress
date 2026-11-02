import {
  blocks,
  boolean,
  collection,
  group,
  json,
  media,
  repeater,
  richText,
  text,
} from "zero";

export const stories = collection(
  {
    title: text().notNull().min(1).max(120),
    body: richText(),
    cover: media({ accept: "image" }),
    details: group({
      fields: { subtitle: text(), featured: boolean().default(false) },
    }),
    links: repeater({
      fields: { label: text().notNull(), href: text().notNull() },
    }),
    sections: blocks({
      layouts: {
        quote: { text: text().notNull(), cite: text() },
        callout: { heading: text().notNull(), body: text() },
      },
    }),
    metadata: json(),
  },
  {
    title: "title",
    content: "body",
    label: "Stories",
    access: {
      read: "anyone",
      create: "editor",
      update: "editor",
      delete: "editor",
    },
  },
);
