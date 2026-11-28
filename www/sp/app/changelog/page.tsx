import { Link } from "spacepress/app";
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
        <article className="sp-release-entry" id="2026-11-26">
          <header className="sp-release-head">
            <span className="sp-mono-label">November 22–26, 2026 · main</span>
            <h2>Queries and mutations, the import split, packages with islands, and a docs package</h2>
            <p>
              What changed on <code>main</code> since the preview. Several of these are breaking: the compiler refuses the old spelling and names the new one.
            </p>
          </header>

          <ul className="sp-release-list">
            <li>
              <strong>Breaking: <code>query()</code> and <code>mutation()</code> replace <code>action()</code>.</strong> A server function is <code>query(options, handler)</code> when it only reads and <code>mutation(options, handler)</code> when it writes; its input is the handler&apos;s parameter type. Jobs are <code>job(options, handler)</code> and are queued with <code>myJob.enqueue(...)</code> instead of <code>jobs.myJob</code>. <Link href="/docs/core/actions-jobs-routes">Server functions →</Link>
            </li>
            <li>
              <strong>Breaking: modules say where code runs.</strong> Schema builders stay in <code>&quot;spacepress&quot;</code>; <code>db</code>, <code>HttpError</code>, <code>mail</code>, <code>once</code> and <code>connectors</code> move to <code>&quot;spacepress/server&quot;</code>; kinds come from <code>&quot;spacepress/server/db&quot;</code>; WordPress functions from <code>&quot;spacepress/server/wp&quot;</code>; page helpers from <code>&quot;spacepress/app&quot;</code> and <code>&quot;spacepress/content&quot;</code>; island hooks from <code>&quot;react&quot;</code> and <code>&quot;spacepress/react&quot;</code>. <Link href="/docs/getting-started/project-structure">Project structure →</Link>
            </li>
            <li>
              <strong>Typed islands:</strong> every build writes <code>sp/_generated/api</code>, so islands call <code>useLive(api.notes.list(...))</code> and <code>useMutation(api.actions.clap)</code> with full types. Pages import <code>PageProps</code> from <code>./$types</code>, and <code>defineConfig(&#123; dir &#125;)</code> renames <code>sp/</code>. Islands also accept ordinary browser code in handlers and effects (loops, <code>async</code> callbacks, <code>fetch</code>, <code>localStorage</code>) and upload files with <code>uploadFile(bucket, file)</code>.
            </li>
            <li>
              <strong>Packages can ship UI:</strong> installed packages may export TSX components, <code>&quot;use client&quot;</code> islands and stylesheets; each package island is hashed into the plugin lock. <code>@spacepress/docs</code> (this site&apos;s reference) and <code>@spacepress/todo</code> are the first two. <Link href="/examples">Examples →</Link>
            </li>
            <li>
              <strong>Forward-only storage:</strong> migrations are sortable folders that never drop or rename columns (<code>.was()</code> is replaced by <code>.column()</code> and <code>.alias()</code>), deletes are soft by default, and revisions are unified across collections and tables.
            </li>
            <li>
              <strong>WordPress Abilities everywhere:</strong> the typed client runs each query and mutation through core&apos;s Abilities run route, forms are type-checked against their mutation&apos;s input, fields can be <code>.searchable()</code>, and access rules may run read-only <code>db.query</code> lookups.
            </li>
            <li>
              <strong>Hosting and admin:</strong> compiled page cache policies with fixed purge routes, Gutenberg collaborative editing in SpacePress Admin, host-managed <code>connectors.call()</code>, configurable REST and auth paths, and an in-place upgrade for sites deployed under the TypedPress name. <Link href="/docs/operations/upgrade-to-spacepress">Upgrade guide →</Link>
            </li>
          </ul>
        </article>

        <article className="sp-release-entry" id="v0-istanbul">
          <header className="sp-release-head">
            <span className="sp-mono-label">v0 &ldquo;Istanbul&rdquo; · CLI 0.3.0</span>
            <h2>Initial public preview</h2>
            <p>
              The first end-to-end preview of SpacePress: compile TypeScript schemas, server actions, background jobs, and React TSX pages into native PHP, SQL migrations, OpenAPI 3.1, and standard WordPress plugins — zero Node.js in production.
            </p>
          </header>

          <ul className="sp-release-list">
            <li>
              <strong>Headful WordPress by default, headless when you want it:</strong> file-based React TSX pages and layouts in <code>sp/app/</code> compile to native server-rendered PHP, with <code>&quot;use client&quot;</code> islands compiled to the WordPress Interactivity API. Every build also emits a typed TypeScript client, React hooks, OpenAPI 3.1, and <code>@spacepress/astro</code> for optional external frontends.
            </li>
            <li>
              <strong>Rust + OXC compiler &amp; WebAssembly playground:</strong> deterministic compilation of <code>collection()</code>, <code>table()</code>, <code>global()</code>, <code>wp.posts.extend()</code>, row/field <code>.access()</code>, <code>action()</code>, Action Scheduler <code>job()</code>, WooCommerce storefronts, and React Email templates — running both in the CLI and live in the browser at <Link href="/play">/play</Link>.
            </li>
            <li>
              <strong>Static lint &amp; auto-fix:</strong> <code>spacepress check</code> and <code>spacepress check --fix</code> enforce schema safety and WordPress conventions including <code>capital_P_dangit</code>, surfaced inline inside the browser editor as well.
            </li>
            <li>
              <strong>Two-way Markdown &amp; Git sync:</strong> bind any collection with <code>sync: &quot;content/**/*.md&quot;</code> for three-way merges between VS Code and WordPress Admin with stable UIDs.
            </li>
            <li>
              <strong>Static schema migration:</strong> <code>spacepress migrate config --from emdash|payload|sanity|zero</code> converts existing schemas to <code>spacepress.config.ts</code> without executing source code.
            </li>
            <li>
              <strong>Agent-ready workflow:</strong> WordPress Abilities API annotations, <code>spacepress mcp</code>, <code>AGENTS.md</code> scaffolding, and full Markdown twins at <a href="/llms.txt">/llms.txt</a> and <a href="/llms-full.txt">/llms-full.txt</a>.
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
