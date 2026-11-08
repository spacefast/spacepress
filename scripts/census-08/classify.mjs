// Assigns each converter error on a rebuilt 0.8 capsule to a census reason.
//
// Reasons fall in two kinds:
// - "refusal": the stored payload alone shows a blocker that the original source would hit too
//   (an endpoint the manifest declares, a context service the bundle calls, a construct outside
//   the v2 subset). A Space with one is refused whatever its source says.
// - "source": the error comes from what the stored payload lacks (erased parameter types, page
//   bodies) or from the bundling itself (esbuild hoisted or inlined something the converter reads
//   differently). Only the original source can settle these, so they count as
//   "source not recoverable", never as accepted and never as a refusal.
//
// Labels are fixed strings, never text taken from the error, so census output carries no
// customer identifiers. The first matching rule wins.
export const SOURCE_NOT_RECOVERABLE = "source not recoverable";

const first = (r) => r.split("\n")[0];

const LANGUAGE = [
  ["bitwise operators", "bitwise operators"],
  ["bitwise assignment", "bitwise operators"],
  ["class expressions", "class expressions"],
  ["destructuring assignment", "destructuring assignment"],
  ["BigInt", "BigInt"],
  ["tagged templates", "tagged templates"],
  ["labels", "labels"],
  ["`in`", "the in operator"],
  ["`this` outside", "this outside a class"],
  ["`delete`", "delete"],
  ["`do ... while`", "do-while"],
];

// A client app without pages (src/config_migrate/app/client.rs): each reason starts with a fixed
// tag the converter's Z08_CLIENT_* rule matches. Same tags, same labels as census.mjs CLIENT_RULES.
const CLIENT = [
  ["0.8 client storage uploads", "client: storage uploads"],
  ["0.8 authenticatedFetch", "client: authenticatedFetch"],
  ["0.8 client connector state", "client: connector state"],
  ["0.8 client content reads", "client: content reads"],
  ["0.8 client sign-in", "client: 0.8 sign-in"],
  ["0.8 client API without a v2 bridge", "client: other 0.8 client API"],
  ["0.8 kit components in the client", "client: kit components"],
  ["0.8 charts in the client", "client: charts"],
  ["npm package in the client", "client: npm package"],
  ["client import outside the capsule", "client: import outside the capsule"],
  ["dynamic import in the client", "client: dynamic import"],
  ["client import of a non-script file", "client: non-script import"],
  ["client source the browser build cannot compile", "client: source the browser build cannot compile"],
  ["client app over an existing public/", "client: existing public/"],
  ["client module that cannot be read", "client: unreadable module"],
  ["client app conversion outside the native CLI", "client: needs the native CLI"],
];

