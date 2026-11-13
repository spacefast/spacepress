import { capsule, connector, query } from "@spacefast/zero/server";
export default capsule({
  name: "legacy-content",
  auth: { requireSignIn: true },
  connectors: {
    calendar: connector({ as: "owner", connector: "calendar" }),
    shared: connector({ as: "team", connector: "github" }),
    visitor: connector({ as: "visitor", connector: "linear" }),
  },
  collections: {
    notes: { publicRead: true, fields: { title: { kind: "text", required: true } } },
  },
  queries: {
    profile: query(async (ctx) => ({
      signedIn: ctx.auth.isSignedIn,
      guest: ctx.auth.isGuest,
      name: ctx.auth.displayName,
    })),
  },
});
