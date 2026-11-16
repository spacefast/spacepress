import { action, defineConfig } from "typedpress";
type Recursive<T> = { value: Recursive<T> };
export const example = action({ input: {}, handler: () => { const value: Recursive<number> = { value: {} }; return value; } });

export default defineConfig({});
