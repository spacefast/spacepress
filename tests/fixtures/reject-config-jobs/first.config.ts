import { defineConfig, job } from "first";
const digest = job({ input: {}, handler: async () => {} });
export default defineConfig({ jobs: { digest } });
