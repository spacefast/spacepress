import { HttpError, integer, type AccessCtx, type HookCtx } from "first";

export const ownerId = integer().access({ create: false, update: false });

export function ownerFilter(ctx: AccessCtx) {
  return ctx.user ? { ownerId: ctx.user.id } : false;
}

export const personalAccess = {
  read: ownerFilter,
  create: "authenticated",
  update: ownerFilter,
  delete: ownerFilter,
} as const;

export function actorId(ctx: HookCtx): number {
  if (!ctx.user) throw new HttpError(401, "unauthenticated", "Sign in to your drawer.");
  return ctx.user.id;
}
