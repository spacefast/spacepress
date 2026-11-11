/**
 * The JSX runtime for pages (`jsxImportSource: "@spacefast/first-pages"`).
 *
 * It is First Blocks' runtime with one step in front: per-request values become
 * tokens before Blocks sees them, so the tree Blocks maps and serializes is
 * ordinary content with placeholders in text and attributes. Function
 * components still receive the values themselves (a `<Show when>` needs the
 * path, not a token). Positions where PHP could not escape a value for its
 * context, or where it would change structure rather than text, are refused
 * here with the element's location.
 */
import {
  Fragment, createElement as blocksCreateElement, jsx as blocksJsx, jsxDEV as blocksJsxDEV, toContentNodes,
} from "@spacefast/first-blocks/jsx-runtime";

import { PagesError, hasToken, pathOf, registry, tokenize } from "./symbolic.ts";

export { Fragment, toContentNodes };
export type { JSX } from "@spacefast/first-blocks/jsx-runtime";

/** Structure, styling and behavior are code-owned; a per-request value there is refused rather than half-supported. */
const STATIC_PROPS = new Set(["class", "className", "id", "style", "key", "ref", "dangerouslySetInnerHTML", "srcset", "srcSet", "sizes", "tabIndex", "role"]);

interface JsxSource {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

/** Where a refusal happened, attached to the error so the build can report `file:line:column`. */
export interface LocatedError extends Error {
  pagesLoc?: { fileName: string; line: number; column: number };
}

function located(error: unknown, source: JsxSource | undefined): unknown {
  if (error instanceof PagesError && source !== undefined && (error as LocatedError).pagesLoc === undefined) {
    (error as LocatedError).pagesLoc = { fileName: source.fileName, line: source.lineNumber, column: source.columnNumber };
  }
  return error;
}

function intrinsicProps(tag: string, props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    if (name === "children") {
      out.children = tokenize(value);
      continue;
    }
    const dynamic = pathOf(value) !== undefined || (typeof value === "string" && hasToken(value));
    if (dynamic && (STATIC_PROPS.has(name) || /^on[A-Z]/i.test(name) || name.startsWith("data-wp-"))) {
      throw new PagesError(
        "dynamic_attribute",
        `<${tag} ${name}> cannot hold a per-request value: classes, ids, styles and handlers are part of the page's code. Branch with <Show> instead.`,
      );
    }
    if (/^on[A-Z]/.test(name) && typeof value === "function") {
      throw new PagesError("event_handler", `<${tag} ${name}> is an event handler; pages render on the server. Use an <Island> with a client module.`);
    }
    out[name] = tokenize(value);
  }
  return out;
}

const wrapped = new WeakMap<object, (props: Record<string, unknown>) => unknown>();

/** A component's output is tokenized too, so a component may return a field (`return props.title`). */
function component(type: (props: Record<string, unknown>) => unknown): (props: Record<string, unknown>) => unknown {
  let wrapper = wrapped.get(type);
  if (wrapper === undefined) {
    wrapper = (props) => {
      const rendered = type(props);
      if (rendered !== null && typeof rendered === "object" && typeof (rendered as { then?: unknown }).then === "function") {
        throw new PagesError("async_component", `${type.name || "A component"} is async; components render synchronously at build time. Read data in load().`);
      }
      return tokenize(rendered);
    };
    Object.defineProperty(wrapper, "name", { value: type.name });
    wrapped.set(type, wrapper);
  }
  return wrapper;
}

function prepare(type: unknown, props: Record<string, unknown> | null | undefined): [unknown, Record<string, unknown>] {
  const bag = props ?? {};
  if (typeof type === "string") return [type, intrinsicProps(type, bag)];
  if (type === Fragment) return [type, { ...bag, children: tokenize(bag.children) }];
  if (typeof type === "function") return [component(type as (props: Record<string, unknown>) => unknown), bag];
  return [type, bag];
}

export function jsx(type: unknown, props: Record<string, unknown>, key?: unknown): unknown {
  const [t, p] = prepare(type, props);
  return blocksJsx(t, p, key);
}

export const jsxs = jsx;

export function jsxDEV(type: unknown, props: Record<string, unknown>, key?: unknown, isStatic?: boolean, source?: JsxSource): unknown {
  const outer = registry.callSite;
  try {
    const [t, p] = prepare(type, props);
    if (typeof type === "function" && source !== undefined) registry.callSite = source.fileName;
    return blocksJsxDEV(t, p, key, isStatic, source);
  } catch (error) {
    throw located(error, source);
  } finally {
    registry.callSite = outer;
  }
}

export function createElement(type: unknown, props: Record<string, unknown> | null | undefined, ...children: unknown[]): unknown {
  const [t, p] = prepare(type, children.length === 0 ? props : { ...props, children: children.length === 1 ? children[0] : children });
  return blocksCreateElement(t, p);
}
