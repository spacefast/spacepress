// `<Search>` and `<SearchResults>` (docs/decisions/2026-11-14-search.md): a kind with a URL and a
// field hidden from visitors, a kind without a URL, and pages that search one kind and every kind
// (tests/app_router.rs `search_pages_answer_as_the_visitor`).
import { defineConfig } from "spacepress";

export default defineConfig({ name: "searchy" });
