import { integer, text } from "first";
import type { PageProps } from "first/app";

export const search = { page: integer().default(1), q: text().optional() };
export const metadata = { title: "Notes", robots: { index: false } };

export default function Notes({ search }: PageProps) {
  return <p className="search">page {search.page} q {search.q ?? "none"}</p>;
}
