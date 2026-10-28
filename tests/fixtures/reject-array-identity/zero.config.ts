import { collection, id, defineConfig, action } from "zero";
const n = collection("n", { id: id() });
export default defineConfig({
  schema: { n },
  actions: { eq: action({ input: {}, handler() { const a = [1]; return a === [1]; } }) },
});
