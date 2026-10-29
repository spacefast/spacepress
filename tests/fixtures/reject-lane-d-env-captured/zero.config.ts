import { action, defineConfig, env } from "zero";
const values = [{ tokens: [env("PRIVATE_TOKEN")] }];
export default defineConfig({ schema: {}, actions: { bad: action({ input: {}, handler: () => values[0] }) } });
