import { collection, id, defineConfig, action } from "zero";
const n = collection("n", { id: id() }, { editor: false });
const shared = { visits: 0 };
// The helper hands back the module's container; compiled PHP returns a copy of it.
function current() {
  return shared;
}
export default defineConfig({
  schema: { n },
  actions: {
    visit: action({
      input: {},
      handler() {
        const s = current();
        s.visits++;
        return shared.visits;
      },
    }),
  },
});
