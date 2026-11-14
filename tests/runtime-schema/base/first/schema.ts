import { collection, table, global, text, integer, richText, group, repeater } from "first";

export const articles = collection({
  title: text(),
  body: richText().optional(),
  rating: integer().optional(),
  // Stored by Secure Custom Fields as `first_seo`, `first_seo_title`, and for each link row
  // `first_links`, `first_links_<n>_href`: names a runtime field must not take.
  seo: group({ title: text().optional() }).optional(),
  links: repeater({ href: text() }).optional(),
});

export const votes = table({ article: integer(), weight: integer().default(1) });

// Stored as the options `first_global_site_<field>`: a runtime global must not overlap them.
export const site = global({ meta_title: text().optional() });
