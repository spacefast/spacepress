// The `emdash` modules EmDash's official templates import, as @spacepress/astro/emdash provides them.
// spEmdash() adds these declarations to the project (Astro's injectTypes), so a template
// type-checks with no EmDash package installed.

declare module "emdash" {
  export interface PortableTextSpan { _type: string; _key?: string; text?: string; marks?: string[] }
  export interface PortableTextBlock { _type: string; _key: string; style?: string; children?: PortableTextSpan[]; _html?: string; [key: string]: unknown }
  export interface TaxonomyTerm { id: string; slug: string; label: string; description?: string }
  export interface BylineSummary { displayName: string; avatarStorageKey?: string }
  export interface ContentBylineCredit { byline: BylineSummary; roleLabel: string | null }
  export interface ContentImage { id: string; src: string; alt: string; width?: number; height?: number }
  export interface ContentData {
    id: string;
    title: string;
    content: PortableTextBlock[];
    excerpt: string;
    featured_image: ContentImage | null;
    publishedAt: Date | null;
    updatedAt: Date;
    seoTitle: string;
    seoDescription: string;
    terms: { tag: TaxonomyTerm[]; category: TaxonomyTerm[] };
    bylines: ContentBylineCredit[];
  }
  /** Augmented by a template's generated emdash-env.d.ts. */
  export interface EmDashCollections {}
  export type InferCollectionData<T extends string> = ContentData & { readonly collection?: T };
  export interface ContentEntry<T = ContentData> {
    id: string;
    data: T;
    edit: { title: Record<string, string>; excerpt: Record<string, string>; content: Record<string, string>; featured_image: Record<string, string> };
  }
  type Collection = "posts" | "pages" | (keyof EmDashCollections & string);
  export interface CollectionQuery { orderBy?: Record<string, string>; limit?: number; cursor?: string; where?: Record<string, string | undefined> }
  export function getEmDashCollection(collection: Collection, options?: CollectionQuery): Promise<{ entries: ContentEntry[]; total: number; cacheHint: false; nextCursor?: string }>;
  export function getEmDashEntry(collection: Collection, slug: string): Promise<{ entry: ContentEntry | null; cacheHint: false }>;
  export function getTermsForEntries(collection: Collection, ids: string[], taxonomy: "tag" | "category"): Promise<Map<string, TaxonomyTerm[]>>;
  export function getTaxonomyTermsWithCacheHint(taxonomy: "tag" | "category", options?: { includeCounts?: boolean }): Promise<{ data: TaxonomyTerm[]; cacheHint: false }>;
  export interface MediaRef { mediaId: string; alt: string; url: string }
  export interface SiteSettings { title: string; tagline: string; logo?: MediaRef; favicon?: MediaRef }
  export function getSiteSettings(): Promise<SiteSettings>;
  export function getSiteSettingsWithCacheHint(): Promise<{ data: SiteSettings; cacheHint: false }>;
  export interface MenuItem { type: string; label: string; url: string; target?: string }
  export function getMenuWithCacheHint(name: string): Promise<{ data: { name: string; label: string; items: MenuItem[] } | null; cacheHint: false }>;
  export function getWidgetAreas(): Promise<{ name: string; widgets: Record<string, unknown>[] }[]>;
  export function getSession(cookie?: string | null): Promise<{ user: null }>;
  export class SearchUnavailableError extends Error {}
  export interface SearchResponse { items: { id: string; slug: string; title: string; snippet: string }[]; nextCursor?: string }
  export function search(query: string, options: { collections: string[]; limit: number }): Promise<SearchResponse>;
  export function getComments(id: string): Promise<{ open: boolean; items: { id: string; parent: string; author: string; html: string }[] }>;
  export function decodeSlug(slug: string | undefined): string | undefined;
  export function getI18nConfig(): { defaultLocale: string };
  export function getSeoMeta(entry: ContentEntry, options: { siteTitle: string; siteUrl: string; path: string; defaultOgImage?: string }): {
    title: string; ogTitle: string; pageTitle: string; description: string; canonical: string; ogImage?: string; robots?: string;
    ogType: string; publishedTime?: string; modifiedTime?: string; author: string;
  };
  export function createPublicPageContext<T>(page: T): T;
}

declare module "emdash/runtime" {
  export function emdashLoader(options?: Record<string, unknown>): import("astro/loaders").LiveLoader;
}

declare module "emdash/page" {
  export function createPublicPageContext<T>(page: T): T;
}

declare module "emdash/locals" {}

declare module "emdash/ui" {
  type Component = (props: Record<string, any>) => any;
  export const Comments: Component;
  export const CommentForm: Component;
  export const Image: Component;
  export const PortableText: Component;
  export const WidgetArea: Component;
  export const EmDashHead: Component;
  export const EmDashBodyStart: Component;
  export const EmDashBodyEnd: Component;
}

declare module "emdash/ui/comments" {
  type Component = (props: Record<string, any>) => any;
  export const Comments: Component;
  export const CommentForm: Component;
}

declare module "emdash/ui/search" {
  const LiveSearch: (props: Record<string, any>) => any;
  export default LiveSearch;
}

declare namespace App {
  interface Locals {
    /** Always unset on a SpacePress site: a page served elsewhere can't see the WordPress session. */
    user?: { id: number; name: string };
    emdash?: { getPublicMediaUrl?: (key: string) => string };
  }
}
