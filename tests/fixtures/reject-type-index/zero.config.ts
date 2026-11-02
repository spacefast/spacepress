import { action, defineConfig } from "zero";
type Value = ({ id: number } | { other: string })["id"];
export default defineConfig({ schema: {}, actions: { example: action({ input: {}, handler: () => { const value: Value = 1; return value; } }) } });
