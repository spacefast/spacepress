import { Section, Code, Built, Decided } from "../Guide";

export function Frontend() {
  return (
    <>
      <Section id="frontend" />
      <p><Decided /> One client for every frontend. It gives you data and sign-in, and it is the same client TypedPress pages use. <Built /> as files generated into each project; the npm package is the new part.</p>
      <Code lang="ts">{`import { createClient } from "@typedpress/client";
import { useQuery, useMutation } from "@typedpress/client/react";

const tp = createClient({ url: "https://my-site.example" });

await tp.posts.list({ where: { writer: 3 }, with: { writer: true }, limit: 10 });  // read
await tp.posts.create({ title: "Hello", writer: 3 });                              // write
await tp.like({ id: 42 });                                                         // a mutation, by its export name
tp.popular({ limit: 5 }).subscribe((rows) => render(rows));                        // stays current

await tp.auth.signIn();                                    // goes to the sign-in screens, then back
const client = createClient({ url, auth: { guests: true } }); // visitors can write before they sign up

const { data } = useQuery(tp.popular, { limit: 5 });       // React`}</Code>
      <Code lang="tsx">{`// React
function Todos() {
  const open = tp.todos.list({ where: { done: false } });
  const todos = useQuery(open);                                   // { data, error, loading }
  const add = useMutation((title: string) => tp.todos.create({ title }), {
    optimistic: (apply, title) => apply(open, (rows) => [...rows, { id: -1, title, done: false }]),
  });                                                             // { mutate, pending, error, reset }
  return <button disabled={add.pending} onClick={() => add.mutate("Buy milk")}>Add</button>;
}`}</Code>
      <Code lang="ts">{`// Astro: src/content.config.ts
import { defineCollection } from "astro:content";
import { loader, liveLoader, webhook } from "@typedpress/astro";

export const collections = {
  posts: defineCollection({ loader: loader("posts") }),                      // build time
  featured: defineCollection({ loader: loader("posts", { where: { featured: true } }) }),
};`}</Code>
      <div className="scroll"><table>
      <tr><th>Client call</th><th>What it does</th></tr>
      <tr><td><code>tp.posts.list / get / count / paginate</code></td><td>reads; <code>await</code> one for a single answer, or <code>.subscribe(onData, onError?)</code> to keep it current</td></tr>
      <tr><td><code>tp.posts.create / update / delete</code></td><td>writes; they refresh every subscription that reads that kind</td></tr>
      <tr><td><code>read.optimistic(update)</code></td><td>show a write before the server answers; <code>.settle()</code> or <code>.rollback()</code></td></tr>
      <tr><td><code>tp.posts.stage / compare / promote / discard</code></td><td>staged versions</td></tr>
      <tr><td><code>tp.auth.signIn()</code>, <code>handleCallback()</code>, <code>signOut()</code>, <code>upgrade()</code></td><td>sign-in through the site's screens; <code>upgrade()</code> turns a guest into a member and keeps their rows</td></tr>
      <tr><td><code>tp.media</code>, <code>tp.files.decks</code></td><td>uploads to the media library and to private buckets</td></tr>
      <tr><td><code>registerRealtimeTransport(transport)</code></td><td>a push transport from the host; without one, subscriptions poll</td></tr>
      </table></div>
      <div className="scroll"><table>
      <tr><th>Your frontend</th><th>You run</th><th>What arrives</th></tr>
      <tr><td>React or static Next.js</td><td><code>typedpress add react</code></td><td>the client and a hooks example</td></tr>
      <tr><td>Next.js with server caching</td><td><code>typedpress add next</code></td><td>one webhook route that revalidates by tag</td></tr>
      <tr><td>TanStack Start</td><td><code>typedpress add tanstack</code></td><td>a query example</td></tr>
      <tr><td>Astro</td><td><code>typedpress add astro</code></td><td><code>@typedpress/astro</code> loaders in your content config</td></tr>
      </table></div>
      <ul>
        <li>The per-framework files stay thin. Cache tags, webhook checks and preview live in the client; each framework file only calls that framework's own cache API.</li>
        <li><Built /> The Astro loaders: build-time collections that fetch only what changed, request-time collections with cache tags, and a webhook endpoint that purges or rebuilds on a write.</li>
        <li>Built-in components such as comments and search work only in TypedPress pages. Another frontend gets data and sign-in.</li>
      </ul>
    </>
  );
}
