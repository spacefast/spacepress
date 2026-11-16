import { action, defineConfig, env } from "typedpress";
const serialized = JSON.stringify([{ tokens: [env("HOOK_SECRET")] }]);
export const bad = action({ input: {}, handler: () => serialized });

export default defineConfig({});
