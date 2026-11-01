import { createRequire } from "node:module";

import { nearest, type Diagnostic } from "../diagnostics.ts";
import { renderRichTextHtml } from "../mapping.ts";
import type { BlockAttributes, BlockNode, ContentNode, SourceLocation } from "../nodes.ts";

/**
 * Serialize a block tree to the markup WordPress stores.
 *
 * A template we compile has to open valid in the Site Editor, which means its
 * inner HTML must be what each block's own `save()` produces. Writing that by
 * hand would be a transcription of every core block's save function, wrong the
 * day core changes one. So this runs core's own code: `@wordpress/block-library`
 * registered under happy-dom, then `createBlock()` and `serialize()` from
 * `@wordpress/blocks`, all from the prebundled copy pinned to the versions
 * WordPress 7.1 ships (`scripts/bundle-wp.mjs`).
 *
 * Before any of that, every attribute is checked against the registered type.
 * `createBlock` drops an attribute the block does not register, and
 * `serialize()` drops an attribute registered as editor-local, both silently.
 * Here each is a located error instead.
 */

interface AttributeSchema {
  type?: string | string[];
  enum?: unknown[];
  source?: string;
  role?: string;
  default?: unknown;
}

interface BlockType {
  name: string;
  title?: string;
  attributes?: Record<string, AttributeSchema>;
  save?: unknown;
}

interface WpBlock {
  name: string;
  attributes: BlockAttributes;
  innerBlocks: WpBlock[];
  innerContent?: (string | null)[];
}

interface ParsedBlock extends WpBlock {
  isValid: boolean;
  innerBlocks: ParsedBlock[];
}

/** The subset of `@wordpress/blocks` the serializer and its tests use. */
export interface BlockApi {
  createBlock(name: string, attributes?: BlockAttributes, innerBlocks?: WpBlock[]): WpBlock;
  getBlockType(name: string): BlockType | undefined;
  getBlockTypes(): BlockType[];
  getSaveContent(type: string | BlockType, attributes: BlockAttributes, innerBlocks?: WpBlock[]): string;
  parse(markup: string): ParsedBlock[];
  serialize(blocks: WpBlock[]): string;
  registerBlockType(name: string, settings: Record<string, unknown>): unknown;
  unregisterBlockType(name: string): unknown;
}

interface WpBundle {
  blocks: BlockApi;
  registerCoreBlocks(): void;
  element: { createElement: (...args: unknown[]) => unknown; RawHTML: unknown };
}

const DOM_GLOBAL_NAMES = [
  "window", "document", "navigator", "self", "location", "Node", "Element", "HTMLElement", "HTMLIFrameElement",
  "DocumentFragment", "Text", "Comment", "NodeFilter", "Event", "CustomEvent", "DOMParser", "XMLSerializer",
  "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia", "MutationObserver",
  "ResizeObserver", "IntersectionObserver",
] as const;

const require = createRequire(import.meta.url);

let loaded: Promise<WpBundle> | null = null;

/**
 * WordPress's attribute parser (hpq) reads `element.attributes[name]` after
 * `hasOwnProperty(attributes, name)`. happy-dom's NamedNodeMap answers the
 * property read but not the own-property check, so every sourced attribute
 * (`core/image.url`, `core/button.url`) would parse back empty and the editor
 * would call the block invalid. This makes named attributes own properties.
 */
