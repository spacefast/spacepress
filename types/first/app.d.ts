// "first/app": pages, layouts and HTTP routes under first/app/ (docs/spec/rendering.md §2–§4).
// Types only: the compiler lowers these to PHP; nothing here runs in Node or the browser.
/// <reference path="./assets.d.ts" />
import type { RouteRequest, RouteResponse, User } from "first";
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
}

/** `export const guard` in a layout: who may see everything below it. */
export type Guard = "anyone" | "authenticated" | "subscriber" | "author" | "editor" | "admin" | boolean | ((ctx: { user: User | null }) => boolean);

/** `export const search = { page: integer().default(1) }`: the typed query string of a page. */
export type SearchParams<S> = S;

/** Stops the render and answers with `app/not-found.tsx` and a 404. */
export declare function notFound(): never;
/** Stops the render and redirects (302 unless given 301, 303, 307 or 308). */
export declare function redirect(url: string, status?: 301 | 302 | 303 | 307 | 308): never;

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
