import { action, defineConfig, json } from "zero";
import { DraftEntryView } from "./shapes";
import type { Entry, Projection, Flags, Tags, Together, Absent, BoolChoice, LiteralCheck } from "./shapes";

type Draft = Entry;
type Labels<T> = { [P in keyof T]: string };
type Intersected = { note?: string } & { note: string | undefined };
type OptionalConflict = { note?: string } & { note?: number };
const labels: Labels<{ note?: number }> = { note: undefined };
const optionalSnapshot: { note?: string } = { note: undefined };
const intersected: Intersected = { note: undefined };
const optionalConflict: OptionalConflict = {};
type Snapshot = Required<Pick<Draft, "id" | "note">>;
type Copy<T> = { [K in keyof T]: T[K] };
type Mandatory<T> = { [K in keyof T]-?: T[K] };
type Choice = Extract<"draft" | "published" | 7, string>;
type State = Exclude<Choice, "published">;
type Values<T> = T[keyof T];
type Box<T> = { value: T };
const NUMBER_IS_FINITE = Number.isFinite;
const FINITE_VALUES = [NaN, Infinity, "3", null, [], [3], [false]];
const PURE_FINITE = FINITE_VALUES.map(value => [Number.isFinite(value), isFinite(Number(value))]);
type Candidate = { kind: string; label?: string };
type Named = Candidate & { kind: "named"; label: string };
function isNamed(item: Candidate): item is Named {
  return item.kind === "named" && typeof item.label === "string";
}
function guardedLabel(item: Candidate | undefined): string {
  if (!item || !isNamed(item)) return "";
  return item.label;
}
function scalarLabel(value: unknown): string {
  if (typeof value === "number") return String(value + 1);
  if ("string" === typeof value && value.trim() !== "") return value.toUpperCase();
  if (typeof value !== "boolean") return "other";
  return value ? "true" : "false";
}
function scalarRemainder(value: number | string | null): string {
  if (typeof value === "number") return String(value - 1);
  if (typeof value !== "string") return "absent";
  return value.toLowerCase();
}
type Report = {
  finiteChecks: boolean[][];
  finiteIdentity: boolean;
  finiteCaptured: boolean;
  pureFinite: boolean[][];
  scalarTypes: string[];
  scalarFalseBranches: string[];
  guardedLabels: string[];
  guardedFind: string;
  guardedBranch: string;
  predicateMap: boolean[];
  booleanFilter: string[];
  tupleLabels: string[];
  arrayPresence: { tags?: string[] } & { tags: string[] };
  classView: DraftEntryView;
  labels: Labels<{ note?: number }>;
  intersected: Required<Intersected>;
  optionalConflict: OptionalConflict;
  optionalSnapshot: { note?: string };
  snapshot: Snapshot;
  flags: Flags<"ready" | "visible">;
  state: State;
  tag: Tags<"draft" | 7>;
  together: Together<"draft" | 7>;
  value: Values<{ count: number; label: string }>;
  missing: Draft["note"];
  pair: ["draft", number][0 | 1];
  element: ReadonlyArray<string>[number];
  key: keyof ({ common: string; left: number } | { common: number; right: boolean });
  payload: NonNullable<string | null>;
  awaited: Awaited<Promise<Promise<"done">>>;
  returned: ReturnType<(n: number) => "ok" | null>;
  args: Parameters<(n: number, s: string) => boolean>;
  undefinedType: Absent<undefined>;
  nullType: Absent<null>;
  booleans: BoolChoice<boolean | "other">[];
  collapsed: LiteralCheck<string | "draft">;
  weak: { x: number } extends { y?: string } ? "yes" : "no";
  requiredUndefined: Required<{ label?: string | undefined }>;
};

function read(item: Draft, key: keyof Projection<Draft, "title" | "state">): string {
  return item[key];
}

export default defineConfig({
  tables: {},
  actions: {
    typeReport: action({
      input: { entry: json().$type<Projection<Draft>>().notNull() },
      handler: (input): Report => {
        const finite = Number.isFinite;
        const candidates: Candidate[] = [{ kind: "other" }, { kind: "named", label: "found" }];
        const guard = isNamed;
        const networks: ReadonlyArray<["left" | "right", string]> = [["left", "Left"], ["right", "Right"]];
        const dictionary = { left: "L", right: "R" };
        const tupleLabels = networks.flatMap(([key, label]) => [`${label}:${dictionary[key]}`]);
        const guarded = candidates.filter(guard).map(item => item.label);
        const item: Copy<Draft> = input.entry;
        const boxed: Box<DraftEntryView> = { value: new DraftEntryView(item, "draft") };
        boxed.value.clear();
        const snapshot: Mandatory<Projection<Draft, "id" | "note">> = boxed.value.snapshot();
        const flags: Readonly<Flags<"ready" | "visible">> = { ready: true, visible: item.active };
        const patch: Partial<Omit<Draft, "id">> = {};
        const projectedOptional: Projection<Draft, "note"> = {};
        return {
          finiteChecks: FINITE_VALUES.map(value => [finite(value), isFinite(Number(value))]),
          finiteIdentity: finite === Number.isFinite,
          finiteCaptured: NUMBER_IS_FINITE(3),
          pureFinite: PURE_FINITE,
          scalarTypes: [7, "Hello", true, false, null].map(scalarLabel),
          scalarFalseBranches: [7, "Hello", null].map(scalarRemainder),
          guardedLabels: guarded,
          guardedFind: candidates.find(isNamed)?.label ?? "",
          guardedBranch: guardedLabel(candidates[1]),
          predicateMap: candidates.map(isNamed),
          booleanFilter: ["", "0", "value"].filter(Boolean),
          tupleLabels,
          arrayPresence: { tags: ["present"] },
          classView: boxed.value,
          labels,
          intersected,
          optionalConflict,
          optionalSnapshot,
          snapshot,
          flags,
          state: "draft",
          tag: { kind: "draft" },
          together: "mixed",
          value: read(item, "title"),
          missing: projectedOptional.note ?? patch.note,
          pair: 7,
          element: "value",
          key: "common",
          payload: "present",
          awaited: "done",
          returned: null,
          args: [1, "one"],
          undefinedType: "undefined",
          nullType: "null",
          booleans: ["yes", "no"],
          collapsed: "broad",
          weak: "no",
          requiredUndefined: { label: "present" },
        };
      },
    }),
  },
});
