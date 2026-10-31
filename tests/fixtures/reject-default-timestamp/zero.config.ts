import { collection, id, timestamp, group, defineConfig } from "zero";
// Defaults go through the runtime codec, so a non-timestamp inside a group fails the build (a Feb 30
// string does too; see the extract.rs unit test for the string rules).
const n = collection("n", { id: id(), when: group({ fields: { at: timestamp() } }).default({ at: false }) }, { editor: false });
export default defineConfig({ schema: { n } });
