// "spacepress/app": pages, layouts and HTTP routes under <dir>/app/ (docs/spec/rendering.md §2–§4).
// Types only: the compiler lowers these to PHP; nothing here runs in Node or the browser.
/// <reference path="./assets.d.ts" />
import type { AccessCtx, Action, ReadOnlyDb, RouteRequest, RouteResponse, User } from "./index.d.ts";
import type { JSX } from "./jsx-runtime.d.ts";

export type { RouteRequest, RouteResponse };

/**
 * The app's routes, by id (the folder below `sp/app/`) → the params its folders bind.
 * `spacepress build` writes the map to `sp/_generated/routes.d.ts`, which augments this interface.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Routes {}

/** Anything a component can render: what `children` may be. */
export type ReactNode = JSX.Children;

/** A path the app serves, checked against the generated route map once it exists. */
export type Href = keyof Routes extends never ? string : RoutePaths | `${RoutePaths}?${string}` | `${RoutePaths}#${string}` | `http${string}` | `mailto:${string}` | `#${string}` | `?${string}`;
type RoutePaths = { [K in keyof Routes]: Routes[K] extends { path: infer P extends string } ? P : never }[keyof Routes];

type Params<R> = R extends keyof Routes ? (Routes[R] extends { params: infer P } ? P : Record<string, string>) : Record<string, string | string[]>;

/**
 * What a page receives: `params` from its folder names (`[slug]` a string, `[...rest]` and
 * `[[...rest]]` arrays), `search` parsed by `export const search`, the signed-in `user` (or null),
 * and a read-only `db` bound to the current visitor.
 */
export interface PageProps<R extends keyof Routes | string = string, S = Record<string, any>> {
  params: Params<R>;
  search: S;
  user: User | null;
  db: ReadOnlyDb;
}

/** What a layout receives: its params, current user, read-only db, and the rendered children. */
export interface LayoutProps<R extends keyof Routes | string = string> {
  params: Params<R>;
  user: User | null;
  db: ReadOnlyDb;
  children: JSX.Element;
}

/**
 * What `sp/app/login.tsx` receives: wp-login.php's sign-in view, after WordPress has run the
 * sign-in. Messages are plain text (WordPress's own, after `login_errors` and `login_messages`).
 */
export interface LoginProps {
  params: Record<string, never>;
  user: User | null;
  db: ReadOnlyDb;
  /** Why the last attempt failed: a wrong password, too many attempts, … */
  errors: string[];
  /** Notices: "You are now logged out.", "Check your email…", … */
  messages: string[];
  /** The login to fill in again after a wrong password; empty otherwise. */
  login: string;
  /** Whether "Remember Me" was checked on the last attempt. */
  remember: boolean;
  /** Where WordPress sends the visitor after signing in. */
  redirectTo: string;
  /** wp-login.php's URL: where the form posts. */
  action: string;
  lostPasswordUrl: string;
  /** wp-login.php's registration URL when the site lets anyone register, else null. */
  registerUrl: string | null;
}

/** `export const metadata` in a page or layout, or a function of the page props returning it. */
export interface Metadata {
  /** A page title, or (in a layout) a default plus a `%s` template child pages fill. */
  title?: string | { default: string; template: string };
  description?: string;
  /** An absolute URL or a path on this site. */
  canonical?: string;
  robots?: { index?: boolean; follow?: boolean };
  /** Open Graph tags. `title` and `description` default to the page's; `image` may be a path on this site. */
  openGraph?: { title?: string; description?: string; image?: string; type?: string };
  /** `<meta name="twitter:card">`: `"summary"` or `"summary_large_image"`. */
  twitter?: { card: string };
  /** More `<link>`s for the head (`rel="alternate"`, `rel="describedby"`, …). Each layout's and the page's all appear. */
  links?: { rel: string; href: string; type?: string }[];
  /** Script modules the page loads: paths on this site (a file in `public/`) or https:// URLs. Each layout's and the page's all load, once each. */
  scripts?: string[];
}

type AccessRule = "anyone" | "authenticated" | "guest" | "subscriber" | "author" | "editor" | "admin" | boolean | ((ctx: AccessCtx) => boolean);

/** `export const access` on a page, layout, or route.ts. A page with HTTP handlers can give each its own rule. */
export type Access = AccessRule | { page?: AccessRule; handlers: AccessRule };
/** @deprecated Renamed to `Access`. */
export type Guard = Access;

