// Syntax highlighting for the playground and the tour: Pierre's diffs highlighter (Shiki with its
// JavaScript regex engine) and its light theme. The tour highlights at build time. The playground
// highlights in the browser as it edits and compiles. Blume highlights the Markdown pages itself.
import type { Element, ElementContent } from "hast";
import { getFiletypeFromFileName, getSharedHighlighter, hastToHtml, renderTokenLines } from "@pierre/diffs";

const theme = "pierre-light";

/** The Shiki language for a file name: `first.config.ts` is TypeScript, `schema.php` is PHP. */
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
