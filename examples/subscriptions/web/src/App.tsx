import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Actions, Collections, User } from "../../zero/_generated/client/types.ts";
import { logRenewal, zero } from "./client";

type Subscription = Collections["subscriptions"]["row"];
type Charge = Collections["charges"]["row"];
type Category = Collections["categories"]["row"];
type Burn = Actions["monthlyBurn"]["output"];
type Soon = Actions["renewingSoon"]["output"];
type Data = {
  user: User;
  subscriptions: Subscription[];
  categories: Category[];
  burn: Burn;
  soon: Soon;
};
type Session =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "ready"; data: Data };
type Page =
  | { kind: "home" }
  | { kind: "list" }
  | { kind: "detail"; id: number };
type Sheet = { kind: "add" } | { kind: "edit"; subscription: Subscription };
type IconName =
  | "home"
  | "list"
  | "plus"
  | "arrow"
  | "back"
  | "close"
  | "search"
  | "check"
  | "external"
  | "repeat";

const palette = ["#385449", "#a0b48a", "#d3b97e", "#b7a4b3", "#98b7b9"];
const statusLabels = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};
const cycleLabels = { weekly: "week", monthly: "month", yearly: "year" };

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7v10H3Z" />
        <path d="M9 20v-7h6v7" />
      </>
    ),
    list: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="3" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    back: <path d="m15 5-7 7 7 7" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    external: (
      <>
        <path d="M14 4h6v6M20 4 10 14" />
        <path d="M10 4H4v16h16v-6" />
      </>
    ),
    repeat: (
      <>
        <path d="M20 9a8 8 0 1 0 0 6M20 3v6h-6" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}
function renewalLabel(value: string) {
  const today = new Date();
  const days = Math.round(
    (Date.parse(`${value}T00:00:00Z`) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      86_400_000,
  );
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Try again.";
}
function pageFromHash(): Page {
  const match = /^#subscription\/(\d+)$/.exec(location.hash);
  if (match) return { kind: "detail", id: Number(match[1]) };
  return { kind: location.hash === "#subscriptions" ? "list" : "home" };
}
function navigate(page: Page) {
  location.hash =
    page.kind === "detail"
      ? `subscription/${page.id}`
      : page.kind === "list"
        ? "subscriptions"
        : "home";
  window.scrollTo({ top: 0 });
}
async function allRows<T>(
  list: (query: { limit: number; offset: number }) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const batch = await list({ limit: 100, offset });
    rows.push(...batch);
    if (batch.length < 100) return rows;
  }
}

