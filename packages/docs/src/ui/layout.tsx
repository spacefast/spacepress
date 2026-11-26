// The docs page around a doc's content: the sidebar tree, breadcrumbs, the article with its page
// actions and pager, and the table of contents. All server components: the page works, links and
// prints without JavaScript; the islands (search, tabs, the enhancer) add to it.
import { Content, Link, type ReactNode } from "spacepress/app";
import type { JSX } from "spacepress/jsx-runtime";
import type { Heading, NavItem, PagerLink } from "spacepress/content";
import { Icon } from "./Icon";

/** What a doc page shows of its record. */
export interface DocItem {
  title: string;
  description?: string | null;
  content?: string | null;
  updatedAt?: string | null;
}

/** The site-wide settings the docs chrome reads. */
export interface DocsSite {
  /** The site's name, in the header and in page titles. */
  title: string;
  /** The public origin (`https://spacepress.dev`): absolute links for the chat page actions. */
  url?: string;
  /** `owner/name` on GitHub: the header link and "Edit this page". */
  github?: string;
  /** The branch and folder the docs' Markdown lives in, for "Edit this page" (`main/www/content/docs`). */
  editPath?: string;
  resources?: { title: string; href: string }[];
}

/** The sidebar: each section a collapsible group, the current page and its ancestors open. */
export function Sidebar({ items, label = "Docs" }: { items: NavItem[]; label?: string }) {
  return (
    <nav className="sd-sidebar" aria-label={label}>
      <SidebarList items={items} depth={0} />
    </nav>
  );
}

