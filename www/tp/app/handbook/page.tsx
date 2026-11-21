import { Link } from "typedpress/app";
import { Part1Foundation } from "../../components/guide/Part1Foundation";
import { Part2ServerAndUI } from "../../components/guide/Part2ServerAndUI";
import { Part3Ecosystem } from "../../components/guide/Part3Ecosystem";

export const metadata = {
  title: "Handbook",
  description: "The complete end-to-end interactive handbook for SpacePress: Rust/OXC compiler, schemas, SQL migrations, access control, actions, jobs, TSX pages, WooCommerce, React Email, Markdown sync, MCP, and deployment.",
};

const SECTIONS = [
  { id: "mental-model", num: "01", title: "Project Layout & Mental Model" },
  { id: "compiler", num: "02", title: "Rust & OXC Compiler" },
  { id: "data-modeling", num: "03", title: "Data Modeling & Migrations" },
  { id: "queries-access", num: "04", title: "Queries, Validation & Access" },
  { id: "hooks", num: "05", title: "Hooks & Lifecycle Events" },
  { id: "actions-jobs-routes", num: "06", title: "Actions, Jobs, Routes & Files" },
  { id: "pages-islands", num: "07", title: "Pages, Layouts & Islands" },
  { id: "clients-astro", num: "08", title: "Typed Client, React & Astro" },
  { id: "woocommerce", num: "09", title: "WooCommerce Storefront" },
  { id: "react-email", num: "10", title: "React Email Templates" },
  { id: "admin-plugins", num: "11", title: "Admin, Gutenberg & Plugins" },
  { id: "markdown-sync", num: "12", title: "Two-Way Markdown Git Sync" },
  { id: "mcp-agents", num: "13", title: "MCP, Abilities & AI Agents" },
  { id: "deploy-cli", num: "14", title: "Hosting, Deploy & CLI" },
];

export default function HandbookPage() {
  return (
    <>
      <section className="sp-page-banner">
        <div className="sp-container-wide">
          <h1>The SpacePress Handbook</h1>
          <p>
            A thorough, single-page engineering handbook covering every layer of SpacePress — with live, editable WebAssembly compiler sandboxes embedded throughout so you can test every feature as you read.
          </p>
          <div style={{ display: "flex", gap: "12px", marginTop: "20px", flexWrap: "wrap" }}>
            <Link href="/quick-start" className="sp-btn sp-btn-primary sp-btn-sm">3-Minute Quick Start →</Link>
            <Link href="/play" className="sp-btn sp-btn-secondary sp-btn-sm">Open Full Playground</Link>
            <Link href="/docs" className="sp-btn sp-btn-ghost sp-btn-sm">Browse Reference</Link>
          </div>
        </div>
      </section>

      <div className="sp-container-wide">
        <div className="sp-guide-layout">
          <aside className="sp-toc" data-toc="" aria-label="Handbook contents">
            <p className="sp-toc-title">In this handbook</p>
            <ol>
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", opacity: 0.7 }}>{s.num}</span>
                    <span>{s.title}</span>
                  </a>
                </li>
              ))}
            </ol>
          </aside>

          <article className="sp-guide-article">
            <Part1Foundation />
            <Part2ServerAndUI />
            <Part3Ecosystem />
          </article>
        </div>
      </div>
    </>
  );
}
