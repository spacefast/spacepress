import { collection, media, ref, select, taxonomy, terms, text } from "typedpress";

export const authors = collection({ title: text() });

export const posts = collection(
  { title: text(), labels: terms(() => tags).reverse("labelled") },
  { url: "/notes/:topics.slug/:slug" },
);

export const pages = collection(
  { title: text(), secret: text().optional() },
  { access: { read: "editor", create: "author", update: "author" } },
);

export const topics = taxonomy(
  {
    color: text().optional(),
    icon: media().optional(),
    owner: ref(authors).optional(),
    shades: select(["light", "dark"]).many().optional(),
    note: text().optional().access({ read: "editor" }),
  },
  { hierarchical: true, url: "/topics/:path", on: [posts, pages], access: { create: "author" } },
);

export const tags = taxonomy({}, { url: "/tags/:slug" });
