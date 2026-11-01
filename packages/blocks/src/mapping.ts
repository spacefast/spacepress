import type { Diagnostic } from "./diagnostics.ts";
import type { BlockAttributes, BlockNode, ContentNode, ElementNode, ElementProps, SourceLocation } from "./nodes.ts";

/**
 * HTML tags in, blocks out.
 *
 * Native HTML is the authoring vocabulary, so this table is the whole contract
 * an author has to hold: `<p>` is a paragraph, `<h2>` is a level-2 heading,
 * `<section>` is a group that remembers its tag. Nothing is inferred beyond
 * the table: a flex-looking div is a group with those classes, never columns.
 *
 * Two things it refuses outright, with the node's location: a `style` prop
 * (classes and the block's own `style` attribute object are the styling
 * surface; inline styles do not survive the block editor) and a tag with no
 * block behind it. Both are reported rather than dropped, and mapping
 * continues past them so one bad tag does not hide the rest of a file's
 * problems.
 */

export interface MappingResult {
  blocks: BlockNode[];
  diagnostics: Diagnostic[];
}

/** Tags that fold into the surrounding rich text instead of becoming blocks. */
const PHRASING_TAGS = new Set([
  "a", "abbr", "b", "br", "cite", "code", "del", "em", "i", "ins", "kbd", "mark", "q", "s", "samp", "small",
  "span", "strong", "sub", "sup", "time", "u", "var",
]);

/** Sectioning tags that become a group carrying their own tag name. */
const GROUP_TAGS = new Set(["section", "article", "aside", "header", "footer", "main", "nav"]);

/** `h1`–`h6`: the tag is the level the heading block stores. */
const HEADING_TAG = /^h([1-6])$/;

const HTML_ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
]);

/** Void elements, which close themselves rather than wrapping content. */
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

export function isInlineTag(tag: string): boolean {
  return PHRASING_TAGS.has(tag);
}

/** HTML's four attribute-and-text escapes. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => HTML_ESCAPES.get(character)!);
}

function attributeString(props: ElementProps): string {
  return Object.entries(props)
    .flatMap(([name, value]) => {
      // `class` is HTML's spelling and `className` is JSX's; both reach the markup as `class`.
      const attribute = name === "className" ? "class" : name;
      if (value === null || value === undefined || value === false) return [];
      if (value === true) return [` ${attribute}`];
      return [` ${attribute}="${escapeHtml(String(value))}"`];
    })
    .join("");
}

/**
 * Render rich-text nodes to the HTML string a block attribute holds.
 *
 * Rich text is where a block's inline markup lives (Gutenberg stores it as an
 * HTML string, not a tree), so this is the point where author text is
 * escaped. It runs before `@wordpress/blocks` sees the value.
 */
