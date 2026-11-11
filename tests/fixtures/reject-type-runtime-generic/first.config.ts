import { action, defineConfig } from "first";
function identity<T>(value: T): T { return value; }
export default defineConfig({ tables: {}, actions: { example: action({ input: {}, handler: () => { return identity(1); } }) } });