/**
 * `export const template` in a page or layout: the WordPress block template the page renders in.
 * `"theme"` (the default) is SpacePress's template with the theme's header and footer parts; `"blank"`
 * has none, for a layout that draws its own; any other value is a template's slug (one the theme,
 * a plugin or the Site Editor provides). The page nearest wins, then the nearest layout.
 */
export type Template = "theme" | "blank" | (string & {});

/**
 * `export async function staticParams(): Promise<StaticParams<"blog/[slug]">>` in a prebuilt dynamic
 * page: one entry per page to build, with a value for each folder parameter (Astro's `getStaticPaths`).
 */
export type StaticParams<R extends keyof Routes | string = string> = Params<R>[];

/** `export const search = { page: integer().default(1) }`: the typed query string of a page. */
export type SearchParams<S> = S;

/** Stops the render and answers with `app/not-found.tsx` and a 404. */
export declare function notFound(): never;
/** Stops the render and redirects (302 unless given 301, 303, 307 or 308). */
export declare function redirect(url: string, status?: 301 | 302 | 303 | 307 | 308): never;

/**
 * What the last submit of a `<form action={action}>` on this page left: read once, when the page
 * the form came back to renders (with or without JavaScript). `pending` is always false: while a
 * submit is in flight the form has `aria-busy="true"` instead. `error.fields` holds the message of
 * the input field an error is about (the problem's `pointer`), keyed by the action's input fields;
 * `values` is what was typed, to fill the form again (never a password field).
 *
 * Inside the form's own JSX, a field named after an input gets this state by itself:
 * `aria-invalid="true"` when the error is about it, and after an error the value that was typed
 * (over the page's `defaultValue`, such as an edit form's stored value; a `value` the page sets
 * wins) or the boxes that were checked. With several
 * forms for one action on a page, only the one that posted gets it. The form gets
 * `data-sp-form-state="success"` or `"error"`; after a success it starts over with the values the
 * page renders, with or without JavaScript.
 */
export declare function useFormState<TResult = unknown, TInput = any>(action: Action<TInput, TResult>): FormState<Awaited<TResult>, TInput>;
/** Per input field of an action: the message or the typed text, when there is one. */
export type FormFields<TInput> = { [K in keyof TInput & string]?: string };
export interface FormState<TResult, TInput = Record<string, unknown>> {
  pending: boolean;
  error: { code: string; message: string; fields: FormFields<TInput> } | null;
  result: TResult | null;
  values: FormFields<TInput>;
}

/**
 * The thread on `for` (an item of a kind with `comments` on), as the visitor may read it, and a
 * form that posts a comment without JavaScript. Who may comment, moderation and reply depth are
 * the kind's comment options, enforced wherever a comment is created, never props.
 */
export declare function Comments(props: { for: { id: number }; className?: string }): JSX.Element;
/**
 * Part of a server page the browser keeps current: `<Live id="notes">{rows.map(…)}</Live>`. When
 * anything the page read for it changes, the region is rendered again as the visitor and swapped in
 * place. `id` is a literal, unique on the page; it names the region to the server.
 */
export declare function Live(props: { id: string; children?: JSX.Children }): JSX.Element;
/**
 * Numbered links to the other pages of a listing, as a `<nav>` that works without JavaScript:
 * `<Pagination page={search.page} pages={Math.ceil(total / 20)} />`. Each link is this URL with
 * only `param` (default `"page"`) changed; page 1 drops it. Many pages collapse around the current one.
 */
export declare function Pagination(props: { page: number; pages: number; param?: string; className?: string; "aria-label"?: string }): JSX.Element;
/**
 * The sign-in form wp-login.php reads (`log`, `pwd`, `rememberme`, `redirect_to`), with the fields
 * plugins add through `login_form`. It posts to wp-login.php, so WordPress runs the sign-in: the
 * second factor, attempt limits and every `authenticate` filter apply. In `login.tsx` it shows
 * wp-login.php's errors and messages above the fields (`notices={false}` leaves them to the page)
 * and refills the login; anywhere else it signs in and comes back to the page it is on. `links`
 * (default true) adds "Register" (when open) and "Lost your password?".
 */
export declare function LoginForm(props: { className?: string; submitLabel?: string; notices?: boolean; links?: boolean }): JSX.Element;
/**
 * One of the active theme's template parts (`core/template-part`), as the Site Editor holds it:
 * `<TemplatePart slug="header" />`. A layout that places parts itself renders in the blank
 * template unless it exports a `template` of its own.
 */
