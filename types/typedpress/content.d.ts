import type { Href } from "./app";

// "typedpress/content": navigation for a hierarchical kind's pages. Runs as the visitor; drafts and
// items the visitor may not read are in no tree, pager or link.

/** One item of `nav()`'s tree. The tree is four levels deep: the fourth level's `children` is empty. */
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

/**
 * One `##` or `###` heading of an item, with the anchor id the page renders it with: GitHub's
 * rule (`## What's new?` is `whats-new`; a repeat on the page gets `-1`, `-2`, …).
 */
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

/** One parameter or property of an operation. `depth` is how far it is nested: indent by it. */
export interface ApiField {
  name: string;
  depth: number;
  /** As a reader says it: `string | null`, `Post[]`, `integer | Author`. */
  type: string;
  required: boolean;
  /** HTML, from the document's Markdown: render it with `<Html value>`. */
  description: string;
  /** `min 1`, `max length 200`, `default: 50`, `one of: draft, published`. */
  constraints: string[];
  /** For a parameter: `query`, `path`, `header` or `cookie`. Empty for a property. */
  in: string;
}

/** One response of an operation, with the fields of its body. */
export interface ApiResponse {
  status: string;
  description: string;
  /** The media type of the body, empty when there is none. */
  type: string;
  fields: ApiField[];
}

/** One operation, with request samples a reader copies. */
export interface ApiOperation {
  /** The `operationId`, e.g. `posts.list`. */
  id: string;
  /** The id as a URL segment: `posts-list`. */
  slug: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  /** TypedPress's `x-typedpress-access`: who may call it (`anyone`, `authenticated`, a role, `rule`), or empty. */
  access: string;
  params: ApiField[];
  /** The request body's media type, empty when it takes none. */
  bodyType: string;
  body: ApiField[];
  responses: ApiResponse[];
  /** A `curl` command against the document's first server. */
  curl: string;
  /** The same request with `fetch`. */
  fetch: string;
}

/** A tag of the document and its operations, in the document's order. */
export interface ApiTag {
  name: string;
  /** The name as a URL segment: `WordPress` is `word-press`. */
  slug: string;
  description: string;
  operations: ApiOperation[];
}

/** An OpenAPI document, flat enough for a page to render: see `apiReference()`. */
export interface ApiReference {
  title: string;
  version: string;
  description: string;
  /** The first server's URL: for the app's own API, this site's `/wp-json/typedpress/v1`. */
  server: string;
  tags: ApiTag[];
}

/**
 * An OpenAPI 3.1 document as tags, operations and fields a page maps over: the app's own API (what
 * `typedpress build` writes, as this site serves it) or, given a path, a JSON file in `public/`.
 */
export declare function apiReference(source?: string): ApiReference;
