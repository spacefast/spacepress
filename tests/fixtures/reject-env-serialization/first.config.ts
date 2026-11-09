import { action, defineConfig, env } from "first";
const serialized = JSON.stringify([{ tokens: [env("HOOK_SECRET")] }]);
export default defineConfig({ collections: {}, actions: { bad: action({ input: {}, handler: () => serialized }) } });
