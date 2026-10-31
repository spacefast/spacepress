import { collection, id, timestamp, group, defineConfig } from "zero";
// The default is applied by the runtime's strict ISO codec, so a Feb 30 inside a group can't build.
const n = collection("n", { id: id(), when: group({ fields: { at: timestamp() } }).default({ at: "2026-02-30T00:00:00Z" }) }, { editor: false });
export default defineConfig({ schema: { n } });
