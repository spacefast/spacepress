// "typedpress/content" types: what nav(), pager() and headings() give a docs page.
import { nav, pager, headings, type NavItem, type Heading } from "typedpress/content";

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

// apiReference(): an OpenAPI document as tags, operations and fields a page maps over.
import { apiReference, type ApiField, type ApiOperation } from "typedpress/content";

export function reference(): string[] {
  const api = apiReference();
  const partner = apiReference("partner-api.json");
  const ops: ApiOperation[] = api.tags.flatMap((t) => t.operations);
  const fields: ApiField[] = ops.flatMap((o) => [...o.params, ...o.body, ...o.responses.flatMap((r) => r.fields)]);
  const lines = fields.map((f) => `${"  ".repeat(f.depth)}${f.name}: ${f.type}${f.required ? "" : "?"} ${f.constraints.join(", ")} ${f.in}`);
  // @ts-expect-error: a source is a path, not a document
  apiReference({ openapi: "3.1.0" });
  // @ts-expect-error: apiReference() is not a promise
  void api.then;
  return [api.title, api.server, partner.version, ...ops.map((o) => `${o.method} ${o.path} ${o.slug} ${o.curl}`), ...lines];
}
