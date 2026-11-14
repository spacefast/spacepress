import { integer, text } from "first";
import { Pagination, type PageProps } from "first/app";

export const search = { page: integer().default(1), q: text().optional() };
export const metadata = { title: "Notes", robots: { index: false } };

export default function Notes({ search }: PageProps) {
  return (
    <section>
      <p className="search">page {search.page} q {search.q ?? "none"}</p>
      <Pagination page={search.page} pages={12} />
    </section>
  );
}
