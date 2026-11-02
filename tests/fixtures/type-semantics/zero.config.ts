import { action, defineConfig, json } from "zero";
import { DraftEntryView } from "./shapes";
import type { Entry, Projection, Flags, Tags, Together, Absent, BoolChoice, LiteralCheck } from "./shapes";

type Draft = Entry;
type Labels<T> = { [P in keyof T]: string };
type Intersected = { note?: string } & { note: string | undefined };
type OptionalConflict = { note?: string } & { note?: number };
const labels: Labels<{ note?: number }> = {};
const intersected: Intersected = { note: undefined };
const optionalConflict: OptionalConflict = {};
type Snapshot = Required<Pick<Draft, "id" | "note">>;
type Copy<T> = { [K in keyof T]: T[K] };
type Mandatory<T> = { [K in keyof T]-?: T[K] };
type Choice = Extract<"draft" | "published" | 7, string>;
type State = Exclude<Choice, "published">;
type Values<T> = T[keyof T];
type Box<T> = { value: T };
type Report = {
  classView: DraftEntryView;
  labels: Labels<{ note?: number }>;
  intersected: Required<Intersected>;
  optionalConflict: OptionalConflict;
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
  schema: {},
  actions: {
    typeReport: action({
      input: { entry: json().$type<Projection<Draft>>().notNull() },
      handler: (input): Report => {
        const item: Copy<Draft> = input.entry;
        const boxed: Box<DraftEntryView> = { value: new DraftEntryView(item, "draft") };
        boxed.value.clear();
        const snapshot: Mandatory<Projection<Draft, "id" | "note">> = boxed.value.snapshot();
        const flags: Readonly<Flags<"ready" | "visible">> = { ready: true, visible: item.active };
        const patch: Partial<Omit<Draft, "id">> = {};
        const projectedOptional: Projection<Draft, "note"> = {};
        return {
          classView: boxed.value,
          labels,
          intersected,
          optionalConflict,
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
