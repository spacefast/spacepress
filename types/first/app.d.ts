// "first/app": pages, layouts and HTTP routes under first/app/ (docs/spec/rendering.md §2–§4).
// Types only: the compiler lowers these to PHP; nothing here runs in Node or the browser.
/// <reference path="./assets.d.ts" />
import type { Action, ColumnsConfig, RouteRequest, RouteResponse, User } from "first";
import type { JSX } from "first/jsx-runtime";

export type { RouteRequest, RouteResponse };

/**
 * The app's routes, by id (the folder below `first/app/`) → the params its folders bind.
 * `first build` writes the map to `first/_generated/routes.d.ts`, which augments this interface.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Routes {}

/** Anything a component can render: what `children` may be. */
export type ReactNode = JSX.Children;

/** A path the app serves, checked against the generated route map once it exists. */
export type Href = keyof Routes extends never ? string : RoutePaths | `http${string}` | `mailto:${string}` | `#${string}` | `?${string}`;
type RoutePaths = { [K in keyof Routes]: Routes[K] extends { path: infer P extends string } ? P : never }[keyof Routes];

type Params<R> = R extends keyof Routes ? (Routes[R] extends { params: infer P } ? P : Record<string, string>) : Record<string, string | string[]>;

/**
 * What a page receives: `params` from its folder names (`[slug]` a string, `[...rest]` and
 * `[[...rest]]` arrays) and `search`, parsed by the page's `export const search`.
 */
export interface PageProps<R extends keyof Routes | string = string, S = Record<string, any>> {
  params: Params<R>;
  search: S;
  /** On a page whose folders serve a kind's `url` pattern: that item, read as the visitor. */
  item: R extends keyof Routes ? (Routes[R] extends { item: infer I } ? I : never) : any;
}

/** What a layout receives: its params and the page (or nested layout) rendered inside it. */
export interface LayoutProps<R extends keyof Routes | string = string> {
  params: Params<R>;
  children: JSX.Element;
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

/** `export const guard` in a layout: who may see everything below it. */
export type Guard = "anyone" | "authenticated" | "subscriber" | "author" | "editor" | "admin" | boolean | ((ctx: { user: User | null }) => boolean);

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
 * What the last submit of a `<form action={action}>` on this page left: read once, after the form
 * posted without JavaScript and came back. `pending` is false on the server. `error.fields` names
 * the field an input error is about; `values` is what was typed, to fill the form again (never a
 * password field).
 */
export declare function useFormState<TResult>(action: Action<ColumnsConfig, TResult> | Action<any, TResult>): FormState<Awaited<TResult>>;
export interface FormState<TResult> {
  pending: boolean;
  error: { code: string; message: string; fields: Record<string, string | undefined> } | null;
  result: TResult | null;
  values: Record<string, string | undefined>;
}

/**
 * The thread on `for` (an item of a kind with `comments` on), as the visitor may read it, and a
 * form that posts a comment without JavaScript. Who may comment, moderation and reply depth are
 * the kind's comment options, enforced wherever a comment is created, never props.
 */
export declare function Comments(props: { for: { id: number }; className?: string }): JSX.Element;
/** A post body (block markup) rendered through `the_content`. */
export declare function Content(props: { value: string | null | undefined }): JSX.Element;
/** Trusted markup: a literal is placed as written; any other value goes through `wp_kses_post`. */
export declare function Html(props: { value: string | null | undefined }): JSX.Element;
/**
 * A link. A path on this site navigates inside the router region (`@wordpress/interactivity-router`)
 * once JavaScript runs; without it, it is an ordinary link.
 */
export declare function Link(props: {
  href: Href;
  children?: JSX.Element | string | number | (JSX.Element | string | number)[];
  prefetch?: boolean;
  className?: string;
  id?: string;
  title?: string;
  rel?: string;
  target?: string;
  "aria-current"?: string;
}): JSX.Element;
