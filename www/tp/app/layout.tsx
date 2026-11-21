import { Link, type LayoutProps } from "typedpress/app";
import "./site.css";

export const template = "blank";

export const metadata = {
  title: { default: "SpacePress — The TypeScript Framework for WordPress", template: "%s · SpacePress" },
  description: "Write TypeScript schemas, server actions, background jobs, and React TSX pages. SpacePress compiles them with Rust into native PHP, SQL migrations, OpenAPI, and WordPress plugins — zero Node.js in production.",
  scripts: ["/site.js"],
  // Strichpunkt Sans and JetBrains Mono, the two faces site.css names (a stylesheet can't @import).
  links: [
    { rel: "preconnect", href: "https://fonts-api.wp.com" },
    { rel: "preconnect", href: "https://fonts.wp.com" },
    { rel: "stylesheet", href: "https://fonts-api.wp.com/css2?family=JetBrains+Mono:wght@400;500&family=Strichpunkt+Sans:wght@400..900&display=swap" },
  ],
};

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div className="sp-shell">
      <div className="sp-wip-banner" role="status">
        <span>v0 &ldquo;Istanbul&rdquo; · THIS IS WORK IN PROGRESS.</span>
      </div>

      <header className="sp-header">
        <div className="sp-container sp-header-inner">
          <Link href="/" className="sp-brand">
            <span className="sp-logo-mark" aria-hidden="true">S</span>
            <span>SpacePress</span>
          </Link>

          <nav className="sp-nav" aria-label="Primary">
            <Link href="/quick-start">Quick Start</Link>
            <Link href="/handbook">Handbook</Link>
            <Link href="/examples">Examples</Link>
            <Link href="/docs">Reference</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/play">Playground</Link>
          </nav>

          <div className="sp-nav-actions">
            <a
              className="sp-btn sp-btn-ghost sp-btn-sm sp-hide-sm"
              href="https://github.com/spacefast/spacepress"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub ↗
            </a>
            <Link href="/quick-start" className="sp-btn sp-btn-primary sp-btn-sm sp-hide-sm">
              Get Started
            </Link>
            <button
              type="button"
              className="sp-nav-toggle"
              data-nav-toggle=""
              aria-expanded="false"
              aria-label="Toggle navigation"
            >
              Menu
            </button>
          </div>
        </div>
        <div className="sp-mobile-drawer" data-nav-drawer="">
          <Link href="/quick-start">Quick Start</Link>
          <Link href="/handbook">Handbook</Link>
          <Link href="/examples">Examples</Link>
          <Link href="/docs">Reference</Link>
          <Link href="/blog">Blog</Link>
          <Link href="/play">Playground</Link>
          <a href="https://github.com/spacefast/spacepress" target="_blank" rel="noopener noreferrer">
            GitHub ↗
          </a>
        </div>
      </header>

      <main>{children}</main>

      <footer className="sp-footer">
        <div className="sp-container">
          <div className="sp-footer-grid">
            <div>
              <Link href="/" className="sp-brand">
                <span className="sp-logo-mark" aria-hidden="true">S</span>
                <span>SpacePress</span>
              </Link>
              <p style={{ marginTop: "12px", maxWidth: "320px" }}>
                The TypeScript full-stack framework that compiles directly into native PHP, SQL migrations, and WordPress plugins. Built with Rust and OXC.
              </p>
            </div>

            <div>
              <h4>Learn</h4>
              <ul>
                <li><Link href="/quick-start">Quick Start</Link></li>
                <li><Link href="/handbook">Handbook</Link></li>
                <li><Link href="/docs">Reference</Link></li>
                <li><Link href="/examples">Examples</Link></li>
              </ul>
            </div>

            <div>
              <h4>Explore</h4>
              <ul>
                <li><Link href="/play">Browser Playground</Link></li>
                <li><Link href="/blog">Blog</Link></li>
                <li><a href="/api/examples.json">Examples JSON API</a></li>
                <li><a href="/third-party-licenses.txt">Third-Party Licenses</a></li>
              </ul>
            </div>

            <div>
              <h4>Project</h4>
              <ul>
                <li><a href="https://github.com/spacefast/spacepress" target="_blank" rel="noopener noreferrer">GitHub Repository</a></li>
                <li><a href="https://github.com/spacefast/spacepress/issues" target="_blank" rel="noopener noreferrer">Issues &amp; Roadmap</a></li>
                <li><a href="https://spacepress.dev">spacepress.dev</a></li>
              </ul>
            </div>
          </div>

          <div className="sp-footer-bottom">
            <span>
              Proudly powered by <Link href="/">SpacePress</Link> on{" "}
              <a href="https://wordpress.org" target="_blank" rel="noopener noreferrer">WordPress</a>.
            </span>
            <span>v0 &ldquo;Istanbul&rdquo; · Compiler MIT · WordPress runtime GPL-2.0-or-later.</span>
          </div>
        </div>

        <div className="sp-poetry-banner" aria-label="Code is Poetry (Now Type-Checked)">
          <span className="sp-poetry-main">CODE IS POETRY</span>
          <span className="sp-poetry-sub">(NOW TYPE-CHECKED)</span>
        </div>
      </footer>
    </div>
  );
}
