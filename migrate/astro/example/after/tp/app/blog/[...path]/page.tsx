// Was src/pages/blog/[...slug].astro: the kind's url (/blog/:path) hands the page its post, so
// there is no getStaticPaths(). The <Likes client:load> island is a "use client" component.
import { Content, type PageProps } from "typedpress/app";
import { Likes } from "../../../components/Likes";

export const metadata = ({ item }: PageProps<"blog/[...path]">) => ({ title: item.title, description: item.description });

export default function Post({ item }: PageProps<"blog/[...path]">) {
  return (
    <article>
      <h1>{item.title}</h1>
      {item.heroImage && <img src={item.heroImage} alt="" />}
      <Content value={item.body} />
      <Likes initial={0} />
    </article>
  );
}
