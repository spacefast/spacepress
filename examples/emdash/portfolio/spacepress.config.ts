import { collection, defineConfig, global, f } from "spacepress";

const editorial = { read: "anyone", create: "editor", update: "editor", delete: "editor" };
const disciplines = ["identity", "editorial", "packaging", "digital", "spatial", "art-direction"];

export const projects = collection({
  title: f.text().min(1).max(160),
  slug: f.slug({ source: "title" }).optional(),
  summary: f.text({ multiline: true }).max(200).optional(),
  client: f.text().max(160).optional(),
  year: f.text().max(40).optional(),
  website: f.url().optional(),
  featured: f.boolean().default(false),
  cover: f.media({ accept: "image" }).optional(),
  tags: f.select(disciplines).many().default([]),
  body: f.richText().optional(),
  gallery: f.repeater({
    image: f.media({ accept: "image" }),
    caption: f.text().max(240).optional(),
  }).max(24).optional(),
  seo: f.group({
    title: f.text().max(160).optional(), description: f.text().max(300).optional(), noindex: f.boolean().default(false),
  }).optional(),
}, { label: "Projects", title: "title", content: "body", access: editorial });

export const pages = collection({
  title: f.text().max(160),
  slug: f.slug({ source: "title" }).optional(),
  body: f.richText().optional(),
  layout: f.blocks({
    statement: { text: f.text({ multiline: true }).max(160), label: f.text().max(40).optional() },
    selectedWork: { heading: f.text().max(40) },
    clients: {
      heading: f.text().max(40),
      clients: f.repeater({ name: f.text().max(160) }).min(1).max(40).optional(),
    },
    contact: {
      heading: f.text().max(80), label: f.text().max(40).optional(),
      intro: f.text({ multiline: true }).max(400).optional(), email: f.email(), emailLabel: f.text().max(40).optional(),
      details: f.repeater({
        label: f.text().max(80), text: f.text().max(240), note: f.text().max(240).optional(),
      }).max(6).optional(),
    },
  }).max(20).optional(),
  seo: f.group({ title: f.text().max(160).optional(), description: f.text().max(300).optional(), noindex: f.boolean().default(false) }).optional(),
}, { label: "Portfolio pages", title: "title", content: "body", access: editorial });

export const settings = global({
  title: f.text().default("Norma").max(80),
  tagline: f.text({ multiline: true }).max(400).optional(),
  logo: f.media({ accept: "image" }).optional(),
  separator: f.text().default("—").max(8),
  social: f.group({
    twitter: f.text().max(240).optional(), github: f.text().max(240).optional(), facebook: f.text().max(240).optional(),
    instagram: f.text().max(240).optional(), linkedin: f.text().max(240).optional(), youtube: f.text().max(240).optional(),
  }).optional(),
  navigation: f.repeater({ label: f.text().max(80), href: f.text().max(300) }).max(20).optional(),
  footer: f.repeater({ label: f.text().max(80), href: f.text().max(300) }).max(20).optional(),
}, { label: "Portfolio settings", access: { read: "anyone", update: "editor" } });

export default defineConfig({
  name: "portfolio",
  media: { sizes: { card: { width: 960, height: 720, fit: "cover" } } },
});
