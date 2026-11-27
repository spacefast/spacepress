import { f } from "spacepress";
import { Search, SearchResults, type PageProps } from "spacepress/app";

export const search = { q: f.text().optional(), page: f.integer().default(1) };

// One kind, paged by <Pagination>'s own parameter.
export default function NotesSearch({ search }: PageProps) {
  return (
    <main>
      <Search label="Search notes" />
      <SearchResults kind="notes" q={search.q} page={search.page} perPage={2} />
    </main>
  );
}
