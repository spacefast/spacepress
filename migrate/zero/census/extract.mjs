// Facts about one live 0.8 Space, from its stored finalize payload. features.mjs turns them into
// feature usage. Nothing here keeps a name, path or value from the Space beyond the call.
import { readPayload, serverImports } from "./reconstruct.mjs";

// SpacePress path segments the converter treats as owned by WordPress or SpacePress
// (`RESERVED` in migrate/src/zero/endpoints.rs), plus every `wp-*`.
export const RESERVED_SEGMENTS = new Set([
  "wp-admin", "wp-json", "wp-content", "wp-includes", "wp-login.php", "wp-signup.php", "wp-cron.php",
  "xmlrpc.php", "wp-sitemap.xml", "feed", "comments", "search", "author", "category", "tag", "page",
  "embed", "trackback", "robots.txt", "favicon.ico", "spacepress-admin", "auth", ".well-known",
  "__spacefast", "__zero", "identity", "index.php", "wp-config.php",
]);

const HANDLER_KEYS = ["queries", "mutations", "actions", "endpoints"];
const CLIENT_BUNDLE = "client.js";

function reserved(p) {
  const first = String(p).split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
  return RESERVED_SEGMENTS.has(first) || first.startsWith("wp-");
}

/** Facts for one finalize payload. `ts` is the TypeScript module. */
export function extract(ts, finalize) {
  const { artifact, bundle, error } = readPayload(finalize);
  if (error) return null;
  const server = artifact.server ?? {};
  const files = (artifact.sourceManifest?.files ?? []).map((f) => String(f.path ?? ""));
  const entries = artifact.sourceManifest?.entries ?? {};
  const pages = (artifact.pages ?? []).map((p) => ({
    render: p.render,
    file: String(p.file ?? ""),
    params: p.params ?? [],
    bindingId: Boolean(p.bindingId),
  }));
  const clientEntry = Boolean(entries.client) && files.includes(entries.client);
  const schema = { tables: 0, types: new Set(), optional: false, defaults: false, userReference: false, indexes: 0, unique: false };
  const optionalFields = new Map();
  for (const [name, table] of Object.entries(server.schema ?? {})) {
    schema.tables++;
    const optional = new Set();
    for (const c of table.columns ?? []) {
      schema.types.add(c.type);
      if (c.optional || c.nullable) {
        schema.optional = true;
        optional.add(c.name);
      }
      if ("default" in c) schema.defaults = true;
      if (c.userReference) schema.userReference = true;
    }
    optionalFields.set(name, optional);
    for (const i of table.indexes ?? []) {
      schema.indexes++;
      if (i.unique) schema.unique = true;
    }
  }
  return {
    entries: { server: entries.server ?? "server/index.ts" },
    schema,
    handlers: {
      queries: (server.queries ?? []).length,
      mutations: (server.mutations ?? []).length,
      actions: (server.actions ?? []).length,
    },
    endpoints: (server.endpoints ?? []).map((e) => ({
      method: String(e.method ?? "").toUpperCase(),
      path: String(e.path ?? ""),
      mode: e.mode,
      reserved: reserved(e.path ?? ""),
    })),
    sockets: (server.sockets ?? []).length,
    connectors: (artifact.connectors ?? []).length,
    auth: { requireSignIn: finalize.auth?.requireSignIn === true },
    pages,
    files: {
      shared: files.some((f) => f.startsWith("shared/")),
      contentPosts: files.some((f) => f.startsWith("content/posts/")),
      themeJson: files.includes("theme.json"),
      islands: files.some((f) => f.startsWith("islands/")),
      systemPages: files.some((f) => f.startsWith("_pages/")),
      clientEntry,
    },
    server: serverFacts(ts, bundle, optionalFields),
    client: clientFacts(ts, finalize, pages, clientEntry),
  };
}

function emptyServer() {
  return {
    capsule: false,
    imports: new Set(),
    options: new Set(),
    authOptions: new Set(),
    ctx: new Set(),
    auth: new Set(),
    request: new Set(),
    globals: new Set(),
    calls: new Set(),
    ctxDynamic: false,
    db: { crud: false, query: false, paginate: false, range: false },
  };
}

