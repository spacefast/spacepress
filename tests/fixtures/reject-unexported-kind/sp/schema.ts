import { table, f } from "spacepress";
export const notes = table({ title: f.text() });
// Built but not exported: under the registries this was registered; now it would have no name.
const hidden = table({ secret: f.text() });