function SidebarList({ items, depth }: { items: NavItem[]; depth: number }): JSX.Element {
  return (
    <ul className={depth === 0 ? "sd-nav sd-nav-root" : "sd-nav"}>
      {items.map((item) =>
        item.children.length > 0 ? (
          <li key={item.id} className={item.open ? "sd-nav-group is-open" : "sd-nav-group"}>
            <details open={item.open || depth === 0}>
              <summary className={item.current ? "sd-nav-link is-current" : "sd-nav-link"}>
                <span>{item.title}</span>
                <span className="sd-chevron">
                  <Icon name="chevron-right" size={14} />
                </span>
              </summary>
              <ul className="sd-nav">
                <li>
                  <Link href={item.href} className={item.current ? "sd-nav-link is-current" : "sd-nav-link"} aria-current={item.current ? "page" : undefined}>
                    Overview
                  </Link>
                </li>
              </ul>
              <SidebarList items={item.children} depth={depth + 1} />
            </details>
          </li>
        ) : (
          <li key={item.id}>
            <Link href={item.href} className={item.current ? "sd-nav-link is-current" : "sd-nav-link"} aria-current={item.current ? "page" : undefined}>
              {item.title}
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}

/** The current page's ancestors in the tree, root first, ending with the page itself. */
export function trail(items: NavItem[]): NavItem[] {
  for (const item of items) {
    if (item.current) return [item];
    if (item.open) {
      const below = trail(item.children);
      if (below.length > 0) return [item, ...below];
    }
  }
  return [];
}

export function Breadcrumbs({ items, home }: { items: NavItem[]; home?: { title: string; href: string } }) {
  const path = trail(items);
  if (path.length < 2 && !home) return null;
  return (
    <nav className="sd-breadcrumbs" aria-label="Breadcrumbs">
      <ol>
        {home && (
          <li>
            <a href={home.href}>{home.title}</a>
          </li>
        )}
        {path.slice(0, -1).map((item) => (
          <li key={item.id}>
            <Link href={item.href}>{item.title}</Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** "On this page": the doc's `##` and `###` headings. The enhancer marks the one in view. */
export function TableOfContents({ headings, title = "On this page" }: { headings: Heading[]; title?: string }) {
  if (headings.length === 0) return null;
  return (
    <nav className="sd-toc" aria-label={title} data-sd-toc="">
      <p className="sd-toc-title">
        <Icon name="list" size={14} />
        {title}
      </p>
      <ul>
        {headings.map((h) => (
          <li key={h.id} className={h.depth === 3 ? "sd-toc-sub" : undefined}>
            <a href={`#${h.id}`}>{h.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Pager({ prev, next }: { prev: PagerLink | null; next: PagerLink | null }) {
  if (!prev && !next) return null;
  return (
    <nav className="sd-pager" aria-label="Previous and next pages">
      {prev ? (
        <Link href={prev.href} rel="prev" className="sd-pager-link">
          <small>Previous</small>
          <span>
            <Icon name="chevron-left" size={14} />
            {prev.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next.href} rel="next" className="sd-pager-link is-next">
          <small>Next</small>
          <span>
            {next.title}
            <Icon name="chevron-right" size={14} />
          </span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/**
 * Copy the page as Markdown, open its Markdown twin, ask a chat assistant about it, or edit it on
 * GitHub. `markdown` is the page's `.md` twin, which the runtime serves for every public page.
 */
export function PageActions({
  title,
  markdown,
  site,
  source,
}: {
  title: string;
  markdown: string;
  site: DocsSite;
  /** The doc's file below `site.editPath` (`guides/install.md`). */
  source?: string;
}) {
  const absolute = site.url ? `${site.url}${markdown}` : markdown;
  const prompt = `Read ${absolute} (${title}) and help me with questions about it.`;
  const edit = site.github && site.editPath && source ? `https://github.com/${site.github}/edit/${site.editPath}/${source}` : null;
  return (
    <div className="sd-page-actions">
      <button type="button" className="sd-action" data-sd-copy-markdown={markdown}>
        <Icon name="copy" size={14} />
        <span>Copy page</span>
      </button>
      <details className="sd-action-menu">
        <summary className="sd-action" aria-label="More page actions">
          <Icon name="chevron-down" size={14} />
        </summary>
        <div className="sd-action-list">
          <a href={markdown}>
            <Icon name="file-text" size={16} />
            <span>
              View as Markdown<small>The page as plain text</small>
            </span>
          </a>
          <a href={`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`} target="_blank" rel="noopener noreferrer">
            <Icon name="message-square" size={16} />
            <span>
              Open in ChatGPT<small>Ask about this page</small>
            </span>
          </a>
          <a href={`https://claude.ai/new?q=${encodeURIComponent(prompt)}`} target="_blank" rel="noopener noreferrer">
            <Icon name="sparkles" size={16} />
            <span>
              Open in Claude<small>Ask about this page</small>
            </span>
          </a>
          {site.resources?.map((resource) => (
            <a key={resource.href} href={resource.href}>
              <Icon name="file-text" size={16} />
              <span>{resource.title}</span>
            </a>
          ))}
          {edit && (
            <a href={edit} target="_blank" rel="noopener noreferrer">
              <Icon name="pencil" size={16} />
              <span>
                Edit on GitHub<small>Suggest a change</small>
              </span>
            </a>
          )}
        </div>
      </details>
    </div>
  );
}

/** `2026-11-26T10:00:00Z` → `November 26, 2026`, read from the ISO text (UTC). */
function formatDate(iso: string): string {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const year = iso.slice(0, 4);
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  if (month < 1 || month > 12 || !(day >= 1)) return iso;
  return `${months[month - 1]} ${day}, ${year}`;
}

/** The three-column doc page. `children` goes after the content (feedback, comments). */
export function DocPage({
  item,
  tree,
  prev,
  next,
  headings,
  markdown,
  site,
  source,
  home,
  children,
}: {
  item: DocItem;
  tree: NavItem[];
  prev: PagerLink | null;
  next: PagerLink | null;
  headings: Heading[];
  markdown: string;
  site: DocsSite;
  source?: string;
  home?: { title: string; href: string };
  children?: ReactNode;
}) {
  return (
    <div className="sd-docs">
      <aside className="sd-docs-sidebar">
        <details className="sd-mobile-nav">
          <summary>
            <Icon name="menu" size={16} />
            <span>Menu</span>
          </summary>
          <Sidebar items={tree} label={home?.title} />
        </details>
        <div className="sd-desktop-nav">
          <Sidebar items={tree} label={home?.title} />
        </div>
      </aside>
      <article className="sd-article" data-sd-article="">
        <Breadcrumbs items={tree} home={home} />
        <header className="sd-article-head">
          <h1>{item.title}</h1>
          <PageActions title={item.title} markdown={markdown} site={site} source={source} />
        </header>
        {item.description && <p className="sd-lead">{item.description}</p>}
        <div className="sd-prose">
          <Content value={item.content} />
        </div>
        {children}
        <footer className="sd-article-foot">
          {item.updatedAt && <p className="sd-updated">Last updated {formatDate(item.updatedAt)}</p>}
          <Pager prev={prev} next={next} />
        </footer>
      </article>
      <aside className="sd-docs-toc">
        <TableOfContents headings={headings} />
      </aside>
    </div>
  );
}
