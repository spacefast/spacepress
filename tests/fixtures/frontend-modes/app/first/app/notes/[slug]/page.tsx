import { Content, type PageProps } from "first/app";

export const metadata = ({ item }: PageProps<"notes/[slug]">) => ({ title: item.title });

export default function Note({ item }: PageProps<"notes/[slug]">) {
  return (
    <article className="app-note">
      <h1>{item.title}</h1>
      <Content value={item.body} />
    </article>
  );
}