export function renderRichTextHtml(nodes: readonly ContentNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "text") return escapeHtml(node.text);
      if (node.kind === "block") {
        // A block inside rich text has no inline spelling; its own text is the closest honest rendering.
        return renderRichTextHtml(node.inner);
      }
      const attributes = attributeString(node.props);
      if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attributes}>`;
      return `<${node.tag}${attributes}>${renderRichTextHtml(node.children)}</${node.tag}>`;
    })
    .join("");
}

/** Read one authored prop as a non-empty string. */
function stringProp(props: ElementProps, name: string): string | null {
  const value = props[name];
  return typeof value === "string" && value !== "" ? value : null;
}

/** The block attributes every mapped tag carries when the author asked for them. */
function commonAttributes(props: ElementProps): BlockAttributes {
  const attrs: BlockAttributes = {};
  const className = stringProp(props, "class") ?? stringProp(props, "className");
  if (className !== null) attrs.className = className;
  // `id` is Gutenberg's `anchor`: the same thing an author links a heading by.
  const anchor = stringProp(props, "id");
  if (anchor !== null) attrs.anchor = anchor;
  return attrs;
}

function isElement(node: ContentNode): node is ElementNode {
  return node.kind === "element";
}

function elementChildren(node: ElementNode, tag: string): ElementNode[] {
  return node.children.filter((child): child is ElementNode => isElement(child) && child.tag === tag);
}

function block(blockName: string, attrs: BlockAttributes, inner: ContentNode[], loc: SourceLocation | undefined): BlockNode {
  const node: BlockNode = { kind: "block", blockName, attrs, inner };
  if (loc) node.loc = loc;
  return node;
}

/** One mapping pass. Diagnostics accumulate; the walk never stops on one. */
class Mapper {
  readonly diagnostics: Diagnostic[] = [];

  /** Map a run of nodes at block level. */
  blocks(nodes: readonly ContentNode[]): BlockNode[] {
    const out: BlockNode[] = [];
    // Consecutive text and phrasing nodes are one paragraph's worth of rich
    // text, so they accumulate until something block-level interrupts them.
    let run: ContentNode[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const paragraph = run;
      run = [];
      // Whitespace between elements is how JSX is indented, not content.
      if (paragraph.every((node) => node.kind === "text" && node.text.trim() === "")) return;
      const first = paragraph.find((node) => node.kind === "element");
      out.push(block("core/paragraph", {}, paragraph, first?.kind === "element" ? first.loc : undefined));
    };

    for (const node of nodes) {
      if (node.kind === "text") {
        run.push(node);
        continue;
      }
      if (node.kind === "block") {
        flush();
        // An authored block still owns author JSX inside it, so its inner tree
        // goes through the same mapping the file did.
        out.push(block(node.blockName, node.attrs, this.inner(node.inner), node.loc));
        continue;
      }
      if (isInlineTag(node.tag)) {
        this.checkInline([node]);
        run.push(node);
        continue;
      }
      flush();
      out.push(...this.element(node));
    }
    flush();
    return out;
  }

  /**
   * Map the inside of an authored block. Rich text an author passed straight
   * to a block component (`<Cover>caption</Cover>`) stays rich text; anything
   * block-level maps as usual.
   */
  private inner(nodes: readonly ContentNode[]): ContentNode[] {
    const hasBlockLevel = nodes.some((node) => node.kind === "block" || (isElement(node) && !isInlineTag(node.tag)));
    if (hasBlockLevel) return this.blocks(nodes);
    this.checkInline(nodes);
    return [...nodes];
  }

  private styleProp(node: ElementNode): void {
    this.diagnostics.push({
      code: "style_prop_unsupported",
      severity: "error",
      message: `<${node.tag}> has a style prop, which does not survive the block editor.`,
      hint: "Use a class, or a block component's `style` attribute object.",
      loc: node.loc,
    });
  }

  private unmappable(node: ElementNode, message: string, hint: string): BlockNode[] {
    this.diagnostics.push({ code: "unmappable_element", severity: "error", message, hint, loc: node.loc });
    return [];
  }

  /** Map one block-level element. Returns a run, because a div can dissolve. */
  private element(node: ElementNode): BlockNode[] {
    if (node.props.style !== undefined && node.tag !== "img") this.styleProp(node);
    const attrs = commonAttributes(node.props);

    const heading = HEADING_TAG.exec(node.tag);
    if (heading !== null) {
      return [block("core/heading", { level: Number(heading[1]), ...attrs }, this.rich(node), node.loc)];
    }

    switch (node.tag) {
      case "p":
        return [block("core/paragraph", attrs, this.rich(node), node.loc)];
      case "div":
        // A bare div dissolves; a classed one is the group the author meant. Never wrap for free.
        return Object.keys(attrs).length === 0 ? this.blocks(node.children) : [block("core/group", attrs, this.blocks(node.children), node.loc)];
      case "ul":
      case "ol": {
        if (node.tag === "ol") attrs.ordered = true;
        return [block("core/list", attrs, this.blocks(node.children), node.loc)];
      }
      case "li":
        return [block("core/list-item", attrs, this.listItem(node), node.loc)];
      case "blockquote":
        return [block("core/quote", attrs, this.blocks(node.children), node.loc)];
      case "pre":
        return [block("core/code", attrs, this.code(node), node.loc)];
      case "img":
        this.onlyChildren(node, [], "an image has no content", "Remove the children, or use a <figure> with a <figcaption>.");
        return [block("core/image", { ...this.image(node), ...attrs }, [], node.loc)];
      case "figure":
        return this.figure(node, attrs);
      case "table":
        return [block("core/table", { ...this.table(node), ...attrs }, [], node.loc)];
      case "hr":
        this.onlyChildren(node, [], "a separator has no content", "Remove the children.");
        return [block("core/separator", attrs, [], node.loc)];
      case "details":
        return [block("core/details", { ...this.details(node), ...attrs }, this.detailsBody(node), node.loc)];
      default:
        break;
    }

    if (GROUP_TAGS.has(node.tag)) {
      return [block("core/group", { tagName: node.tag, ...attrs }, this.blocks(node.children), node.loc)];
    }

    return this.unmappable(node, `<${node.tag}> has no block.`, 'Use one of the mapped tags, or name a block directly with <Block name="…">.');
  }

  /**
   * Children of a rich-text container, kept as inline nodes. Every element in
   * there is still checked: a `style` prop three spans deep and a block-level
   * tag inside a paragraph are both mistakes the author needs to hear about.
   */
  private rich(node: ElementNode): ContentNode[] {
    this.checkInline(node.children);
    return [...node.children];
  }

  private checkInline(nodes: readonly ContentNode[]): void {
    for (const child of nodes) {
      if (child.kind === "block") {
        this.diagnostics.push({ code: "unmappable_element", severity: "error", message: `${child.blockName} sits inside rich text, where a block cannot go.`, hint: "Put it on its own, as a direct child of the file or of a block.", loc: child.loc });
        continue;
      }
      if (!isElement(child)) continue;
      if (child.props.style !== undefined) this.styleProp(child);
      if (!isInlineTag(child.tag)) {
        this.diagnostics.push({ code: "unmappable_element", severity: "error", message: `<${child.tag}> sits inside rich text, where only phrasing tags (a, strong, em, code, span, …) can go.`, hint: "Move it out of the paragraph, or use a phrasing tag.", loc: child.loc });
        continue;
      }
      this.checkInline(child.children);
    }
  }

  /** A list item's own text, then any list nested under it. */
  private listItem(node: ElementNode): ContentNode[] {
    const text: ContentNode[] = [];
    const nested: ContentNode[] = [];
    for (const child of node.children) {
      if (child.kind === "block") nested.push(...this.blocks([child]));
      else if (isElement(child) && !isInlineTag(child.tag)) nested.push(...this.element(child));
      else text.push(child);
    }
    this.checkInline(text);
    return [...text, ...nested];
  }

  /** `<pre><code>` is the code block; a bare `<pre>` is still code. Anything beside the `<code>` is refused. */
  private code(node: ElementNode): ContentNode[] {
    const [code] = elementChildren(node, "code");
    if (code) {
      this.structural(code);
      this.onlyChildren(node, [code], "a code block holds one <code>", "Put everything inside the <code>.");
    }
    const body = code ? code.children : node.children;
    this.checkInline(body);
    return [...body];
  }

  private image(node: ElementNode): BlockAttributes {
    if (node.props.style !== undefined) this.styleProp(node);
    const attrs: BlockAttributes = {};
    const url = stringProp(node.props, "src");
    if (url !== null) attrs.url = url;
    const alt = stringProp(node.props, "alt");
    if (alt !== null) attrs.alt = alt;
    return attrs;
  }

  /** A structural child (figcaption, summary, thead, tr, td, …): checked for a style prop like any element. */
  private structural(node: ElementNode): ElementNode {
    if (node.props.style !== undefined) this.styleProp(node);
    return node;
  }

  /** Refuse every child that is not one of the accepted ones, so nothing is dropped silently. */
  private onlyChildren(parent: ElementNode, accepted: readonly ContentNode[], what: string, hint: string): void {
    for (const child of parent.children) {
      if (accepted.includes(child)) continue;
      if (child.kind === "text" && child.text.trim() === "") continue;
      const message = child.kind === "element" ? `<${child.tag}> inside a <${parent.tag}> has nowhere to go: ${what}.` : child.kind === "block" ? `${child.blockName} inside a <${parent.tag}> has nowhere to go: ${what}.` : `Text inside a <${parent.tag}> has nowhere to go: ${what}.`;
      this.diagnostics.push({ code: "unmappable_element", severity: "error", message, hint, loc: child.kind === "text" ? parent.loc : child.loc });
    }
  }

  private figure(node: ElementNode, attrs: BlockAttributes): BlockNode[] {
    const [image] = elementChildren(node, "img");
    if (!image) {
      return this.unmappable(node, "A <figure> maps to an image block, so it needs an <img> inside it.", "Put an <img> in the figure, or use a block component.");
    }
    this.onlyChildren(image, [], "an image has no content", "Put a caption in a <figcaption> beside the <img>.");
    const imageAttrs = { ...this.image(image), ...commonAttributes(image.props), ...attrs };
    const [caption] = elementChildren(node, "figcaption");
    if (caption) imageAttrs.caption = renderRichTextHtml(this.rich(this.structural(caption)));
    this.onlyChildren(node, [image, ...(caption ? [caption] : [])], "a figure is one image block", "Keep only an <img> and an optional <figcaption> in the figure.");
    return [block("core/image", imageAttrs, [], node.loc)];
  }

  private details(node: ElementNode): BlockAttributes {
    const attrs: BlockAttributes = {};
    const [summary, ...extra] = elementChildren(node, "summary");
    if (summary) attrs.summary = renderRichTextHtml(this.rich(this.structural(summary)));
    for (const duplicate of extra) this.unmappable(duplicate, "A <details> has one <summary>; this second one has nowhere to go.", "Merge the summaries into one.");
    return attrs;
  }

  /** The body is everything but the summaries: the first became the attribute, the rest were refused in details(). */
  private detailsBody(node: ElementNode): ContentNode[] {
    return this.blocks(node.children.filter((child) => !(isElement(child) && child.tag === "summary")));
  }

  /**
   * A table's rows are attributes, not inner blocks: `core/table` stores its
   * cells as structured attributes so the editor can edit a cell without
   * re-parsing markup.
   */
  private table(node: ElementNode): BlockAttributes {
    const sections = ["thead", "tbody", "tfoot"].flatMap((tag) => elementChildren(node, tag));
    const looseRows = elementChildren(node, "tr");
    this.onlyChildren(node, [...sections, ...looseRows], "a table holds thead, tbody, tfoot or rows", "Put cells in <tr> rows inside a section.");
    const rowsOf = (container: ElementNode): ElementNode[] => {
      this.structural(container);
      const rows = elementChildren(container, "tr");
      this.onlyChildren(container, rows, "a table section holds rows", "Put cells in <tr> rows.");
      return rows;
    };
    const rowsIn = (section: "thead" | "tbody" | "tfoot") => {
      // Every section of a kind contributes its rows, in order; rows written
      // straight into the table are body rows, after any tbody's.
      const rows = elementChildren(node, section).flatMap((container) => rowsOf(container));
      if (section === "tbody") rows.push(...looseRows);
      return rows.map((row) => {
        this.structural(row);
        const cells = row.children.filter((cell): cell is ElementNode => isElement(cell) && (cell.tag === "td" || cell.tag === "th"));
        this.onlyChildren(row, cells, "a row holds td and th cells", "Put content inside a cell.");
        return { cells: cells.map((cell) => ({ content: renderRichTextHtml(this.rich(this.structural(cell))), tag: cell.tag })) };
      });
    };
    return { head: rowsIn("thead"), body: rowsIn("tbody"), foot: rowsIn("tfoot") };
  }
}

/**
 * Map an executed module's tree to the blocks it will serialize as.
 *
 * Diagnostics are returned rather than thrown: a file with three `style`
 * props should report three, once, instead of making the author rebuild per
 * fix.
 */
export function mapToBlocks(nodes: readonly ContentNode[]): MappingResult {
  const mapper = new Mapper();
  const blocks = mapper.blocks(nodes);
  return { blocks, diagnostics: mapper.diagnostics };
}