export declare function TemplatePart(props: { slug: string; tagName?: string; className?: string }): JSX.Element;
/** A post body (block markup) rendered through `the_content`. */
export declare function Content(props: { value: string | null | undefined }): JSX.Element;
/** Trusted markup: a literal is placed as written; any other value goes through `wp_kses_post`. */
export declare function Html(props: { value: string | null | undefined }): JSX.Element;
/**
 * An optimized `<img>`: accepts an imported image URL, a `?meta` image object (`{ src, width, height, format }`),
 * or a WordPress media attachment object. Fills intrinsic `width`/`height` automatically, defaults to
 * `loading="lazy"` + `decoding="async"`, emits responsive `srcset` from WordPress media sizes, and
 * emits `<link rel="preload" as="image" fetchpriority="high">` when `priority` is true.
 */
export declare function Image(props: {
  src:
    | string
    | { readonly src: string; readonly width?: number; readonly height?: number; readonly format?: string }
    | { readonly url: string; readonly width?: number | null; readonly height?: number | null; readonly sizes?: Record<string, { readonly url: string; readonly width: number; readonly height?: number }> };
  alt: string;
  width?: number | string;
  height?: number | string;
  sizes?: string;
  priority?: boolean;
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
  className?: string;
  id?: string;
  style?: Record<string, string | number | undefined>;
}): JSX.Element;
/**
 * A link. A path on this site navigates inside the router region (`@wordpress/interactivity-router`)
 * once JavaScript runs; without it, it is an ordinary link.
 */
export declare function Link(props: {
  href: Href;
  children?: JSX.Element | string | number | (JSX.Element | string | number)[];
  prefetch?: boolean;
  /** Override automatic sign-in routing for a local destination. By default its page and layout guards decide. */
  requireAuth?: boolean;
  className?: string;
  id?: string;
  title?: string;
  rel?: string;
  target?: string;
  "aria-current"?: string;
}): JSX.Element;

/** A GET search form using the app's `q` query parameter. */
export declare function Search(props: { action?: Href; label?: string; placeholder?: string; className?: string }): JSX.Element;

/** Search results from one kind with a canonical route, or from every searchable kind with one. */
export declare function SearchResults(props: { kind?: string; q: string | null | undefined; page?: number; perPage?: number; className?: string }): JSX.Element;

/** One item of `db.<kind>.nav()`'s tree. The tree is four levels deep: the fourth level's `children` is empty. */
export interface NavItem {
  id: number;
  title: string;
  href: Href;
  current: boolean;
  open: boolean;
  children: NavItem[];
}

/** One end of `db.<kind>.pager()`. */
export interface PagerLink {
  id: number;
  title: string;
  href: Href;
}

/** One `##` or `###` heading of an item, with its GitHub-style anchor id. */
export interface Heading {
  depth: 2 | 3;
  text: string;
  id: string;
}

/** The item's `##` and `###` headings, for a table of contents. */
export declare function headings(item: unknown): Heading[];

/** One parameter or property of an operation. `depth` is how far it is nested. */
export interface ApiField {
  name: string;
  depth: number;
  type: string;
  required: boolean;
  description: string;
  constraints: string[];
  in: string;
}

/** One response of an operation, with the fields of its body. */
export interface ApiResponse {
  status: string;
  description: string;
  type: string;
  fields: ApiField[];
}

/** One operation, with request samples a reader copies. */
export interface ApiOperation {
  id: string;
  slug: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  access: string;
  params: ApiField[];
  bodyType: string;
  body: ApiField[];
  responses: ApiResponse[];
  curl: string;
  fetch: string;
}

/** A tag of the document and its operations, in the document's order. */
export interface ApiTag {
  name: string;
  slug: string;
  description: string;
  operations: ApiOperation[];
}

/** An OpenAPI document, flat enough for a page to render: see `apiReference()`. */
export interface ApiReference {
  title: string;
  version: string;
  description: string;
  server: string;
  tags: ApiTag[];
}

/**
 * An OpenAPI 3.1 document as tags, operations and fields a page maps over: the app's own API (what
 * `spacepress build` writes) or, given a path, a JSON file in `public/`.
 */
export declare function apiReference(source?: string): ApiReference;
