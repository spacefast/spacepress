import { defineConfig, action, route, text, table, db, type HookCtx, type User, type Role, type RouteRequest, type RouteResponse } from "zero";

const notes = table({ body: text().notNull(), author: text().notNull() });

// A handler's context and request are values: helpers take them, return them, and read static keys.
function caller(ctx: HookCtx): User | null {
  return ctx.user;
}
function label(user: User | null): string {
  return user === null ? "guest" : `${user.name}#${user.id}`;
}
function role(ctx: HookCtx): Role {
  return ctx.user?.role ?? "guest";
}
function same(ctx: HookCtx): HookCtx {
  return ctx;
}
function read(ctx: HookCtx, key: keyof HookCtx) {
  return ctx[key] === undefined || ctx[key] === null;
}
async function write(ctx: HookCtx, body: string) {
  await db.insert(notes).values({ body, author: label(caller(ctx)) });
  return (await db.query.notes.findMany({ where: { body } })).map((n) => n.author);
}
function echo(req: RouteRequest, ctx: HookCtx): RouteResponse {
  return { status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ method: req.method, url: req.url, path: req.path, body: req.body, role: role(ctx) }) };
}

export default defineConfig({
  tables: { notes },
  actions: {
    whoami: action({
      input: {},
      access: "anyone",
      handler: async (_input, ctx) => ({ label: label(caller(same(ctx))), role: role(ctx), anonymous: read(ctx, "user"), viaIndex: ctx["user"] === null }),
    }),
    note: action({ input: { body: text().notNull() }, access: "anyone", handler: async (input, ctx) => await write(ctx, input.body) }),
  },
  routes: {
    echo: route({ method: "POST", path: "/echo", access: "anyone", handler: async (req, ctx) => echo(req, ctx) }),
  },
});
