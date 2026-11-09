// `__proto__: null` object literals, which picomatch 4.0.7 (a files-sdk dependency) uses for its
// lookup tables: reads of keys the object doesn't own are undefined, including Object.prototype
// names; `in` sees own keys only; inherited method calls throw TypeError; enumeration, spread and
// JSON behave as on an ordinary object. Tables are built both at module scope (configuration
// evaluation, captured into PHP) and inside handlers. Every action runs under Node and as
// compiled PHP; the JSON results must be byte-identical.
import { action, defineConfig } from "zero";
import { picomatchLookups, thisNullProto, untypedNullProto } from "./null-proto-helpers.mjs";

const run = (handler: () => unknown) => action({ input: {}, handler });

const INPUTS = ["***", "**/**", "**/**/**", "**", "alnum", "xdigit", "missing", "constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString"];

// Built while the config is evaluated; handlers read the captured table.
const REPLACEMENTS: Record<string, string | undefined> = { __proto__: null, "***": "*", "**/**": "**", "**/**/**": "**" } as unknown as Record<string, string | undefined>;

function replace(input: string): string {
  return REPLACEMENTS[input] || input;
}

const BUILD_TIME = {
  replaced: INPUTS.map(replace),
  present: INPUTS.map((key) => key in REPLACEMENTS),
  keys: Object.keys(REPLACEMENTS),
  copy: { ...REPLACEMENTS },
  inCopy: ["constructor" in { ...REPLACEMENTS }, "***" in { ...REPLACEMENTS }],
};

function typedFresh(): unknown[] {
  const table = { __proto__: null, alpha: "a-zA-Z", digit: "0-9" };
  const open = table as unknown as Record<string, string | undefined>;
  const keys: string[] = [];
  for (const key in table) keys.push(key);
  open.late = "added";
  return [
    table.alpha,
    [...INPUTS, "alpha", "late"].map((key) => open[key] ?? null),
    [...INPUTS, "alpha", "late"].map((key) => key in table),
    Object.keys(table),
    keys,
    JSON.stringify(table),
    JSON.stringify({ ...table, extra: 1 }),
    "toString" in { ...table },
    Object.hasOwn(table, "toString"),
  ];
}

function typedMethodCall(): string {
  const table = { __proto__: null, a: 1 } as unknown as { hasOwnProperty(key: string): boolean };
  try {
    return String(table.hasOwnProperty("a"));
  } catch (error) {
    return (error as Error).name;
  }
}

export default defineConfig({
  name: "language-null-proto",
  actions: {
    nullProtoBuildTime: run(() => BUILD_TIME),
    nullProtoCaptured: run(() => [INPUTS.map(replace), INPUTS.map((key) => key in REPLACEMENTS), Object.keys(REPLACEMENTS), JSON.stringify(REPLACEMENTS)]),
    nullProtoCapturedMutation: run(() => {
      REPLACEMENTS.constructor = "own";
      const out = [REPLACEMENTS.constructor, "constructor" in REPLACEMENTS, Object.keys(REPLACEMENTS)];
      delete REPLACEMENTS.constructor;
      return out;
    }),
    nullProtoTyped: run(() => typedFresh()),
    nullProtoTypedMethod: run(() => typedMethodCall()),
    nullProtoPicomatch: run(() => picomatchLookups(INPUTS)),
    nullProtoUntyped: run(() => untypedNullProto()),
    nullProtoThis: run(() => thisNullProto(INPUTS)),
  },
});
