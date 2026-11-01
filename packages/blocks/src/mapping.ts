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

/**
 * HTML's boolean attributes on phrasing tags: present or absent, never a value.
 * Every other attribute keeps its value as text, so `aria-checked={false}`,
 * `draggable={false}` and `contenteditable={false}` (enumerated, where "false"
 * overrides what is inherited) write the "false" they mean instead of vanishing.
 */
const BOOLEAN_ATTRIBUTES = new Set(["hidden", "inert", "autofocus", "disabled", "download"]);

function attributeString(props: ElementProps): string {
  return Object.entries(props)
    .flatMap(([name, value]) => {
      // `class` is HTML's spelling and `className` is JSX's; both reach the markup as `class`.
      const attribute = name === "className" ? "class" : name;
      if (value === null || value === undefined) return [];
      if (typeof value === "boolean") {
        if (BOOLEAN_ATTRIBUTES.has(attribute)) return value ? [` ${attribute}`] : [];
        return [` ${attribute}="${value}"`];
      }
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

/** The props every mapped block-level tag accepts: the two that become block attributes, and `style`, refused separately. */
const COMMON_PROPS = ["class", "className", "id", "style"] as const;

/** HTML's `<ol type>` vocabulary, as the CSS `list-style-type` core/list stores. */
const LIST_TYPES: Record<string, string> = { "1": "decimal", a: "lower-alpha", A: "upper-alpha", i: "lower-roman", I: "upper-roman" };

/** A CSS length for an HTML dimension: a bare number is pixels, as it is on `<img width>`. */
function cssLength(value: string | number): string {
  const text = String(value).trim();
  return /^\d+(\.\d+)?$/.test(text) ? `${text}px` : text;
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

  private badValue(node: ElementNode, name: string, expected: string): void {
    this.diagnostics.push({
      code: "unmappable_element",
      severity: "error",
      message: `<${node.tag}> has a "${name}" prop that is not ${expected}.`,
      hint: `Give "${name}" ${expected}, or remove it.`,
      loc: node.loc,
    });
  }

  /** A prop that is text in HTML: a string or a number, nothing when absent, refused when anything else. */
  private text(node: ElementNode, name: string): string | null {
    const value = node.props[name];
    if (value === undefined || value === null || value === false) return null;
    if (typeof value === "string") return value === "" ? null : value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    this.badValue(node, name, "a string");
    return null;
  }

  /** An HTML boolean attribute: `true`, the empty string or its own name all mean on, as they do in HTML. */
  private flag(node: ElementNode, name: string): boolean {
    const value = node.props[name];
    if (value === undefined || value === null || value === false) return false;
    if (value === true || value === "" || value === name) return true;
    this.badValue(node, name, "a boolean");
    return false;
  }

  /** A whole number, as HTML's `start` is. */
  private integer(node: ElementNode, name: string): number | null {
    const value = node.props[name];
    if (value === undefined || value === null || value === false) return null;
    const number = typeof value === "number" ? value : typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
    if (Number.isInteger(number)) return number;
    this.badValue(node, name, "a whole number");
    return null;
  }

  /** Two spellings of one attribute; an element has one place for it, so the second is not merged or dropped. */
  private spelledTwice(node: ElementNode, html: string, jsx: string): void {
    if (node.props[html] === undefined || node.props[jsx] === undefined) return;
    this.diagnostics.push({ code: "unmappable_element", severity: "error", message: `<${node.tag}> has both "${html}" and "${jsx}"; they are one attribute.`, hint: "Keep one of them.", loc: node.loc });
  }

  private classSpelledTwice(node: ElementNode): void {
    this.spelledTwice(node, "class", "className");
  }

  /** The block attributes every mapped tag carries when the author asked for them. */
  private common(node: ElementNode): BlockAttributes {
    const attrs: BlockAttributes = {};
    this.classSpelledTwice(node);
    const className = this.text(node, "class") ?? this.text(node, "className");
    if (className !== null) attrs.className = className;
    // `id` is Gutenberg's `anchor`: the same thing an author links a heading by.
    const anchor = this.text(node, "id");
    if (anchor !== null) attrs.anchor = anchor;
    return attrs;
  }

  /**
   * Refuse every prop the tag's block has no attribute for. A `colspan` on a
   * cell or a `start` on a list is mapped; a `data-track` on a paragraph has
   * nowhere to go in block markup, and dropping it would be silent.
   */
  private props(node: ElementNode, known: readonly string[]): void {
    for (const name of Object.keys(node.props)) {
      if (name === "style" || known.includes(name)) continue;
      this.diagnostics.push({
        code: "unmappable_element",
        severity: "error",
        message: `<${node.tag}> has a "${name}" prop that its block cannot hold.`,
        hint: "Remove it, or use a block component and set the block's own attribute.",
        loc: node.loc,
      });
    }
  }

  /** Map one block-level element. Returns a run, because a div can dissolve. */
  private element(node: ElementNode): BlockNode[] {
    if (node.props.style !== undefined && node.tag !== "img") this.styleProp(node);
    const attrs = this.common(node);

    const heading = HEADING_TAG.exec(node.tag);
    if (heading !== null) {
      this.props(node, COMMON_PROPS);
      return [block("core/heading", { level: Number(heading[1]), ...attrs }, this.rich(node), node.loc)];
    }

    switch (node.tag) {
      case "p":
        this.props(node, COMMON_PROPS);
        return [block("core/paragraph", attrs, this.rich(node), node.loc)];
      case "div":
        this.props(node, COMMON_PROPS);
        // A bare div dissolves; a classed one is the group the author meant. Never wrap for free.
        return Object.keys(attrs).length === 0 ? this.blocks(node.children) : [block("core/group", attrs, this.blocks(node.children), node.loc)];
      case "ul":
      case "ol":
        return [block("core/list", { ...this.list(node), ...attrs }, this.blocks(node.children), node.loc)];
      case "li":
        this.props(node, COMMON_PROPS);
        return [block("core/list-item", attrs, this.listItem(node), node.loc)];
      case "blockquote":
        this.props(node, COMMON_PROPS);
        return [block("core/quote", attrs, this.blocks(node.children), node.loc)];
      case "pre":
        this.props(node, COMMON_PROPS);
        return [block("core/code", attrs, this.code(node), node.loc)];
      case "img":
        this.onlyChildren(node, [], "an image has no content", "Remove the children, or use a <figure> with a <figcaption>.");
        return [block("core/image", { ...this.image(node), ...attrs }, [], node.loc)];
      case "figure":
        this.props(node, COMMON_PROPS);
        return this.figure(node, attrs);
      case "table":
        this.props(node, COMMON_PROPS);
        return [block("core/table", { ...this.table(node), ...attrs }, [], node.loc)];
      case "hr":
        this.props(node, COMMON_PROPS);
        this.onlyChildren(node, [], "a separator has no content", "Remove the children.");
        return [block("core/separator", attrs, [], node.loc)];
      case "details":
        return [block("core/details", { ...this.details(node), ...attrs }, this.detailsBody(node), node.loc)];
      default:
        break;
    }

    if (GROUP_TAGS.has(node.tag)) {
      this.props(node, COMMON_PROPS);
      return [block("core/group", { tagName: node.tag, ...attrs }, this.blocks(node.children), node.loc)];
    }

    return this.unmappable(node, `<${node.tag}> has no block.`, 'Use one of the mapped tags, or name a block directly with <Block name="…">.');
  }

  /** `<ol>` numbering (`start`, `reversed`) and either list's `type` are core/list attributes. */
  private list(node: ElementNode): BlockAttributes {
    this.props(node, [...COMMON_PROPS, "start", "reversed", "type"]);
    const attrs: BlockAttributes = {};
    if (node.tag === "ol") attrs.ordered = true;
    const start = this.integer(node, "start");
    if (start !== null) attrs.start = start;
    if (this.flag(node, "reversed")) attrs.reversed = true;
    const type = this.text(node, "type");
    if (type !== null) {
      const listStyle = LIST_TYPES[type];
      if (listStyle === undefined) this.badValue(node, "type", 'one of HTML\'s list types: "1", "a", "A", "i" or "I"');
      else attrs.type = listStyle;
    }
    return attrs;
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
      // Phrasing tags are written as HTML text, so a value that is not text (a handler, an
      // object) would be stringified into the markup. Refused here, where every phrasing element passes.
      this.classSpelledTwice(child);
      for (const [name, value] of Object.entries(child.props)) {
        if (name === "style" || value === null || value === undefined) continue;
        if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) continue;
        this.badValue(child, name, "a string, a number or a boolean");
      }
      if (!isInlineTag(child.tag)) {
        this.diagnostics.push({ code: "unmappable_element", severity: "error", message: `<${child.tag}> sits inside rich text, where only phrasing tags (a, strong, em, code, span, …) can go.`, hint: "Move it out of the paragraph, or use a phrasing tag.", loc: child.loc });
        continue;
      }
      if (VOID_TAGS.has(child.tag)) {
        // A void tag renders without its children, so any it was given would vanish.
        this.onlyChildren(child, [], `a <${child.tag}> has no content`, "Remove the children.");
        continue;
      }
      this.checkInline(child.children);
    }
  }

  /**
   * A list item's own text, then any list nested under it. That is the only
   * order a list item block can hold, so text after a nested list is refused
   * rather than moved in front of it.
   */
  private listItem(node: ElementNode): ContentNode[] {
    const text: ContentNode[] = [];
    const nested: ContentNode[] = [];
    for (const child of node.children) {
      if (child.kind === "block") nested.push(...this.blocks([child]));
      else if (isElement(child) && !isInlineTag(child.tag)) nested.push(...this.element(child));
      else if (nested.length > 0 && !(child.kind === "text" && child.text.trim() === "")) {
        this.diagnostics.push({
          code: "unmappable_element",
          severity: "error",
          message: `${child.kind === "text" ? "Text" : `<${child.tag}>`} after a nested list in a <li> has nowhere to go: an item's text comes before its nested list.`,
          hint: "Move it before the nested list, or into its own item.",
          loc: child.kind === "text" ? node.loc : child.loc,
        });
      } else text.push(child);
    }
    this.checkInline(text);
    return [...text, ...nested];
  }

  /** `<pre><code>` is the code block; a bare `<pre>` is still code. Anything beside the `<code>` is refused. */
  private code(node: ElementNode): ContentNode[] {
    const [code] = elementChildren(node, "code");
    if (code) {
      this.structural(code, [], "Put a class on the <pre>.");
      this.onlyChildren(node, [code], "a code block holds one <code>", "Put everything inside the <code>.");
    }
    const body = code ? code.children : node.children;
    this.checkInline(body);
    return [...body];
  }

  private image(node: ElementNode): BlockAttributes {
    if (node.props.style !== undefined) this.styleProp(node);
    this.props(node, [...COMMON_PROPS, "src", "alt", "title", "width", "height"]);
    const attrs: BlockAttributes = {};
    const url = this.text(node, "src");
    if (url !== null) attrs.url = url;
    const alt = this.text(node, "alt");
    if (alt !== null) attrs.alt = alt;
    const title = this.text(node, "title");
    if (title !== null) attrs.title = title;
    // core/image writes both into an inline style, so they are CSS lengths; HTML's bare pixels get their unit.
    for (const dimension of ["width", "height"] as const) {
      const value = this.text(node, dimension);
      if (value !== null) attrs[dimension] = cssLength(value);
    }
    return attrs;
  }

  /**
   * A structural child (figcaption, summary, thead, tr, td, …): checked for a
   * style prop like any element, and for props the block has no place for.
   */
  private structural(node: ElementNode, known: readonly string[] = [], hint?: string): ElementNode {
    if (node.props.style !== undefined) this.styleProp(node);
    const before = this.diagnostics.length;
    this.props(node, ["style", ...known]);
    if (hint !== undefined) for (const added of this.diagnostics.slice(before)) added.hint = hint;
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
    const own = this.common(image);
    // One image block has one class and one anchor; a figure and its img both carrying one is a collision, not a merge.
    for (const key of Object.keys(own)) {
      if (!Object.hasOwn(attrs, key)) continue;
      const prop = key === "anchor" ? "id" : "class";
      this.diagnostics.push({ code: "unmappable_element", severity: "error", message: `Both the <figure> and its <img> have a "${prop}"; the image block has one place for it.`, hint: `Keep the "${prop}" on one of them.`, loc: image.loc });
    }
    const imageAttrs = { ...this.image(image), ...own, ...attrs };
    const [caption] = elementChildren(node, "figcaption");
    if (caption) imageAttrs.caption = renderRichTextHtml(this.rich(this.structural(caption)));
    this.onlyChildren(node, [image, ...(caption ? [caption] : [])], "a figure is one image block", "Keep only an <img> and an optional <figcaption> in the figure.");
    return [block("core/image", imageAttrs, [], node.loc)];
  }

  private details(node: ElementNode): BlockAttributes {
    this.props(node, [...COMMON_PROPS, "open", "name"]);
    const attrs: BlockAttributes = {};
    if (this.flag(node, "open")) attrs.showContent = true;
    const name = this.text(node, "name");
    if (name !== null) attrs.name = name;
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
      // Every section of a kind contributes its rows, in document order; a row
      // written straight into the table is a body row where it stands.
      const rows = node.children.flatMap((child) => {
        if (!isElement(child)) return [];
        if (child.tag === section) return rowsOf(child);
        return section === "tbody" && child.tag === "tr" ? [child] : [];
      });
      return rows.map((row) => {
        this.structural(row);
        const cells = row.children.filter((cell): cell is ElementNode => isElement(cell) && (cell.tag === "td" || cell.tag === "th"));
        this.onlyChildren(row, cells, "a row holds td and th cells", "Put content inside a cell.");
        return { cells: cells.map((cell) => this.cell(cell)) };
      });
    };
    return { head: rowsIn("thead"), body: rowsIn("tbody"), foot: rowsIn("tfoot") };
  }

  /** One cell as core/table stores it: content, tag, and the span and scope attributes HTML gives a cell. */
  private cell(node: ElementNode): Record<string, string> {
    this.structural(node, ["colSpan", "colspan", "rowSpan", "rowspan", "scope"]);
    this.spelledTwice(node, "colspan", "colSpan");
    this.spelledTwice(node, "rowspan", "rowSpan");
    const cell: Record<string, string> = { content: renderRichTextHtml(this.rich(node)), tag: node.tag };
    for (const [attribute, names] of [["colspan", ["colSpan", "colspan"]], ["rowspan", ["rowSpan", "rowspan"]], ["scope", ["scope"]]] as const) {
      for (const name of names) {
        const value = this.text(node, name);
        if (value !== null) cell[attribute] = value;
      }
    }
    return cell;
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
