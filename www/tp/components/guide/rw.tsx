import { Section, Code, Built } from "../Guide";

export function Rw() {
  return (
    <>
      <Section id="rw" />
      <p><Built /> Inside pages, queries and mutations, a kind reads and writes <b>as the visitor</b>: access rules, drafts and hidden fields apply automatically.</p>
      <Code lang="ts">{`import { posts } from "typedpress:db";

await posts.list({
  where: { writer: { name: "Alice" } },       // filter through a relation
  orderBy: { views: "desc" }, limit: 10,
  with: { writer: true, topics: true },       // load related rows
});
await posts.paginate({ limit: 20, cursor });  // { rows, cursor }
await posts.get(42);                          // the row, or null
await posts.get({ slug: "hello" });
await posts.count({ search: "tea" });         // full-text search on what the visitor may read
await posts.create({ title: "Hi", writer: 3 });
await posts.update(42, { title: "Hello" });
await posts.delete(42);

await posts.system.list();                    // trusted: no access rules, every draft`}</Code>
      <Code lang="ts">{`// staged versions, through the client: change a published item without visitors seeing it
await tp.posts.stage(42, { title: "New title" });
await tp.posts.compare(42);                   // what differs from the live item
await tp.posts.promote(42);                   // or promote(42, { at: "2026-12-01T09:00:00Z" })
await tp.posts.discard(42);`}</Code>
      <ul>
        <li>Filters on a list of links: <code>{"{ tags: { has: 5 } }"}</code>, <code>{"{ tags: { name: \"news\" } }"}</code>, <code>{"{ tags: [] }"}</code> for none.</li>
        <li>A request, a mutation and a job each run in one transaction that covers table rows and WordPress content together.</li>
        <li><code>.system</code> is the only way around the rules. Jobs and signed webhooks have no visitor and run as the system.</li>
        <li>Search uses an index TypedPress keeps current on every write. A draft or a hidden field is never found and never counted.</li>
      </ul>
    </>
  );
}
