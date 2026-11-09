// The Zero 0.8 surface as census features: one entry per row of the capability table in
// docs/zero-08-parity.md, plus the 0.8 SDK exports and engine routes that table did not list
// (marked `added`). Sources: `@spacefast/zero` 0.8.1 (spacefast/monorepo
// legacy/zero-0.8/packages/zero/src) and its compiler (legacy/zero-0.8/packages/first-compile).
//
// Each feature names the evidence that decides it:
//   artifact  the finalize payload's artifact (schema, endpoints, pages, capabilities, auth)
//   server    the server bundle (`bundles[0]`, esbuild output; identifiers kept, types erased)
//   client    the uploaded client bundle (`client.js`; not minified, so SDK import names survive)
//   none      nothing stored records it; the row is reported "not measured"
//
// `detect(f)` receives the facts `extract()` (usage.mjs) collected for one Space and returns
// true, false, or null (not measurable for this Space, for example a client feature when the
// Space's client bundle was not stored). Labels are fixed strings; nothing from a Space leaks
// into them.

const any = (xs, fn) => (xs ?? []).some(fn);
const has = (set, ...names) => names.some((n) => set.has(n));
// Client rows: null when the Space has a client and its bundle bytes were not stored.
const client = (fn) => (f) => (f.client.measured ? fn(f.client) : f.client.present ? null : false);

export const SECTIONS = ["Capsule and data", "Identity", "Context services", "HTTP", "Pages and client", "Engine routes"];

