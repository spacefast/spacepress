import type { Href } from "./app";

// "first/content": navigation for a hierarchical kind's pages. Runs as the visitor; drafts and
// items the visitor may not read are in no tree, pager or link.

/** One item of `nav()`'s tree. `children` goes four levels deep. */
export interface NavItem {
  id: number;
  title: string;
  /** The item's path on the site (`/docs/guides/install`), for `<Link href>`. */
  href: Href;
  /** This is the current item. */
  current: boolean;
  /** This is the current item or one of its ancestors: its section is open. */
  open: boolean;
  children: NavItem[];
}

/** One end of `pager()`. */
export interface PagerLink {
  id: number;
  title: string;
  /** The item's path on the site (`/docs/guides/install`), for `<Link href>`. */
  href: Href;
}

/** One `##` or `###` heading of an item, with the anchor id the page renders it with. */
export interface Heading {
  depth: 2 | 3;
  text: string;
  id: string;
}

/** The kind's published items as a tree: siblings by `order`, then title. */
export declare function nav(kind: unknown, current?: { id: number } | number | null): Promise<NavItem[]>;
/** The items before and after `current`, reading the tree top to bottom. */
export declare function pager(kind: unknown, current: { id: number } | number): Promise<{ prev: PagerLink | null; next: PagerLink | null }>;
/** The item's `##` and `###` headings, for a table of contents. */
export declare function headings(item: unknown): Heading[];
