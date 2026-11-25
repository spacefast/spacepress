import { collection, timestamp, group, defineConfig, table } from "spacepress";
// Defaults go through the runtime codec, so an epoch past 9999-12-31 inside a group fails the build (a Feb 30
// string does too; see the extract.rs unit test for the string rules).
export const n = table({ when: group({ at: timestamp().optional() }).default({ at: 253402300800000 }).optional() });
export default defineConfig({});
