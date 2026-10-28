import { collection, id, defineConfig, action } from "zero";
const n = collection("n", { id: id() }, { editor: false });
export default defineConfig({
  schema: { n },
  actions: { eq: action({ input: {}, handler() { const a = [1]; return a === [1]; } }) },
});
