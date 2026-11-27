import { collection, taxonomy, f } from "spacepress";

export const authors = collection({ title: f.text() });

export const posts = collection(
  { title: f.text(), labels: f.terms(() => tags).reverse("labelled") },
);

export const pages = collection(
  { title: f.text(), secret: f.text().optional() },
  { access: { read: "editor", create: "author", update: "author" } },
);

export const topics = taxonomy(
  {
    color: f.text().optional(),
    icon: f.media().optional(),
    owner: f.ref(authors).optional(),
    shades: f.select(["light", "dark"]).many().optional(),
    note: f.text().optional().access({ read: "editor" }),
  },
  { hierarchical: true, on: [posts, pages], access: { create: "author" } },
);

export const tags = taxonomy({});
