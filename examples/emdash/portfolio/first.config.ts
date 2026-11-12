import {
  boolean, collection, defineConfig, email, global, group, media,
  repeater, richText, select, slug, text, url, blocks,
} from "first";

const editorial = { read: "anyone", create: "editor", update: "editor", delete: "editor" };
const disciplines = ["identity", "editorial", "packaging", "digital", "spatial", "art-direction"];

export const projects = collection({
  title: text().min(1).max(160),
  slug: slug({ source: "title" }).optional(),
  summary: text({ multiline: true }).max(200).optional(),
  client: text().max(160).optional(),
  year: text().max(40).optional(),
  website: url().optional(),
  featured: boolean().default(false),
  cover: media({ accept: "image" }).optional(),
  tags: select(disciplines).many().default([]),
  body: richText().optional(),
  gallery: repeater({
    image: media({ accept: "image" }),
    caption: text().max(240).optional(),
  }).max(24).optional(),
  seo: group({
    title: text().max(160).optional(), description: text().max(300).optional(), noindex: boolean().default(false),
  }).optional(),
}, { label: "Projects", title: "title", content: "body", access: editorial });

export const pages = collection({
  title: text().max(160),
  slug: slug({ source: "title" }).optional(),
  body: richText().optional(),
  layout: blocks({
    statement: { text: text({ multiline: true }).max(160), label: text().max(40).optional() },
    selectedWork: { heading: text().max(40) },
    clients: {
      heading: text().max(40),
      clients: repeater({ name: text().max(160) }).min(1).max(40).optional(),
    },
    contact: {
      heading: text().max(80), label: text().max(40).optional(),
      intro: text({ multiline: true }).max(400).optional(), email: email(), emailLabel: text().max(40).optional(),
      details: repeater({
        label: text().max(80), text: text().max(240), note: text().max(240).optional(),
      }).max(6).optional(),
    },
  }).max(20).optional(),
  seo: group({ title: text().max(160).optional(), description: text().max(300).optional(), noindex: boolean().default(false) }).optional(),
}, { label: "Portfolio pages", title: "title", content: "body", access: editorial });

export const settings = global("settings", {
  title: text().default("Norma").max(80),
  tagline: text({ multiline: true }).max(400).optional(),
  logo: media({ accept: "image" }).optional(),
  separator: text().default("—").max(8),
  social: group({
    twitter: text().max(240).optional(), github: text().max(240).optional(), facebook: text().max(240).optional(),
    instagram: text().max(240).optional(), linkedin: text().max(240).optional(), youtube: text().max(240).optional(),
  }).optional(),
  navigation: repeater({ label: text().max(80), href: text().max(300) }).max(20).optional(),
  footer: repeater({ label: text().max(80), href: text().max(300) }).max(20).optional(),
}, { label: "Portfolio settings", access: { read: "anyone", update: "editor" } });

export default defineConfig({
  name: "portfolio", admin: true,
  collections: { projects, pages }, globals: { settings },
  media: { sizes: { card: { width: 960, height: 720, fit: "cover" } } },
});