function patchNamedNodeMap(win: Record<string, unknown>): void {
  const proto = (win.Element as { prototype: object }).prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "attributes");
  if (!descriptor?.get) return;
  const original = descriptor.get;
  Object.defineProperty(proto, "attributes", {
    configurable: true,
    get() {
      const map = original.call(this) as { getNamedItem(name: string): object | null };
      return new Proxy(map, {
        getOwnPropertyDescriptor(target, key) {
          if (typeof key === "string" && !/^\d+$/.test(key)) {
            const item = target.getNamedItem(key);
            if (item) return { value: item, configurable: true, enumerable: true, writable: false };
          }
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
        has(target, key) {
          return (typeof key === "string" && target.getNamedItem(key) !== null) || Reflect.has(target, key);
        },
        get(target, key) {
          const value = Reflect.get(target, key, target) as unknown;
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
    },
  });
}

let dom: Promise<Record<string, unknown>> | null = null;
let domDepth = 0;
let restoreDom: (() => void) | null = null;

/**
 * Put the browser `@wordpress/*` expects onto `globalThis` for the length of
 * one call, then put whatever was there before back. One happy-dom window is
 * kept for the process (the block registry holds references into it), but
 * the globals are present only while this package is working, so an authored
 * module executed later sees the same environment as one executed first.
 */
async function createDom(): Promise<Record<string, unknown>> {
  const { Window } = await import("happy-dom");
  const win = new Window({ url: "https://localhost/" }) as unknown as Record<string, unknown>;
  patchNamedNodeMap(win);
  return win;
}

async function withDom<T>(use: () => Promise<T>): Promise<T> {
  // The window is created once, and the depth is read only after that await,
  // so two concurrent cold calls cannot both believe they are first.
  dom ??= createDom();
  const win = await dom;
  if (domDepth === 0) {
    const previous = new Map<string, PropertyDescriptor | undefined>();
    for (const name of DOM_GLOBAL_NAMES) {
      if (win[name] === undefined) continue;
      previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: win[name] });
    }
    restoreDom = () => {
      for (const [name, before] of previous) {
        if (before) Object.defineProperty(globalThis, name, before);
        else Reflect.deleteProperty(globalThis, name);
      }
    };
  }
  domDepth += 1;
  try {
    return await use();
  } finally {
    domDepth -= 1;
    if (domDepth === 0) {
      restoreDom?.();
      restoreDom = null;
    }
  }
}

async function loadBundle(): Promise<WpBundle> {
  const bundle = require("../../vendor/wp.cjs") as WpBundle;
  bundle.registerCoreBlocks();
  return bundle;
}

/**
 * Run `use` with `@wordpress/blocks` loaded, core blocks registered and a DOM
 * in place. Shared by the serializer, the codegen and tests: registration is
 * the expensive part and happens once per process.
 */
export function withBlockApi<T>(use: (api: BlockApi) => T | Promise<T>): Promise<T> {
  return withDom(async () => {
    loaded ??= loadBundle();
    return use((await loaded).blocks);
  });
}

/**
 * The inner HTML an unregistered block carries. Declared with a `source` so it
 * rides in the markup and never in the block comment. The name has a
 * character no author can write in JSX props or attrs objects by accident
 * (a colon), and authored attrs are checked against it anyway.
 */
const PASSTHROUGH_INNER_ATTRIBUTE = "zero-blocks:inner-html";

/** Blocks we registered ourselves, and the attribute names each has. */
const passthroughBlocks = new Map<string, Set<string>>();

/** WordPress's rule for a block name: `namespace/name`, lowercase, digits and dashes. */
const BLOCK_NAME = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;

/**
 * Teach `@wordpress/blocks` about a block it has never heard of, so a
 * third-party block serializes with its attributes and children instead of
 * being dropped. Its markup is unverified, which `unverified_block` says.
 */
async function registerPassthrough(blockName: string, attributeNames: Set<string>): Promise<void> {
  loaded ??= loadBundle();
  const bundle = await loaded;
  const known = passthroughBlocks.get(blockName);
  if (known !== undefined) {
    if ([...attributeNames].every((name) => known.has(name))) return;
    for (const name of known) attributeNames.add(name);
    bundle.blocks.unregisterBlockType(blockName);
  }
  passthroughBlocks.set(blockName, new Set(attributeNames));
  const attributes: Record<string, AttributeSchema> = { [PASSTHROUGH_INNER_ATTRIBUTE]: { type: "string", source: "html" } };
  for (const name of attributeNames) attributes[name] = {};
  const registered = bundle.blocks.registerBlockType(blockName, {
    apiVersion: 3,
    title: blockName,
    category: "widgets",
    supports: { className: false, customClassName: false, html: false },
    attributes,
    save: (props: { attributes: BlockAttributes }) =>
      bundle.element.createElement(bundle.element.RawHTML, null, String(props.attributes[PASSTHROUGH_INNER_ATTRIBUTE] ?? "")),
  });
  if (registered === undefined) {
    passthroughBlocks.delete(blockName);
    throw new Error(`WordPress refused to register ${blockName}`);
  }
}

function splitInner(inner: readonly ContentNode[]) {
  const richText: ContentNode[] = [];
  const childBlocks: BlockNode[] = [];
  for (const node of inner) {
    if (node.kind === "block") childBlocks.push(node);
    else richText.push(node);
  }
  return { richText, childBlocks };
}

/** The attribute a block keeps its own rich text in, if it has one named `content`. */
function richTextAttribute(type: BlockType): string | null {
  const schema = type.attributes?.content;
  if (schema === undefined) return null;
  return schema.source === "rich-text" || schema.source === "html" || schema.type === "rich-text" ? "content" : null;
}

const JSON_TYPE_CHECKS: Record<string, (value: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  "rich-text": (v) => typeof v === "string",
  number: (v) => typeof v === "number" && Number.isFinite(v),
  integer: (v) => typeof v === "number" && Number.isInteger(v),
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => isPlainObject(v),
  null: (v) => v === null,
};

/** A JSON object literal: what a block attribute of type `object` can hold. Dates, Maps and class instances are not. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Whether a value fits a registered attribute. An `enum` of primitives is the
 * whole set of allowed values (WordPress's parser drops anything else); the
 * `type` applies otherwise, a `type` array being a union.
 */
export function fitsAttribute(schema: AttributeSchema, value: unknown): boolean {
  if (schema.enum && schema.enum.length > 0 && schema.enum.every((entry) => entry === null || typeof entry !== "object")) {
    return schema.enum.includes(value);
  }
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length === 0) return true;
  return types.some((type) => JSON_TYPE_CHECKS[type]?.(value) ?? true);
}

