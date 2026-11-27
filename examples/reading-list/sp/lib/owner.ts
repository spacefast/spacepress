import { f, type AccessCtx, type User } from "spacepress";
import { HttpError } from "spacepress/server";

// Set by the server from the signed-in user; a client can't write it.
export const ownerId = f.integer().access({ create: false, update: false });

// An access rule can return a filter: each reader sees only their own rows.
export const mine = (ctx: AccessCtx) => (ctx.user ? { ownerId: ctx.user.id } : false);

export function signedIn(ctx: { user: User | null }): number {
  if (!ctx.user) throw new HttpError(401, "unauthenticated", "Sign in first.");
  return ctx.user.id;
}
