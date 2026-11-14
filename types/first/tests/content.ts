// "first/content" types: what nav(), pager() and headings() give a docs page.
import { nav, pager, headings, type NavItem, type Heading } from "first/content";

declare const docs: unknown;
declare const item: { id: number; content: string | null };

export async function docsPage(): Promise<string[]> {
  const tree: NavItem[] = await nav(docs, item);
  const { prev, next } = await pager(docs, item.id);
  const toc: Heading[] = headings(item);
  const out: string[] = tree.flatMap((a) => [a.title, ...a.children.map((b) => b.href)]);
  if (prev) out.push(prev.href);
  if (next) out.push(next.title);
  for (const h of toc) {
    const depth: 2 | 3 = h.depth;
    out.push(`${depth}#${h.id}`);
  }
  // @ts-expect-error: a pager link has no children
  out.push(String(prev?.children));
  // @ts-expect-error: headings() is not a promise
  void headings(item).then;
  return out;
}
