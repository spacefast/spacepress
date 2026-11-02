import { action, defineConfig } from "zero";
function identity<T>(value: T): T { return value; }
export default defineConfig({ schema: {}, actions: { example: action({ input: {}, handler: () => { return identity(1); } }) } });
