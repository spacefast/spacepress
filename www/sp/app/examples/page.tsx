import { examples } from "spacepress:db";
import { Link } from "spacepress/app";
import { refreshStars } from "../../server";

export const metadata = {
  title: "Examples",
  description: "Explore real SpacePress applications — from SQL-backed task trackers and editorial sites to full websites — open them in the browser playground or browse their source on GitHub.",
};

const ONE_DAY_MS = 86_400_000;

export default async function ExamplesPage() {
  const rows = await examples.list({ orderBy: { position: "asc", id: "asc" }, limit: 100 });

  const cutoff = new Date(Date.now() - ONE_DAY_MS).toISOString();
  const stale = rows.some((row) => !row.starsAt || row.starsAt < cutoff);
  if (rows.length > 0 && stale) {
    await refreshStars.enqueue({}, { key: "refresh-stars" });
  }

  return (
    <>
      <section className="sp-page-banner">
        <div className="sp-container">
          <h1>SpacePress Examples</h1>
          <p>
            Every example below is a real SpacePress application compiled on every build. Open any of them in the interactive browser playground or inspect the source on GitHub.
          </p>
        </div>
      </section>

      <div className="sp-container" style={{ paddingTop: "36px", paddingBottom: "80px" }}>
        {rows.length === 0 ? (
          <div className="sp-callout is-info">
            <strong>No examples seeded yet.</strong> Run <code>npm run seed</code> (with <code>SP_APP_PASSWORD</code>) to populate the <code>examples</code> SQL table, or jump straight into the <Link href="/play">interactive Playground</Link>.
          </div>
        ) : (
          <div className="sp-card-grid" style={{ marginTop: 0 }}>
            {rows.map((item) => {
              const ghHref = `https://github.com/${item.repo}/tree/main/${item.path}`;
              return (
                <article key={item.id} className="sp-card">
                  <div className="sp-meta-row" style={{ justifyContent: "space-between" }}>
                    <span className="sp-mono-label">{item.name}</span>
                    {item.stars != null && (
                      <span className="sp-star-badge">★ {item.stars}</span>
                    )}
                  </div>
                  <h3>{item.title}</h3>
                  <p style={{ flex: 1 }}>{item.summary}</p>
                  <div className="sp-meta-row" style={{ fontSize: "12.5px" }}>
                    <code>{item.path || item.repo}</code>
                  </div>
                  <div style={{ display: "flex", gap: "10px", marginTop: "6px", flexWrap: "wrap" }}>
                    <Link href={`/play?example=${item.name}`} className="sp-btn sp-btn-primary sp-btn-sm">
                      Open in Playground →
                    </Link>
                    <a
                      href={ghHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="sp-btn sp-btn-secondary sp-btn-sm"
                    >
                      Source ↗
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <div className="sp-callout" style={{ marginTop: "32px" }}>
          <strong>How this page works:</strong> These cards are stored in the <code>examples</code> SQL table defined in <code>www/sp/schema.ts</code>. GitHub star counts are refreshed asynchronously in the background via the <code>refreshStars</code> job on Action Scheduler, and the same data is exposed as JSON at <a href="/api/examples.json"><code>/api/examples.json</code></a>.
        </div>
      </div>
    </>
  );
}
