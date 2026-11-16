import { integer, text } from "typedpress";
import { Search, SearchResults, type PageProps } from "typedpress/app";

export const search = { q: text().optional(), page: integer().default(1) };

// One kind, paged by <Pagination>'s own parameter.
export default function NotesSearch({ search }: PageProps) {
  return (
    <main>
      <Search label="Search notes" />
      <SearchResults kind="notes" q={search.q} page={search.page} perPage={2} />
    </main>
  );
}
