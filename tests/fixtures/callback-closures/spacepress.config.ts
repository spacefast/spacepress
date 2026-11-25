// Request input that a type assertion or `any` calls a function: PHP must refuse the string,
// never call the PHP function it names (tests/compiler.rs, a_string_from_input_is_never_called).
import { defineConfig, mutation } from "spacepress";

const asMapper = (value: string) => value as unknown as (v: string) => string;
function apply(f: (v: string) => string, value: string): string {
  return f(value);
}

export const map = mutation({ access: "anyone" }, async (input: { fn: string }) => ["abc", "xyz"].map(asMapper(input.fn)));

export const filter = mutation({ access: "anyone" }, async (input: { fn: string }) => ["abc", ""].filter(input.fn as unknown as (v: string) => boolean));

export const reduce = mutation({ access: "anyone" }, async (input: { fn: string }) => ["abc", "xyz"].reduce(input.fn as unknown as (a: string, v: string) => string, ""));

export const replace = mutation({ access: "anyone" }, async (input: { fn: string }) => "abc".replace("b", input.fn as unknown as (m: string) => string));

export const range = mutation({ access: "anyone" }, async (input: { fn: string }) => Array.from({ length: 2 }, input.fn as unknown as (v: undefined, i: number) => string));

export const passed = mutation({ access: "anyone" }, async (input: { fn: string }) => apply(input.fn as unknown as (v: string) => string, "abc"));

export const call = mutation({ access: "anyone" }, async (input: { fn: string; arg: string }) => (input.fn as unknown as (v: string) => string)(input.arg));

export const json = mutation({ access: "anyone" }, async (input: { body: string }) => {
  const parsed = JSON.parse(input.body) as { fn: (v: string) => string };
  return ["abc", "xyz"].map(parsed.fn);
});

export default defineConfig({});
