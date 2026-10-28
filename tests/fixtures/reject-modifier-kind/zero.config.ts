import { collection, id, boolean, defineConfig } from "zero";
const a = collection("a", { id: id(), done: boolean().max(3) }, { editor: false });
export default defineConfig({ schema: { a } });
