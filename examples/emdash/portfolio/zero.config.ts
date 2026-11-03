import {
  boolean, collection, defineConfig, email, global, group, media,
  repeater, richText, select, slug, text, url, blocks,
} from "zero";

const editorial = { read: "anyone", create: "editor", update: "editor", delete: "editor" };
const disciplines = ["identity", "editorial", "packaging", "digital", "spatial", "art-direction"];

export const projects = collection({
  title: text().notNull().min(1).max(160),
  slug: slug({ source: "title" }),
  summary: text({ multiline: true }).max(200),
  client: text().max(160),
  year: text().max(40),
  website: url(),
  featured: boolean().notNull().default(false),
  cover: media({ accept: "image" }),
  tags: select({ options: disciplines, multiple: true }).notNull().default([]),
  body: richText(),
  gallery: repeater({ fields: {
    image: media({ accept: "image" }).notNull(),
    caption: text().max(240),
  } }).max(24),
  seo: group({ fields: {
    title: text().max(160), description: text().max(300), noindex: boolean().notNull().default(false),
  } }),
}, { label: "Projects", title: "title", content: "body", access: editorial });

export const pages = collection({
  title: text().notNull().max(160),
  slug: slug({ source: "title" }),
  body: richText(),
  layout: blocks({ layouts: {
    statement: { text: text({ multiline: true }).notNull().max(160), label: text().max(40) },
    selectedWork: { heading: text().notNull().max(40) },
    clients: {
      heading: text().notNull().max(40),
      clients: repeater({ fields: { name: text().notNull().max(160) } }).min(1).max(40),
    },
    contact: {
      heading: text().notNull().max(80), label: text().max(40),
      intro: text({ multiline: true }).max(400), email: email().notNull(), emailLabel: text().max(40),
      details: repeater({ fields: {
        label: text().notNull().max(80), text: text().notNull().max(240), note: text().max(240),
      } }).max(6),
    },
  } }).max(20),
  seo: group({ fields: { title: text().max(160), description: text().max(300), noindex: boolean().notNull().default(false) } }),
}, { label: "Portfolio pages", title: "title", content: "body", access: editorial });

export const settings = global("settings", {
  title: text().notNull().default("Norma").max(80),
  tagline: text({ multiline: true }).max(400),
  logo: media({ accept: "image" }),
  separator: text().notNull().default("—").max(8),
  social: group({ fields: {
    twitter: text().max(240), github: text().max(240), facebook: text().max(240),
    instagram: text().max(240), linkedin: text().max(240), youtube: text().max(240),
  } }),
  navigation: repeater({ fields: { label: text().notNull().max(80), href: text().notNull().max(300) } }).max(20),
  footer: repeater({ fields: { label: text().notNull().max(80), href: text().notNull().max(300) } }).max(20),
}, { label: "Portfolio settings", access: { read: "anyone", update: "editor" } });

export default defineConfig({
  name: "portfolio", admin: true,
  collections: { projects, pages }, globals: { settings },
  media: { sizes: { card: { width: 960, height: 720, fit: "cover" } } },
});
