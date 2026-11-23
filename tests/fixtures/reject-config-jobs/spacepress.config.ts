import { defineConfig, job } from "spacepress";
const digest = job({}, async () => {});
export default defineConfig({ jobs: { digest } });