/** Server facts from the bundle: SDK imports, capsule options, and what handlers do with ctx. */
export function serverFacts(ts, text, optionalFields = new Map()) {
  const out = emptyServer();
  if (!text) return out;
  const sf = ts.createSourceFile("index.js", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const imports = serverImports(ts, sf);
  out.imports = new Set(imports.keys());
  const local = new Map([...imports].map(([exported, name]) => [name, exported]));
  // Top-level functions by name, so ctx and request can be followed into helpers.
  const functions = new Map();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) functions.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          functions.set(d.name.text, d.initializer);
        }
      }
    }
  }
  const sdk = (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression) ? local.get(node.expression.text) : undefined;
  const visitAll = (node) => {
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === "fetch") out.globals.add("fetch");
      if (ts.isPropertyAccessExpression(node.expression)) out.calls.add(node.expression.name.text);
      if (sdk(node) === "capsule") capsuleOptions(node);
    }
    ts.forEachChild(node, visitAll);
  };
  const seen = new Set();
  const analyze = (fn, roles) => {
    const key = `${fn.pos}:${[...roles].join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);
    roles.forEach((role, index) => {
      const param = fn.parameters?.[index];
      if (!param) return;
      if (ts.isObjectBindingPattern(param.name)) {
        for (const el of param.name.elements) {
          const name = (el.propertyName ?? el.name).getText(sf);
          if (role === "ctx") out.ctx.add(name);
          else out.request.add(name);
        }
        return;
      }
      if (ts.isIdentifier(param.name)) follow(fn.body, param.name.text, role);
    });
  };
  const follow = (body, name, role) => {
    if (!body) return;
    const aliases = new Map(); // a local bound to ctx.<member>, e.g. `const db = ctx.db`
    const visit = (node) => {
      if (ts.isIdentifier(node) && node.text === name && !isDeclarationName(ts, node)) use(node, role);
      else if (ts.isIdentifier(node) && aliases.has(node.text) && !isDeclarationName(ts, node)) member(node, aliases.get(node.text));
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isPropertyAccessExpression(node.initializer)
        && ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === name && role === "ctx") {
        if (ts.isIdentifier(node.name)) aliases.set(node.name.text, node.initializer.name.text);
        else if (ts.isObjectBindingPattern(node.name) && node.initializer.name.text === "auth") {
          for (const el of node.name.elements) out.auth.add((el.propertyName ?? el.name).getText(sf));
        }
      }
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.initializer) && node.initializer.text === name
        && ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          const n = (el.propertyName ?? el.name).getText(sf);
          if (role === "ctx") {
            out.ctx.add(n);
            if (ts.isIdentifier(el.name)) aliases.set(el.name.text, n);
          } else out.request.add(n);
        }
      }
      ts.forEachChild(node, visit);
    };
    const member = (node, prop) => {
      // node is an alias of ctx.<prop>
      const p = node.parent;
      if (ts.isPropertyAccessExpression(p) && p.expression === node) serviceUse(prop, p);
    };
    const use = (node, r) => {
      const p = node.parent;
      if (ts.isPropertyAccessExpression(p) && p.expression === node) {
        const prop = p.name.text;
        if (r === "ctx") {
          out.ctx.add(prop);
          const gp = p.parent;
          if (ts.isPropertyAccessExpression(gp) && gp.expression === p) serviceUse(prop, gp);
        } else {
          const gp = p.parent;
          const sub = ts.isPropertyAccessExpression(gp) && gp.expression === p ? `${prop}.${gp.name.text}` : null;
          out.request.add(prop);
          if (sub) out.request.add(sub);
        }
        return;
      }
      // Passed to a local helper: follow the helper's matching parameter.
      if (ts.isCallExpression(p) && p.arguments.includes(node) && ts.isIdentifier(p.expression) && functions.has(p.expression.text)) {
        const roles = [];
        roles[p.arguments.indexOf(node)] = r;
        analyze(functions.get(p.expression.text), roles);
        return;
      }
      if (r === "ctx") out.ctxDynamic = true;
    };
    visit(body);
  };
  // `ctx.<service>.<x>` or an alias of ctx.<service> read as `.x`.
  const serviceUse = (service, access) => {
    if (service === "auth") out.auth.add(access.name.text);
    if (service === "db") dbChain(access);
  };
  const dbChain = (tableAccess) => {
    const table = tableAccess.name.text;
    // Walk up the method chain from ctx.db.<table>.
    let node = tableAccess;
    while (node.parent && (ts.isPropertyAccessExpression(node.parent) || ts.isCallExpression(node.parent))) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        const m = parent.name.text;
        if (["get", "insert", "update", "delete"].includes(m)) out.db.crud = true;
        if (["withIndex", "order", "collect", "take", "first", "count"].includes(m)) out.db.query = true;
        if (m === "paginate") out.db.paginate = true;
        if (["where", "orderBy", "limit", "offset", "filter"].includes(m)) out.db.range = true;
        if (m === "withIndex" && ts.isCallExpression(parent.parent)) rangeOnOptional(parent.parent, optionalFields.get(table));
      } else if (!(ts.isCallExpression(parent) && parent.expression === node)) break;
      node = parent;
    }
  };
  const rangeOnOptional = (call, optional) => {
    const range = call.arguments[1];
    if (!range || !optional?.size) return;
    const visit = (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["gt", "gte", "lt", "lte"].includes(n.expression.name.text)) {
        const field = n.arguments[0];
        if (field && ts.isStringLiteral(field) && optional.has(field.text)) out.db.range = true;
      }
      ts.forEachChild(n, visit);
    };
    visit(range);
  };
  const capsuleOptions = (call) => {
    out.capsule = true;
    const options = call.arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options)) return;
    for (const prop of options.properties) {
      const key = prop.name ? propName(ts, prop.name) : null;
      if (!key) continue;
      out.options.add(key);
      if (key === "auth" && ts.isPropertyAssignment(prop) && ts.isObjectLiteralExpression(prop.initializer)) {
        for (const a of prop.initializer.properties) {
          const k = a.name ? propName(ts, a.name) : null;
          if (k) out.authOptions.add(k);
          if (k === "onGuestUpgrade") {
            const fn = ts.isPropertyAssignment(a) ? a.initializer : a;
            if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isMethodDeclaration(fn)) analyze(fn, ["ctx"]);
          }
        }
      }
      if (!HANDLER_KEYS.includes(key) || !ts.isPropertyAssignment(prop)) continue;
      const handlers = ts.isObjectLiteralExpression(prop.initializer) ? prop.initializer.properties : [];
      for (const h of handlers) {
        const init = ts.isPropertyAssignment(h) ? h.initializer : null;
        if (!init || !ts.isCallExpression(init)) continue;
        const fn = [...init.arguments].reverse().find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        const named = !fn && init.arguments.find((a) => ts.isIdentifier(a) && functions.has(a.text));
        const target = fn ?? (named ? functions.get(named.text) : null);
        if (target) analyze(target, key === "endpoints" ? ["ctx", "request"] : ["ctx"]);
        else out.ctxDynamic = true;
      }
    }
  };
  visitAll(sf);
  return out;
}

function propName(ts, name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

function isDeclarationName(ts, node) {
  const p = node.parent;
  return (ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isBindingElement(p) || ts.isFunctionDeclaration(p)) && p.name === node;
}

/** Client facts from the uploaded `client.js`, when the payload kept its bytes. */
export function clientFacts(ts, finalize, pages, clientEntry) {
  const present = pages.some((p) => p.render === "client") || (pages.length === 0 && clientEntry);
  const file = (finalize.staticFiles ?? []).find((f) => f?.path === CLIENT_BUNDLE && f.contentBase64);
  if (!present || !file) return { present, measured: false, zero: new Set(), modules: new Set(), preactHooks: false, dynamicImport: false };
  return { present, measured: true, ...clientBundleFacts(ts, Buffer.from(file.contentBase64, "base64").toString("utf8")) };
}

// SDK names whose bundled definition survives in client.js when imported from
// `@spacefast/zero/react` (bundled) instead of `@spacefast/zero/client` (external).
const CLIENT_NAMES = [
  "useQuery", "useMutation", "useAction", "useAuth", "usePaginatedQuery", "Link", "navigate", "Router",
  "Routes", "Route", "useNavigate", "useLocation", "useParams", "usePageParams", "storage",
  "signInWithGoogle", "signInWithGravatar", "signInWithSpacefast", "signOut", "getCurrentUser",
  "getIdentity", "retryAuth", "canAccessApp", "authenticatedFetch", "contentQueryOptions",
  "useConnectorState", "useConnectorRoleState", "retryConnectorQueries",
  "SignInWithGoogle", "SignInWithGravatar", "SignInWithSpacefast",
];
const HOOK_NAMES = new Set(["useState", "useEffect", "useReducer", "useRef", "useMemo", "useCallback", "useLayoutEffect", "useContext"]);
const ZERO_CLIENT_MODULES = new Set(["@spacefast/zero/client", "lakebed/client", "@spacefast/compat-lakebed/client"]);

/** Imports `client.js` leaves to the platform import map, and SDK functions it bundled. */
export function clientBundleFacts(ts, text) {
  const sf = ts.createSourceFile("client.js", text, ts.ScriptTarget.ES2022, false, ts.ScriptKind.JS);
  const zero = new Set();
  const modules = new Set();
  let preactHooks = false;
  // esbuild keeps `import()` when it can't resolve the target statically.
  const dynamicImport = /\bimport\(/.test(text);
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) && !(ts.isExportDeclaration(st) && st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    modules.add(spec);
    const names = ts.isImportDeclaration(st)
      ? [...(st.importClause?.namedBindings?.elements ?? [])].map((el) => (el.propertyName ?? el.name).text)
      : [];
    if (ZERO_CLIENT_MODULES.has(spec)) names.forEach((n) => zero.add(n));
    if (/^(preact\/hooks|preact\/compat|react|react-dom)$/.test(spec) && names.some((n) => HOOK_NAMES.has(n))) preactHooks = true;
  }
  for (const n of CLIENT_NAMES) {
    if (new RegExp(`function ${n}\\d*\\(`).test(text)) zero.add(n);
  }
  return { zero, modules, preactHooks, dynamicImport };
}

export const _test = { reserved };