export function App() {
  const [session, setSession] = useState<Session>({ kind: "loading" });
  const [page, setPage] = useState<Page>(pageFromHash);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const user = await zero.auth.me();
    if (!user) {
      setSession({ kind: "signedOut" });
      return;
    }
    const [subscriptions, categories, burn, soon] = await Promise.all([
      allRows<Subscription>((query) =>
        zero.subscriptions.list({ ...query, orderBy: { nextRenewal: "asc" } }),
      ),
      allRows<Category>((query) =>
        zero.categories.list({ ...query, orderBy: { name: "asc" } }),
      ),
      zero.actions.monthlyBurn({}),
      zero.actions.renewingSoon({ days: 7 }),
    ]);
    setSession({
      kind: "ready",
      data: { user, subscriptions, categories, burn, soon },
    });
  }

  useEffect(() => {
    const change = () => setPage(pageFromHash());
    window.addEventListener("hashchange", change);
    void (async () => {
      try {
        const params = new URLSearchParams(location.search);
        if (params.has("code") || params.has("error")) {
          try {
            await zero.auth.handleCallback();
          } finally {
            history.replaceState(null, "", location.pathname + location.hash);
          }
        }
        await load();
      } catch (err) {
        setError(message(err));
        setSession({ kind: "signedOut" });
      }
    })();
    return () => window.removeEventListener("hashchange", change);
  }, []);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function save(input: Collections["subscriptions"]["insert"]) {
    if (session.kind !== "ready" || !sheet) return;
    const categoryName = input.category ?? "Other";
    const existing = await zero.categories.list({
      where: { name: categoryName },
      limit: 1,
    });
    if (!existing.length) await zero.categories.create({ name: categoryName });
    if (sheet.kind === "edit")
      await zero.subscriptions.update(sheet.subscription.id, input);
    else await zero.subscriptions.create(input);
    setSheet(null);
    setNotice(sheet.kind === "edit" ? "Changes saved" : "Subscription added");
    try {
      await load();
    } catch (err) {
      setError(`Saved, but the overview could not refresh. ${message(err)}`);
    }
  }

  const subscription =
    session.kind === "ready" && page.kind === "detail"
      ? session.data.subscriptions.find((row) => row.id === page.id)
      : undefined;

  return (
    <div className="app">
      <header className="masthead">
        <a className="brand" href="#home" aria-label="Again home">
          <span className="brand-mark">
            <Icon name="repeat" size={23} />
          </span>
          again<span className="brand-dot">.</span>
        </a>
        {session.kind === "ready" && (
          <button
            className="avatar"
            title="Sign out"
            aria-label={`Sign out ${session.data.user.name}`}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await zero.auth.signOut({
                  returnTo: new URL(import.meta.env.BASE_URL, location.href)
                    .href,
                });
                setSession({ kind: "signedOut" });
              })
            }
          >
            {session.data.user.name.slice(0, 1).toUpperCase()}
          </button>
        )}
        {session.kind !== "ready" && (
          <span className="private-label">A little more in control</span>
        )}
      </header>
      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
      {notice && (
        <div className="banner success" role="status">
          <Icon name="check" size={18} />
          {notice}
        </div>
      )}
      <main>
        {session.kind === "loading" && (
          <div className="loading-state" role="status">
            <span className="loader" />
            Getting your subscriptions…
          </div>
        )}
        {session.kind === "signedOut" && (
          <section className="welcome">
            <div className="welcome-art" aria-hidden="true">
              <span className="orbit orbit-one" />
              <span className="orbit orbit-two" />
              <span className="orbit-center">
                <Icon name="repeat" size={62} />
              </span>
              <span className="floating-tag tag-one">All in one place</span>
              <span className="floating-tag tag-two">No surprises</span>
            </div>
            <p className="eyebrow">YOUR MONEY, A LITTLE CLEARER</p>
            <h1>
              Keep track.
              <br />
              Breathe easy.
            </h1>
            <p className="welcome-copy">
              Know what you're paying for, what's coming up, and what you can
              let go.
            </p>
            <button
              className="primary wide"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await zero.auth.signIn({
                    returnTo: new URL(
                      location.pathname + location.hash,
                      location.origin,
                    ).href,
                  });
                })
              }
            >
              Sign in to your space <Icon name="arrow" size={19} />
            </button>
            <p className="fine-print">
              Your subscriptions stay private to your account.
            </p>
          </section>
        )}
        {session.kind === "ready" && page.kind === "home" && (
          <Home data={session.data} onAdd={() => setSheet({ kind: "add" })} />
        )}
        {session.kind === "ready" && page.kind === "list" && (
          <SubscriptionList
            subscriptions={session.data.subscriptions}
            categories={session.data.categories}
            onAdd={() => setSheet({ kind: "add" })}
          />
        )}
        {session.kind === "ready" &&
          page.kind === "detail" &&
          (subscription ? (
            <Detail
              subscription={subscription}
              busy={busy}
              onEdit={() => setSheet({ kind: "edit", subscription })}
              onLog={() =>
                void run(async () => {
                  await logRenewal(subscription);
                  await load();
                  setNotice("Charge logged. Renewal date updated.");
                })
              }
              onCancel={() =>
                void run(async () => {
                  const result = await zero.actions.cancel({
                    subscriptionId: subscription.id,
                  });
                  await load();
                  setNotice(
                    result.cancelUrl
                      ? "Marked cancelled. Open the vendor page below to finish cancelling."
                      : "Subscription marked cancelled",
                  );
                })
              }
            />
          ) : (
            <div className="empty-state">
              <h2>Subscription not found</h2>
              <p>It may have been removed from your account.</p>
              <button
                className="secondary"
                onClick={() => navigate({ kind: "list" })}
              >
                Back to subscriptions
              </button>
            </div>
          ))}
      </main>
      {session.kind === "ready" && (
        <nav className="tab-bar" aria-label="Main navigation">
          <button
            className={page.kind === "home" ? "selected" : ""}
            onClick={() => navigate({ kind: "home" })}
          >
            <Icon name="home" />
            <span>Overview</span>
          </button>
          <button
            className={page.kind !== "home" ? "selected" : ""}
            onClick={() => navigate({ kind: "list" })}
          >
            <Icon name="list" />
            <span>Subscriptions</span>
          </button>
        </nav>
      )}
      {sheet && session.kind === "ready" && (
        <EditSheet
          sheet={sheet}
          categories={session.data.categories}
          onClose={() => setSheet(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function Home({ data, onAdd }: { data: Data; onAdd: () => void }) {
  const active = data.subscriptions.filter((row) => row.status === "active");
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">A CLEARER PICTURE</p>
          <h1>Your overview</h1>
        </div>
        <button
          className="add-button"
          aria-label="Add subscription"
          onClick={onAdd}
        >
          <Icon name="plus" />
        </button>
      </div>
      <section className="burn-card" aria-labelledby="burn-heading">
        <div className="card-top">
          <h2 id="burn-heading">Monthly spending</h2>
          <span className="small-badge">{active.length} active</span>
        </div>
        {data.burn.currencies.length ? (
          data.burn.currencies.map((total, index) => (
            <div
              className={index ? "extra-currency" : "main-currency"}
              key={total.currency}
            >
              <span className="burn-number">
                {money(total.amount, total.currency)}
              </span>
              <span className="currency-caption">{total.currency} / month</span>
            </div>
          ))
        ) : (
          <div className="main-currency">
            <span className="burn-number">0.00</span>
            <span className="currency-caption">per month</span>
          </div>
        )}
        <div className="burn-footer">
          <span className="tiny-dot" />
          Only active subscriptions. Currencies stay separate.
        </div>
      </section>
      <div className="section-heading">
        <h2>Coming up</h2>
        <span className="muted">Next 7 days</span>
      </div>
      {data.soon.length ? (
        <div className="row-group">
          {data.soon.map((row) => (
            <SubscriptionRow key={row.id} subscription={row} soon />
          ))}
        </div>
      ) : (
        <div className="quiet-card">
          <span className="quiet-icon">
            <Icon name="check" />
          </span>
          <div>
            <h3>Nothing around the corner</h3>
            <p>No active renewals in the next 7 days.</p>
          </div>
        </div>
      )}
      <div className="section-heading">
        <h2>Where it goes</h2>
        <span className="muted">Per month</span>
      </div>
      {data.burn.currencies.length ? (
        data.burn.currencies.map((total) => (
          <section
            className="category-card"
            key={total.currency}
            aria-label={`Monthly categories in ${total.currency}`}
          >
            <div className="category-currency">{total.currency}</div>
            <div className="category-bar" aria-hidden="true">
              {total.categories.map((category, index) => (
                <span
                  key={category.category}
                  style={{
                    flex: Math.max(category.amount, 0.01),
                    background: palette[index % palette.length],
                  }}
                />
              ))}
            </div>
            <div className="category-legend">
              {total.categories.map((category, index) => (
                <div key={category.category}>
                  <span
                    className="legend-dot"
                    style={{ background: palette[index % palette.length] }}
                  />
                  <span>{category.category}</span>
                  <strong>{money(category.amount, total.currency)}</strong>
                </div>
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="empty-state compact">
          <h3>Your first subscription starts here</h3>
          <p>Add the things you pay for. We'll do the monthly math.</p>
          <button className="text-button" onClick={onAdd}>
            <Icon name="plus" size={18} />
            Add a subscription
          </button>
        </div>
      )}
      <p className="calculation-note">
        Weekly × 52 ÷ 12 · Monthly × 1 · Yearly ÷ 12
      </p>
    </>
  );
}

function SubscriptionRow({
  subscription,
  soon = false,
}: {
  subscription: Subscription;
  soon?: boolean;
}) {
  const colorIndex =
    [...subscription.name].reduce(
      (sum, letter) => sum + letter.charCodeAt(0),
      0,
    ) % palette.length;
  return (
    <button
      className="subscription-row"
      onClick={() => navigate({ kind: "detail", id: subscription.id })}
    >
      <span
        className="service-icon"
        style={{
          background: `${palette[colorIndex]}20`,
          color: palette[colorIndex],
        }}
      >
        {subscription.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="row-description">
        <strong>{subscription.name}</strong>
        <span>
          {soon
            ? renewalLabel(subscription.nextRenewal)
            : subscription.vendor || subscription.category}
        </span>
      </span>
      <span className="row-price">
        <strong>{money(subscription.amount, subscription.currency)}</strong>
        <span>
          {soon
            ? dateLabel(subscription.nextRenewal).replace(/, \d{4}$/, "")
            : subscription.status === "active"
              ? `/${cycleLabels[subscription.cycle]}`
              : statusLabels[subscription.status]}
        </span>
      </span>
      <Icon name="arrow" size={15} />
    </button>
  );
}

function SubscriptionList({
  subscriptions,
  categories,
  onAdd,
}: {
  subscriptions: Subscription[];
  categories: Category[];
  onAdd: () => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Subscription["status"] | "">("active");
  const [category, setCategory] = useState("");
  const visible = subscriptions.filter(
    (row) =>
      (!status || row.status === status) &&
      (!category || row.category === category) &&
      `${row.name} ${row.vendor}`.toLowerCase().includes(search.toLowerCase()),
  );
  const names = [
    ...new Set([
      ...categories.map((row) => row.name),
      ...subscriptions.map((row) => row.category),
    ]),
  ].sort();
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">EVERYTHING YOU PAY FOR</p>
          <h1>Subscriptions</h1>
        </div>
        <button
          className="add-button"
          aria-label="Add subscription"
          onClick={onAdd}
        >
          <Icon name="plus" />
        </button>
      </div>
      <label className="search-field">
        <Icon name="search" size={20} />
        <input
          type="search"
          aria-label="Search subscriptions"
          placeholder="Search subscriptions"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="filters">
        <label>
          <span className="sr-only">Filter by status</span>
          <select
            value={status}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === "" ||
                value === "active" ||
                value === "paused" ||
                value === "cancelled"
              )
                setStatus(value);
            }}
          >
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="cancelled">Cancelled</option>
            <option value="">All statuses</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by category</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">All categories</option>
            {names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="section-heading">
        <h2>{status ? statusLabels[status] : "All subscriptions"}</h2>
        <span className="muted">
          {visible.length}{" "}
          {visible.length === 1 ? "subscription" : "subscriptions"}
        </span>
      </div>
      {visible.length ? (
        <div className="row-group">
          {visible.map((row) => (
            <SubscriptionRow key={row.id} subscription={row} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-mark">
            <Icon name="list" size={32} />
          </span>
          <h2>{subscriptions.length ? "No matches" : "A fresh start"}</h2>
          <p>
            {subscriptions.length
              ? "Try another filter or search term."
              : "Add your first subscription to see your spending clearly."}
          </p>
          <button className="secondary" onClick={onAdd}>
            Add subscription
          </button>
        </div>
      )}
    </>
  );
}

function Detail({
  subscription,
  busy,
  onEdit,
  onLog,
  onCancel,
}: {
  subscription: Subscription;
  busy: boolean;
  onEdit: () => void;
  onLog: () => void;
  onCancel: () => void;
}) {
  const [charges, setCharges] = useState<Charge[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    setLoading(true);
    void allRows<Charge>((query) =>
      zero.charges.list({
        ...query,
        where: { subscriptionId: subscription.id },
        orderBy: { chargedOn: "desc" },
      }),
    )
      .then((rows) => {
        if (current) {
          setCharges(rows);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (current) setError(message(err));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [subscription.id, subscription.nextRenewal]);
  return (
    <>
      <div className="detail-nav">
        <button
          className="text-button"
          onClick={() => navigate({ kind: "list" })}
        >
          <Icon name="back" size={19} />
          Subscriptions
        </button>
        <button className="text-button" onClick={onEdit}>
          Edit
        </button>
      </div>
      <section className="detail-hero">
        <span className="service-icon large">
          {subscription.name.slice(0, 1).toUpperCase()}
        </span>
        <h1>{subscription.name}</h1>
        <p>{subscription.vendor || subscription.category}</p>
        <div className="detail-amount">
          {money(subscription.amount, subscription.currency)}
          <span> / {cycleLabels[subscription.cycle]}</span>
        </div>
        <span className={`status-pill ${subscription.status}`}>
          {statusLabels[subscription.status]}
        </span>
      </section>
      <div className="detail-info">
        <dl>
          <div>
            <dt>Next renewal</dt>
            <dd>
              {dateLabel(subscription.nextRenewal)}
              <span>{renewalLabel(subscription.nextRenewal)}</span>
            </dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>{subscription.category}</dd>
          </div>
          <div>
            <dt>Payment method</dt>
            <dd>{subscription.paymentMethod || "Not set"}</dd>
          </div>
        </dl>
      </div>
      {subscription.notes && (
        <section className="note-card">
          <h2>Your notes</h2>
          <p>{subscription.notes}</p>
        </section>
      )}
      {subscription.status === "active" && (
        <button className="primary wide" disabled={busy} onClick={onLog}>
          <Icon name="check" size={19} />
          Log this renewal
        </button>
      )}
      <p className="action-note">
        Logging a charge records{" "}
        {money(subscription.amount, subscription.currency)} and moves the
        renewal date forward one {cycleLabels[subscription.cycle]}.
      </p>
      <div className="section-heading">
        <h2>Charge history</h2>
        <span className="muted">{charges.length} logged</span>
      </div>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="muted" role="status">
          Loading charges…
        </p>
      ) : charges.length ? (
        <div className="charge-list">
          {charges.map((charge) => (
            <div className="charge-row" key={charge.id}>
              <span className="charge-check">
                <Icon name="check" size={16} />
              </span>
              <span>{dateLabel(charge.chargedOn)}</span>
              <strong>{money(charge.amount, subscription.currency)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="quiet-card">
          <p>No charges logged yet. Your next renewal can be the first.</p>
        </div>
      )}
      <div className="cancellation-section">
        {subscription.status !== "cancelled" && (
          <button
            className="danger-button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Mark ${subscription.name} as cancelled? This does not cancel billing with the vendor.`,
                )
              )
                onCancel();
            }}
          >
            Mark as cancelled
          </button>
        )}
        {subscription.cancelUrl && (
          <a
            className="vendor-link"
            href={subscription.cancelUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open vendor cancellation page <Icon name="external" size={17} />
          </a>
        )}
        <p>Manage billing with the vendor to stop future charges.</p>
      </div>
    </>
  );
}

function EditSheet({
  sheet,
  categories,
  onClose,
  onSave,
}: {
  sheet: Sheet;
  categories: Category[];
  onClose: () => void;
  onSave: (input: Collections["subscriptions"]["insert"]) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const row = sheet.kind === "edit" ? sheet.subscription : null;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previous;
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const cycle = value("cycle");
    const status = value("status");
    if (cycle !== "weekly" && cycle !== "monthly" && cycle !== "yearly") return;
    if (status !== "active" && status !== "paused" && status !== "cancelled")
      return;
    const amount = Math.round(Number(value("amount")) * 100);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      setError("Enter a valid amount in cents.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSave({
        name: value("name"),
        vendor: value("vendor"),
        amount,
        currency: value("currency").toUpperCase(),
        cycle,
        nextRenewal: value("nextRenewal"),
        category: value("category"),
        paymentMethod: value("paymentMethod"),
        cancelUrl: value("cancelUrl"),
        notes: value("notes"),
        status,
      });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="edit-sheet"
      aria-labelledby="sheet-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="sheet-handle" aria-hidden="true" />
        <header className="sheet-header">
          <div>
            <p className="eyebrow">MAKE ROOM FOR WHAT MATTERS</p>
            <h2 id="sheet-title">
              {row ? "Edit subscription" : "New subscription"}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close sheet"
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="sheet-fields">
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <label>
            Name
            <input
              name="name"
              placeholder="e.g. Spotify"
              maxLength={100}
              required
              autoFocus
              defaultValue={row?.name}
            />
          </label>
          <label>
            Vendor
            <input
              name="vendor"
              placeholder="Company or service"
              maxLength={100}
              defaultValue={row?.vendor ?? ""}
            />
          </label>
          <div className="field-pair">
            <label>
              Amount
              <input
                name="amount"
                type="number"
                inputMode="decimal"
                min="0"
                max="1000000"
                step="0.01"
                placeholder="0.00"
                required
                defaultValue={row ? (row.amount / 100).toFixed(2) : ""}
              />
            </label>
            <label>
              Currency
              <input
                name="currency"
                list="currency-options"
                minLength={3}
                maxLength={3}
                pattern="[a-zA-Z]{3}"
                required
                defaultValue={row?.currency ?? "USD"}
              />
              <datalist id="currency-options">
                <option value="USD" />
                <option value="EUR" />
                <option value="GBP" />
                <option value="CAD" />
                <option value="AUD" />
                <option value="JPY" />
              </datalist>
            </label>
          </div>
          <div className="field-pair">
            <label>
              Billing cycle
              <select name="cycle" defaultValue={row?.cycle ?? "monthly"}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <label>
              Next renewal
              <input
                name="nextRenewal"
                type="date"
                required
                defaultValue={
                  row?.nextRenewal ?? new Date().toISOString().slice(0, 10)
                }
              />
            </label>
          </div>
          <label>
            Category
            <input
              name="category"
              list="category-options"
              placeholder="e.g. Entertainment"
              maxLength={60}
              required
              defaultValue={row?.category ?? "Other"}
            />
            <datalist id="category-options">
              {[
                ...new Set([
                  ...categories.map((category) => category.name),
                  "Entertainment",
                  "Work",
                  "Health",
                  "Home",
                  "Other",
                ]),
              ].map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </label>
          <label>
            Payment method <span className="optional">optional</span>
            <input
              name="paymentMethod"
              placeholder="e.g. Visa ending in 4242"
              maxLength={100}
              defaultValue={row?.paymentMethod ?? ""}
            />
          </label>
          <label>
            Cancellation link <span className="optional">optional</span>
            <input
              name="cancelUrl"
              maxLength={2000}
              type="url"
              placeholder="https://…"
              defaultValue={row?.cancelUrl ?? ""}
            />
          </label>
          <label>
            Notes <span className="optional">optional</span>
            <textarea
              name="notes"
              maxLength={4000}
              placeholder="Anything you want to remember"
              rows={3}
              defaultValue={row?.notes ?? ""}
            />
          </label>
          <label>
            Status
            <select name="status" defaultValue={row?.status ?? "active"}>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </div>
        <footer className="sheet-footer">
          <button className="primary wide" disabled={busy} type="submit">
            {busy ? "Saving…" : row ? "Save changes" : "Add subscription"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
