import { action, defineConfig } from "typedpress";
type Value = ({ id: number } | { other: string })["id"];
export const example = action({ input: {}, handler: () => { const value: Value = 1; return value; } });

export default defineConfig({});
