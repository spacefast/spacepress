// Request input that a type assertion or `any` calls a function: PHP must refuse the string,
// never call the PHP function it names (tests/compiler.rs, a_string_from_input_is_never_called).
import { defineConfig, action, text } from "first";

const asMapper = (value: string) => value as unknown as (v: string) => string;
function apply(f: (v: string) => string, value: string): string {
  return f(value);
}

export const map = action({
  input: { fn: text() },
  access: "anyone",
  handler: async (input) => ["abc", "xyz"].map(asMapper(input.fn)),
});

export const filter = action({
  input: { fn: text() },
  access: "anyone",
  handler: async (input) => ["abc", ""].filter(input.fn as unknown as (v: string) => boolean),
});

export const reduce = action({
  input: { fn: text() },
  access: "anyone",
  handler: async (input) => ["abc", "xyz"].reduce(input.fn as unknown as (a: string, v: string) => string, ""),
});

export const replace = action({
  input: { fn: text() },
  access: "anyone",
  handler: async (input) => "abc".replace("b", input.fn as unknown as (m: string) => string),
});

export const range = action({
  input: { fn: text() },
  access: "anyone",
  handler: async (input) => Array.from({ length: 2 }, input.fn as unknown as (v: undefined, i: number) => string),
});

export const passed = action({
  input: { fn: text() },
  access: "anyone",
  handler: async (input) => apply(input.fn as unknown as (v: string) => string, "abc"),
});

export const call = action({
  input: { fn: text(), arg: text() },
  access: "anyone",
  handler: async (input) => (input.fn as unknown as (v: string) => string)(input.arg),
});

export const json = action({
  input: { body: text() },
  access: "anyone",
  handler: async (input) => {
    const parsed = JSON.parse(input.body) as { fn: (v: string) => string };
    return ["abc", "xyz"].map(parsed.fn);
  },
});

export default defineConfig({});
