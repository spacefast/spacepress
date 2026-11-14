import { action, defineConfig } from "first";
type Recursive<T> = { value: Recursive<T> };
export const example = action({ input: {}, handler: () => { const value: Recursive<number> = { value: {} }; return value; } });

export default defineConfig({});
