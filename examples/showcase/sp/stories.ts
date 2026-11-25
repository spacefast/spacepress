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
} from "spacepress";

export const stories = collection(
  {
    title: text().min(1).max(120),
    body: richText().optional(),
    cover: media({ accept: "image" }).optional(),
    details: group({ subtitle: text().optional(), featured: boolean().default(false).optional() }).optional(),
    links: repeater({ label: text(), href: text() }).optional(),
    sections: blocks({
        quote: { text: text(), cite: text().optional() },
        callout: { heading: text(), body: text().optional() },
      }).optional(),
    metadata: json().optional(),
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
