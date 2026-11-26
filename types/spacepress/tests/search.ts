// <Search> and <SearchResults> (docs/pages.md, "Search"): the form and the results list.
import { Search, SearchResults } from "spacepress/server/app";

export const form = Search({});
export const labelled = Search({ action: "/find", label: "Search workshops", placeholder: "bread", className: "search" });
// @ts-expect-error the form's field is always `q`: it has no `name` to set
export const renamed = Search({ name: "s" });
// @ts-expect-error a label is text
export const numbered = Search({ label: 3 });

// `q` comes from the page's `search` export, so it may be absent.
declare const query: string | undefined;
export const everywhere = SearchResults({ q: query });
export const oneKind = SearchResults({ kind: "events", q: "bread", page: 2, perPage: 20, className: "results" });
export const empty = SearchResults({ q: null });
// @ts-expect-error the results need the query, even an absent one
export const noQuery = SearchResults({ kind: "events" });
// @ts-expect-error a page is a number
export const wrongPage = SearchResults({ q: "bread", page: "2" });
// @ts-expect-error the kind is its name, not the kind
export const wrongKind = SearchResults({ q: "bread", kind: { name: "events" } });

// `.searchable()` on a collection's text fields: which fields `search` matches.
import { collection, email, integer, richText, text } from "spacepress";

export const recipes = collection({
  title: text(),
  intro: richText().searchable(),
  author: email().searchable(),
  internalNotes: text().optional().searchable(false),
  servings: integer(),
});
export const explicitOn = text().searchable(true);
// @ts-expect-error a number isn't searched: filter it with `where`
export const countSearch = integer().searchable();
// @ts-expect-error the flag is a boolean
export const wrongFlag = text().searchable("yes");
