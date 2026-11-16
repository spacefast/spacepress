import { Section, Code, Tree, Built } from "../Guide";

export function Pages() {
  return (
    <>
      <Section id="pages" />
      <p><Built /> Pages are optional. Folders under <code>tp/app/</code> are URLs, with the file names Next.js uses.</p>
      <Tree>{`tp/app/
  layout.tsx                 wraps every page
  page.tsx                   /
  blog/[slug]/page.tsx       /blog/hello
  about/page.md              /about, a WordPress Page an editor can change
  account/layout.tsx         export const guard = "subscriber"
  api/feed.json/route.ts     GET /api/feed.json
  not-found.tsx  error.tsx   404 and 500
`}</Tree>
      <Code file="tp/app/blog/[slug]/page.tsx">{`import { posts } from "typedpress:db";
import { Content, Comments, notFound, type PageProps } from "typedpress/app";
import { LikeButton } from "./LikeButton";

export const metadata = ({ params }: PageProps<"blog/[slug]">) =>
  ({ title: params.slug, canonical: \`/blog/\${params.slug}\` });

export default async function Post({ params }: PageProps<"blog/[slug]">) {
  const post = await posts.get({ slug: params.slug });
  if (!post) notFound();
  return (
    <article>
      <h1>{post.title}</h1>
      <Content value={post.body} />
      <LikeButton id={post.id} count={post.views} />
      <Comments for={post} />
    </article>
  );
}`}</Code>
      <p>The page is rendered by WordPress, in PHP, as the person viewing it. Drafts and fields they may not see never reach the HTML.</p>
      <p>This site does both of these itself. Each <a href="/blog/">blog post</a> ends with WordPress's own comments, from <code>{"<Comments for={item} />"}</code> and one line on the kind, and the bottom of this page lists the newest posts with a component that reads them while the page renders.</p>
      <div className="scroll"><table>
      <tr><th>You want</th><th>You write</th></tr>
      <tr><td>Title, description, canonical URL, robots, social cards</td><td><code>export const metadata</code>, an object or a function of the page's props</td></tr>
      <tr><td>A typed query string</td><td><code>{"export const search = { page: integer().default(1), q: text().optional() }"}</code></td></tr>
      <tr><td>Protect a section</td><td><code>export const guard = "subscriber"</code> on a layout; a role, <code>"authenticated"</code> or a function</td></tr>
      <tr><td>A 404 or a redirect</td><td><code>notFound()</code>, <code>redirect(url, status?)</code></td></tr>
      <tr><td>Links without full page loads</td><td><code>&lt;Link href&gt;</code>, checked against your routes; <code>prefetch</code> loads on hover</td></tr>
      <tr><td>A post body</td><td><code>{"<Content value={post.body} />"}</code></td></tr>
      <tr><td>Numbered page links</td><td><code>{"<Pagination page={search.page} pages={n} />"}</code></td></tr>
      <tr><td>A comment thread and form</td><td><code>{"<Comments for={item} />"}</code>, on a kind with <code>comments</code> on</td></tr>
      <tr><td>A search box and results</td><td><code>&lt;Search /&gt;</code> and <code>{"<SearchResults kind=\"posts\" q={search.q} />"}</code></td></tr>
      <tr><td>Part of a page that stays current</td><td><code>&lt;Live id="notes"&gt;…&lt;/Live&gt;</code>; it re-renders on the server when what it read changes</td></tr>
      <tr><td>Styles and images</td><td><code>import "./site.css"</code>, <code>import styles from "./x.module.css"</code>, <code>import logo from "./logo.svg"</code></td></tr>
      </table></div>
      <Code file="tp/app/layout.tsx">{`import { Link, type LayoutProps } from "typedpress/app";
import "./global.css";

export const metadata = {
  title: { default: "Field Notes", template: "%s · Field Notes" },   // wraps each page's title
  description: "Short notes from the field.",
};

export default function RootLayout({ children }: LayoutProps) {
  return <main className="site"><nav><Link href="/blog">Blog</Link></nav>{children}</main>;
}`}</Code>
      <Code file="tp/app/about/page.md" note="a page an editor can change">{`---
title: Colophon
description: How this site is made.
---

Set in a system font, served by **WordPress**.`}</Code>
      <p className="cap">A <code>page.md</code> becomes a real WordPress Page on the first request after a build. From then on an editor changes it in the WordPress editor.</p>
      <div className="scroll"><table>
      <tr><th>Helper for documentation sites</th><th>Gives you</th></tr>
      <tr><td><code>nav(docs, current)</code></td><td>the section's tree, for a sidebar</td></tr>
      <tr><td><code>pager(docs, current)</code></td><td>the previous and next page</td></tr>
      <tr><td><code>headings(item)</code></td><td>the item's headings with their anchor ids, for a table of contents</td></tr>
      <tr><td><code>apiReference()</code></td><td>your API's operations and fields, to render an API reference page</td></tr>
      </table></div>
      <p className="cap">Fenced code blocks in content are highlighted on the server, in light and dark, with titles, marked lines and tabs. No script is added to the page.</p>
      <h3>Forms that work without JavaScript</h3>
      <Code lang="tsx">{`import { useFormState } from "typedpress/app";
import { subscribe } from "../server";

export default function Page() {
  const state = useFormState(subscribe);
  return (
    <form action={subscribe}>
      {state.error ? <p>{state.error.message}</p> : null}
      {state.result ? <p>Subscribed {state.result.email}</p> : null}
      <input name="email" type="email" defaultValue={state.values.email ?? ""} />
      <button>Subscribe</button>
    </form>
  );
}`}</Code>
      <p className="cap">The form posts to the mutation, which runs as the visitor, and the browser is sent back to the page with the result or the error for each field. <code>useFormState</code> returns <code>{"{ pending, error, result, values }"}</code>, and <code>error.fields</code> holds one message per field.</p>
      <h3>Caching</h3>
      <p><Built /> A signed-out visitor's page is cacheable by the page cache and the edge. Each cached page records the rows it read, so a write purges exactly the URLs that showed it. Signed-in visitors and guarded sections are never cached.</p>
      <h3>Static output</h3>
      <div className="scroll"><table>
      <tr><th>You want</th><th>You write</th></tr>
      <tr><td>Some pages prebuilt, the rest rendered per request</td><td><code>export const prerender = true</code> in those pages</td></tr>
      <tr><td>A whole site as static files, with no WordPress serving it</td><td><code>output: "static"</code> in the config, then <code>typedpress export</code></td></tr>
      <tr><td>Static files from a WordPress that editors use somewhere else</td><td>the same, with <code>typedpress export --site https://cms.example.com</code></td></tr>
      </table></div>
      <p className="cap">A write that changes what a prebuilt page shows deletes that page's file at once and schedules its rebuild, so nobody sees old content.</p>
    </>
  );
}
