import { action, defineConfig } from "first";
const like = action({ input: {}, handler: () => 1 });
export default defineConfig({ actions: { like } });