// [label, kind, test(pointer, reason)]
const RULES = [
  ...CLIENT.map(([tag, label]) => [label, "refusal", (p, r) => r.startsWith(`${tag}: `)]),
  // What the rebuild cannot know.
  // Only the first line is the message; the rest quotes source, which contains the placeholder.
  ["erased parameter types", "source", (p, r) => /refused by v2 compiler: error: .*(\bunknown\b|__Census08Erased)/.test(first(r))],
  ["erased parameter types", "source", (p, r) => /handler parameters (need supported concrete|require explicit) TypeScript types|missing parameter type/.test(r)],
  ["page body", "source", (p, r) => /^\/pages\/.+\.tsx$/.test(p) && !/needs an explicit port/.test(r)],
  // Pages the converter cannot take at all, or whose kind has no v2 counterpart.
  ["pages: no page conversion", "refusal", (p, r) => /^\/(pages|layouts|islands|_pages)(\/|$)/.test(p) && /needs an explicit port/.test(r)],
  ["pages: Markdown or HTML document", "refusal", (p) => /^\/pages\/.+\.(md|html)$/.test(p)],
  // Endpoints, decided by the manifest's method, path and mode. Before #130 the converter refused
  // every endpoint as an unsupported capsule feature.
  ["endpoint: no endpoint conversion", "refusal", (p, r) => /^\/endpoints(\/|$)/.test(p) && /unsupported capsule feature/.test(r)],
  ["endpoint: writing GET", "refusal", (p, r) => /^\/endpoints\//.test(p) && /writing GET/.test(r)],
  ["endpoint: path owned by WordPress or Zero", "refusal", (p, r) => /^\/endpoints\//.test(p) && /belongs to WordPress or Zero/.test(r)],
  ["endpoint: OPTIONS or HEAD", "refusal", (p, r) => /^\/endpoints\//.test(p) && /OPTIONS|HEAD/.test(r) && /method|endpoints have no v2 route/.test(r)],
  ["endpoint: catch-all segment", "refusal", (p, r) => /^\/endpoints\//.test(p) && /catch-all|\*[a-z]|:splat|splat/.test(r)],
  ["endpoint: request API (url, bytes, headers.entries)", "refusal", (p, r) => /request API has no v2 route equivalent/.test(r)],
  ["endpoint: name shared with a handler", "refusal", (p, r) => /endpoint name collides/.test(r)],
  // Context services, by name.
  ["ctx.auth: profile fields or methods", "refusal", (p, r) => /\/ctx\/auth\//.test(p) && /legacy profiles and auth methods/.test(r)],
  // Before #130 every `ctx.auth` principal read was refused, `userId` included.
  ["ctx.auth: principal id or profile", "refusal", (p, r) => /\/ctx\/auth\//.test(p) && /legacy principal IDs/.test(r)],
  ["ctx.auth.userId without Space Users", "refusal", (p, r) => /ctx\.auth\.userId maps only for Space Users/.test(r)],
  ["ctx.auth: whole object passed on", "refusal", (p, r) => /\/ctx\/auth$/.test(p) && /unsupported context service/.test(r)],
  ...["fetch", "crypto", "email", "spam", "gravatar", "jwt", "storage", "connectors", "invalidate", "env", "log", "content", "realtime"].map((s) => [
    `ctx.${s}`,
    "refusal",
    (p, r) => new RegExp(`/ctx/${s}(/|$)`).test(p) && /unsupported context service/.test(r),
  ]),
  ["ctx.db: database handle use", "refusal", (p, r) => /\/ctx\/db(\/|$)/.test(p) && /unsupported context service/.test(r)],
  ["ctx passed on or read dynamically", "refusal", (p, r) => /unsupported context service, alias or dynamic use/.test(r)],
  ["ctx: other service", "refusal", (p, r) => /\/ctx\//.test(p) && /unsupported context service/.test(r)],
  // Database calls.
  ["db: paginate, filter or other operation", "refusal", (p, r) => /unsupported database operation/.test(r)],
  ["db: write outside a mutation", "refusal", (p, r) => /writes are only allowed in legacy mutations/.test(r)],
  ["db: range on an optional field", "refusal", (p, r) => /optional-field range/.test(r)],
  ["db: spread arguments", "refusal", (p, r) => /spread database arguments/.test(r)],
  ["db: handle escapes a handler", "refusal", (p, r) => /database handles cannot escape/.test(r)],
  // Capsule options and handler shapes the converter refuses.
  ["favicon", "refusal", (p) => p === "/favicon"],
  ["auth callbacks (onGuestUpgrade)", "refusal", (p) => /^\/auth\//.test(p)],
  ["sockets", "refusal", (p) => /^\/sockets(\/|$)/.test(p)],
  ["collections or sync", "refusal", (p) => /^\/(collections|sync)(\/|$)/.test(p)],
  ["schema: non-literal default", "refusal", (p, r) => /^\/schema\//.test(p) && /default must be a literal/.test(r)],
  ["handler signature (rest, default or destructured parameters)", "refusal", (p, r) => /rest and default parameters|destructured (input|request) parameters|context destructuring|endpoint handlers take|must declare its context parameter/.test(r)],
  ["ctx: email in a read", "refusal", (p, r) => /could not send email in 0\.8 either/.test(r)],
  ["handler or table name", "refusal", (p, r) => /names must start with an ASCII letter/.test(r)],
  ["build-time global", "refusal", (p, r) => /names a build-time global/.test(r)],
  ...LANGUAGE.map(([needle, label]) => [
    `language: ${label}`,
    "refusal",
    (p, r) => !p && r.startsWith("error: Zero code doesn't support") && first(r).includes(needle),
  ]),
  ["language: other construct", "refusal", (p, r) => !p && r.startsWith("error: Zero code doesn't support")],
  // A global the handler calls that v2 does not provide; `fetch` is mapped from #131 on.
  ["global: fetch", "refusal", (p, r) => /`fetch` isn't available in Zero code/.test(r)],
  ["global: other host API", "refusal", (p, r) => /`[\w$.]+` isn't available in Zero code/.test(r)],
  // Shapes esbuild may have produced: settled only by the source.
  ["bundle shape", "source", () => true],
];

/** `{ label, kind }` for one converter error. */
export function classify(error) {
  const pointer = String(error?.pointer ?? "");
  const reason = String(error?.reason ?? "");
  for (const [label, kind, test] of RULES) {
    if (test(pointer, reason)) return { label, kind };
  }
  return { label: "bundle shape", kind: "source" };
}
