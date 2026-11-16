// Front-end modes (tests/app_router.rs `frontend_modes_on_wordpress`): the test copies this
// project, adds `frontend: …` or tp/app/ (from app/tp/app), and serves each variant.
import { defineConfig } from "typedpress";

export default defineConfig({ name: "modes" });
