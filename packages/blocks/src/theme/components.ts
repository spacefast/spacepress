/**
 * The template vocabulary: the blocks a block theme's templates and parts
 * are made of, under the names authors know them by. Each is the generated
 * core component, so the serializer checks every attribute; the few helpers
 * that add a rule (`QueryLoop`, `TemplatePart`, `Pattern`) build the node
 * the compiler then checks against the theme's own files.
 */
import { Core } from "../blocks.generated.ts";
import { toContentNodes } from "../jsx-runtime.ts";
import type { BlockNode, BlockObjectAttribute } from "../nodes.ts";
import type { QueryProps } from "../blocks.generated.ts";

export { Group, Columns, Column, Cover, Spacer, Separator, Buttons, Button, MediaText, Gallery, Embed, Paragraph, Heading, Image, Html } from "../blocks-popular.ts";

export const PostTitle = Core.PostTitle;
export const PostContent = Core.PostContent;
export const PostExcerpt = Core.PostExcerpt;
export const PostDate = Core.PostDate;
export const PostFeaturedImage = Core.PostFeaturedImage;
export const PostAuthorName = Core.PostAuthorName;
export const PostTerms = Core.PostTerms;
export const PostNavigationLink = Core.PostNavigationLink;
export const ReadMore = Core.ReadMore;
export const SiteTitle = Core.SiteTitle;
export const SiteTagline = Core.SiteTagline;
export const SiteLogo = Core.SiteLogo;
export const Navigation = Core.Navigation;
export const NavigationLink = Core.NavigationLink;
export const PageList = Core.PageList;
export const Search = Core.Search;
export const QueryTitle = Core.QueryTitle;
export const TermDescription = Core.TermDescription;
export const PostTemplate = Core.PostTemplate;
export const NoResults = Core.QueryNoResults;
export const Pagination = Core.QueryPagination;
export const PaginationPrevious = Core.QueryPaginationPrevious;
export const PaginationNumbers = Core.QueryPaginationNumbers;
export const PaginationNext = Core.QueryPaginationNext;
export const CommentsArea = Core.Comments;
export const CommentsTitle = Core.CommentsTitle;
export const CommentTemplate = Core.CommentTemplate;
export const CommentAuthorName = Core.CommentAuthorName;
export const CommentDate = Core.CommentDate;
export const CommentContent = Core.CommentContent;
export const CommentsPagination = Core.CommentsPagination;
export const PostCommentsForm = Core.PostCommentsForm;
export const Avatar = Core.Avatar;

/** `<TemplatePart slug="header">`: `core/template-part`. The slug must be a file in `parts/`; `tagName` and `area` come from the part's declaration unless given. */
export function TemplatePart(props: { slug: string; tagName?: string | undefined; area?: string | undefined; className?: string | undefined; style?: BlockObjectAttribute | undefined; align?: "left" | "center" | "right" | "wide" | "full" | "" | undefined }): BlockNode {
  const attrs: Record<string, unknown> = { slug: props.slug };
  if (props.tagName !== undefined) attrs.tagName = props.tagName;
  if (props.area !== undefined) attrs.area = props.area;
  if (props.className !== undefined) attrs.className = props.className;
  if (props.style !== undefined) attrs.style = props.style;
  if (props.align !== undefined) attrs.align = props.align;
  return { kind: "block", blockName: "core/template-part", attrs, inner: [] };
}

/** `<Pattern slug="zero-starter/hero">`: `core/pattern`, a reference the editor expands. The slug must be a theme pattern or listed in `externalPatterns`. */
export function Pattern(props: { slug: string }): BlockNode {
  return { kind: "block", blockName: "core/pattern", attrs: { slug: props.slug }, inner: [] };
}

/** The explicit query a `QueryLoop` can run instead of inheriting the page's. */
export interface LoopQuery {
  postType?: string | undefined;
  perPage?: number | undefined;
  offset?: number | undefined;
  pages?: number | undefined;
  order?: "asc" | "desc" | undefined;
  orderBy?: "date" | "title" | "author" | "modified" | "menu_order" | "rand" | "id" | "comment_count" | "relevance" | "include" | "slug" | "parent" | undefined;
  author?: string | undefined;
  search?: string | undefined;
  exclude?: readonly number[] | undefined;
  sticky?: "" | "only" | "exclude" | "ignore" | undefined;
  taxQuery?: BlockObjectAttribute | undefined;
  parents?: readonly number[] | undefined;
  format?: readonly string[] | undefined;
  excludeCurrent?: boolean | undefined;
}

export type QueryLoopProps = Omit<QueryProps, "query"> &
  ({ inherit: true; query?: undefined } | { inherit?: false | undefined; query: LoopQuery }) & {
    /** The per-post template (`core/post-template`'s children). `NoResults` and `Pagination` written here become siblings of the template inside the loop. */
    children?: unknown;
    /** `core/post-template`'s own attributes (layout, className). */
    template?: BlockObjectAttribute | undefined;
  };

/** The blocks that belong beside the post template, not inside it. */
const LOOP_SIBLINGS = new Set(["core/query-no-results", "core/query-pagination"]);

/**
 * `<QueryLoop inherit>` or `<QueryLoop query={{ postType: "post", perPage: 6 }}>`:
 * `core/query` holding one `core/post-template` with the children as the
 * per-post body. Exactly one of `inherit` or `query`; the compiler reports
 * `query_mode_required` otherwise. WordPress's own default is what an
 * unspecified query field means.
 */
export function QueryLoop(props: QueryLoopProps): BlockNode {
  // Read loosely: the union narrows the author's call, but a plain object (or JavaScript) can still hand over any combination.
  const { inherit, query, children, template, ...rest } = props as { inherit?: boolean | undefined; query?: LoopQuery | undefined; children?: unknown; template?: BlockObjectAttribute | undefined } & Record<string, unknown>;
  const attrs: Record<string, unknown> = { ...rest };
  const defaults = { perPage: 10, pages: 0, offset: 0, postType: "post", order: "desc", orderBy: "date", author: "", search: "", exclude: [] as readonly number[], sticky: "" };
  if (inherit === true && query === undefined) {
    attrs.query = { ...defaults, inherit: true };
  } else if (inherit !== true && query !== undefined) {
    const { exclude, parents, format, ...scalars } = query;
    attrs.query = { ...defaults, exclude: exclude ?? [], inherit: false, ...scalars, ...(parents ? { parents } : {}), ...(format ? { format } : {}) };
  } else {
    // Both or neither: the compiler names this; the node carries a marker it recognises.
    attrs.query = { ...defaults, inherit: inherit === true, ...(query ?? {}) };
    attrs["zero-blocks:query-mode"] = inherit === true && query !== undefined ? "both" : "neither";
  }
  const body = toContentNodes(children);
  const siblings = body.filter((node) => node.kind === "block" && LOOP_SIBLINGS.has(node.blockName));
  const perPost = body.filter((node) => !(node.kind === "block" && LOOP_SIBLINGS.has(node.blockName)));
  const postTemplate: BlockNode = { kind: "block", blockName: "core/post-template", attrs: template ?? {}, inner: perPost };
  return { kind: "block", blockName: "core/query", attrs, inner: [postTemplate, ...siblings] };
}
