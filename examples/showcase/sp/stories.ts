import { collection, f } from "spacepress";

export const stories = collection(
  {
    title: f.text().min(1).max(120),
    body: f.richText().optional(),
    cover: f.media({ accept: "image" }).optional(),
    details: f.group({ subtitle: f.text().optional(), featured: f.boolean().default(false).optional() }).optional(),
    links: f.repeater({ label: f.text(), href: f.text() }).optional(),
    sections: f.blocks({
        quote: { text: f.text(), cite: f.text().optional() },
        callout: { heading: f.text(), body: f.text().optional() },
      }).optional(),
    metadata: f.json().optional(),
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
