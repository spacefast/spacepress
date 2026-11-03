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
} from "zero";

export const pages = collection(
  {
    title: text().notNull().min(1),
    slug: slug({ source: "title" }),
    seo: group({
      fields: {
        title: text().max(160),
        description: text({ multiline: true }).max(500),
        image: media({ accept: "image" }),
        noindex: boolean().notNull().default(false),
      },
    }),
    sections: blocks({
      layouts: {
        hero: {
          headline: text().notNull().min(1),
          subheadline: text({ multiline: true }),
          primary_cta_label: text(),
          primary_cta_url: text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ),
          secondary_cta_label: text(),
          secondary_cta_url: text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ),
          image: media({ accept: "image" }),
          image_caption: text(),
          eyebrow: text(),
          eyebrow_url: text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ),
          centered: boolean().notNull().default(false),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/),
        },
        features: {
          headline: text().notNull().min(1),
          subheadline: text({ multiline: true }),
          eyebrow: text(),
          features: repeater({
            fields: {
              icon: select({
                options: [
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
                ],
              }).notNull(),
              title: text().notNull().min(1),
              description: text({ multiline: true }).notNull().min(1),
            },
          })
            .notNull()
            .min(1)
            .max(12),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/),
        },
        testimonials: {
          headline: text(),
          testimonials: repeater({
            fields: {
              quote: text({ multiline: true }).notNull().min(1),
              author: text().notNull().min(1),
              role: text(),
              company: text(),
              avatar: media({ accept: "image" }),
            },
          })
            .notNull()
            .min(1)
            .max(12),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/),
        },
        pricing: {
          headline: text(),
          plans: repeater({
            fields: {
              name: text().notNull().min(1),
              price: text().notNull().min(1),
              period: text(),
              description: text({ multiline: true }),
              features: text({ multiline: true }),
              cta_label: text().notNull().min(1),
              cta_url: text()
                .pattern(
                  /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
                )
                .notNull()
                .min(1),
              highlighted: boolean().notNull().default(false),
              badge: text(),
            },
          })
            .notNull()
            .min(1)
            .max(3),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/),
        },
        faq: {
          headline: text(),
          subheadline: text({ multiline: true }),
          items: repeater({
            fields: {
              question: text().notNull().min(1),
              answer: text({ multiline: true }).notNull().min(1),
            },
          })
            .notNull()
            .min(1)
            .max(12),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/),
        },
        logos: {
          headline: text(),
          logos: repeater({
            fields: {
              name: text().notNull().min(1),
              logo: media({ accept: "image" }),
            },
          })
            .notNull()
            .min(1)
            .max(24),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/),
        },
        split: {
          headline: text().notNull().min(1),
          eyebrow: text(),
          body: text({ multiline: true }),
          points: text({ multiline: true }),
          cta_label: text(),
          cta_url: text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ),
          image: media({ accept: "image" }),
          image_caption: text(),
          image_first: boolean().notNull().default(false),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/),
        },
        stats: {
          headline: text(),
          subheadline: text({ multiline: true }),
          stats: repeater({
            fields: {
              value: text().notNull().min(1),
              label: text().notNull().min(1),
            },
          })
            .notNull()
            .min(1)
            .max(6),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/),
        },
        cta: {
          headline: text().notNull().min(1),
          body: text({ multiline: true }),
          primary_cta_label: text(),
          primary_cta_url: text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ),
          secondary_cta_label: text(),
          secondary_cta_url: text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ),
          image: media({ accept: "image" }),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/),
        },
        contact: {
          headline: text(),
          eyebrow: text(),
          subheadline: text({ multiline: true }),
          options: repeater({
            fields: {
              icon: select({
                options: [
                  "email",
                  "support",
                  "sales",
                  "phone",
                  "chat",
                  "location",
                ],
              }).notNull(),
              title: text().notNull().min(1),
              description: text({ multiline: true }),
              link_label: text().notNull().min(1),
              link_url: text()
                .pattern(
                  /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
                )
                .notNull(),
            },
          })
            .notNull()
            .min(1)
            .max(6),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/),
        },
        text: {
          headline: text(),
          body: richText().notNull().min(1),
          anchor_id: text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/),
        },
      },
    }).max(20),
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
  label: text().notNull().min(1).max(80),
  href: text()
    .notNull()
    .pattern(/^(?:\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/),
};
export const site = global(
  "site",
  {
    identity: group({
      fields: {
        title: text().notNull().default("My Site").max(80),
        tagline: text().max(240),
        logo: media({ accept: "image" }),
      },
    }),
    seo: group({ fields: { titleSeparator: text().default("—").max(8) } }),
    navigation: repeater({
      fields: { ...link, button: boolean().notNull().default(false) },
    }).max(24),
    footer: repeater({
      fields: {
        heading: text().notNull().min(1),
        links: repeater({ fields: link }).max(12),
      },
    }).max(6),
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