/** A short, never-throwing rendering of an authored value for a message. */
function describeValue(value: unknown): string {
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return "a function";
  if (typeof value === "symbol") return value.toString();
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json.length > 80 ? `${json.slice(0, 77)}...` : json;
  } catch {
    /* circular or otherwise unserializable */
  }
  try {
    return typeof value === "object" && value !== null ? `a ${Object.getPrototypeOf(value)?.constructor?.name ?? "object"}` : String(value);
  } catch {
    // Even naming it threw (a getter on the prototype); the kind is all that is safe to say.
    return `a ${typeof value}`;
  }
}

function describeType(schema: AttributeSchema): string {
  if (schema.enum && schema.enum.length > 0) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  return types.join(" | ") || "unknown";
}

interface Prepared {
  blocks: WpBlock[];
  diagnostics: Diagnostic[];
}

class Serializer {
  readonly diagnostics: Diagnostic[] = [];
  /** The authored node each built block came from, for the round-trip check's locations. */
  readonly origins = new WeakMap<WpBlock, BlockNode>();
  private readonly unverified = new Set<string>();
  private readonly api: BlockApi;

  constructor(api: BlockApi) {
    this.api = api;
  }

  private error(code: Diagnostic["code"], message: string, hint: string | undefined, loc: SourceLocation | undefined): void {
    const diagnostic: Diagnostic = { code, severity: "error", message };
    if (hint) diagnostic.hint = hint;
    if (loc) diagnostic.loc = loc;
    this.diagnostics.push(diagnostic);
  }

