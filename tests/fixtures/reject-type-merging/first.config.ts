import { action, defineConfig } from "first";
interface Entry { id: number }
interface Entry { title: string }
export default defineConfig({ tables: {}, actions: { example: action({ input: {}, handler: () => { const value: Entry = { id: 1, title: "Hello" }; return value; } }) } });
