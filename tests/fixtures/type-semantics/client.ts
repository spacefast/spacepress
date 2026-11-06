import type { Actions } from "./zero/client/types";

declare const report: Actions["typeReport"]["output"];
const scalarTypes: string[] = report.scalarTypes;
const scalarFalseBranches: string[] = report.scalarFalseBranches;
void [scalarTypes, scalarFalseBranches];
const guardedLabels: string[] = report.guardedLabels;
const guardedFind: string = report.guardedFind;
const guardedBranch: string = report.guardedBranch;
const predicateMap: boolean[] = report.predicateMap;
const booleanFilter: string[] = report.booleanFilter;
void [guardedLabels, guardedFind, guardedBranch, predicateMap, booleanFilter];
const classMissing: undefined = report.classView.missing;
const classState: "draft" = report.classView.label;
const classId: number = report.classView.entry.id;
// @ts-expect-error class methods do not cross the JSON boundary
report.classView.snapshot();
// @ts-expect-error undefined class fields do not become null
const classNull: null = report.classView.missing;
const id: number = report.snapshot.id;
const note: string | null = report.snapshot.note;
const missing: string | null | undefined = report.missing;
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
// @ts-expect-error an optional property read may be absent
const present: string = report.missing;
// @ts-expect-error keyof a union contains only shared keys
const otherKey: "left" = report.key;
// @ts-expect-error Exclude retains the finite state
const published: "published" = report.state;
// @ts-expect-error literal Record keys do not become a string index signature
report.flags.other;
// @ts-expect-error the inherited id remains required after Projection and Required
const noId: Actions["typeReport"]["output"]["snapshot"] = { note: null };
void [classMissing, classState, classId, classNull, collapsed, undefinedType, nullType, requiredLabel, id, note, missing, state, key, flag, together, returned, args, input, nonnullNote, present, otherKey, published, noId];

const optionalLabels: Actions["typeReport"]["output"]["labels"] = {};
const intersectionNote: string | undefined = report.intersected.note;
const requiredIntersection: Actions["typeReport"]["output"]["intersected"] = { note: undefined };
const optionalConflict: Actions["typeReport"]["output"]["optionalConflict"] = {};
// @ts-expect-error required presence retains the optional side's allowed undefined
const definiteIntersection: string = report.intersected.note;
// Serialization omits undefined even when the source property is required.
const absentIntersection: Actions["typeReport"]["output"]["intersected"] = {};
// @ts-expect-error conflicting optional value domains admit no string
const conflictString: Actions["typeReport"]["output"]["optionalConflict"] = { note: "value" };
void [optionalLabels, intersectionNote, requiredIntersection, optionalConflict, definiteIntersection, absentIntersection, conflictString];

const presentUndefined: Actions["typeReport"]["output"]["optionalSnapshot"] = { note: undefined };
const optionalLabel: Actions["typeReport"]["output"]["labels"] = { note: undefined };
if (report.optionalSnapshot.note !== undefined) {
  const definiteNote: string = report.optionalSnapshot.note;
  void definiteNote;
}
// @ts-expect-error a string optional property does not admit null
const nullableLabel: Actions["typeReport"]["output"]["labels"] = { note: null };
void [presentUndefined, optionalLabel, nullableLabel];

// Array.from and map retain the minimum length of their nonempty input.
declare const nonemptyValues: Actions["nonemptyValues"]["output"];
const firstValue: string = nonemptyValues[0];
const remainingValues: string[] = nonemptyValues.slice(1);
void [firstValue, remainingValues];

// Public action types describe the serialized response.
declare const wireTuple: Actions["wireUndefinedTuple"]["output"];
const serializedTuple: [null] = wireTuple;
// @ts-expect-error undefined array slots become null on the wire
const unserializedTuple: [undefined] = wireTuple;
declare const wireObject: Actions["wireUndefinedObject"]["output"];
const omittedObject: Actions["wireUndefinedObject"]["output"] = {};
const missingObjectValue: undefined = wireObject.x;
void [serializedTuple, unserializedTuple, omittedObject, missingObjectValue];

declare const destructuredObject: Actions["wireDestructuredObject"]["output"];
const omittedDestructured: Actions["wireDestructuredObject"]["output"] = {};
const missingDestructured: undefined = destructuredObject.x;
void [omittedDestructured, missingDestructured];

const omittedNullish: Actions["wireNullishObject"]["output"] = {};
declare const nullishObject: Actions["wireNullishObject"]["output"];
const nullishValue: string | undefined = nullishObject.value;
// @ts-expect-error a nullish check retains the omitted parameter's undefined
const requiredNullish: string = nullishObject.value;
void [omittedNullish, nullishValue, requiredNullish];

const omittedLogical: Actions["wireLogicalArrayObject"]["output"] = {};
declare const logicalObject: Actions["wireLogicalArrayObject"]["output"];
const logicalValue: string | undefined = logicalObject.value;
// @ts-expect-error a missing logical-assignment operand stays optional on the wire
const requiredLogical: string = logicalObject.value;
void [omittedLogical, logicalValue, requiredLogical];
