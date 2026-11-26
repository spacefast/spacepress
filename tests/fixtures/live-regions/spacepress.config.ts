// `<Live>` regions and the subscription endpoint's `page` read (docs/decisions/2026-11-14-live-regions.md):
// a page with a live list of notes, a guarded page with one, and a region that reads the clock
// (tests/app_router.rs `live_regions_answer_page_reads`).
import { defineConfig } from "spacepress";

export default defineConfig({ name: "liveregions" });
