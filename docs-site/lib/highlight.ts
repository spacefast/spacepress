// Syntax highlighting for the playground's editors: Pierre's diffs highlighter (Shiki with its
// JavaScript regex engine) and its light and dark themes, in the browser as it edits and compiles.
// Every other file on the site renders at build time through lib/code-file.ts.
import type { Element, ElementContent } from "hast";
import { getFiletypeFromFileName, getSharedHighlighter, hastToHtml, renderTokenLines } from "@pierre/diffs";

/** The light theme is the default; the playground passes dark when the site is dark. */
const themeFor = (dark: boolean) => (dark ? "pierre-dark" : "pierre-light");

/** The Shiki language for a file name: `first.config.ts` is TypeScript, `schema.php` is PHP. */
export function languageOf(file: string): string {
  return getFiletypeFromFileName(file);
}

/** `<code>` holding one `span.line` per line of `code`, its tokens colored; unknown languages stay plain text. */
export async function highlightCode(code: string, lang: string, dark = false): Promise<Element> {
  const theme = themeFor(dark);
  const highlighter = await getSharedHighlighter({ themes: ["pierre-light", "pierre-dark"], langs: [], preferredHighlighter: "shiki-js" });
  const known = await highlighter.loadLanguages([lang]).then(() => true, () => false);
  const { tokens } = highlighter.codeToTokens(code, { lang: known ? lang : "text", theme });
  const children = renderTokenLines(tokens, {}).flatMap((line, i): ElementContent[] => (i === 0 ? [line] : [{ type: "text", value: "\n" }, line]));
  return { type: "element", tagName: "code", properties: {}, children };
}

/** The inner HTML of a highlighted `<code>`, for a view the playground paints itself. */
export async function highlightHtml(code: string, lang: string, dark = false): Promise<string> {
  return hastToHtml((await highlightCode(code, lang, dark)).children);
}
