import { action, defineConfig, env } from "typedpress";
const values = [{ tokens: [env("PRIVATE_TOKEN")] }];
export const bad = action({ input: {}, handler: () => values[0] });

export default defineConfig({});
