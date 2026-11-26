import type { PageProps } from "spacepress/server/app";
import { Cheer } from "../../../components/Cheer";

export const metadata = ({ item }: PageProps<"notes/[slug]">) => ({ title: item.title });

export default function Note({ item }: PageProps<"notes/[slug]">) {
  return <article className="note"><h1>{item.title}</h1><Cheer noteId={item.id} /></article>;
}
