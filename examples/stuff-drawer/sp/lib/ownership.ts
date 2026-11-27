import { f, type AccessCtx, type User } from "spacepress";
import { HttpError } from "spacepress/server";

export const ownerId = f.integer().access({ create: false, update: false });

export function ownerFilter(ctx: AccessCtx) {
  return ctx.user ? { ownerId: ctx.user.id } : false;
}

export const personalAccess = {
  read: ownerFilter,
  create: "authenticated",
  update: ownerFilter,
  delete: ownerFilter,
} as const;

export function actorId(ctx: { user: User | null }): number {
  if (!ctx.user) throw new HttpError(401, "unauthenticated", "Sign in to your drawer.");
  return ctx.user.id;
}
