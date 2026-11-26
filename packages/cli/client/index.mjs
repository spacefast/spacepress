// Generated from runtime/client/index.ts by packages/client/scripts/sync.mjs.
// @spacepress/client: zero-dependency fetch client supporting WordPress Abilities and SpacePress REST.

function registry() {
    const g = globalThis;
    return g.__spRealtime ??= {
        waiters: new Set()
    };
}
export function registerRealtimeTransport(transport) {
    const r = registry();
    r.transport = transport;
    for (const wake of [
        ...r.waiters
    ])wake();
}
export class SpacePressError extends Error {
    status;
    code;
    detail;
    title;
    type;
    pointer;
    constructor(problem){
        super(problem.detail);
        this.name = "SpacePressError";
        this.status = problem.status;
        this.code = problem.code;
        this.detail = problem.detail;
        this.title = problem.title;
        this.type = problem.type;
        this.pointer = problem.pointer;
    }
}
function networkError(detail) {
    return new SpacePressError({
        type: "about:blank",
        title: "Network error",
        status: 0,
        code: "network",
        detail
    });
}
const isObject = (v)=>typeof v === "object" && v !== null && !Array.isArray(v);
function orderParam(order) {
    if (typeof order === "string") return order;
    if (!isObject(order)) return "";
    return Object.entries(order).filter(([, dir])=>dir === "asc" || dir === "desc").map(([col, dir])=>dir === "desc" ? `-${col}` : col).join(",");
}
function orderObject(order) {
    if (typeof order !== "string") return order;
    const out = {};
    for (const part of order.split(",").map((s)=>s.trim()).filter(Boolean)){
        out[part.replace(/^[-+]/, "")] = part.startsWith("-") ? "desc" : "asc";
    }
    return out;
}
function withJson(w) {
    const out = {};
    for (const [name, v] of Object.entries(w)){
        if (v === true) out[name] = true;
        else if (isObject(v)) {
            out[name] = {
                ...v,
                ...v.orderBy !== undefined ? {
                    orderBy: orderObject(v.orderBy)
                } : {},
                ...isObject(v.with) ? {
                    with: withJson(v.with)
                } : {}
            };
        }
    }
    return out;
}
function withParam(w) {
    if (!isObject(w)) return "";
    const json = withJson(w);
    const names = Object.keys(json);
    if (names.length === 0) return "";
    return names.some((n)=>json[n] !== true) ? JSON.stringify(json) : names.join(",");
}
function listParams(q) {
    const p = new URLSearchParams();
    if (!q) return p;
    if (q.where !== undefined) p.set("where", JSON.stringify(q.where));
    if (typeof q.status === "string") p.set("status", q.status);
    if (typeof q.locale === "string") p.set("locale", q.locale);
    if (typeof q.deleted === "string") p.set("deleted", q.deleted);
    if (q.orderBy !== undefined) {
        const order = orderParam(q.orderBy);
        if (order) p.set("orderBy", order);
    }
    if (typeof q.limit === "number") p.set("limit", String(q.limit));
    if (typeof q.offset === "number") p.set("offset", String(q.offset));
    const w = withParam(q.with);
    if (w) p.set("with", w);
    return p;
}
function liveArgs(q) {
    const args = {};
    if (!q) return args;
    const where = typeof q.status !== "string" ? q.where : q.where === undefined ? {
        status: q.status
    } : {
        AND: [
            q.where,
            {
                status: q.status
            }
        ]
    };
    if (where !== undefined) args.where = where;
    const order = orderObject(q.orderBy);
    if (isObject(order) && Object.keys(order).length > 0) args.orderBy = order;
    if (typeof q.limit === "number") args.limit = q.limit;
    if (typeof q.offset === "number") args.offset = q.offset;
    if (typeof q.cursor === "string") args.cursor = q.cursor;
    if (typeof q.locale === "string") args.locale = q.locale;
    if (typeof q.deleted === "string") args.deleted = q.deleted;
    if (isObject(q.with) && Object.keys(withJson(q.with)).length > 0) args.with = withJson(q.with);
    return args;
}
const seg = (v)=>encodeURIComponent(String(v));
function inputQuery(input) {
    return Object.keys(input).length === 0 ? undefined : new URLSearchParams({
        input: JSON.stringify(input)
    });
}
function encodeCursor(offset) {
    return btoa(JSON.stringify({
        offset
    })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function decodeCursor(cursor) {
    try {
        const text = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
        const m = /^\{"offset":([1-9][0-9]{0,14})\}$/.exec(text);
        if (m) return Number(m[1]);
    } catch  {}
    throw invalidQuery("cursor is not one paginate() returned", "/cursor");
}
function invalidQuery(detail, pointer) {
    return new SpacePressError({
        type: "about:blank",
        title: "Invalid query",
        status: 400,
        code: "invalid_query",
        detail,
        pointer
    });
}
const DEFAULT_API = "/spacepress/v1";
function endpoints(url) {
    const [path, search = ""] = url.split(/\?(.*)/s, 2);
    const trimmed = path.replace(/\/+$/, "");
    const suffix = search ? `?${search}` : "";
    const params = new URLSearchParams(search);
    const restRoute = params.get("rest_route");
    if (restRoute !== null) {
        const route = restRoute.replace(/^\/*/, "/").replace(/\/+$/, "");
        params.set("rest_route", "");
        return {
            root: `${path}?${params}`,
            api: route || DEFAULT_API
        };
    }
    const prefix = /\/wp-json(?=\/|$)/.exec(trimmed);
    if (prefix) {
        const split = prefix.index + "/wp-json".length;
        const route = trimmed.slice(split).replace(/^\/*/, "/").replace(/\/+$/, "");
        return {
            root: trimmed.slice(0, split) + suffix,
            api: route || DEFAULT_API
        };
    }
    if (trimmed.endsWith(DEFAULT_API)) return {
        root: trimmed.slice(0, -DEFAULT_API.length) + suffix,
        api: DEFAULT_API
    };
    return {
        root: `${trimmed}/wp-json` + suffix,
        api: DEFAULT_API
    };
}
function restUrl(root, route, query) {
    const [path, search = ""] = root.split(/\?(.*)/s, 2);
    const params = new URLSearchParams(search);
    const restRoute = params.get("rest_route");
    if (restRoute !== null) {
        params.set("rest_route", restRoute.replace(/\/+$/, "") + route);
        return `${path}?${params}${query ? `&${query}` : ""}`;
    }
    const suffix = [
        search,
        query
    ].filter(Boolean).join("&");
    return path.replace(/\/+$/, "") + route + (suffix ? `?${suffix}` : "");
}
function pageData() {
    const doc = globalThis.document;
    const text = doc?.querySelector?.('script[type="application/json"][id="wp-script-module-data-@spacepress/client"]')?.textContent;
    if (!text) return null;
    try {
        const v = JSON.parse(text);
        return isObject(v) ? v : null;
    } catch  {
        return null;
    }
}
const browser = ()=>globalThis;
const PKCE_KEY = "spacepress.auth.pkce";
function base64url(bytes) {
    let bin = "";
    for (const b of bytes)bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function randomString(bytes) {
    return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}
async function s256(verifier) {
    return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}
function authError(status, code, detail) {
    return new SpacePressError({
        type: "about:blank",
        title: code,
        status,
        code,
        detail
    });
}
const refreshes = new Map();
export function bind(schema) {
    return (options = {})=>createClient(schema, options);
}
export function createClient(SCHEMA, options = {}) {
    if (!SCHEMA || typeof SCHEMA !== "object" || !SCHEMA.collections) {
        throw new TypeError("createClient(schema, options?) requires a SpacePress SCHEMA descriptor (or use bind(SCHEMA))");
    }
    const site = options.wordpress === false || options.url !== undefined ? null : pageData();
    const pageRoot = typeof site?.root === "string" && site.root !== "" ? site.root : null;
    const given = options.api !== undefined && options.url !== undefined ? {
        root: options.url,
        api: "/" + options.api.replace(/^\/+|\/+$/g, "")
    } : null;
    const resolved = given ?? endpoints(options.url ?? "/wp-json");
    const root = pageRoot ?? resolved.root;
    const API = options.api !== undefined ? "/" + options.api.replace(/^\/+|\/+$/g, "") : typeof site?.api === "string" && site.api.startsWith("/") ? site.api : resolved.api;
    const cookie = site !== null && (options.wordpress === true || options.fetch === undefined && options.headers === undefined && options.nonce === undefined && options.auth === undefined);
    let nonce = options.nonce ?? (cookie ? site?.nonce : undefined);
    const pageNonce = cookie && options.nonce === undefined;
    const base = (options.url ?? "/wp-json/spacepress/v1").replace(/\/+$/, "");
    const app = SCHEMA.app;
    const authOpts = options.auth ?? {};
    const doFetch = (input, init)=>(options.fetch ?? globalThis.fetch)(input, init);
    const storageKey = `spacepress.auth:${base}`;
    let memory = {};
    function stored() {
        if (authOpts.storage !== "session") return memory;
        const raw = browser().sessionStorage?.getItem(storageKey);
        if (!raw) return {};
        try {
            const v = JSON.parse(raw);
            return isObject(v) ? v : {};
        } catch  {
            return {};
        }
    }
    function store(next) {
        if (authOpts.storage !== "session") {
            memory = next;
            return;
        }
        browser().sessionStorage?.setItem(storageKey, JSON.stringify(next));
    }
    function held() {
        const v = stored();
        return typeof v.accessToken === "string" && typeof v.refreshToken === "string" ? v : null;
    }
    const sidOf = (v)=>v?.sid ?? v?.accessToken ?? "";
    const currentSid = ()=>sidOf(stored());
    function switchTo(next, from) {
        if (currentSid() !== from) return false;
        store({
            ...next ?? {},
            sid: randomString(12)
        });
        identityChanged?.();
        return true;
    }
    let identityChanged = null;
    function hold(next, sid) {
        store({
            ...next,
            sid
        });
    }
    const expiresAt = (expiresIn)=>Date.now() + expiresIn * 1000;
    async function call(url, init, label) {
        let res;
        let text;
        try {
            res = await doFetch(url, init);
            text = await res.text();
        } catch (e) {
            throw networkError(`${label}: ${e instanceof Error ? e.message : String(e)}`);
        }
        try {
            return {
                res,
                parsed: text === "" ? undefined : JSON.parse(text)
            };
        } catch  {
            throw networkError(`${label}: HTTP ${res.status} with a non-JSON body`);
        }
    }
    async function request(method, path, send = {}, retried = false) {
        const qs = send.query?.toString();
        const headers = {
            accept: "application/json"
        };
        const tokens = send.anonymous ? null : held();
        const started = currentSid();
        if (tokens) headers.authorization = `Bearer ${tokens.accessToken}`;
        const sendNonce = nonce !== undefined && (options.nonce !== undefined || !tokens);
        if (sendNonce && nonce !== undefined) headers["x-wp-nonce"] = nonce;
        let body;
        if (send.form) body = send.form;
        else if (send.json !== undefined) {
            headers["content-type"] = "application/json";
            body = JSON.stringify(send.json);
        }
        for (const [k, v] of Object.entries(options.headers ?? {}))headers[k.toLowerCase()] = v;
        const init = {
            method,
            headers,
            body
        };
        if (sendNonce) init.credentials = "same-origin";
        else if (tokens) init.credentials = "omit";
        const sentPageNonce = pageNonce && sendNonce && headers["x-wp-nonce"] === nonce;
        const address = restUrl(root, path, qs);
        const label = `${method} ${path}`;
        let { res, parsed } = await call(address, init, label);
        const expired = res.status === 403 && (isObject(parsed) && parsed.code === "rest_cookie_invalid_nonce" || res.headers?.get("spacepress-reason") === "rest_cookie_invalid_nonce");
        if (expired && sentPageNonce && !retried && currentSid() === started) {
            const fresh = await freshNonce();
            if (fresh !== null && currentSid() === started) {
                nonce = fresh;
                headers["x-wp-nonce"] = fresh;
                ({ res, parsed } = await call(address, init, label));
                retried = true;
            }
        }
        const renewed = sentPageNonce ? res.headers?.get("x-wp-nonce") : null;
        if (renewed) nonce = renewed;
        if (res.ok) return unwrapped(parsed, send, label);
        const error = toError(res, parsed);
        if (error.status === 401 && (error.code === "unauthenticated" || error.code === "invalid_token") && !send.anonymous && !retried) {
            if (tokens && headers.authorization === `Bearer ${tokens.accessToken}`) {
                if (currentSid() === started && await renew(tokens) && currentSid() === started) return request(method, path, send, true);
            } else if (!tokens && authOpts.guests && method !== "GET" && headers.authorization === undefined) {
                if (!held()) await startGuest(started).catch(()=>undefined);
                if (guestSid !== "" && currentSid() === guestSid && guestFromSid === started) return request(method, path, send, true);
            }
        }
        throw error;
    }
    async function freshNonce() {
        const endpoint = site?.nonceEndpoint;
        const session = site?.nonceSession;
        if (typeof endpoint !== "string" || typeof session !== "string") return null;
        try {
            const res = await doFetch(endpoint, {
                credentials: "same-origin",
                mode: "same-origin",
                cache: "no-store",
                headers: {
                    "x-spacepress-rest-session": session
                }
            });
            if (res.status === 409) throw authError(409, "session_changed", "The WordPress login session changed. Reload the page.");
            const text = res.ok ? (await res.text()).trim() : "";
            return /^[a-z0-9]{10}$/i.test(text) ? text : null;
        } catch (error) {
            if (error instanceof SpacePressError) throw error;
            return null;
        }
    }
    function unwrapped(parsed, send, label) {
        if (send.raw) return parsed === undefined ? null : parsed;
        if (!isObject(parsed) || !("data" in parsed)) throw networkError(`${label}: response has no data`);
        return send.envelope ? {
            rows: parsed.data,
            cursor: parsed.cursor ?? null
        } : parsed.data;
    }
    async function ability(name, input, annotations = {}) {
        const full = `${app}/${name}`;
        const route = `/wp-abilities/v1/abilities/${full}/run`;
        const method = annotations.readonly ? "GET" : annotations.destructive && annotations.idempotent ? "DELETE" : "POST";
        if (method === "POST") return request("POST", route, {
            json: {
                input
            },
            raw: true
        });
        return request(method, route, {
            query: inputQuery(input),
            raw: true
        });
    }
    function renew(sent) {
        const current = held();
        if (!current) return Promise.resolve(false);
        if (current.accessToken !== sent.accessToken) return Promise.resolve(true);
        const key = `${authOpts.storage === "session" ? storageKey : clientKey}#${currentSid()}`;
        const shared = refreshes.get(key);
        if (shared) return shared;
        const started = refresh(current).finally(()=>{
            if (refreshes.get(key) === started) refreshes.delete(key);
        });
        refreshes.set(key, started);
        return started;
    }
    const clientKey = `memory:${randomString(9)}`;
    async function refresh(current) {
        const started = currentSid();
        const keep = (next)=>{
            if (currentSid() !== started) return false;
            hold(next, started);
            return true;
        };
        try {
            const clientId = current.clientId ?? authOpts.clientId ?? "";
            const out = await issuerPost("/token", {
                grant_type: "refresh_token",
                refresh_token: current.refreshToken,
                client_id: clientId
            });
            return keep({
                accessToken: out.access_token,
                refreshToken: out.refresh_token,
                expiresAt: expiresAt(out.expires_in),
                ...current.clientId !== undefined ? {
                    clientId: current.clientId
                } : {},
                ...(out.id_token ?? current.idToken) !== undefined ? {
                    idToken: out.id_token ?? current.idToken
                } : {}
            });
        } catch (e) {
            if (!(e instanceof SpacePressError) || e.status !== 0) switchTo(null, started);
            return false;
        }
    }
    function adopt(out, from) {
        const adopted = switchTo({
            accessToken: out.accessToken,
            refreshToken: out.refreshToken,
            expiresAt: expiresAt(out.expiresIn),
            ...typeof out.clientId === "string" ? {
                clientId: out.clientId
            } : {}
        }, from);
        if (!adopted) throw authError(409, "session_changed", "Another sign-in or sign-out happened first");
        return out.user;
    }
    let guestSid = "";
    let guestFromSid = "";
    const guestings = new Map();
    function startGuest(from) {
        const existing = guestings.get(from);
        if (existing) return existing;
        const started = request("POST", `${API}/auth/guest`, {
            json: {},
            anonymous: true
        }).then((out)=>{
            const user = adopt(out, from);
            guestFromSid = from;
            guestSid = currentSid();
            return user;
        }).finally(()=>{
            if (guestings.get(from) === started) guestings.delete(from);
        });
        guestings.set(from, started);
        return started;
    }
    let issuerUrl = authOpts.issuer?.replace(/\/+$/, "");
    async function issuer() {
        if (issuerUrl === undefined) {
            const config = await request("GET", `${API}/auth/config`, {
                anonymous: true
            });
            if (typeof config.issuer !== "string") throw authError(400, "not_supported", "This app has no sign-in issuer");
            issuerUrl = config.issuer.replace(/\/+$/, "");
        }
        return issuerUrl;
    }
    async function issuerPost(path, form, accessToken) {
        const url = await issuer() + path;
        const headers = {
            "content-type": "application/x-www-form-urlencoded"
        };
        if (accessToken !== undefined) headers.authorization = `Bearer ${accessToken}`;
        const { res, parsed } = await call(url, {
            method: "POST",
            headers,
            body: new URLSearchParams(form).toString()
        }, `POST ${url}`);
        if (res.ok) return parsed;
        const body = isObject(parsed) ? parsed : {};
        const code = typeof body.error === "string" ? body.error : "http_error";
        throw authError(res.status, code, typeof body.error_description === "string" ? body.error_description : `HTTP ${res.status}`);
    }
    async function redirectToIssuer(returnTo, extra) {
        const { clientId, redirectUri } = authOpts;
        if (!clientId || !redirectUri) throw authError(400, "invalid_input", "auth.clientId and auth.redirectUri are required to sign in");
        const { sessionStorage, location } = browser();
        if (!sessionStorage || !location) throw authError(400, "not_supported", "Redirect sign-in needs a browser");
        const verifier = randomString(64);
        const state = randomString(32);
        const nonce = randomString(32);
        const params = new URLSearchParams({
            response_type: "code",
            client_id: clientId,
            redirect_uri: redirectUri,
            scope: "openid profile email",
            state,
            nonce,
            code_challenge: await s256(verifier),
            code_challenge_method: "S256",
            ...extra
        });
        const url = `${await issuer()}/authorize?${params}`;
        sessionStorage.setItem(PKCE_KEY, JSON.stringify({
            verifier,
            state,
            nonce,
            ...returnTo !== undefined ? {
                returnTo
            } : {}
        }));
        location.assign(url);
        return new Promise(()=>{});
    }
    const auth = {
        signIn (opts = {}) {
            return redirectToIssuer(opts.returnTo, {});
        },
        async handleCallback () {
            const { sessionStorage, location } = browser();
            const params = new URLSearchParams(location?.search ?? "");
            let pkce = {};
            try {
                const v = JSON.parse(sessionStorage?.getItem(PKCE_KEY) ?? "null");
                if (isObject(v)) pkce = v;
            } catch  {}
            const state = params.get("state");
            if (typeof pkce.state !== "string" || typeof pkce.verifier !== "string" || state !== pkce.state) {
                throw authError(400, "invalid_state", "This sign-in response does not match a sign-in started here");
            }
            sessionStorage?.removeItem(PKCE_KEY);
            const failed = params.get("error");
            if (failed) throw authError(400, failed, params.get("error_description") ?? failed);
            const code = params.get("code");
            if (!code) throw authError(400, "invalid_input", "The sign-in response has no code");
            const clientId = authOpts.clientId ?? "";
            const from = currentSid();
            const out = await issuerPost("/token", {
                grant_type: "authorization_code",
                code,
                redirect_uri: authOpts.redirectUri ?? "",
                client_id: clientId,
                code_verifier: pkce.verifier
            });
            if (!switchTo({
                accessToken: out.access_token,
                refreshToken: out.refresh_token,
                expiresAt: expiresAt(out.expires_in),
                clientId,
                ...out.id_token !== undefined ? {
                    idToken: out.id_token
                } : {}
            }, from)) throw authError(409, "session_changed", "Another sign-in or sign-out happened first");
            const user = await auth.me();
            if (!user) throw authError(401, "unauthenticated", "The issuer's tokens were not accepted");
            if (typeof pkce.returnTo === "string" && location && authOpts.storage === "session") {
                let to = null;
                try {
                    to = new URL(pkce.returnTo, location.href);
                } catch  {
                    to = null;
                }
                if (to && to.origin === new URL(location.href).origin) location.assign(to.href);
            }
            return user;
        },
        guest: ()=>startGuest(currentSid()),
        async upgrade () {
            const current = held();
            if (!current) throw authError(401, "unauthenticated", "Only a guest session can be upgraded");
            const { handoff } = await issuerPost("/handoff", {}, current.accessToken);
            return redirectToIssuer(undefined, {
                handoff
            });
        },
        me: ()=>request("GET", `${API}/me`),
        async signOut (opts = {}) {
            const current = held();
            const from = currentSid();
            if (!current) {
                switchTo(null, from);
                return;
            }
            try {
                await issuerPost("/revoke", {
                    token: current.refreshToken,
                    client_id: current.clientId ?? authOpts.clientId ?? ""
                });
            } catch (e) {
                if (!(e instanceof SpacePressError && e.status === 401)) throw e;
            } finally{
                switchTo(null, from);
            }
            if (opts.returnTo !== undefined && current.idToken !== undefined) {
                const params = new URLSearchParams({
                    id_token_hint: current.idToken,
                    post_logout_redirect_uri: opts.returnTo
                });
                browser().location?.assign(`${await issuer()}/logout?${params}`);
            }
        },
        session () {
            const current = held();
            return current ? {
                accessToken: current.accessToken,
                refreshToken: current.refreshToken,
                expiresAt: current.expiresAt
            } : null;
        }
    };
    const rtOpts = options.realtime ?? {};
    const pollOpt = rtOpts.pollMs;
    const pollMs = pollOpt === false ? false : typeof pollOpt === "number" ? pollOpt : pollOpt?.max ?? 30_000;
    const livePollMs = rtOpts.livePollMs === undefined ? 60_000 : rtOpts.livePollMs;
    const listeners = new Set();
    const statusListeners = new Set();
    let disconnect = null;
    let live = false;
    let poller = null;
    let pollerLive = false;
    const dispatch = (notice)=>{
        for (const l of [
            ...listeners
        ]){
            if (notice === null ? l.poll : l.collections === null || notice.changes.some((c)=>l.collections?.has(c.collection))) l.onChange(notice);
        }
    };
    const syncPolling = ()=>{
        const every = live ? livePollMs : pollMs;
        const want = [
            ...listeners
        ].some((l)=>l.poll) && every !== false;
        if (poller !== null && (!want || pollerLive !== live)) {
            clearTimeout(poller);
            poller = null;
        }
        if (!want || poller !== null) return;
        pollerLive = live;
        const delay = live ? Math.round(every * (0.8 + Math.random() * 0.4)) : every;
        poller = setTimeout(()=>{
            poller = null;
            dispatch(null);
            syncPolling();
        }, delay);
    };
    const connect = ()=>{
        if (disconnect !== null || listeners.size === 0 || rtOpts.transport === false) return;
        const transport = rtOpts.transport ?? registry().transport;
        if (!transport || typeof transport.connect !== "function") return;
        registry().waiters.delete(connect);
        let current = true;
        const stop = transport.connect((notice)=>{
            if (current && isObject(notice) && Array.isArray(notice.changes)) dispatch(notice);
        }, (state)=>{
            if (!current) return;
            const was = live;
            live = state === "live";
            syncPolling();
            if (live && !was) dispatch(null);
            if (live !== was) for (const changed of [
                ...statusListeners
            ])changed();
        });
        disconnect = ()=>{
            current = false;
            live = false;
            stop();
        };
    };
    const realtime = {
        subscribe (collections, onChange) {
            const entry = {
                collections: collections === null ? null : new Set(collections),
                poll: collections !== null,
                onChange
            };
            listeners.add(entry);
            registry().waiters.add(connect);
            connect();
            syncPolling();
            return ()=>{
                listeners.delete(entry);
                if (listeners.size === 0) {
                    registry().waiters.delete(connect);
                    disconnect?.();
                    disconnect = null;
                }
                syncPolling();
            };
        }
    };
    const subscriptions = new Map();
    let serverWindow = {
        min: 2_000,
        max: 30_000
    };
    const bounds = ()=>typeof pollOpt === "number" ? {
            min: pollOpt,
            max: pollOpt
        } : {
            min: (pollOpt || {}).min ?? serverWindow.min,
            max: (pollOpt || {}).max ?? serverWindow.max
        };
    let gap = bounds().min;
    let liveTimer = null;
    let liveAt = 0;
    let asking = false;
    let askAgain = false;
    let kicked = false;
    let sent = 0;
    let writes = 0;
    let stopNotices = null;
    const page = ()=>globalThis.document;
    const hidden = ()=>page()?.visibilityState === "hidden" || page()?.prerendering === true;
    const markDue = (which)=>{
        for (const s of subscriptions.values())if (which(s)) s.due = true;
    };
    const guarded = (fn)=>{
        try {
            fn();
        } catch (e) {
            const report = globalThis.reportError;
            if (typeof report === "function") report(e);
            else console.error(e);
        }
    };
    const fail = (s, error)=>{
        for (const to of [
            ...s.subscribers
        ])guarded(()=>to.onError?.(error));
    };
    const deliver = (s, to)=>{
        if (s.error) return guarded(()=>to.onError?.(s.error));
        if (!s.has) return;
        if (s.descriptor.op === "get" && s.data === null) return guarded(()=>to.onError?.(new SpacePressError({
                type: "about:blank",
                title: "Not found",
                status: 404,
                code: "not_found",
                detail: `No ${s.descriptor.kind} row`
            })));
        const data = s.overlays.reduce((current, overlay)=>overlay.apply(current), s.data);
        guarded(()=>to.onData(data));
    };
    const emit = (s)=>{
        for (const to of [
            ...s.subscribers
        ])deliver(s, to);
    };
    const reschedule = (restart = false)=>{
        const every = live ? livePollMs : pollOpt === false ? false : gap;
        const off = subscriptions.size === 0 || every === false || hidden();
        if (off) {
            if (liveTimer !== null) clearTimeout(liveTimer);
            liveTimer = null;
            return;
        }
        const jitter = !live && typeof pollOpt === "number" ? 1 : 0.8 + Math.random() * 0.4;
        const due = Date.now() + Math.round(every * jitter);
        if (liveTimer !== null && !restart && due >= liveAt) return;
        if (liveTimer !== null) clearTimeout(liveTimer);
        liveAt = due;
        liveTimer = setTimeout(()=>{
            liveTimer = null;
            markDue(()=>true);
            void ask(true);
        }, due - Date.now());
    };
    const settle = (s, result, request)=>{
        if (!isObject(result)) {
            fail(s, networkError("POST /_live: the answer has no result for this read"));
            return false;
        }
        if (result.pending === true) {
            s.due = askAgain = true;
            return false;
        }
        const overlays = s.overlays.length;
        s.overlays = s.overlays.filter((o)=>o.after === null || request <= o.after);
        const dropped = s.overlays.length !== overlays;
        if (isObject(result.error)) {
            s.token = undefined;
            const error = toError(new Response(null, {
                status: typeof result.error.status === "number" && result.error.status >= 400 ? result.error.status : 500
            }), result.error);
            const same = s.error !== undefined && s.error.status === error.status && s.error.code === error.code && s.error.detail === error.detail;
            s.error = error;
            if (!same || dropped) emit(s);
            return false;
        }
        if (typeof result.token === "string") s.token = result.token;
        const changed = result.changed === true;
        if (changed) {
            s.has = true;
            s.data = result.data;
        }
        const recovered = s.error !== undefined;
        s.error = undefined;
        if (changed || dropped || recovered) emit(s);
        return changed;
    };
    async function ask(fromTimer = false) {
        if (asking) {
            askAgain = true;
            return;
        }
        asking = true;
        try {
            do {
                askAgain = false;
                if (currentSid() !== askedAs) forget();
                const due = [
                    ...subscriptions.entries()
                ].filter(([, s])=>s.due);
                if (due.length === 0) break;
                let changed = false;
                let failed = false;
                for (const batch of batches(due)){
                    const number = ++sent;
                    const visitor = currentSid();
                    for (const [, s] of batch){
                        s.due = false;
                        s.sent = number;
                    }
                    try {
                        const out = await request("POST", `${API}/_live`, {
                            json: {
                                queries: batch.map(([, s])=>s.token === undefined ? s.descriptor : {
                                        ...s.descriptor,
                                        token: s.token
                                    })
                            }
                        });
                        if (currentSid() !== visitor) continue;
                        const { minMs, maxMs } = out.poll ?? {};
                        if (typeof minMs === "number" && typeof maxMs === "number" && minMs > 0 && maxMs >= minMs) serverWindow = {
                            min: minMs,
                            max: maxMs
                        };
                        batch.forEach(([key, s], j)=>{
                            if (subscriptions.get(key) !== s) return;
                            s.answered = Math.max(s.answered, number);
                            changed = settle(s, out.results?.[j], number) || changed;
                        });
                    } catch (e) {
                        if (currentSid() !== visitor) continue;
                        failed = true;
                        const error = e instanceof SpacePressError ? e : networkError(String(e));
                        for (const [key, s] of batch)if (subscriptions.get(key) === s) fail(s, error);
                    }
                }
                const { min, max } = bounds();
                gap = failed ? Math.min(300_000, Math.max(gap, min) * 2) : changed ? min : Math.min(max, Math.max(gap, min) * 1.5);
            }while (askAgain)
        } finally{
            asking = false;
            reschedule(fromTimer);
        }
    }
    const utf8 = new TextEncoder();
    const batches = (due)=>{
        const out = [];
        let batch = [];
        let size = 0;
        for (const entry of due){
            const s = entry[1];
            const bytes = utf8.encode(JSON.stringify(s.token === undefined ? s.descriptor : {
                ...s.descriptor,
                token: s.token
            })).length + 1;
            if (batch.length > 0 && (batch.length === 20 || size + bytes > 30_000)) {
                out.push(batch);
                batch = [];
                size = 0;
            }
            batch.push(entry);
            size += bytes;
        }
        if (batch.length > 0) out.push(batch);
        return out;
    };
    const kick = ()=>{
        if (kicked) return;
        kicked = true;
        queueMicrotask(()=>{
            kicked = false;
            void ask();
        });
    };
    const wrote = (written, collection)=>written.then((result)=>{
            writes++;
            for (const s of subscriptions.values())s.sentAtWrite = s.sent;
            if (subscriptions.size > 0) {
                markDue((s)=>collection === undefined || s.deps.has(collection));
                kick();
            }
            return result;
        });
    let askedAs = currentSid();
    const forget = ()=>{
        askedAs = currentSid();
        for (const s of subscriptions.values()){
            s.due = true;
            s.token = undefined;
        }
        gap = bounds().min;
    };
    identityChanged = ()=>{
        if (subscriptions.size === 0) return;
        forget();
        if (!hidden()) kick();
    };
    const shown = ()=>{
        if (hidden()) return reschedule(true);
        gap = bounds().min;
        markDue(()=>true);
        kick();
    };
    const restored = (event)=>{
        if (event?.persisted === true) shown();
    };
    function subscribe(key, descriptor, deps, to, seed) {
        let s = subscriptions.get(key);
        if (!s) {
            s = {
                descriptor,
                deps: new Set(deps),
                has: seed !== undefined,
                data: seed?.data,
                token: seed?.token,
                due: true,
                subscribers: new Set(),
                overlays: [],
                sent: 0,
                answered: 0,
                sentAtWrite: 0
            };
            subscriptions.set(key, s);
            if (subscriptions.size === 1) {
                page()?.addEventListener?.("visibilitychange", shown);
                page()?.addEventListener?.("prerenderingchange", shown);
                globalThis.addEventListener?.("pageshow", restored);
                const onStatus = ()=>{
                    if (live) markDue(()=>true);
                    if (live && !hidden()) kick();
                    reschedule(true);
                };
                statusListeners.add(onStatus);
                const stop = realtime.subscribe(null, (notice)=>{
                    markDue((sub)=>notice === null || notice.changes.some((c)=>sub.deps.has(c.collection)));
                    if (!hidden()) kick();
                });
                stopNotices = ()=>{
                    statusListeners.delete(onStatus);
                    stop();
                };
            }
        }
        const subscription = s;
        subscription.subscribers.add(to);
        if (subscription.has || subscription.error) queueMicrotask(()=>subscription.subscribers.has(to) && deliver(subscription, to));
        if (!hidden()) kick();
        return ()=>{
            subscription.subscribers.delete(to);
            if (subscription.subscribers.size > 0 || subscriptions.get(key) !== subscription) return;
            subscriptions.delete(key);
            if (subscriptions.size > 0) return;
            page()?.removeEventListener?.("visibilitychange", shown);
            page()?.removeEventListener?.("prerenderingchange", shown);
            globalThis.removeEventListener?.("pageshow", restored);
            stopNotices?.();
            stopNotices = null;
            gap = bounds().min;
            reschedule(true);
        };
    }
    function optimistic(key, update) {
        const s = subscriptions.get(key);
        const overlay = {
            apply: update,
            after: null
        };
        const since = writes;
        if (s) {
            s.overlays.push(overlay);
            emit(s);
        }
        const drop = ()=>{
            if (!s || !s.overlays.includes(overlay)) return;
            s.overlays = s.overlays.filter((o)=>o !== overlay);
            if (subscriptions.get(key) === s) emit(s);
        };
        return {
            settle () {
                if (!s || !s.overlays.includes(overlay)) return;
                overlay.after = writes > since ? s.sentAtWrite : s.sent;
                if (s.answered > overlay.after) return drop();
                if (s.sent > overlay.after || subscriptions.get(key) !== s) return;
                s.due = true;
                kick();
            },
            rollback: drop
        };
    }
    async function once(descriptor) {
        const out = await request("POST", `${API}/_live`, {
            json: {
                queries: [
                    descriptor
                ]
            }
        });
        const result = out.results?.[0];
        if (isObject(result) && isObject(result.error)) throw toError(new Response(null, {
            status: typeof result.error.status === "number" && result.error.status >= 400 ? result.error.status : 500
        }), result.error);
        if (!isObject(result) || !("data" in result)) throw networkError("POST /_live: the answer has no result");
        return result.data;
    }
    function query(descriptor, deps, run, refuse, keyed) {
        const key = JSON.stringify(descriptor.op === "page" ? [
            "page",
            descriptor.args.url,
            descriptor.args.region
        ] : [
            descriptor.kind,
            descriptor.op,
            descriptor.id ?? null,
            descriptor.args ?? {},
            ...keyed ? [
                keyed
            ] : []
        ]);
        let started;
        const promise = ()=>started ??= run();
        const read = {
            key,
            then: (onFulfilled, onRejected)=>promise().then(onFulfilled, onRejected),
            catch: (onRejected)=>promise().catch(onRejected),
            finally: (onFinally)=>promise().finally(onFinally),
            [Symbol.toStringTag]: "Query",
            subscribe: (onData, onError, seed)=>{
                if (refuse !== undefined) throw new TypeError(refuse);
                return subscribe(key, descriptor, deps, {
                    onData: onData,
                    onError
                }, seed);
            },
            optimistic: (update)=>optimistic(key, update)
        };
        return read;
    }
    function conditions(options) {
        const out = {};
        if (options?._rev !== undefined) out._rev = options._rev;
        if (options?.takeover) out.takeover = true;
        return out;
    }
    function patchInput(id, patch) {
        const { _rev, takeover, ...fields } = isObject(patch) ? patch : {};
        return {
            id,
            patch: fields,
            ...conditions({
                _rev,
                takeover
            })
        };
    }
    const readonly = {
        readonly: true,
        idempotent: true
    };
    const destructive = {
        destructive: true
    };
    function collection(key) {
        const desc = SCHEMA.collections[key];
        const path = `${API}/${seg(desc.path)}`;
        const one = (id)=>`${path}/${seg(id)}`;
        const kind = desc.ability;
        const op = (suffix)=>`${kind}-${suffix}`;
        const reads = (q)=>dependencies(SCHEMA, key, q?.with, q?.where);
        const rows = async (q)=>(await ability(op("list"), liveArgs(q), readonly)).rows;
        const capped = (q)=>typeof q?.limit === "number" && q.limit > 100 ? {
                ...q,
                limit: 100
            } : q;
        const list = (q)=>query({
                kind: key,
                op: "list",
                args: liveArgs(q)
            }, reads(q), ()=>kind === undefined ? request("GET", path, {
                    query: listParams(q)
                }) : rows(capped(q)));
        const paginate = (q)=>{
            const run = async ()=>{
                if (kind === undefined) {
                    const params = listParams(q);
                    if (typeof q?.cursor === "string") params.set("cursor", q.cursor);
                    return request("GET", path, {
                        query: params,
                        envelope: true
                    });
                }
                if (q?.limit !== undefined && !(Number.isInteger(q.limit) && q.limit >= 1)) throw invalidQuery("limit must be a positive integer", "/limit");
                if (q?.offset !== undefined && !(Number.isInteger(q.offset) && q.offset >= 0)) throw invalidQuery("offset must be a non-negative integer", "/offset");
                const limit = Math.min(typeof q?.limit === "number" ? q.limit : 50, 100);
                const offset = typeof q?.cursor === "string" ? decodeCursor(q.cursor) : typeof q?.offset === "number" ? q.offset : 0;
                const page = await rows({
                    ...q ?? {},
                    cursor: undefined,
                    offset,
                    limit: limit + 1
                });
                return {
                    rows: page.slice(0, limit),
                    cursor: page.length > limit ? encodeCursor(offset + limit) : null
                };
            };
            return query({
                kind: key,
                op: "paginate",
                args: liveArgs(q && {
                    ...q,
                    offset: undefined
                })
            }, reads(q), run, typeof q?.offset === "number" ? "paginate({ offset }) can be awaited but not subscribed to: page by cursor" : undefined, typeof q?.offset === "number" ? {
                offset: q.offset
            } : undefined);
        };
        const getOne = (id, q)=>kind === undefined ? request("GET", one(id), {
                query: listParams(q ? {
                    with: q.with,
                    locale: q.locale
                } : undefined)
            }) : ability(op("get"), {
                id,
                ...liveArgs(q ? {
                    with: q.with,
                    locale: q.locale
                } : undefined)
            }, readonly);
        return {
            list,
            paginate,
            watch: (q, onRows, onError)=>list(q).subscribe(onRows, onError),
            get: (id, q)=>query({
                    kind: key,
                    op: "get",
                    id,
                    args: liveArgs(q ? {
                        with: q.with,
                        locale: q.locale
                    } : undefined)
                }, reads(q), ()=>getOne(id, q)),
            count: (q)=>{
                const descriptor = {
                    kind: key,
                    op: "count",
                    args: liveArgs(q ? {
                        where: q.where,
                        status: q.status,
                        locale: q.locale
                    } : undefined)
                };
                return query(descriptor, dependencies(SCHEMA, key, undefined, q?.where), ()=>once(descriptor));
            },
            create: (data)=>wrote(kind === undefined ? request("POST", path, {
                    json: data
                }) : ability(op("create"), isObject(data) ? data : {}), key),
            update: (id, patch)=>wrote(kind === undefined ? request("PATCH", one(id), {
                    json: patch
                }) : ability(op("update"), patchInput(id, patch)), key),
            delete: (id, options)=>wrote(kind === undefined ? request("DELETE", one(id)) : ability(op("delete"), {
                    id,
                    ...conditions(options)
                }, destructive), key),
            restore: (id)=>wrote(request("POST", `${one(id)}/restore`), key),
            purge: (id)=>wrote(request("DELETE", `${one(id)}/purge`), key),
            revisions: {
                list: async (id)=>{
                    const all = [];
                    let cursor = null;
                    do {
                        const query = new URLSearchParams({
                            limit: "100"
                        });
                        if (cursor !== null) query.set("cursor", cursor);
                        const page = await request("GET", `${one(id)}/revisions`, {
                            query,
                            envelope: true
                        });
                        all.push(...page.rows);
                        cursor = page.cursor;
                    }while (cursor !== null)
                    return all;
                },
                get: (id, rid)=>request("GET", `${one(id)}/revisions/${seg(rid)}`),
                diff: (id, from, to)=>request("GET", `${one(id)}/revisions/diff`, {
                        query: new URLSearchParams({
                            from: String(from),
                            to: String(to)
                        })
                    }),
                restore: (id, rid)=>wrote(request("POST", `${one(id)}/revisions/${seg(rid)}/restore`), key)
            },
            stage: (id, patch)=>ability(op("stage"), patchInput(id, patch)),
            staged: (id)=>ability(op("staged-get"), {
                    id
                }, readonly),
            compare: (id)=>ability(op("staged-compare"), {
                    id
                }, readonly),
            promote: (id, options)=>wrote(ability(op("staged-promote"), {
                    id,
                    ...options && "at" in options ? {
                        at: options.at
                    } : {},
                    ...conditions(options)
                }), key),
            discard: (id, options)=>ability(op("staged-discard"), {
                    id,
                    ...conditions(options)
                }),
            previewLink: (id, options)=>ability(op("staged-preview"), {
                    id,
                    ...options?.ttl !== undefined ? {
                        ttl: options.ttl
                    } : {}
                })
        };
    }
    const upload = (route, file, fields, filename)=>{
        const form = new FormData();
        form.append("file", file, filename ?? ("name" in file && typeof file.name === "string" ? file.name : "upload"));
        for (const [k, v] of Object.entries(fields))form.append(k, v);
        return request("POST", route, {
            form
        });
    };
    const client = {
        media: {
            list: (q)=>request("GET", `${API}/media`, {
                    query: listParams(q)
                }),
            get: (id)=>request("GET", `${API}/media/${seg(id)}`),
            upload: (file, opts = {})=>upload(`${API}/media`, file, opts.alt !== undefined ? {
                    alt: opts.alt
                } : {}, opts.filename),
            update: (id, patch)=>request("PATCH", `${API}/media/${seg(id)}`, {
                    json: patch
                }),
            delete: (id)=>request("DELETE", `${API}/media/${seg(id)}`)
        },
        files: Object.fromEntries(SCHEMA.buckets.map((bucket)=>[
                bucket,
                {
                    upload: (file, opts = {})=>upload(`${API}/files/${seg(bucket)}`, file, {}, opts.filename),
                    get: (id)=>request("GET", `${API}/files/${seg(bucket)}/${seg(id)}`),
                    delete: (id)=>request("DELETE", `${API}/files/${seg(bucket)}/${seg(id)}`)
                }
            ])),
        actions: Object.fromEntries(SCHEMA.actions.map((name)=>{
            const meta = SCHEMA.abilities.actions[name];
            return [
                name,
                (input)=>wrote(ability(meta.ability, isObject(input) ? input : {}, meta))
            ];
        })),
        globals: Object.fromEntries(SCHEMA.globals.map((name)=>{
            const k = SCHEMA.abilities.globals[name];
            return [
                name,
                {
                    get: ()=>ability(`global-${k}-get`, {}, readonly),
                    update: (patch)=>ability(`global-${k}-update`, isObject(patch) ? patch : {})
                }
            ];
        })),
        auth,
        schema: ()=>request("GET", API)
    };
    for (const key of Object.keys(SCHEMA.collections))client[key] = collection(key);
    hubs.set(client, realtime);
    pageReads.set(client, (url, region, deps)=>query({
            op: "page",
            args: {
                url,
                region
            }
        }, deps, ()=>once({
                op: "page",
                args: {
                    url,
                    region
                }
            })));
    return client;
}
const hubs = new WeakMap();
const pageReads = new WeakMap();
export function pageRead(client, url, region, deps) {
    const read = pageReads.get(client) ?? (()=>{
        throw new TypeError("pageRead() needs a client from createClient()");
    })();
    return read(url, region, deps);
}
export function watch(client, collections, read, onResult, onError) {
    const hub = hubs.get(client) ?? (()=>{
        throw new TypeError("watch() needs a client from createClient()");
    })();
    return watchWith(hub, collections, read, onResult, onError);
}
function watchWith(hub, collections, read, onResult, onError) {
    let stopped = false;
    let running = false;
    let again = false;
    const refresh = async ()=>{
        if (running) {
            again = true;
            return;
        }
        running = true;
        try {
            do {
                again = false;
                try {
                    const value = await read();
                    if (!stopped) onResult(value);
                } catch (e) {
                    if (!stopped) onError?.(e instanceof SpacePressError ? e : networkError(String(e)));
                }
            }while (again && !stopped)
        } finally{
            running = false;
        }
    };
    const unsubscribe = hub.subscribe(collections, ()=>void refresh());
    void refresh();
    return ()=>{
        stopped = true;
        unsubscribe();
    };
}
function dependencies(SCHEMA, key, w, where, seen = new Set()) {
    seen.add(key);
    const relations = SCHEMA.collections[key]?.relations ?? {};
    if (isObject(w)) {
        for (const [name, v] of Object.entries(w)){
            const target = relations[name]?.collection;
            if (!v || typeof target !== "string") continue;
            dependencies(SCHEMA, target, isObject(v) ? v.with : undefined, isObject(v) ? v.where : undefined, seen);
        }
    }
    const filter = (f)=>{
        if (Array.isArray(f)) return f.forEach(filter);
        if (!isObject(f)) return;
        for (const [name, v] of Object.entries(f)){
            if (name === "AND" || name === "OR" || name === "NOT") filter(v);
            else if (typeof relations[name]?.collection === "string" && (isObject(v) || Array.isArray(v) && v.length === 0)) dependencies(SCHEMA, relations[name].collection, undefined, isObject(v) ? v : undefined, seen);
        }
    };
    filter(where);
    return [
        ...seen
    ];
}
function wordPressError(wpCode, message, givenStatus, body, data) {
    let code = wpCode.startsWith("sp_") ? wpCode.slice(3) : wpCode;
    let status = givenStatus;
    switch(code){
        case "ability_permission_denied":
        case "ability_invalid_permissions":
        case "rest_ability_cannot_execute":
        case "rest_forbidden":
        case "rest_cannot_create":
        case "rest_cannot_edit":
        case "rest_cannot_delete":
        case "rest_cannot_read":
            code = status === 401 ? "unauthenticated" : "forbidden";
            status = code === "unauthenticated" ? 401 : 403;
            break;
        case "ability_invalid_input":
        case "rest_invalid_param":
        case "rest_missing_callback_param":
            code = "invalid_input";
            status = status && status !== 400 ? status : 422;
            break;
        case "rest_ability_not_found":
        case "rest_no_route":
        case "rest_post_invalid_id":
            code = "not_found";
            status = 404;
            break;
        case "rest_ability_invalid_method":
        case "rest_no_route_method":
            code = "method_not_allowed";
            status = 405;
            break;
        case "rest_cookie_invalid_nonce":
            code = "forbidden";
            status = 403;
            break;
        default:
            if (code === "") code = status ? "http_error" : "error";
    }
    const pointer = typeof data.pointer === "string" ? data.pointer : typeof body.pointer === "string" ? body.pointer : undefined;
    return new SpacePressError({
        type: typeof body.type === "string" ? body.type : "about:blank",
        title: typeof body.title === "string" ? body.title : typeof data.title === "string" ? data.title : code,
        status: status || 500,
        code,
        detail: message,
        ...pointer !== undefined ? {
            pointer
        } : {}
    });
}
function toError(res, body) {
    if (isObject(body) && typeof body.code === "string" && typeof body.detail !== "string" && typeof body.message === "string") {
        const data = isObject(body.data) ? body.data : {};
        return wordPressError(body.code, body.message, typeof data.status === "number" ? data.status : res.status, body, data);
    }
    if (isObject(body) && typeof body.code === "string") {
        const detail = typeof body.detail === "string" ? body.detail : typeof body.message === "string" ? body.message : res.statusText;
        return new SpacePressError({
            type: typeof body.type === "string" ? body.type : "about:blank",
            title: typeof body.title === "string" ? body.title : res.statusText || `HTTP ${res.status}`,
            status: typeof body.status === "number" ? body.status : res.status,
            code: body.code,
            detail,
            ...typeof body.pointer === "string" ? {
                pointer: body.pointer
            } : {}
        });
    }
    return new SpacePressError({
        type: "about:blank",
        title: res.statusText || `HTTP ${res.status}`,
        status: res.status,
        code: "http_error",
        detail: `HTTP ${res.status}`
    });
}

