import { defineConfig, job } from "typedpress";
const digest = job({ input: {}, handler: async () => {} });
export default defineConfig({ jobs: { digest } });
