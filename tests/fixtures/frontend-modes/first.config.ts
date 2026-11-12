// Front-end modes (tests/app_router.rs `frontend_modes_on_wordpress`): the test copies this
// project, adds `frontend: …` or first/app/ (from app/first/app), and serves each variant.
import { defineConfig } from "first";

export default defineConfig({ name: "modes" });
