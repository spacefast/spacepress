import { type PageProps } from "first/app";
export const metadata = ({ item }: PageProps<"masked/[slug]">) => ({ title: item.title, openGraph: { type: "article" } });
export default function Masked() { return <h1>Public part</h1>; }
