import { collection, id, timestamp, group, defineConfig } from "zero";
// Defaults go through the runtime codec, so an epoch past 9999-12-31 inside a group fails the build (a Feb 30
// string does too; see the extract.rs unit test for the string rules).
const n = collection("n", { id: id(), when: group({ fields: { at: timestamp() } }).default({ at: 253402300800000 }) }, { editor: false });
export default defineConfig({ schema: { n } });
