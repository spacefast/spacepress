import { action, defineConfig } from "first";
type Box<T> = { value: T };
export const example = action({ input: {}, handler: () => { const value: Box = { value: 1 }; return value; } });

export default defineConfig({});