  /** Validate one node against the registry; returns false when it cannot be built. */
  private check(node: BlockNode): boolean {
    const type = this.api.getBlockType(node.blockName);
    if (type === undefined && node.blockName.startsWith("core/")) {
      const candidate = nearest(node.blockName, this.api.getBlockTypes().map((t) => t.name));
      this.error("unknown_block", `${node.blockName} is not a block WordPress 7.1 registers.`, candidate ? `Did you mean ${candidate}?` : undefined, node.loc);
      return false;
    }
    if (type === undefined && !BLOCK_NAME.test(node.blockName)) {
      this.error("unknown_block", `"${node.blockName}" is not a valid block name.`, "Block names are namespace/name in lowercase letters, digits and dashes, like acme/testimonials.", node.loc);
      return false;
    }
    // One body per block: `content` names the whole body for a paragraph, a heading, a Custom HTML
    // block; children would be a second body and one of them would be lost.
    if (Object.hasOwn(node.attrs, "content") && node.inner.length > 0) {
      this.error("content_and_children", `${node.blockName} has both a content attribute and children.`, "Give it one body: children, or the content attribute.", node.loc);
      return false;
    }
    if (type === undefined || passthroughBlocks.has(node.blockName)) {
      if (Object.hasOwn(node.attrs, PASSTHROUGH_INNER_ATTRIBUTE)) {
        this.error("unknown_attribute", `"${PASSTHROUGH_INNER_ATTRIBUTE}" is reserved.`, "Pass the block's body as children.", node.loc);
        return false;
      }
      if (!this.unverified.has(node.blockName)) {
        this.unverified.add(node.blockName);
        const diagnostic: Diagnostic = {
          code: "unverified_block",
          severity: "info",
          message: `${node.blockName} is not a core block; its attributes and markup are written as authored and not checked.`,
        };
        if (node.loc) diagnostic.loc = node.loc;
        this.diagnostics.push(diagnostic);
      }
      return true;
    }
    let ok = true;
    const attributes = type.attributes ?? {};
    for (const [name, value] of Object.entries(node.attrs)) {
      const schema = Object.hasOwn(attributes, name) ? attributes[name] : undefined;
      if (schema === undefined) {
        const candidate = nearest(name, Object.keys(attributes));
        this.error("unknown_attribute", `${node.blockName} has no attribute "${name}".`, candidate ? `Did you mean "${candidate}"?` : undefined, node.loc);
        ok = false;
        continue;
      }
      if (schema.role === "local" && !(node.blockName === "core/html" && name === "content")) {
        this.error("local_attribute", `${node.blockName}.${name} is editor-session state that WordPress never writes to the saved markup.`, "Remove it; it cannot reach the theme.", node.loc);
        ok = false;
        continue;
      }
      if (!fitsAttribute(schema, value)) {
        this.error("attribute_type", `${node.blockName}.${name} expects ${describeType(schema)}, got ${describeValue(value)}.`, undefined, node.loc);
        ok = false;
        continue;
      }
      // The block comment is JSON; a value JSON cannot write (a BigInt inside an object) would throw at the end.
      const unwritable = jsonProblem(value);
      if (unwritable !== null) {
        this.error("attribute_type", `${node.blockName}.${name} holds ${unwritable}, which block markup cannot store.`, "Use JSON values: strings, numbers, booleans, arrays and plain objects.", node.loc);
        ok = false;
      }
    }
    return ok;
  }

  private innerHtml(node: BlockNode): string {
    const { richText, childBlocks } = splitInner(node.inner);
    const parts = [renderRichTextHtml(richText)];
    if (childBlocks.length > 0) {
      const built = childBlocks.map((child) => this.build(child)).filter((child): child is WpBlock => child !== null);
      parts.push(this.api.serialize(built));
    }
    return parts.filter((part) => part !== "").join("\n\n");
  }

