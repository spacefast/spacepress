import { defineConfig, email, userProjection } from "spacepress";
const members = userProjection({ email: email().unique().max(191) });
export default defineConfig({ users: { members } });
