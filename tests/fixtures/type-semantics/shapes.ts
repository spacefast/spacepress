export interface Identity { id: number }
export interface Content<S extends string = "draft"> {
  title: string;
  state: S;
  note?: string | null | undefined;
}
export interface Entry<S extends string = "draft"> extends Identity, Content<S> {
  active: boolean;
}
export type Projection<T, K extends keyof T = keyof T> = { [P in K]: T[P] };
export type Flags<K extends string> = { [P in K]: boolean };
export type Tags<T> = T extends string ? { kind: T } : { count: T };
export type Together<T> = [T] extends [string] ? "text" : "mixed";
export type Absent<T> = T extends undefined ? "undefined" : T extends null ? "null" : "present";
export type BoolChoice<T> = T extends true ? "yes" : "no";
export type LiteralCheck<T> = T extends "draft" ? "literal" : "broad";