  /** Convert one checked node to the block object `serialize()` understands. */
  build(node: BlockNode): WpBlock | null {
    if (!this.check(node)) {
      // Still walk the children so every problem in the tree is reported once.
      for (const child of node.inner) if (child.kind === "block") this.build(child);
      return null;
    }
    const attrs = { ...node.attrs };

    if (node.blockName === "core/html") {
      const { content, ...rest } = attrs;
      return this.from(node, { ...this.api.createBlock(node.blockName, rest, []), innerContent: [typeof content === "string" ? content : this.innerHtml(node)] });
    }

    if (passthroughBlocks.has(node.blockName)) {
      const inner = this.innerHtml(node);
      return this.from(node, this.api.createBlock(node.blockName, inner === "" ? attrs : { ...attrs, [PASSTHROUGH_INNER_ATTRIBUTE]: inner }, []));
    }

    const type = this.api.getBlockType(node.blockName)!;
    const { richText, childBlocks } = splitInner(node.inner);
    const innerBlocks = childBlocks.map((child) => this.build(child)).filter((child): child is WpBlock => child !== null);

    if (richText.length > 0) {
      const attribute = richTextAttribute(type);
      if (attribute !== null) {
        attrs[attribute] = renderRichTextHtml(richText);
      } else {
        // No body of its own to hold loose text, so the text becomes the
        // paragraph the author meant, as typing into a cover block does.
        innerBlocks.unshift(this.api.createBlock("core/paragraph", { content: renderRichTextHtml(richText) }, []));
      }
    }

    const block = this.api.createBlock(node.blockName, attrs, innerBlocks);
    // `serialize()` swallows a throwing save() and writes an empty block; ask first.
    let saved: string;
    try {
      saved = this.api.getSaveContent(type, block.attributes, block.innerBlocks);
    } catch (error) {
      this.error("save_failed", `${node.blockName} could not be rendered by its own save(): ${error instanceof Error ? error.message : String(error)}`, undefined, node.loc);
      return null;
    }
    // A block whose save() has no InnerBlocks slot (a paragraph, an image) drops
    // its inner blocks on the floor; the author would never know. If saving with
    // the children gives the same markup as saving without, they were dropped.
    if (innerBlocks.length > 0 && saved === this.api.getSaveContent(type, block.attributes, [])) {
      const first = childBlocks[0] ?? node;
      this.error("unmappable_element", `${node.blockName} cannot hold inner blocks; ${innerBlocks.length === 1 ? "its child" : "its children"} would be dropped.`, "Put the child blocks beside it, or inside a group.", first.loc ?? node.loc);
      return null;
    }
    return this.from(node, block);
  }

  private from(node: BlockNode, block: WpBlock): WpBlock {
    this.origins.set(block, node);
    return block;
  }

  /**
   * Read the document back the way the editor will and compare it with what
   * was written. `save()` is free to ignore a registered attribute (core/list's
   * legacy `values`, `scope` on a table's `td`) or to write markup its own
   * parser rejects (a heading at level 7); the registry check cannot see
   * either, the reparse can.
   */
  verify(written: readonly WpBlock[], read: readonly ParsedBlock[], parent: BlockNode | undefined): void {
    if (written.length !== read.length) {
      const first = written[0] !== undefined ? this.origins.get(written[0]) : undefined;
      this.error("save_failed", `${written.length} ${written.length === 1 ? "block was" : "blocks were"} written${parent ? ` inside ${parent.blockName}` : ""} and ${read.length} read back.`, undefined, first?.loc ?? parent?.loc);
      return;
    }
    for (const [index, block] of written.entries()) {
      const parsed = read[index]!;
      const origin = this.origins.get(block);
      const loc = origin?.loc ?? parent?.loc;
      if (parsed.name !== block.name || !parsed.isValid) {
        this.error("save_failed", `${block.name} saved markup the editor does not accept as that block${parsed.name !== block.name ? ` (it reads it as ${parsed.name})` : ""}.`, "Check the attribute values against what the block can render; the editor would show it as broken.", loc);
        continue;
      }
      if (origin !== undefined) {
        for (const name of Object.keys(origin.attrs)) {
          if (name === PASSTHROUGH_INNER_ATTRIBUTE || (block.name === "core/html" && name === "content")) continue;
          if (canonical(block.attributes[name]) !== canonical(parsed.attributes[name])) {
            this.error("attribute_dropped", `${block.name}.${name} is a registered attribute, but the block's save() does not write it into the markup; the editor reads back ${describeValue(normalizeRichText(parsed.attributes[name]))}.`, "Express it another way: as children, or through an attribute the block's current markup carries.", loc);
          }
        }
      }
      // A passthrough block's children were written as raw HTML inside it, which the parser reads as
      // inner blocks of its own; they were never built here, so there is nothing to compare them with.
      if (!passthroughBlocks.has(block.name)) this.verify(block.innerBlocks, parsed.innerBlocks, origin ?? parent);
    }
  }
}

