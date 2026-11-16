import { createRoot } from "react-dom/client";
import { useEffect, useState, type FormEvent } from "react";
import * as z from "zod";
import {
  DataViews,
  DataForm,
  filterSortAndPaginate,
  type View,
  type Field,
} from "./ciab/dataviews.js";
import "./style.css";
const root = document.getElementById("identity-admin");
if (!root?.dataset.api || !root.dataset.nonce)
  throw new Error("Admin configuration missing");
const api = root.dataset.api,
  nonce = root.dataset.nonce,
  site = root.dataset.site?.trim() || "Identity";
const rowSchema = z.record(z.string(), z.unknown());
type Row = z.infer<typeof rowSchema>;
async function request(path: string, body?: unknown): Promise<unknown> {
  const r = await fetch(new URL(path, api), {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-WP-Nonce": nonce },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data: unknown = await r.json();
  if (!r.ok) {
    const e = z
      .object({ error: z.object({ message: z.string() }) })
      .safeParse(data);
    throw new Error(e.success ? e.data.error.message : "Request failed");
  }
  return z.object({ data: z.unknown() }).parse(data).data;
}
const sections = [
  {
    path: "people",
    label: "People",
    description: "Everyone who calls this place theirs.",
  },
  {
    path: "organizations",
    label: "Organizations",
    description: "Groups, memberships, and shared access.",
  },
  {
    path: "applications",
    label: "Applications",
    description: "Trusted apps connected to your identity service.",
  },
  {
    path: "sessions",
    label: "Sessions",
    description: "See where people are signed in.",
  },
  {
    path: "authentication",
    label: "Authentication",
    description: "Choose how people access their accounts.",
  },
  {
    path: "security-events",
    label: "Security Events",
    description: "A record of account and security changes.",
  },
];
const viewSchema = z.object({
  type: z.literal("table"),
  page: z.number(),
  perPage: z.number(),
  fields: z.array(z.string()),
  search: z.string().optional(),
  sort: z
    .object({ field: z.string(), direction: z.enum(["asc", "desc"]) })
    .optional(),
});
function Admin() {
  const [path, setPath] = useState(location.hash.slice(1) || "people");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [form, setForm] = useState({ name: "", redirect_uri: "", origin: "" });
  const [view, setView] = useState<View>({
    type: "table",
    page: 1,
    perPage: 20,
    fields: [],
  });
  const section = sections.find((s) => s.path === path) ?? sections[0];
  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await request(section.path);
      setRows(
        Array.isArray(data)
          ? z.array(rowSchema).parse(data)
          : [rowSchema.parse(data)],
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    const saved = localStorage.getItem("zi.admin.view." + path);
    if (saved) {
      try {
        const parsed = viewSchema.safeParse(JSON.parse(saved));
        if (parsed.success) setView(parsed.data);
      } catch {
        localStorage.removeItem("zi.admin.view." + path);
      }
    } else setView({ type: "table", page: 1, perPage: 20, fields: [] });
  }, [path]);
  useEffect(() => {
    const change = () => setPath(location.hash.slice(1) || "people");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const keys =
    section.path === "people"
      ? ["id", "name", "status", "emails"]
      : section.path === "sessions"
        ? ["id", "wp_user_id", "label", "created_at", "revoked_at"]
        : section.path === "security-events"
          ? ["id", "type", "wp_user_id", "created_at"]
          : section.path === "applications"
            ? ["id", "name", "redirects", "enabled"]
            : section.path === "organizations"
              ? ["id", "name", "created_at"]
              : ["providers", "keys", "email"];
  const fields: Field<Row>[] = keys.map((key) => ({
    id: key,
    label: key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()),
    enableSorting: true,
    enableGlobalSearch: true,
    getValue: ({ item }) =>
      typeof item[key] === "string"
        ? item[key]
        : JSON.stringify(item[key] ?? ""),
    render: ({ item }) => {
      const value = item[key];
      if (key === "emails") {
        const parsed = z
          .array(z.object({ email: z.string(), primary: z.boolean() }))
          .safeParse(value);
        return (
          <span>
            {parsed.success
              ? parsed.data
                  .filter((e) => e.primary)
                  .map((e) => e.email)
                  .join(", ")
              : ""}
          </span>
        );
      }
      if (key.endsWith("_at") && value)
        return <span>{new Date(Number(value) * 1000).toLocaleString()}</span>;
      return (
        <span className="zi-cell">
          {typeof value === "string" ? value : JSON.stringify(value ?? "")}
        </span>
      );
    },
  }));
  const current = { ...view, fields: view.fields?.length ? view.fields : keys };
  const filtered = filterSortAndPaginate(rows, current, fields);
  async function action(path: string, body: unknown, message: string) {
    try {
      await request(path, body);
      setNotice(message);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      return false;
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const saved=await action(
      "applications",
      { ...form, idempotency_key: requestKey },
      "Application registered. Copy its client ID from the table.",
    );
    if(saved){setShowForm(false);setRequestKey(crypto.randomUUID());}
  }
  return (
    <div className="zi-admin">
      <aside>
        <a href="#people" className="zi-logo">
          <span>
            {site} <small>Identity</small>
          </span>
        </a>
        <span className="zi-nav-label">WORKSPACE</span>
        <nav>
          {sections.map((s) => (
            <a
              key={s.path}
              href={"#" + s.path}
              aria-current={s.path === section.path ? "page" : undefined}
            >
              {s.label}
            </a>
          ))}
        </nav>
        <a
          className="zi-public-link"
          href="/identity"
          target="_blank"
          rel="noreferrer"
        >
          Open account portal ↗
        </a>
        <a className="zi-wordpress-link" href="/wp-admin/index.php">WordPress admin ↗</a><div className="zi-version">{site}</div>
      </aside>
      <main>
        <header>
          <div>
            <div className="zi-breadcrumb">Identity / {section.label}</div>
            <h1>{section.label}</h1>
            <p>{section.description}</p>
          </div>
          <div>
            {section.path === "applications" && (
              <button
                className="zi-primary"
                onClick={() => setShowForm(!showForm)}
              >
                + Register application
              </button>
            )}
            {section.path === "authentication" && (
              <button
                onClick={() =>
                  void action(
                    "keys/rotate",
                    {},
                    "Signing key rotated. Previous keys overlap for ten minutes.",
                  )
                }
              >
                Rotate signing key
              </button>
            )}
          </div>
        </header>
        {error && (
          <div role="alert" className="zi-error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="zi-notice">
            {notice}
          </div>
        )}
        {showForm && (
          <form className="zi-form" onSubmit={submit}>
            <h2>Register an application</h2>
            <p>Use the application's exact callback URL and origin.</p>
            <DataForm
              data={form}
              fields={[
                { id: "name", label: "Application name", type: "text" },
                { id: "redirect_uri", label: "Callback URL", type: "text" },
                { id: "origin", label: "Application origin", type: "text" },
              ]}
              form={{
                layout: { type: "regular" },
                fields: ["name", "redirect_uri", "origin"],
              }}
              onChange={(changes) => setForm({ ...form, ...changes })}
            />
            <button className="zi-primary">Register</button>
          </form>
        )}
        {section.path === "authentication" ? (
          <AuthenticationPanel />
        ) : (
          <div className="zi-table">
            <DataViews
              data={filtered.data}
              fields={fields}
              view={current}
              onChangeView={(next) => {
                setView(next);
                localStorage.setItem(
                  "zi.admin.view." + path,
                  JSON.stringify(next),
                );
              }}
              defaultLayouts={{ table: {} }}
              paginationInfo={filtered.paginationInfo}
              isLoading={loading}
              getItemId={(item) => String(item.id ?? section.path)}
              actions={
                section.path === "people"
                  ? [
                      {
                        id: "erase",
                        label: "Complete requested erasure",
                        isEligible: (item) =>
                          item.status === "deletion_requested",
                        callback: (items) => {
                          const item = items[0];
                          if (item)
                            void action(
                              "people/erase",
                              { id: String(item.id) },
                              "Identity data erased.",
                            );
                        },
                      },
                      {
                        id: "suspend",
                        label: "Toggle suspension",
                        isPrimary: false,
                        callback: (items) => {
                          const item = items[0];
                          if (item)
                            void action(
                              "people/suspend",
                              {
                                id: String(item.id),
                                suspended: item.status === "active",
                              },
                              "Account updated.",
                            );
                        },
                      },
                    ]
                  : section.path === "applications"
                    ? [
                        {
                          id: "status",
                          label: "Toggle application access",
                          isPrimary: false,
                          callback: (items) => {
                            const item = items[0];
                            if (item)
                              void action(
                                "applications/status",
                                {
                                  id: String(item.id),
                                  enabled: Number(item.enabled) !== 1,
                                },
                                "Application updated.",
                              );
                          },
                        },
                      ]
                    : section.path === "sessions"
                      ? [
                          {
                            id: "revoke",
                            label: "Revoke session",
                            isPrimary: false,
                            callback: (items) => {
                              const item = items[0];
                              if (item)
                                void action(
                                  "sessions/revoke",
                                  {
                                    id: String(item.id),
                                    user_id: String(item.wp_user_id),
                                  },
                                  "Session revoked.",
                                );
                            },
                          },
                        ]
                      : []
              }
            />
          </div>
        )}
        {section.path !== "authentication" && (
          <div className="zi-mobile-records">
            <input
              aria-label="Search records"
              type="search"
              placeholder="Search records"
              value={view.search ?? ""}
              onChange={(e) =>
                setView({ ...view, search: e.target.value, page: 1 })
              }
            />
            {filtered.data.map((item) => (
              <article key={String(item.id ?? section.path)}>
                {keys.map((key) => (
                  <div key={key}>
                    <small>{key.replaceAll("_", " ")}</small>
                    <p>
                      {key === "emails"
                        ? z
                            .array(z.object({ email: z.string() }))
                            .parse(item[key])
                            .map((e) => e.email)
                            .join(", ")
                        : typeof item[key] === "string"
                          ? item[key]
                          : JSON.stringify(item[key] ?? "")}
                    </p>
                  </div>
                ))}
                {section.path === "people" && (
                  <button
                    onClick={() =>
                      void action(
                        "people/suspend",
                        {
                          id: String(item.id),
                          suspended: item.status === "active",
                        },
                        "Account updated.",
                      )
                    }
                  >
                    {item.status === "active"
                      ? "Suspend account"
                      : "Restore account"}
                  </button>
                )}
                {section.path === "sessions" && (
                  <button
                    onClick={() =>
                      void action(
                        "sessions/revoke",
                        {
                          id: String(item.id),
                          user_id: String(item.wp_user_id),
                        },
                        "Session revoked.",
                      )
                    }
                  >
                    Revoke session
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
        <div className="zi-table-foot">
          {rows.length} records · Live account data{" "}
          <button onClick={() => void load()}>Refresh</button>
        </div>
      </main>
    </div>
  );
}

function AuthenticationPanel() {
  const [data, setData] = useState<{
    providers: string[];
    email: { transport: string; diagnostics: string };
  } | null>(null);
  const [hooks, setHooks] = useState<
    { id: string; url: string; deliveries: Row[] }[]
  >([]);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState("");
  async function load() {
    setData(
      z
        .object({
          providers: z.array(z.string()),
          email: z.object({ transport: z.string(), diagnostics: z.string() }),
        })
        .parse(await request("authentication")),
    );
    setHooks(
      z
        .array(
          z.object({
            id: z.string(),
            url: z.string(),
            deliveries: z.array(rowSchema),
          }),
        )
        .parse(await request("webhooks")),
    );
  }
  useEffect(() => {
    void load().catch((e) =>
      setError(
        e instanceof Error
          ? e.message
          : "Unable to load authentication settings",
      ),
    );
  }, []);
  return (
    <>
      {error && (
        <p role="alert" className="zi-error">
          {error}
        </p>
      )}
      <section className="zi-form">
        <h2>Sign-in methods</h2>
        <p>
          Email codes, passwords, passkeys and authenticator codes are
          available.
        </p>
        <p>
          External providers: {data?.providers.join(", ") || "None configured"}.
          Set TP_IDENTITY_GOOGLE_CLIENT_ID and
          TP_IDENTITY_GOOGLE_CLIENT_SECRET to enable Google.
        </p>
        <p>
          Email transport: {data?.email.transport}. {data?.email.diagnostics}
        </p>
      </section>
      <section className="zi-form">
        <h2>Signed webhooks</h2>
        <p>
          Receive account and session events. Failed deliveries retry up to
          eight times. Applications must still check live sessions.
        </p>
        {hooks.map((h) => (
          <div key={h.id}>
            <strong>{h.url}</strong>
            <button
              onClick={() =>
                void request("webhooks/remove", { id: h.id })
                  .then(load)
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : "Removal failed"),
                  )
              }
            >
              Remove webhook
            </button>
            <p>{h.deliveries.length} recent deliveries</p>
            {h.deliveries.slice(0, 5).map((d) => (
              <p key={String(d.id)}>
                Event {String(d.event_id)} ·{" "}
                {d.delivered_at ? "Delivered" : "Pending or exhausted"} ·
                attempts {String(d.attempts)} · HTTP {String(d.last_status)}
              </p>
            ))}
          </div>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const values = new FormData(e.currentTarget);
            void request("webhooks", { url: String(values.get("url")) })
              .then((value) => {
                setSecret(z.object({ secret: z.string() }).parse(value).secret);
                return load();
              })
              .catch((e) =>
                setError(
                  e instanceof Error ? e.message : "Registration failed",
                ),
              );
          }}
        >
          <label>
            Endpoint URL
            <input
              name="url"
              type="url"
              placeholder="https://app.example/webhooks/identity"
              required
            />
          </label>
          <button className="zi-primary">Register webhook</button>
        </form>
        {secret && (
          <div>
            <p>Copy this signing secret now. It will not be displayed again.</p>
            <code>{secret}</code>
            <button onClick={() => setSecret("")}>I saved the secret</button>
          </div>
        )}
      </section>
    </>
  );
}
createRoot(root).render(<Admin />);
