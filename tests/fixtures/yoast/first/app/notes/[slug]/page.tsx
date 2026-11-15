import { Content, type PageProps } from "first/app";

export const metadata = ({ item }: PageProps<"notes/[slug]">) => {
  if (item.slug === "editor" || item.slug === "defaults") return { openGraph: { type: "article" } };
  return {
    title: item.title,
    description: item.secret ?? item.dek,
    canonical: `/notes/${item.slug}`,
    openGraph: { type: "article", title: item.slug === "explicit" ? "Code social title" : undefined, description: item.slug === "explicit" ? "Code social description" : undefined },
    robots: item.slug === "noindex" ? { index: false } : item.slug === "robots" ? { index: true, follow: true } : undefined,
  };
};
export default function Note({ item }: PageProps<"notes/[slug]">) {
  return <article><h1>{item.title}</h1><Content value={item.body} /></article>;
}