/** [id, section, label, source, detect, added?] */
export const FEATURES = [
  // Capsule and data
  ["capsule", "Capsule and data", "`capsule({ name })`", "server", (f) => f.server.capsule],
  ["server-entry", "Capsule and data", "Server entry from `sf.jsonc` `runtime.server` (and its aliases)", "artifact", (f) => f.entries.server !== "server/index.ts"],
  ["table", "Capsule and data", "`table()` with `string`, `number`, `boolean`, `id`, `userId`, `.optional()`, `.default()`", "artifact", (f) => f.schema.tables > 0],
  ["table-number", "Capsule and data", "`number()` columns", "artifact", (f) => f.schema.types.has("number"), true],
  ["table-boolean", "Capsule and data", "`boolean()` columns", "artifact", (f) => f.schema.types.has("boolean"), true],
  ["table-userid", "Capsule and data", "`userId()` columns", "artifact", (f) => f.schema.userReference || has(f.server.imports, "userId"), true],
  ["table-id", "Capsule and data", "`id(table)` references", "server", (f) => has(f.server.imports, "id"), true],
  ["table-optional", "Capsule and data", "`.optional()` columns", "artifact", (f) => f.schema.optional, true],
  ["table-default", "Capsule and data", "`.default()` columns", "artifact", (f) => f.schema.defaults, true],
  ["index", "Capsule and data", "`.index(name, fields)`, `by_creation`", "artifact", (f) => f.schema.indexes > 0 || f.server.calls.has("withIndex")],
  ["index-unique", "Capsule and data", "Unique indexes", "artifact", (f) => f.schema.unique, true],
  ["db-crud", "Capsule and data", "`ctx.db.<t>.get/insert/update/delete`", "server", (f) => f.server.db.crud],
  ["db-query", "Capsule and data", "`withIndex(...).order().collect/take/first/count`", "server", (f) => f.server.db.query],
  ["db-paginate", "Capsule and data", "`withIndex(...).paginate({ numItems, cursor })`", "server", (f) => f.server.db.paginate],
  ["db-range", "Capsule and data", "Range on an optional field, `.where()`, `.orderBy()`, `.limit()`, `.offset()`", "server", (f) => f.server.db.range],
  ["handlers", "Capsule and data", "`query()`, `mutation()`, `action()`", "artifact", (f) => f.handlers.queries + f.handlers.mutations + f.handlers.actions > 0],
  ["handlers-action", "Capsule and data", "`action()` handlers", "artifact", (f) => f.handlers.actions > 0, true],
  ["types-pagination", "Capsule and data", "`type PaginationOptions`, `Id<T>`", "none", () => null],
  ["collections", "Capsule and data", "`collections`, native `posts`, `content/posts/`", "server", (f) => f.server.options.has("collections") || f.files.contentPosts],
  ["sync", "Capsule and data", "`sync` declarations", "server", (f) => f.server.options.has("sync")],
  ["connectors", "Capsule and data", "`connectors`", "artifact", (f) => f.connectors > 0 || f.server.options.has("connectors")],
  ["favicon", "Capsule and data", "`favicon`", "server", (f) => f.server.options.has("favicon")],
  ["helpers", "Capsule and data", "Pure helpers, classes, local `shared/` modules", "artifact", (f) => f.files.shared],
  ["build-globals", "Capsule and data", "`declare const NAME` build globals", "none", () => null],
  ["theme-json", "Capsule and data", "`theme.json` site theme", "artifact", (f) => f.files.themeJson, true],
  ["sockets", "Capsule and data", "`sockets` declarations", "artifact", (f) => f.sockets > 0, true],
  // Identity
  ["auth-require-signin", "Identity", "`auth.requireSignIn`", "artifact", (f) => f.auth.requireSignIn],
  ["auth-guest-upgrade", "Identity", "`auth.onGuestUpgrade`", "server", (f) => f.server.authOptions.has("onGuestUpgrade")],
  ["auth-flags", "Identity", "`ctx.auth.isSignedIn`, `isAuthenticated`, `isGuest`, `displayName`", "server", (f) => has(f.server.auth, "isSignedIn", "isAuthenticated", "isGuest", "displayName")],
  ["auth-userid", "Identity", "`ctx.auth.userId` (with or without Space Users)", "server", (f) => f.server.auth.has("userId")],
  ["auth-require", "Identity", "`ctx.auth.requireSignedIn()`, `requireIdentity()`", "server", (f) => has(f.server.auth, "requireSignedIn", "requireIdentity")],
  ["auth-profile", "Identity", "`ctx.auth.email`, `picture`, `provider`, `subject`, `identityAliases`", "server", (f) => has(f.server.auth, "email", "emailVerified", "picture", "provider", "subject", "identityAliases")],
  ["auth-users-data", "Identity", "Users, passwords, sessions, Google bindings, Space Users subjects", "none", () => null],
  ["verify-user", "Identity", "`verifyUser()` (server SDK)", "server", (f) => has(f.server.imports, "verifyUser")],
  ["client-auth-signin", "Identity", "Client sign-in and identity (`signInWith*`, `signOut`, `getCurrentUser`, `getIdentity`)", "client", client((c) => has(c.zero, "signInWithGoogle", "signInWithGravatar", "signInWithSpacefast", "SignInWithGoogle", "SignInWithGravatar", "SignInWithSpacefast", "signOut", "getCurrentUser", "getIdentity", "retryAuth", "canAccessApp")), true],
  // Context services
  ["ctx-env", "Context services", "`ctx.env.NAME`", "server", (f) => f.server.ctx.has("env")],
  ["ctx-log", "Context services", "`ctx.log.info/warn/error/debug`", "server", (f) => f.server.ctx.has("log")],
  ["ctx-invalidate", "Context services", "`ctx.invalidate(...)`", "server", (f) => f.server.ctx.has("invalidate")],
  ["ctx-email", "Context services", "`ctx.email.send`", "server", (f) => f.server.ctx.has("email")],
  ["ctx-spam", "Context services", "`ctx.spam.check/reportSpam/reportHam`", "server", (f) => f.server.ctx.has("spam")],
  ["ctx-gravatar", "Context services", "`ctx.gravatar`", "server", (f) => f.server.ctx.has("gravatar")],
  ["ctx-crypto", "Context services", "`ctx.crypto.sha256/hmacSha256/timingSafeEqual`", "server", (f) => f.server.ctx.has("crypto")],
  ["ctx-jwt", "Context services", "`ctx.jwt.sign`", "server", (f) => f.server.ctx.has("jwt")],
  ["ctx-storage", "Context services", "`ctx.storage.list/get/delete`", "server", (f) => f.server.ctx.has("storage")],
  ["ctx-connectors", "Context services", "`ctx.connectors.<role>.<tool>()`", "server", (f) => f.server.ctx.has("connectors")],
  ["fetch", "Context services", "`fetch()` in actions", "server", (f) => f.server.globals.has("fetch")],
  ["ctx-dynamic", "Context services", "`ctx` passed to helpers or read dynamically", "server", (f) => f.server.ctxDynamic, true],
  // HTTP
  ["endpoint", "HTTP", "`endpoint({ method, path, readOnly })` for GET, POST, PUT, PATCH, DELETE", "artifact", (f) => any(f.endpoints, (e) => ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(e.method))],
  ["endpoint-results", "HTTP", "`json()`, `text()`, `empty()`, `redirect()`, plain values, `undefined` → 204", "server", (f) => f.endpoints.length > 0],
  ["endpoint-redirect", "HTTP", "`redirect()` responses", "server", (f) => has(f.server.imports, "redirect"), true],
  ["request-basic", "HTTP", "`request.text()`, `json()`, `headers.get/has`, `query.get/getAll/has`, `params`, `method`", "server", (f) => has(f.server.request, "text", "json", "headers", "query", "params", "method")],
  ["request-raw", "HTTP", "`request.url`, `bytes()`, `arrayBuffer()`, `headers.entries`", "server", (f) => has(f.server.request, "url", "bytes", "arrayBuffer", "headers.entries")],
  ["endpoint-head-options", "HTTP", "`HEAD`, `OPTIONS` endpoints", "artifact", (f) => any(f.endpoints, (e) => e.method === "HEAD" || e.method === "OPTIONS")],
  ["endpoint-param", "HTTP", "`:param` segments", "artifact", (f) => any(f.endpoints, (e) => /\/:(?!splat$)[^/]+/.test(e.path))],
  ["endpoint-splat", "HTTP", "A final `:splat` (0.8's only catch-all; `*` is refused at publish)", "artifact", (f) => any(f.endpoints, (e) => /\/:splat$/.test(e.path))],
  ["endpoint-writing-get", "HTTP", "A writing `GET` (`readOnly: false`)", "artifact", (f) => any(f.endpoints, (e) => e.method === "GET" && e.mode === "write")],
  ["endpoint-reserved", "HTTP", "Paths under `wp-*`, `feed`, `auth`, `__zero`, …", "artifact", (f) => any(f.endpoints, (e) => e.reserved)],
  ["image-response", "HTTP", "`ImageResponse`", "server", (f) => has(f.server.imports, "ImageResponse")],
  ["default-routes", "HTTP", "`/llms.txt`, `/api/ping` defaults", "none", () => null],
  // Pages and client
  ["pages-static", "Pages and client", "Static `pages/*.tsx` (no hooks, event attributes, browser globals, clocks, client or kit imports)", "artifact", (f) => any(f.pages, (p) => p.render === "document" && p.file.endsWith(".tsx"))],
  ["client-layout", "Pages and client", "`client/index.tsx` static `Layout`", "artifact", (f) => f.pages.length > 0 && f.files.clientEntry],
  ["pages-client", "Pages and client", "`\"use client\"` pages", "artifact", (f) => any(f.pages, (p) => p.render === "client"), true],
  ["client-standalone", "Pages and client", "Client app without pages (`client/` served as a single-page app)", "artifact", (f) => f.pages.length === 0 && f.files.clientEntry, true],
  ["hook-query", "Pages and client", "`useQuery`", "client", client((c) => has(c.zero, "useQuery"))],
  ["hook-mutation", "Pages and client", "`useMutation`, `useAction`", "client", client((c) => has(c.zero, "useMutation", "useAction"))],
  ["hook-auth", "Pages and client", "`useAuth`", "client", client((c) => has(c.zero, "useAuth"))],
  ["hook-state", "Pages and client", "Component state and effects (`useState`, `useEffect`, …)", "client", client((c) => c.preactHooks)],
  ["hook-paginated", "Pages and client", "`usePaginatedQuery`", "client", client((c) => has(c.zero, "usePaginatedQuery"))],
  ["kit", "Pages and client", "`@spacefast/zero/kit` components", "client", client((c) => c.modules.has("@spacefast/zero/kit"))],
  ["charts", "Pages and client", "`@spacefast/zero/charts`", "client", client((c) => c.modules.has("@spacefast/zero/charts") || c.modules.has("recharts"))],
  ["context-editor", "Pages and client", "`@spacefast/zero/context` (`ContextPage`, editor)", "client", client((c) => c.modules.has("@spacefast/zero/context"))],
  ["content-blocks", "Pages and client", "`@spacefast/zero/content` blocks (`PostLoop`, …)", "artifact", (f) => any(f.pages, (p) => p.render === "document" && p.bindingId)],
  ["islands", "Pages and client", "Islands (`client/` components in document pages)", "artifact", (f) => f.files.islands],
  ["pages-param", "Pages and client", "`pages/[param].tsx`", "artifact", (f) => any(f.pages, (p) => (p.params ?? []).length > 0)],
  ["pages-document", "Pages and client", "`pages/*.md`, `pages/*.html` documents", "artifact", (f) => any(f.pages, (p) => p.render === "document" && /\.(md|html)$/.test(p.file))],
  ["pages-system", "Pages and client", "`_pages/` system pages (404, access gate)", "artifact", (f) => f.files.systemPages],
  ["tailwind", "Pages and client", "Tailwind `first.css`", "artifact", (f) => f.client.present],
  ["realtime", "Pages and client", "Live updates, realtime", "artifact", (f) => f.realtime],
  // The compiler's generated mount imports `Router` and `Pages` for every client-page app, so
  // they do not count; `Router` counts only in a client app without pages, which mounts itself.
  ["router", "Pages and client", "`Link`, `navigate`, `Router`", "client", (f) => client((c) => has(c.zero, "Link", "navigate", "Routes", "Route", "useNavigate", "useLocation", "useParams", "usePageParams") || (f.pages.length === 0 && has(c.zero, "Router")))(f)],
  ["client-storage", "Pages and client", "Client `storage` uploads", "client", client((c) => has(c.zero, "storage")), true],
  ["client-connector-state", "Pages and client", "`useConnectorState`, `useConnectorRoleState`", "client", client((c) => has(c.zero, "useConnectorState", "useConnectorRoleState", "retryConnectorQueries")), true],
  ["client-content-query", "Pages and client", "`contentQueryOptions` content reads from the client", "client", client((c) => has(c.zero, "contentQueryOptions")), true],
  ["client-authenticated-fetch", "Pages and client", "`authenticatedFetch`", "client", client((c) => has(c.zero, "authenticatedFetch")), true],
  ["lucide", "Pages and client", "`lucide-react` icons", "client", client((c) => c.modules.has("lucide-react") || c.modules.has("lucide-preact")), true],
  ["lakebed", "Pages and client", "`lakebed/client` compatibility client", "client", client((c) => c.modules.has("lakebed/client") || c.modules.has("@spacefast/compat-lakebed/client")), true],
  // Engine routes. Every client that calls a handler goes through /__zero/run, and every
  // sign-in through /__zero/auth; the stored payload records which of those a Space can reach.
  ["route-run", "Engine routes", "`/__zero/run`", "artifact", (f) => f.handlers.queries + f.handlers.mutations + f.handlers.actions > 0],
  ["route-config", "Engine routes", "`/__zero/config`", "artifact", (f) => f.client.present],
  ["route-auth", "Engine routes", "`/__zero/auth/start`, `/sign-out`", "server", (f) => f.auth.requireSignIn || f.server.auth.size > 0],
  ["route-realtime", "Engine routes", "`/__zero/realtime/*`", "artifact", (f) => f.realtime],
  ["route-connectors", "Engine routes", "`/__spacefast/zero/connectors/<role>/*`", "artifact", (f) => f.connectors > 0],
].map(([id, section, label, source, detect, added = false]) => ({ id, section, label, source, detect, added }));
