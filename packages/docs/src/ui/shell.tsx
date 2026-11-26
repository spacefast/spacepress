// The site around the docs: a sticky header with the brand, top links, search, the GitHub link and
// the theme switch; the page; and a footer. Use it as the root layout's markup.
import { Link, type ReactNode } from "spacepress/app";
import { Icon } from "./Icon";
import { DocsEnhancements } from "./Enhance";
import { DocsSearch, type SearchEntry } from "./Search";
import { ThemeToggle } from "./theme";

export interface HeaderLink {
  label: string;
  href: string;
}

export function DocsShell({
  title,
  mark,
  links = [],
  github,
  search,
  footer,
  children,
}: {
  /** The site's name, beside the mark. */
  title: string;
  /** One or two characters in the square before the name. */
  mark?: string;
  links?: HeaderLink[];
  /** `owner/name` on GitHub. */
  github?: string;
  /** Every page search can find; without it the header has no search. */
  search?: SearchEntry[];
  footer?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="sd-shell">
      <header className="sd-header">
        <div className="sd-header-inner">
          <Link href="/" className="sd-brand">
            <span className="sd-brand-mark" aria-hidden="true">{mark ?? title.slice(0, 1)}</span>
            <span className="sd-brand-text">{title}</span>
          </Link>
          {links.length > 0 && (
            <nav className="sd-header-nav" aria-label="Main">
              {links.map((link) => (
                <Link key={link.href} href={link.href}>
                  {link.label}
                </Link>
              ))}
            </nav>
          )}
          <div className="sd-header-actions">
            {search && <DocsSearch entries={search} />}
            {github && (
              <a className="sd-icon-button" href={`https://github.com/${github}`} target="_blank" rel="noopener noreferrer" aria-label="GitHub">
                <Icon name="github" size={16} />
              </a>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main id="main-content">{children}</main>
      {footer && (
        <footer className="sd-footer">
          <div className="sd-footer-inner">{footer}</div>
        </footer>
      )}
      <DocsEnhancements />
    </div>
  );
}
