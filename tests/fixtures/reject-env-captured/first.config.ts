import { action, defineConfig, env } from "first";
const values = [{ tokens: [env("PRIVATE_TOKEN")] }];
export default defineConfig({ collections: {}, actions: { bad: action({ input: {}, handler: () => values[0] }) } });
