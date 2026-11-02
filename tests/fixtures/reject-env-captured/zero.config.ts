import { action, defineConfig, env } from "zero";
const values = [{ tokens: [env("PRIVATE_TOKEN")] }];
export default defineConfig({ collections: {}, actions: { bad: action({ input: {}, handler: () => values[0] }) } });
