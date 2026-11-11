import { action, defineConfig } from "first";
type Value = ({ id: number } | { other: string })["id"];
export default defineConfig({ tables: {}, actions: { example: action({ input: {}, handler: () => { const value: Value = 1; return value; } }) } });
