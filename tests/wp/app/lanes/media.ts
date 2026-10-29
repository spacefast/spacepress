// Lane fragment for the WP test app; only this lane edits this file. ../compose.ts merges every
// export into the app and fails the build if a key collides with the shared app or another lane.
export const schema = {};
/** Extra relations for this lane's collections: `(r) => ({ myCollection: { ... } })`. */
export const relations = (r: unknown) => ({});
export const actions = {};
export const globals = {};
/** Hooks by collection, then event. Two lanes may hook one collection, never the same event. */
export const hooks = {};
/** Image sizes (phase 2 §7.2): one cover crop the focal point drives, one inside fit. */
export const config = {
  media: { sizes: { card: { width: 120, height: 120, fit: "cover" as const }, wide: { width: 200, fit: "inside" as const } } },
};
