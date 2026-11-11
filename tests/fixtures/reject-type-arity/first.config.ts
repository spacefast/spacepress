import { action, defineConfig } from "first";
type Box<T> = { value: T };
export default defineConfig({ tables: {}, actions: { example: action({ input: {}, handler: () => { const value: Box = { value: 1 }; return value; } }) } });
