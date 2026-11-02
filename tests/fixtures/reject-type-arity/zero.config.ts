import { action, defineConfig } from "zero";
type Box<T> = { value: T };
export default defineConfig({ schema: {}, actions: { example: action({ input: {}, handler: () => { const value: Box = { value: 1 }; return value; } }) } });
