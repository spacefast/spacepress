// Stable route ids (tests/app_router.rs `route_ids_keep_pages_when_files_move`): a page.tsx and a
// page.md that name their own id, so moving either file keeps its WordPress Page.
import { defineConfig } from "first";

export default defineConfig({ name: "routeids" });
