import { action, capsule, query } from "@spacefast/zero/server";

type AvatarOptions = { size?: number; default?: "404" | "mp" | "identicon" | "monsterid" | "wavatar" | "retro" | "robohash" | "blank"; rating?: "g" | "pg" | "r" | "x"; forceDefault?: boolean };

// ctx.gravatar as 0.8 apps use it: an avatar URL for a stored address, and the public profile.
export default capsule({
  name: "Gravatar",
  queries: {
    avatar: query(async (ctx, email: string, options: AvatarOptions) => ctx.gravatar.avatarUrl(email, options)),
    plain: query(async (ctx, email: string) => ctx.gravatar.avatarUrl(email)),
  },
  actions: {
    profile: action(async (ctx, email: string) => {
      const profile = await ctx.gravatar.profile(email);
      return profile === null ? null : { name: profile.displayName, accounts: profile.verifiedAccounts.length };
    }),
  },
});
