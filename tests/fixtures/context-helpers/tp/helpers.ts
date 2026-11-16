import { text, table, db, type HookCtx, type User, type Role, type RouteRequest, type RouteResponse } from "typedpress";

export const notes = table({ body: text(), author: text() });

// A handler's context and request are values: helpers take them, return them, and read static keys.
export function caller(ctx: HookCtx): User | null {
  return ctx.user;
}
export function label(user: User | null): string {
  return user === null ? "guest" : `${user.name}#${user.id}`;
}
export function role(ctx: HookCtx): Role {
  return ctx.user?.role ?? "guest";
}
export function same(ctx: HookCtx): HookCtx {
  return ctx;
}
export function read(ctx: HookCtx, key: keyof HookCtx) {
  return ctx[key] === undefined || ctx[key] === null;
}
export async function write(ctx: HookCtx, body: string) {
  await db.insert(notes).values({ body, author: label(caller(ctx)) });
  return (await db.query.notes.findMany({ where: { body } })).map((n) => n.author);
}
export function echo(req: RouteRequest, ctx: HookCtx): RouteResponse {
  return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ method: req.method, url: req.url, share: req.query.has("__"), path: req.path, body: req.body, role: role(ctx) }) };
}

