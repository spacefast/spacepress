import { Link } from "typedpress/app";
import { PageActions } from "../../components/PageActions";

export const metadata = {
  title: "Changelog",
  description: "Release notes and milestones for SpacePress, starting with v0 \"Istanbul\".",
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
            <h2>Initial public preview</h2>
            <p>
              The first end-to-end preview of SpacePress: compile TypeScript schemas, server actions, background jobs, and React TSX pages into native PHP, numbered SQL migrations, OpenAPI 3.1, and standard WordPress plugins — zero Node.js in production.
            </p>
          </header>

          <ul className="sp-release-list">
            <li>
              <strong>Headful WordPress by default, headless when you want it:</strong> file-based React TSX pages and layouts in <code>tp/app/</code> compile to native server-rendered PHP, with <code>&quot;use client&quot;</code> islands compiled to the WordPress Interactivity API. Every build also emits a typed TypeScript client, React hooks, OpenAPI 3.1, and <code>@typedpress/astro</code> for optional external frontends.
            </li>
            <li>
              <strong>Rust + OXC compiler &amp; WebAssembly playground:</strong> deterministic compilation of <code>collection()</code>, <code>table()</code>, <code>global()</code>, <code>wp.posts.extend()</code>, row/field <code>.access()</code>, <code>action()</code>, Action Scheduler <code>job()</code>, WooCommerce storefronts, and React Email templates — running both in the CLI and live in the browser at <Link href="/play">/play</Link>.
            </li>
            <li>
              <strong>Static lint &amp; auto-fix:</strong> <code>typedpress check</code> and <code>typedpress check --fix</code> enforce schema safety and WordPress conventions including <code>capital_P_dangit</code>, surfaced inline inside the browser editor as well.
            </li>
            <li>
              <strong>Two-way Markdown &amp; Git sync:</strong> bind any collection with <code>sync: &quot;content/**/*.md&quot;</code> for three-way merges between VS Code and WordPress Admin with stable UIDs.
            </li>
            <li>
              <strong>Static schema migration:</strong> <code>typedpress migrate config --from emdash|payload|sanity|zero</code> converts existing schemas to <code>typedpress.config.ts</code> without executing source code.
            </li>
            <li>
              <strong>Agent-ready workflow:</strong> WordPress Abilities API annotations, <code>typedpress mcp</code>, <code>AGENTS.md</code> scaffolding, and full Markdown twins at <a href="/llms.txt">/llms.txt</a> and <a href="/llms-full.txt">/llms-full.txt</a>.
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
