// Every read a first/app/ page can make runs as the visitor (issue #311): a collection whose own
// read rule hides drafts from non-staff, listed by a page, a layout, the "spacepress/server/db" kind API, a
// route.ts handler and a "use client" component's server action
// (tests/app_router.rs `page_reads_run_as_the_visitor`).
import { defineConfig } from "spacepress";

export default defineConfig({ name: "pagereads" });
