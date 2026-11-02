import { action, defineConfig } from "zero";
interface Entry { id: number }
interface Entry { title: string }
export default defineConfig({ schema: {}, actions: { example: action({ input: {}, handler: () => { const value: Entry = { id: 1, title: "Hello" }; return value; } }) } });
