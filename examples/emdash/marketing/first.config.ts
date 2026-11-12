// Content model adapted from EmDash's MIT-licensed marketing seed; see NOTICE and LICENSE-MIT.
import {
  defineConfig,
  collection,
  global,
  text,
  slug,
  boolean,
  media,
  richText,
  group,
  repeater,
  blocks,
  select,
} from "first";

export const pages = collection(
  {
    title: text().min(1),
    slug: slug({ source: "title" }).optional(),
    seo: group({
        title: text().max(160).optional(),
        description: text({ multiline: true }).max(500).optional(),
        image: media({ accept: "image" }).optional(),
        noindex: boolean().default(false),
      }).optional(),
    sections: blocks({
        hero: {
          headline: text().min(1),
          subheadline: text({ multiline: true }).optional(),
          primary_cta_label: text().optional(),
          primary_cta_url: text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ).optional(),
          secondary_cta_label: text().optional(),
          secondary_cta_url: text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ).optional(),
          image: media({ accept: "image" }).optional(),
          image_caption: text().optional(),
          eyebrow: text().optional(),
          eyebrow_url: text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ).optional(),
          centered: boolean().default(false),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        features: {
          headline: text().min(1),
          subheadline: text({ multiline: true }).optional(),
          eyebrow: text().optional(),
          features: repeater({
              icon: select([
                  "zap",
                  "shield",
                  "users",
                  "chart",
                  "code",
                  "globe",
                  "heart",
                  "star",
                  "check",
                  "lock",
                  "clock",
                  "cloud",
                  "building",
                  "leaf",
                  "gauge",
                  "thermometer",
                  "plug",
                  "bell",
                  "file",
                  "sun",
                  "trend",
                ]),
              title: text().min(1),
              description: text({ multiline: true }).min(1),
            }).min(1).max(12),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        testimonials: {
          headline: text().optional(),
          testimonials: repeater({
              quote: text({ multiline: true }).min(1),
              author: text().min(1),
              role: text().optional(),
              company: text().optional(),
              avatar: media({ accept: "image" }).optional(),
            }).min(1).max(12),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        pricing: {
          headline: text().optional(),
          plans: repeater({
              name: text().min(1),
              price: text().min(1),
              period: text().optional(),
              description: text({ multiline: true }).optional(),
              features: text({ multiline: true }).optional(),
              cta_label: text().min(1),
              cta_url: text().pattern(
                  /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
                ).min(1),
              highlighted: boolean().default(false),
              badge: text().optional(),
            }).min(1).max(3),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        faq: {
          headline: text().optional(),
          subheadline: text({ multiline: true }).optional(),
          items: repeater({
              question: text().min(1),
              answer: text({ multiline: true }).min(1),
            }).min(1).max(12),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        logos: {
          headline: text().optional(),
          logos: repeater({
              name: text().min(1),
              logo: media({ accept: "image" }).optional(),
            }).min(1).max(24),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        split: {
          headline: text().min(1),
          eyebrow: text().optional(),
          body: text({ multiline: true }).optional(),
          points: text({ multiline: true }).optional(),
          cta_label: text().optional(),
          cta_url: text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ).optional(),
          image: media({ accept: "image" }).optional(),
          image_caption: text().optional(),
          image_first: boolean().default(false),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        stats: {
          headline: text().optional(),
          subheadline: text({ multiline: true }).optional(),
          stats: repeater({
              value: text().min(1),
              label: text().min(1),
            }).min(1).max(6),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        cta: {
          headline: text().min(1),
          body: text({ multiline: true }).optional(),
          primary_cta_label: text().optional(),
          primary_cta_url: text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ).optional(),
          secondary_cta_label: text().optional(),
          secondary_cta_url: text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ).optional(),
          image: media({ accept: "image" }).optional(),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        contact: {
          headline: text().optional(),
          eyebrow: text().optional(),
          subheadline: text({ multiline: true }).optional(),
          options: repeater({
              icon: select([
                  "email",
                  "support",
                  "sales",
                  "phone",
                  "chat",
                  "location",
                ]),
              title: text().min(1),
              description: text({ multiline: true }).optional(),
              link_label: text().min(1),
              link_url: text().pattern(
                  /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
                ),
            }).min(1).max(6),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        text: {
          headline: text().optional(),
          body: richText().min(1),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
      }).max(20).optional(),
  },
  {
    label: "Marketing pages",
    title: "title",
    access: {
      read: (ctx) =>
        ["editor", "admin"].includes(ctx.user?.role ?? "")
          ? true
          : { status: "published" },
      create: "editor",
      update: "editor",
      delete: "editor",
    },
  },
);

const link = {
  label: text().min(1).max(80),
  href: text().pattern(/^(?:\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/),
};
export const site = global(
  "site",
  {
    identity: group({
        title: text().default("My Site").max(80),
        tagline: text().max(240).optional(),
        logo: media({ accept: "image" }).optional(),
      }).optional(),
    seo: group({ titleSeparator: text().default("—").max(8).optional() }).optional(),
    navigation: repeater({ ...link, button: boolean().default(false) }).max(24).optional(),
    footer: repeater({
        heading: text().min(1),
        links: repeater(link).max(12).optional(),
      }).max(6).optional(),
  },
  {
    label: "Site identity and navigation",
    access: { read: "anyone", update: "editor" },
  },
);

// Keep WordPress's full admin, plugins, settings, media library and SCF options screens.
export default defineConfig({
  name: "emdash-marketing",
  collections: { pages },
  globals: { site },
});
