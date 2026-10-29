import { action, defineConfig, env } from "zero";
const serialized = JSON.stringify([{ tokens: [env("HOOK_SECRET")] }]);
export default defineConfig({ schema: {}, actions: { bad: action({ input: {}, handler: () => serialized }) } });
