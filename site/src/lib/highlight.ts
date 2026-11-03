// Syntax highlighting for every code surface: Pierre's diffs highlighter (Shiki with its JavaScript
// regex engine) and its light theme. The tour and the docs highlight at build time; the playground
// highlights in the browser as it edits and compiles. Zero sources are TypeScript.
import type { Element, ElementContent, Root } from "hast";
import { getFiletypeFromFileName, getSharedHighlighter, hastToHtml, renderTokenLines } from "@pierre/diffs";
import { visit } from "unist-util-visit";

const theme = "pierre-light";

/** The Shiki language for a file name: `zero.config.ts` is TypeScript, `schema.php` is PHP. */
export function languageOf(file: string): string {
  return getFiletypeFromFileName(file);
}

/** `<code>` holding one `span.line` per line of `code`, its tokens colored; unknown languages stay plain text. */
export async function highlightCode(code: string, lang: string): Promise<Element> {
  const highlighter = await getSharedHighlighter({ themes: [theme], langs: [], preferredHighlighter: "shiki-js" });
  const known = await highlighter.loadLanguages([lang]).then(() => true, () => false);
  const { tokens } = highlighter.codeToTokens(code, { lang: known ? lang : "text", theme });
  const children = renderTokenLines(tokens, {}).flatMap((line, i): ElementContent[] => (i === 0 ? [line] : [{ type: "text", value: "\n" }, line]));
  return { type: "element", tagName: "code", properties: {}, children };
}

/** A highlighted `<pre class="diffs">` block, as HTML. */
export async function highlight(code: string, lang: string): Promise<string> {
  return hastToHtml({ type: "element", tagName: "pre", properties: { className: ["diffs"], dataLanguage: lang }, children: [await highlightCode(code, lang)] });
}

/** The inner HTML of a highlighted `<code>`, for a view the playground paints itself. */
export async function highlightHtml(code: string, lang: string): Promise<string> {
  return hastToHtml((await highlightCode(code, lang)).children);
}

/** rehype plugin for the docs: every fenced ```lang block, highlighted by the same highlighter. */
export function rehypeHighlight() {
  return async (tree: Root) => {
    const blocks: { pre: Element; code: Element }[] = [];
    visit(tree, "element", (pre: Element) => {
      const [code] = pre.children;
      if (pre.tagName === "pre" && pre.children.length === 1 && code?.type === "element" && code.tagName === "code") blocks.push({ pre, code });
    });
    for (const { pre, code } of blocks) {
      const classes = Array.isArray(code.properties.className) ? code.properties.className : [];
      const lang = classes.map(String).find((c) => c.startsWith("language-"))?.slice("language-".length) ?? "text";
      const text = code.children.map((child) => (child.type === "text" ? child.value : "")).join("").replace(/\n$/, "");
      pre.properties = { className: ["diffs"], dataLanguage: lang };
      pre.children = [await highlightCode(text, lang)];
    }
  };
}
