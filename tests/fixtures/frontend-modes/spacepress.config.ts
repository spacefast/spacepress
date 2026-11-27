// Front-end modes (tests/app_router.rs `frontend_modes_on_wordpress`): the test copies this
// project, adds `frontend: …` or sp/app/ (from app/sp/app), and serves each variant.
import { defineConfig } from "spacepress";

export default defineConfig({
  name: "modes",
  permalinks: {
    notes: "/notes/:slug",
    journal: "/journal/:year/:slug",
    drafts: "/desk/:slug",
    briefs: "/briefs/:slug",
    cases: "/cases/:slug",
    vault: "/members/vault/:slug",
  },
});
