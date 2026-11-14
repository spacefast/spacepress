import { defineConfig, email, userProjection } from "first";
const members = userProjection({ email: email().unique().max(191) });
export default defineConfig({ users: { members } });
