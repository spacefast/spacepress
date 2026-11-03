import type { Actions } from "./zero/client/types";

declare const report: Actions["typeReport"]["output"];
const classMissing: null = report.classView.missing;
const classState: "draft" = report.classView.label;
const classId: number = report.classView.entry.id;
// @ts-expect-error class methods do not cross the JSON boundary
report.classView.snapshot();
// @ts-expect-error undefined class fields are represented as null in PHP output
const classUndefined: undefined = report.classView.missing;
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
void [classMissing, classState, classId, classUndefined, collapsed, undefinedType, nullType, requiredLabel, id, note, missing, state, key, flag, together, returned, args, input, nonnullNote, present, otherKey, published, noId];

const optionalLabels: Actions["typeReport"]["output"]["labels"] = {};
const intersectionNote: string | null = report.intersected.note;
const requiredIntersection: Actions["typeReport"]["output"]["intersected"] = { note: null };
const optionalConflict: Actions["typeReport"]["output"]["optionalConflict"] = {};
// @ts-expect-error required presence retains the optional side's allowed undefined as null
const definiteIntersection: string = report.intersected.note;
// @ts-expect-error Required does not make the intersection property optional
const absentIntersection: Actions["typeReport"]["output"]["intersected"] = {};
// @ts-expect-error conflicting optional value domains admit no string
const conflictString: Actions["typeReport"]["output"]["optionalConflict"] = { note: "value" };
void [optionalLabels, intersectionNote, requiredIntersection, optionalConflict, definiteIntersection, absentIntersection, conflictString];

const presentUndefined: Actions["typeReport"]["output"]["optionalSnapshot"] = { note: null };
const nullableLabel: Actions["typeReport"]["output"]["labels"] = { note: null };
if (report.optionalSnapshot.note !== undefined) {
  const nullableNote: string | null = report.optionalSnapshot.note;
  // @ts-expect-error a present optional value can be null on the PHP wire
  const definiteNote: string = report.optionalSnapshot.note;
  void [nullableNote, definiteNote];
}
void [presentUndefined, nullableLabel];
