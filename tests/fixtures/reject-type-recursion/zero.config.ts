import { action, defineConfig } from "zero";
type Recursive<T> = { value: Recursive<T> };
export default defineConfig({ schema: {}, actions: { example: action({ input: {}, handler: () => { const value: Recursive<number> = { value: {} }; return value; } }) } });
