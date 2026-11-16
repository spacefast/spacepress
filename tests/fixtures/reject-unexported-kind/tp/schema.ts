import { table, text } from "typedpress";
export const notes = table({ title: text() });
// Built but not exported: under the registries this was registered; now it would have no name.
const hidden = table({ secret: text() });
