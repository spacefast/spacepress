import { Link } from "spacepress/server/app";

export const metadata = {
  title: "Page Not Found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <section className="sp-section">
      <div className="sp-container-narrow" style={{ textAlign: "center", padding: "48px 0" }}>
        <h1 style={{ fontSize: "2.4rem", margin: "0 0 14px", letterSpacing: "-0.03em" }}>Oops! That page can&apos;t be found.</h1>
        <p style={{ color: "var(--ink-secondary)", marginBottom: "28px" }}>
          Even <code>WP_Query</code> came back empty. The page you requested does not exist or has moved — jump back into SpacePress below.
        </p>
        <div className="sp-hero-ctas">
          <Link href="/" className="sp-btn sp-btn-primary">Back to Home</Link>
          <Link href="/handbook" className="sp-btn sp-btn-secondary">Read the Handbook</Link>
          <Link href="/docs" className="sp-btn sp-btn-secondary">Browse Reference</Link>
        </div>
      </div>
    </section>
  );
}
