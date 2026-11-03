import { collection, id, timestamp, group, defineConfig, table } from "zero";
// Defaults go through the runtime codec, so an epoch past 9999-12-31 inside a group fails the build (a Feb 30
// string does too; see the extract.rs unit test for the string rules).
const n = table({ id: id(), when: group({ fields: { at: timestamp() } }).default({ at: 253402300800000 }) });
export default defineConfig({ tables: { n } });
