import { Link } from "spacepress/app";
import { PageActions } from "../../components/PageActions";

export const metadata = {
  title: "Changelog",
  description: "Release notes for SpacePress.",
};

export default function ChangelogPage() {
  return (
    <>
      <section className="sp-page-banner">
        <div className="sp-container-narrow">
          <h1>Changelog</h1>
          <p>
            Release notes for SpacePress. Follow development on{" "}
            <a href="https://github.com/spacefast/spacepress/releases" target="_blank" rel="noopener noreferrer">
              GitHub Releases ↗
            </a>{" "}
            or join{" "}
            <a href="https://github.com/spacefast/spacepress/discussions" target="_blank" rel="noopener noreferrer">
              GitHub Discussions ↗
            </a>.
          </p>
          <div style={{ marginTop: "16px" }}>
            <PageActions mdPath="/md/changelog.md" title="SpacePress Changelog" />
          </div>
        </div>
      </section>

      <div className="sp-container-narrow sp-changelog">
        <article className="sp-release-entry" id="v0-istanbul">
          <header className="sp-release-head">
            <span className="sp-mono-label">v0 &ldquo;Istanbul&rdquo; · CLI 0.3.0</span>
            <h2>First release</h2>
            <p>
              Write a WordPress application in TypeScript. SpacePress compiles its schema, server functions and TSX pages into plugins that run on PHP.
            </p>
          </header>

          <ul className="sp-release-list">
            <li>
              Model editorial content with collections and relational data with SQL tables. SpacePress generates forward-only migrations from your schema. <Link href="/docs/core/schema-and-storage">Schema and storage →</Link>
            </li>
            <li>
              Read data with <code>query()</code>, write it with <code>mutation()</code>, and queue background work with <code>job()</code>. <Link href="/docs/core/actions-jobs-routes">Server functions →</Link>
            </li>
            <li>
              Render pages on the server and add interactive components with <code>&quot;use client&quot;</code>. Islands can call your server functions through the generated typed API. <Link href="/docs/core/pages-and-islands">Pages and islands →</Link>
            </li>
            <li>
              Keep Markdown in Git and edit the same content in WordPress. This site uses <code>@spacepress/docs</code> for its documentation pages and navigation. <Link href="/docs/integrations/docs-package">Build a docs site →</Link>
            </li>
          </ul>

          <div className="sp-release-links">
            <Link href="/quick-start">Start the Quick Start →</Link>
            <Link href="/handbook">Read the Handbook →</Link>
            <a href="https://github.com/spacefast/spacepress/releases" target="_blank" rel="noopener noreferrer">
              GitHub Releases ↗
            </a>
          </div>
        </article>
      </div>
    </>
  );
}
