import { integer, text } from "spacepress";
import { Search, SearchResults, type PageProps } from "spacepress/app";

export const search = { q: text().optional(), page: integer().default(1) };

// Every kind with a URL.
export default function Find({ search }: PageProps) {
  return (
    <main>
      <Search />
      <SearchResults q={search.q} perPage={2} />
    </main>
  );
}
