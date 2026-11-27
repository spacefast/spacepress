import { collection, f, global, table } from "spacepress";

export const articles = collection({
  title: f.text(),
  body: f.richText().optional(),
  rating: f.integer().optional(),
  // Stored by Secure Custom Fields as `sp_seo`, `sp_seo_title`, and for each link row
  // `sp_links`, `sp_links_<n>_href`: names a runtime field must not take.
  seo: f.group({ title: f.text().optional() }).optional(),
  links: f.repeater({ href: f.text() }).optional(),
  // Flexible content also keeps a record of its layouts under `_sp_page_layout_meta`.
  page: f.blocks({ hero: { heading: f.text().optional() } }).optional(),
});

export const votes = table({ article: f.integer(), weight: f.integer().default(1) });

// Stored as the options `sp_global_site_<field>`: a runtime global must not overlap them.
export const site = global({ meta_title: f.text().optional() });
