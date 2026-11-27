// Content model adapted from EmDash's MIT-licensed marketing seed; see NOTICE and LICENSE-MIT.
import { defineConfig, collection, global, f } from "spacepress";

export const pages = collection(
  {
    title: f.text().min(1),
    slug: f.slug({ source: "title" }).optional(),
    seo: f.group({
        title: f.text().max(160).optional(),
        description: f.text({ multiline: true }).max(500).optional(),
        image: f.media({ accept: "image" }).optional(),
        noindex: f.boolean().default(false),
      }).optional(),
    sections: f.blocks({
        hero: {
          headline: f.text().min(1),
          subheadline: f.text({ multiline: true }).optional(),
          primary_cta_label: f.text().optional(),
          primary_cta_url: f.text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ).optional(),
          secondary_cta_label: f.text().optional(),
          secondary_cta_url: f.text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ).optional(),
          image: f.media({ accept: "image" }).optional(),
          image_caption: f.text().optional(),
          eyebrow: f.text().optional(),
          eyebrow_url: f.text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ).optional(),
          centered: f.boolean().default(false),
          anchor_id: f.text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        features: {
          headline: f.text().min(1),
          subheadline: f.text({ multiline: true }).optional(),
          eyebrow: f.text().optional(),
          features: f.repeater({
              icon: f.select([
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
              title: f.text().min(1),
              description: f.text({ multiline: true }).min(1),
            }).min(1).max(12),
          anchor_id: f.text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        testimonials: {
          headline: f.text().optional(),
          testimonials: f.repeater({
              quote: f.text({ multiline: true }).min(1),
              author: f.text().min(1),
              role: f.text().optional(),
              company: f.text().optional(),
              avatar: f.media({ accept: "image" }).optional(),
            }).min(1).max(12),
          anchor_id: f.text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        pricing: {
          headline: f.text().optional(),
          plans: f.repeater({
              name: f.text().min(1),
              price: f.text().min(1),
              period: f.text().optional(),
              description: f.text({ multiline: true }).optional(),
              features: f.text({ multiline: true }).optional(),
              cta_label: f.text().min(1),
              cta_url: f.text().pattern(
                  /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
                ).min(1),
              highlighted: f.boolean().default(false),
              badge: f.text().optional(),
            }).min(1).max(3),
          anchor_id: f.text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        faq: {
          headline: f.text().optional(),
          subheadline: f.text({ multiline: true }).optional(),
          items: f.repeater({
              question: f.text().min(1),
              answer: f.text({ multiline: true }).min(1),
            }).min(1).max(12),
          anchor_id: f.text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        logos: {
          headline: f.text().optional(),
          logos: f.repeater({
              name: f.text().min(1),
              logo: f.media({ accept: "image" }).optional(),
            }).min(1).max(24),
          anchor_id: f.text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        split: {
          headline: f.text().min(1),
          eyebrow: f.text().optional(),
          body: f.text({ multiline: true }).optional(),
          points: f.text({ multiline: true }).optional(),
          cta_label: f.text().optional(),
          cta_url: f.text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ).optional(),
          image: f.media({ accept: "image" }).optional(),
          image_caption: f.text().optional(),
          image_first: f.boolean().default(false),
          anchor_id: f.text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        stats: {
          headline: f.text().optional(),
          subheadline: f.text({ multiline: true }).optional(),
          stats: f.repeater({
              value: f.text().min(1),
              label: f.text().min(1),
            }).min(1).max(6),
          anchor_id: f.text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        cta: {
          headline: f.text().min(1),
          body: f.text({ multiline: true }).optional(),
          primary_cta_label: f.text().optional(),
          primary_cta_url: f.text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ).optional(),
          secondary_cta_label: f.text().optional(),
          secondary_cta_url: f.text().pattern(
            /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
          ).optional(),
          image: f.media({ accept: "image" }).optional(),
          anchor_id: f.text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        contact: {
          headline: f.text().optional(),
          eyebrow: f.text().optional(),
          subheadline: f.text({ multiline: true }).optional(),
          options: f.repeater({
              icon: f.select([
                  "email",
                  "support",
                  "sales",
                  "phone",
                  "chat",
                  "location",
                ]),
              title: f.text().min(1),
              description: f.text({ multiline: true }).optional(),
              link_label: f.text().min(1),
              link_url: f.text().pattern(
                  /^(?:$|\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/,
                ),
            }).min(1).max(6),
          anchor_id: f.text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
        },
        text: {
          headline: f.text().optional(),
          body: f.richText().min(1),
          anchor_id: f.text().pattern(/^(?:$|[a-z][a-z0-9_-]*)$/).optional(),
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
  label: f.text().min(1).max(80),
  href: f.text().pattern(/^(?:\/(?![\/\\])[^\s]*|(?:https?:\/\/|mailto:|tel:|#)[^\s]+)$/),
};
export const site = global(
  {
    identity: f.group({
        title: f.text().default("My Site").max(80),
        tagline: f.text().max(240).optional(),
        logo: f.media({ accept: "image" }).optional(),
      }).optional(),
    seo: f.group({ titleSeparator: f.text().default("—").max(8).optional() }).optional(),
    navigation: f.repeater({ ...link, button: f.boolean().default(false) }).max(24).optional(),
    footer: f.repeater({
        heading: f.text().min(1),
        links: f.repeater(link).max(12).optional(),
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
});
