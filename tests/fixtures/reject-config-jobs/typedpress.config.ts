import { defineConfig, job } from "typedpress";
const digest = job({}, async () => {});
export default defineConfig({ jobs: { digest } });
