// The route's `req` and `ctx` handed to a helper typed with the "spacepress" types, as a value.
import type { HookCtx, RouteRequest } from "spacepress";
import { echo } from "../../helpers";

export const access = "anyone";

export async function POST(req: RouteRequest, ctx: HookCtx) {
  return echo(req, ctx);
}
