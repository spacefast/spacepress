import type { Actions } from "./zero/client/types";

declare const report: Actions["typeReport"]["output"];
const id: number = report.snapshot.id;
const note: string | null = report.snapshot.note;
const missing: string | null = report.missing;
const state: "draft" = report.state;
const key: "common" = report.key;
const flag: boolean = report.flags.ready;
const together: "mixed" = report.together;
const returned: "ok" | null = report.returned;
const undefinedType: "undefined" = report.undefinedType;
const collapsed: "broad" = report.collapsed;
const nullType: "null" = report.nullType;
const requiredLabel: string = report.requiredUndefined.label;
const args: [number, string] = report.args;
const input: Actions["typeReport"]["input"] = { entry: { id: 1, title: "Hello", state: "draft", active: true } };
// @ts-expect-error explicit nullable property stays nullable after Required
const nonnullNote: string = report.snapshot.note;
// @ts-expect-error optional property read is represented as null at the PHP boundary
const present: string = report.missing;
// @ts-expect-error keyof a union contains only shared keys
const otherKey: "left" = report.key;
// @ts-expect-error Exclude retains the finite state
const published: "published" = report.state;
// @ts-expect-error literal Record keys do not become a string index signature
report.flags.other;
// @ts-expect-error the inherited id remains required after Projection and Required
const noId: Actions["typeReport"]["output"]["snapshot"] = { note: null };
void [collapsed, undefinedType, nullType, requiredLabel, id, note, missing, state, key, flag, together, returned, args, input, nonnullNote, present, otherKey, published, noId];