/** `RichTextData` as the HTML string it stands for; everything else as is. */
function normalizeRichText(value: unknown): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !isPlainObject(value) ? String(value) : value;
}

/** One string per value, independent of key order, so two attribute values compare as the editor would see them. */
function canonical(value: unknown): string {
  const normalized = normalizeRichText(value);
  return JSON.stringify(normalized, (_key, entry: unknown) => {
    if (typeof entry === "function") return "«function»";
    if (typeof entry === "symbol") return "«symbol»";
    if (isPlainObject(entry)) return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return typeof entry === "object" && entry !== null && !Array.isArray(entry) ? String(entry) : entry;
  }) ?? "undefined";
}

/** What stops a value from being written as JSON, in words, or null when nothing does. */
function jsonProblem(value: unknown): string | null {
  try {
    JSON.stringify(value);
    return null;
  } catch (error) {
    if (error instanceof TypeError && /circular/i.test(error.message)) return "a circular reference";
    return /BigInt/.test(error instanceof Error ? error.message : "") ? "a BigInt" : "a value JSON cannot write";
  }
}

/** Parse without the parser's console logging: an invalid block is a diagnostic here, not console noise. */
function quietParse(api: BlockApi, markup: string): ParsedBlock[] {
  const { error, warn, groupCollapsed, groupEnd, info } = console;
  Object.assign(console, { error() {}, warn() {}, groupCollapsed() {}, groupEnd() {}, info() {} });
  try {
    return api.parse(markup);
  } finally {
    Object.assign(console, { error, warn, groupCollapsed, groupEnd, info });
  }
}

function collectUnregistered(api: BlockApi, nodes: readonly BlockNode[], into: Map<string, Set<string>>): void {
  for (const node of nodes) {
    if (!node.blockName.startsWith("core/") && BLOCK_NAME.test(node.blockName) && (passthroughBlocks.has(node.blockName) || api.getBlockType(node.blockName) === undefined)) {
      const names = into.get(node.blockName) ?? new Set<string>();
      for (const key of Object.keys(node.attrs)) if (key !== PASSTHROUGH_INNER_ATTRIBUTE) names.add(key);
      into.set(node.blockName, names);
    }
    collectUnregistered(api, node.inner.filter((child): child is BlockNode => child.kind === "block"), into);
  }
}

export interface SerializeResult {
  /** Empty when any diagnostic is an error. */
  markup: string;
  diagnostics: Diagnostic[];
}

/**
 * Serialize a tree to one document of comment-delimited blocks, or report
 * every reason it cannot be.
 */
export function serializeBlocks(blocks: readonly BlockNode[]): Promise<SerializeResult> {
  return withBlockApi(async (api) => {
    const unregistered = new Map<string, Set<string>>();
    collectUnregistered(api, blocks, unregistered);
    for (const [name, attributeNames] of unregistered) await registerPassthrough(name, attributeNames);

    const serializer = new Serializer(api);
    const prepared: Prepared = { blocks: [], diagnostics: serializer.diagnostics };
    for (const node of blocks) {
      const built = serializer.build(node);
      if (built !== null) prepared.blocks.push(built);
    }
    if (prepared.diagnostics.some((d) => d.severity === "error")) return { markup: "", diagnostics: prepared.diagnostics };
    if (prepared.blocks.length === 0) return { markup: "", diagnostics: prepared.diagnostics };
    const markup = api.serialize(prepared.blocks);
    serializer.verify(prepared.blocks, quietParse(api, markup), undefined);
    if (prepared.diagnostics.some((d) => d.severity === "error")) return { markup: "", diagnostics: prepared.diagnostics };
    return { markup, diagnostics: prepared.diagnostics };
  });
}
