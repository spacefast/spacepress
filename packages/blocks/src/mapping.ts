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
        if (node.props.style !== undefined) this.styleProp(node);
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
    return hasBlockLevel ? this.blocks(nodes) : [...nodes];
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
    if (node.props.style !== undefined) this.styleProp(node);
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
        return [block("core/image", { ...this.image(node), ...attrs }, [], node.loc)];
      case "figure":
        return this.figure(node, attrs);
      case "table":
        return [block("core/table", { ...this.table(node), ...attrs }, [], node.loc)];
      case "hr":
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

  /** Children of a rich-text container, kept as inline nodes. */
  private rich(node: ElementNode): ContentNode[] {
    for (const child of node.children) {
      if (isElement(child) && child.props.style !== undefined) this.styleProp(child);
    }
    return [...node.children];
  }

  /** A list item's own text, then any list nested under it. */
  private listItem(node: ElementNode): ContentNode[] {
    const text: ContentNode[] = [];
    const nested: ContentNode[] = [];
    for (const child of node.children) {
      if (isElement(child) && !isInlineTag(child.tag)) nested.push(...this.element(child));
      else text.push(child);
    }
    return [...text, ...nested];
  }

  /** `<pre><code>` is the code block; a bare `<pre>` is still code. */
  private code(node: ElementNode): ContentNode[] {
    const [code] = elementChildren(node, "code");
    return code ? [...code.children] : [...node.children];
  }

  private image(node: ElementNode): BlockAttributes {
    const attrs: BlockAttributes = {};
    const url = stringProp(node.props, "src");
    if (url !== null) attrs.url = url;
    const alt = stringProp(node.props, "alt");
    if (alt !== null) attrs.alt = alt;
    return attrs;
  }

  private figure(node: ElementNode, attrs: BlockAttributes): BlockNode[] {
    const [image] = elementChildren(node, "img");
    if (!image) {
      return this.unmappable(node, "A <figure> maps to an image block, so it needs an <img> inside it.", "Put an <img> in the figure, or use a block component.");
    }
    const imageAttrs = { ...this.image(image), ...commonAttributes(image.props), ...attrs };
    const [caption] = elementChildren(node, "figcaption");
    if (caption) imageAttrs.caption = renderRichTextHtml(caption.children);
    return [block("core/image", imageAttrs, [], node.loc)];
  }

  private details(node: ElementNode): BlockAttributes {
    const attrs: BlockAttributes = {};
    const [summary] = elementChildren(node, "summary");
    if (summary) attrs.summary = renderRichTextHtml(summary.children);
    return attrs;
  }

  private detailsBody(node: ElementNode): ContentNode[] {
    return this.blocks(node.children.filter((child) => !(isElement(child) && child.tag === "summary")));
  }

  /**
   * A table's rows are attributes, not inner blocks: `core/table` stores its
   * cells as structured attributes so the editor can edit a cell without
   * re-parsing markup.
   */
  private table(node: ElementNode): BlockAttributes {
    const rowsIn = (section: "thead" | "tbody" | "tfoot") => {
      const [container] = elementChildren(node, section);
      // A table written without a tbody still has rows; they are body rows.
      const rows = container ? elementChildren(container, "tr") : section === "tbody" ? elementChildren(node, "tr") : [];
      return rows.map((row) => ({
        cells: row.children
          .filter((cell): cell is ElementNode => isElement(cell) && (cell.tag === "td" || cell.tag === "th"))
          .map((cell) => ({ content: renderRichTextHtml(cell.children), tag: cell.tag })),
      }));
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
