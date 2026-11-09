import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { User } from "../../first/_generated/client/index.ts";
import { allRows, choice, driveKinds, errorMessage, field, gb, numberField, placeKinds, statuses, today, first, type Capacity, type Content, type Drive, type Place, type Reading } from "./api.ts";

type Remote<T> = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; value: T };
type Tab = "search" | "places" | "capacity" | "add";
type Screen = Tab | { driveId: number };
const tabs: readonly Tab[] = ["search", "places", "capacity", "add"];

function useRemote<T>(load: () => Promise<T>, keepPrevious = false) {
  const [result, setResult] = useState<Remote<T>>({ kind: "loading" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setResult((previous) => keepPrevious && previous.kind === "ready" ? previous : { kind: "loading" });
    load().then((value) => { if (current) setResult({ kind: "ready", value }); })
      .catch((error: unknown) => { if (current) setResult({ kind: "error", message: errorMessage(error) }); });
    return () => { current = false; };
  }, [load, revision, keepPrevious]);
  return { result, reload: () => setRevision((value) => value + 1) };
}

function Icon({ name }: { name: "search" | "places" | "capacity" | "add" | "drive" | "arrow" }) {
  const paths = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    places: <><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    capacity: <><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7" /></>,
    add: <path d="M12 4v16M4 12h16" />,
    drive: <><rect x="4" y="3" width="16" height="18" rx="3" /><circle cx="12" cy="10" r="4" /><path d="m12 10 4 4M8 18h1M12 18h4" /></>,
    arrow: <path d="m9 5 7 7-7 7" />,
  };
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <p className={`notice ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{children}</p>;
}

function Loading() { return <p className="loading" role="status">Opening the locker…</p>; }

export function App() {
  const [auth, setAuth] = useState<Remote<User | null>>({ kind: "loading" });
  const [authError, setAuthError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    async function start() {
      const params = new URLSearchParams(location.search);
      if (params.has("code") || params.has("error")) {
        try { await first.auth.handleCallback(); }
        finally { history.replaceState(null, "", location.pathname + location.hash); }
      }
      const user = await first.auth.me();
      if (current) setAuth({ kind: "ready", value: user });
    }
    start().catch((error: unknown) => { if (current) setAuth({ kind: "error", message: errorMessage(error) }); });
    return () => { current = false; };
  }, []);

  async function signIn() {
    setAuthError(""); setBusy(true);
    try { await first.auth.signIn({ returnTo: location.origin + location.pathname }); }
    catch (error) { setAuthError(errorMessage(error)); setBusy(false); }
  }
  async function signOut() {
    setAuthError(""); setBusy(true);
    try { await first.auth.signOut(); setAuth({ kind: "ready", value: null }); }
    catch (error) { setAuthError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  const user = auth.kind === "ready" ? auth.value : null;
  return <div className="shell"><a className="skip-link" href="#main-content">Skip to inventory</a>
    <header className="app-header"><a className="brand" href={location.pathname} aria-label="Drive locker home"><span className="brand-mark"><Icon name="drive" /></span><span>Drive locker<span className="brand-caption">PERSONAL INVENTORY</span></span></a>
      {user && <button className="quiet account" onClick={() => void signOut()} disabled={busy} aria-label={`Sign out ${user.name}`}>Sign out</button>}
    </header>
    {authError && <Notice error>{authError}</Notice>}
    {auth.kind === "loading" ? <Loading /> : auth.kind === "error" ? <main id="main-content" tabIndex={-1} className="welcome"><p className="eyebrow">CONNECTION NEEDED</p><h1>Couldn't open your locker.</h1><Notice error>{auth.message}</Notice><button className="primary" onClick={() => location.reload()}>Try again</button><button className="secondary" onClick={() => void signIn()} disabled={busy}>Sign in again</button></main>
      : !user ? <main id="main-content" tabIndex={-1} className="welcome"><div className="locker-art" aria-hidden="true"><div /><div /><div /><span>01 / 02 / 03</span></div><p className="eyebrow">EVERY DRIVE, ACCOUNTED FOR</p><h1>Know where<br />your data lives.</h1><p className="intro">Find the right drive. Check its health. Keep track of what's on it.</p><button className="primary wide" onClick={() => void signIn()} disabled={busy}>{busy ? "Opening sign-in…" : "Sign in to your locker"}<Icon name="arrow" /></button><p className="fine-print">Your inventory belongs to your account.</p></main>
      : <Locker key={user.id} user={user} />}
  </div>;
}

function Locker({ user }: { user: User }) {
  const [screen, setScreen] = useState<Screen>("search");
  const loadInventory = useCallback(async () => {
    const [drives, places] = await Promise.all([
      allRows((page) => first.drives.list({ ...page, orderBy: { label: "asc", id: "asc" } })),
      allRows((page) => first.places.list({ ...page, orderBy: { name: "asc", id: "asc" } })),
    ]);
    return { drives, places };
  }, []);
  const { result, reload } = useRemote(loadInventory, true);
  function navigate(next: Screen) {
    setScreen(next);
    if (next === "search" || next === "places") reload();
    window.scrollTo({ top: 0, behavior: "instant" });
    requestAnimationFrame(() => document.getElementById("main-content")?.focus({ preventScroll: true }));
  }
  const openDrive = (driveId: number) => navigate({ driveId });
  return <>
    <main id="main-content" tabIndex={-1} className="main-content">
      {result.kind === "loading" ? <Loading /> : result.kind === "error" ? <><Notice error>{result.message}</Notice><button className="secondary" onClick={reload}>Try again</button></> : <>
        {screen === "search" && <Search drives={result.value.drives} places={result.value.places} name={user.name} openDrive={openDrive} addDrive={() => navigate("add")} />}
        {screen === "places" && <Places drives={result.value.drives} places={result.value.places} openDrive={openDrive} onSaved={reload} />}
        {screen === "capacity" && <CapacityReport openDrive={openDrive} />}
        {screen === "add" && <AddDrive places={result.value.places} onSaved={(drive) => { reload(); openDrive(drive.id); }} />}
        {typeof screen === "object" && <DriveDetail driveId={screen.driveId} places={result.value.places} back={() => navigate("search")} onChanged={reload} />}
      </>}
    </main>
    <nav className="bottom-nav" aria-label="Main navigation">{tabs.map((item) => <button key={item} className={screen === item ? "active" : ""} aria-current={screen === item ? "page" : undefined} onClick={() => navigate(item)}><Icon name={item} /><span>{item === "add" ? "Add drive" : item === "search" ? "Find" : item === "places" ? "Places" : "Capacity"}</span></button>)}</nav>
  </>;
}

function DriveCard({ drive, place, onOpen }: { drive: Drive; place: Place | undefined; onOpen: () => void }) {
  return <button className="drive-card" onClick={onOpen}>
    <span className={`drive-symbol ${drive.kind}`}><Icon name="drive" /><span>{drive.kind.toUpperCase()}</span></span>
    <span className="drive-card-body"><span className="drive-card-heading"><strong>{drive.label}</strong><span className={`status ${drive.replacementNeededAt ? "replace" : drive.status}`}>{drive.replacementNeededAt ? "Replace" : drive.status.replace("-", " ")}</span></span><span className="drive-model">{drive.model}</span><span className="drive-meta"><span>{gb(drive.capacityGb)}</span><span>{place?.name ?? "No place assigned"}</span></span><span className="serial">S/N {drive.serial}</span></span>
    <span className="card-arrow"><Icon name="arrow" /></span>
  </button>;
}

function Search({ drives, places, name, openDrive, addDrive }: { drives: Drive[]; places: Place[]; name: string; openDrive: (id: number) => void; addDrive: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [matches, setMatches] = useState<Remote<Drive[]>>({ kind: "ready", value: drives });
  useEffect(() => {
    let current = true;
    if (!query.trim()) { setMatches({ kind: "ready", value: drives }); return; }
    setMatches({ kind: "loading" });
    const timer = setTimeout(() => {
      first.actions.whereIs({ query: query.trim() }).then((rows) => {
        if (current) setMatches({ kind: "ready", value: rows.map((row) => row.drive) });
      }).catch((error: unknown) => { if (current) setMatches({ kind: "error", message: errorMessage(error) }); });
    }, 220);
    return () => { current = false; clearTimeout(timer); };
  }, [query, drives]);
  const rows = matches.kind === "ready" ? matches.value.filter((drive) => filter === "all" || (filter === "attention" ? !!drive.replacementNeededAt || drive.status === "failed" : drive.status === filter)) : [];
  return <>
    <div className="page-heading"><p className="eyebrow">YOUR LOCKER / {name}</p><h1>Find a drive.</h1><p>By label, serial, model, or what's on it.</p></div>
    <label className="search-box"><Icon name="search" /><span className="sr-only">Search drives and contents</span><input type="search" maxLength={160} placeholder="Where did I put…" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" enterKeyHint="search" /></label>
    <div className="filter-row" aria-label="Filter drives">{[{ id: "all", label: "All drives" }, { id: "in-use", label: "In use" }, { id: "spare", label: "Spare" }, { id: "attention", label: "Needs attention" }].map((item) => <button className={`chip ${filter === item.id ? "selected" : ""}`} key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>
    {matches.kind === "loading" ? <Notice>Searching your locker…</Notice> : matches.kind === "error" ? <Notice error>{matches.message}</Notice> : <>
      <div className="section-heading"><h2>{query.trim() ? "Search results" : "Drive inventory"}</h2><span className="count">{rows.length}</span></div><span className="sr-only" role="status">{rows.length} matching drives</span>
      {rows.length === 0 ? <div className="empty"><Icon name="drive" /><h2>{drives.length ? "No matching drives." : "Start with your first drive."}</h2><p>{drives.length ? "Try another serial, label, or description." : "Give it a label, a serial, and a place."}</p>{!drives.length && <button className="primary" onClick={addDrive}>Add a drive</button>}</div> : <div className="drive-list">{rows.map((drive) => <DriveCard key={drive.id} drive={drive} place={places.find((place) => place.id === drive.placeId)} onOpen={() => openDrive(drive.id)} />)}</div>}
    </>}
  </>;
}

function Places({ drives, places, openDrive, onSaved }: { drives: Drive[]; places: Place[]; openDrive: (id: number) => void; onSaved: () => void }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try { await first.places.create({ name: field(form, "name"), kind: choice(field(form, "kind"), placeKinds) }); setAdding(false); onSaved(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  const unassigned = drives.filter((drive) => drive.placeId === null);
  return <>
    <div className="page-heading"><p className="eyebrow">A PLACE FOR EVERYTHING</p><h1>Around the rack.</h1><p>Your drives, grouped by where they live.</p></div>
    <button className="secondary wide" onClick={() => setAdding(!adding)} aria-expanded={adding}><Icon name="add" />{adding ? "Cancel new place" : "Add a place"}</button>
    {adding && <form className="panel form-stack" onSubmit={(event) => void save(event)}><h2>New place</h2><label>Name<input name="name" required maxLength={120} placeholder="NAS · Bay 04" /></label><label>Kind<select name="kind" aria-label="Place kind">{placeKinds.map((kind) => <option key={kind} value={kind}>{kind.replace("-", " ")}</option>)}</select></label>{error && <Notice error>{error}</Notice>}<button className="primary" disabled={busy}>{busy ? "Saving…" : "Save place"}</button></form>}
    {!places.length && !unassigned.length && <div className="empty"><h2>No places yet.</h2><p>Add a NAS bay, a drawer, or an offsite location.</p></div>}
    {[...places.map((place) => ({ place, name: place.name, kind: place.kind.replace("-", " "), drives: drives.filter((drive) => drive.placeId === place.id) })), ...(unassigned.length ? [{ place: undefined, name: "Unassigned", kind: "Choose a place in drive detail", drives: unassigned }] : [])].map((group) => <section key={group.place?.id ?? "unassigned"} className="place-group"><div className="section-heading"><div><h2><Icon name="places" />{group.name}</h2><p className="muted">{group.kind}</p></div><span className="count">{group.drives.length}</span></div>{group.drives.length ? <div className="drive-list">{group.drives.map((drive) => <DriveCard key={drive.id} drive={drive} place={group.place} onOpen={() => openDrive(drive.id)} />)}</div> : <p className="place-empty">No drives here yet.</p>}</section>)}
  </>;
}

function AddDrive({ places, onSaved }: { places: Place[]; onSaved: (drive: Drive) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const drive = await first.drives.create({
        label: field(form, "label"), model: field(form, "model"), serial: field(form, "serial"),
        kind: choice(field(form, "kind"), driveKinds), capacityGb: numberField(form, "capacityGb"),
        interface: field(form, "interface"), status: choice(field(form, "status"), statuses),
        placeId: field(form, "placeId") ? numberField(form, "placeId") : null,
        purchasedOn: field(form, "purchasedOn") || null, warrantyUntil: field(form, "warrantyUntil") || null,
        notes: field(form, "notes"), tags: field(form, "tags").split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      onSaved(drive);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <><div className="page-heading"><p className="eyebrow">MAKE IT FINDABLE</p><h1>Add a drive.</h1><p>A good label saves a trip to the rack.</p></div><form className="form-stack" onSubmit={(event) => void save(event)}>
    <div className="panel form-stack"><label>Label<input name="label" placeholder="Photo archive · 02" required maxLength={120} /></label><label>Model<input name="model" placeholder="Samsung 990 Pro" required maxLength={160} /></label><label>Serial number<input name="serial" required maxLength={160} autoCapitalize="characters" spellCheck={false} /></label><div className="form-row"><label>Kind<select name="kind" aria-label="Drive kind">{driveKinds.map((kind) => <option key={kind} value={kind}>{kind.toUpperCase()}</option>)}</select></label><label>Capacity in GB<input name="capacityGb" type="number" inputMode="decimal" min="0.1" step="0.1" required /></label></div><label>Interface<input name="interface" placeholder="SATA, PCIe 4.0, USB-C…" required maxLength={80} /></label></div>
    <div className="panel form-stack"><label>Place<select name="placeId" aria-label="Drive place"><option value="">No place assigned</option>{places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label>{!places.length && <p className="hint">You can add places from the Places tab.</p>}<label>Status<select name="status" aria-label="Drive status">{statuses.map((status) => <option key={status} value={status}>{status.replace("-", " ")}</option>)}</select></label><div className="form-row"><label>Purchased on<input type="date" name="purchasedOn" /></label><label>Warranty until<input type="date" name="warrantyUntil" /></label></div><label>Tags<span className="hint">Separate with commas</span><input name="tags" placeholder="photos, backup, encrypted" /></label><label>Notes<textarea name="notes" rows={3} placeholder="Anything the label doesn't tell you." /></label></div>
    {error && <Notice error>{error}</Notice>}<button className="primary wide" disabled={busy}>{busy ? "Adding drive…" : "Add to locker"}<Icon name="add" /></button>
  </form></>;
}

function Sparkline({ readings, metric, label, unit }: { readings: Reading[]; metric: "wearPercent" | "tempC"; label: string; unit: string }) {
  const points = readings.slice(-24);
  if (!points.length) return <div className="sparkline"><span className="metric-label">{label}</span><p className="muted">No readings yet</p></div>;
  const values = points.map((reading) => reading[metric]);
  const min = Math.min(...values); const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const xy = (value: number, index: number) => ({ x: 8 + index * 264 / Math.max(1, points.length - 1), y: 62 - (value - min) * 42 / span });
  return <figure className={`sparkline ${metric}`}><figcaption><span className="metric-label">{label}</span><strong>{values.at(-1)}{unit}</strong></figcaption><svg viewBox="0 0 280 76" role="img" aria-label={`${label}, last ${points.length} readings, from ${min}${unit} to ${max}${unit}`}><path d="M8 64H272" stroke="currentColor" opacity="0.12" /><polyline points={values.map((value, index) => { const point = xy(value, index); return `${point.x},${point.y}`; }).join(" ")} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />{points.map((reading, index) => { const point = xy(reading[metric], index); return <circle key={reading.id} cx={point.x} cy={point.y} r="3" fill="currentColor"><title>{reading.readOn}: {reading[metric]}{unit}</title></circle>; })}</svg><span className="chart-range">{points[0]?.readOn} → {points.at(-1)?.readOn}</span></figure>;
}

function DriveDetail({ driveId, places, back, onChanged }: { driveId: number; places: Place[]; back: () => void; onChanged: () => void }) {
  const load = useCallback(async () => {
    const [drive, readings, contents] = await Promise.all([
      first.drives.get(driveId),
      allRows((page) => first.healthReadings.list({ ...page, where: { driveId }, orderBy: { readOn: "asc", id: "asc" } })),
      allRows((page) => first.contents.list({ ...page, where: { driveId }, orderBy: { id: "asc" } })),
    ]);
    return { drive, readings, contents };
  }, [driveId]);
  const { result, reload } = useRemote(load);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [retiring, setRetiring] = useState(false);
  async function mutate(operation: () => Promise<unknown>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try { await operation(); setMessage(success); reload(); onChanged(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  async function logReading(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await first.actions.logHealth({ driveId, readOn: field(form, "readOn"), powerOnHours: numberField(form, "powerOnHours"), wearPercent: numberField(form, "wearPercent"), reallocatedSectors: numberField(form, "reallocatedSectors"), tempC: numberField(form, "tempC") });
      setMessage(result.verdict === "replace" ? "Replace this drive. Back up its contents and plan a replacement." : result.verdict === "watch" ? "Reading saved. Watch this drive and check it again soon." : result.verdict === "ok" ? "Reading saved. The trend looks OK." : `Reading saved. Verdict: ${result.verdict}.`);
      reload(); onChanged();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  if (result.kind === "loading") return <Loading />;
  if (result.kind === "error") return <><button className="quiet back" onClick={back}>← Back to drives</button><Notice error>{result.message}</Notice><button className="secondary" onClick={reload}>Try again</button></>;
  const { drive, readings, contents } = result.value;
  const latest = readings.at(-1);
  return <>
    <button className="quiet back" onClick={back}>← Back to drives</button>
    <div className="page-heading detail-heading"><p className="eyebrow">{drive.kind.toUpperCase()} / {gb(drive.capacityGb)}</p><h1>{drive.label}</h1><p>{drive.model}</p><span className={`status ${drive.replacementNeededAt ? "replace" : drive.status}`}>{drive.replacementNeededAt ? "Replace drive" : drive.status.replace("-", " ")}</span></div>
    {error && <Notice error>{error}</Notice>}{message && <Notice>{message}</Notice>}
    {drive.replacementNeededAt && <Notice error>Marked for replacement on {new Date(drive.replacementNeededAt).toLocaleDateString()}. Back up its contents before moving data.</Notice>}
    <section className="panel"><dl className="drive-facts"><div><dt>Serial</dt><dd className="mono">{drive.serial}</dd></div><div><dt>Interface</dt><dd>{drive.interface}</dd></div><div><dt>Purchased</dt><dd>{drive.purchasedOn ?? "Not recorded"}</dd></div><div><dt>Warranty ends</dt><dd>{drive.warrantyUntil ?? "Not recorded"}</dd></div></dl>
      <label className="move-label">Stored in<select aria-label="Stored in" value={drive.placeId ?? ""} disabled={busy} onChange={(event) => { const placeId = event.target.value ? Number(event.target.value) : null; void mutate(() => first.drives.update(driveId, { placeId }), "Place updated."); }}><option value="">No place assigned</option>{places.map((place) => <option key={place.id} value={place.id}>{place.name}</option>)}</select></label>
      {drive.tags.length > 0 && <div className="tag-list">{drive.tags.map((tag, index) => <span key={`${tag}-${index}`}>#{tag}</span>)}</div>}{drive.notes && <p className="notes">{drive.notes}</p>}
    </section>
    <section><div className="section-heading"><h2>Health trend</h2><span className="muted">{readings.length} readings</span></div><div className="chart-grid"><Sparkline readings={readings} metric="wearPercent" label="Wear used" unit="%" /><Sparkline readings={readings} metric="tempC" label="Temperature" unit="°C" /></div>{latest && <p className="hint">Latest reading: {latest.powerOnHours.toLocaleString()} power-on hours · {latest.reallocatedSectors} reallocated sectors</p>}</section>
    <form className="panel form-stack" onSubmit={(event) => void logReading(event)}><h2>Log a reading</h2><label>Read on<input type="date" name="readOn" defaultValue={today()} min={latest ? new Date(Date.parse(latest.readOn) + 86_400_000).toISOString().slice(0, 10) : undefined} required /></label><div className="form-row"><label>Power-on hours<input name="powerOnHours" type="number" inputMode="numeric" min="0" step="1" defaultValue={latest?.powerOnHours ?? 0} required /></label><label>Wear used, %<input name="wearPercent" type="number" inputMode="decimal" min="0" max="100" step="0.1" defaultValue={latest?.wearPercent ?? 0} required /></label></div><div className="form-row"><label>Reallocated sectors<input name="reallocatedSectors" type="number" inputMode="numeric" min="0" step="1" defaultValue={latest?.reallocatedSectors ?? 0} required /></label><label>Temperature, °C<input name="tempC" type="number" inputMode="decimal" min="-40" max="150" step="0.1" defaultValue={latest?.tempC ?? 30} required /></label></div><p className="hint">Wear means percentage of the drive's lifetime used. Readings must be on a later day than the previous reading. Enter 0 for counters your drive does not report.</p><button className="primary wide" disabled={busy}>{busy ? "Saving…" : "Save reading & check trend"}</button></form>
    <Contents driveId={driveId} contents={contents} capacityGb={drive.capacityGb} onSaved={reload} />
    {readings.length > 0 && <details className="panel"><summary>Reading history</summary><ol className="reading-history">{[...readings].reverse().map((reading) => <li key={reading.id}><strong>{reading.readOn}</strong><span>{reading.wearPercent}% wear · {reading.tempC}°C</span><span>{reading.powerOnHours.toLocaleString()} hours · {reading.reallocatedSectors} sectors</span></li>)}</ol></details>}
    {drive.status !== "retired" && <section className="retire-section">{retiring ? <><p>Retire this drive? Its history and contents stay in the locker.</p><div className="button-row"><button className="danger" disabled={busy} onClick={() => void mutate(async () => { await first.actions.retire({ driveId }); setRetiring(false); }, "Drive retired.")}>Yes, retire drive</button><button className="secondary" onClick={() => setRetiring(false)}>Cancel</button></div></> : <button className="quiet" onClick={() => setRetiring(true)}>Retire this drive</button>}</section>}
  </>;
}

function Contents({ driveId, contents, capacityGb, onSaved }: { driveId: number; contents: Content[]; capacityGb: number; onSaved: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    setBusy(true); setError("");
    try { await first.contents.create({ driveId, description: field(values, "description"), usedGb: numberField(values, "usedGb"), lastBackupOn: field(values, "lastBackupOn") || null }); form.reset(); onSaved(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section className="panel form-stack"><div className="section-heading"><h2>What's on it</h2><span className="muted">{gb(contents.reduce((sum, content) => sum + content.usedGb, 0))}</span></div>
    {!contents.length ? <p className="muted">Nothing recorded yet.</p> : <ul className="contents-list">{contents.map((content) => <li key={content.id}><strong>{content.description}</strong><span>{gb(content.usedGb)} · Last backup {content.lastBackupOn ?? "not recorded"}</span></li>)}</ul>}
    <form className="form-stack content-form" onSubmit={(event) => void save(event)}><label>Description<input name="description" placeholder="Family photos, 2020-2026" required maxLength={500} /></label><div className="form-row"><label>Used GB<input name="usedGb" type="number" inputMode="decimal" min="0" max={capacityGb} step="0.1" required /></label><label>Last backup<input name="lastBackupOn" type="date" /></label></div>{error && <Notice error>{error}</Notice>}<button className="secondary wide" disabled={busy}>{busy ? "Saving…" : "Record contents"}</button></form>
  </section>;
}

function CapacityBar({ name, totalGb, usedGb, freeGb }: { name: string; totalGb: number; usedGb: number; freeGb: number }) {
  const percent = totalGb > 0 ? Math.min(100, Math.max(0, usedGb / totalGb * 100)) : 0;
  return <div className="capacity-row"><div className="capacity-title"><strong>{name}</strong><span>{gb(totalGb)}</span></div><div className="capacity-track" role="meter" aria-label={`${name} capacity used`} aria-valuenow={Math.min(usedGb, totalGb)} aria-valuemin={0} aria-valuemax={totalGb || 1} aria-valuetext={`${gb(usedGb)} used, ${gb(freeGb)} free`}><span style={{ width: `${percent}%` }} /></div><div className="capacity-legend"><span>{gb(usedGb)} used</span><span>{gb(freeGb)} free</span></div></div>;
}

function CapacityReport({ openDrive }: { openDrive: (id: number) => void }) {
  const load = useCallback(() => first.actions.capacityReport({}), []);
  const { result, reload } = useRemote<Capacity>(load);
  const [days, setDays] = useState(30);
  const loadWarranty = useCallback(() => first.actions.warrantyExpiring({ days }), [days]);
  const warranties = useRemote(loadWarranty);
  return <><div className="page-heading"><p className="eyebrow">ROOM TO GROW</p><h1>Capacity.</h1><p>Recorded space, across your locker.</p></div>
    {result.kind === "loading" ? <Loading /> : result.kind === "error" ? <><Notice error>{result.message}</Notice><button className="secondary" onClick={reload}>Try again</button></> : <>
      <section className="capacity-hero"><span className="eyebrow">AVAILABLE SPACE</span><strong>{gb(result.value.freeGb)}</strong><p>{gb(result.value.usedGb)} used of {gb(result.value.totalGb)}</p><p className="hint">All your drives, including retired and failed. Used = sum of recorded contents. Free = total capacity minus used.</p></section>
      <section className="panel"><h2>By place</h2>{result.value.byPlace.length ? result.value.byPlace.map((row) => <CapacityBar key={row.placeId ?? "unassigned"} name={row.name} totalGb={row.totalGb} usedGb={row.usedGb} freeGb={row.freeGb} />) : <p className="muted">Add a drive to see capacity here.</p>}</section>
      <section className="panel"><h2>By kind</h2>{result.value.byKind.map((row) => <CapacityBar key={row.kind} name={row.kind.toUpperCase()} totalGb={row.totalGb} usedGb={row.usedGb} freeGb={row.freeGb} />)}</section>
    </>}
    <section className="panel"><h2>Warranty check</h2><label className="warranty-filter">Expiring within<select aria-label="Expiring within" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option><option value={365}>1 year</option></select></label>{warranties.result.kind === "loading" ? <p className="muted" role="status">Checking warranties…</p> : warranties.result.kind === "error" ? <Notice error>{warranties.result.message}</Notice> : !warranties.result.value.length ? <p className="muted">No warranties expiring in this window.</p> : <ul className="warranty-list">{warranties.result.value.map((drive) => <li key={drive.id}><button className="warranty-drive" onClick={() => openDrive(drive.id)}><span><strong>{drive.label}</strong><span>Ends {drive.warrantyUntil}</span></span><Icon name="arrow" /></button></li>)}</ul>}</section>
  </>;
}
