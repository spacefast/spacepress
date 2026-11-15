import { Section, Code, Built, Decided, Proposed } from "../Guide";

export function Events() {
  return (
    <>
      <Section id="events" />
      <p><Decided /> One handler per call, chained, from any file. <Built /> as the object form <code>{".on({ beforeCreate })"}</code> in the file that declares the kind.</p>
      <Code file="tp/server.ts">{`import { posts } from "./schema";

posts
  .on("beforeCreate", (data) => { data.title = data.title.trim(); })
  .on("change", async (c) => { await audit.system.create({ op: c.op, row: (c.after ?? c.before)!.id }); })
  .on("committed", async (c) => {
    if (c.op === "publish") await notifySubscribers.enqueue({ postId: c.after!.id });
  });`}</Code>
      <div className="scroll"><table>
      <tr><th>Event</th><th>Runs</th><th>Can change the data</th><th>If it throws</th></tr>
      <tr><td><code>beforeCreate</code>, <code>beforeUpdate</code></td><td>before the write</td><td>yes</td><td>the write is rejected</td></tr>
      <tr><td><code>beforeDelete</code></td><td>before the delete</td><td>no</td><td>the delete is rejected</td></tr>
      <tr><td><code>afterCreate</code>, <code>afterUpdate</code>, <code>afterDelete</code>, <code>afterPublish</code>, <code>afterUnpublish</code></td><td>after the write, in the same transaction</td><td>no</td><td>the transaction rolls back</td></tr>
      <tr><td><code>change</code></td><td>once per write, with <code>{"{ op, before, after }"}</code></td><td>no</td><td>the transaction rolls back</td></tr>
      <tr><td><code>committed</code></td><td>after the commit, as a queued action that is retried</td><td>no</td><td>it is retried; the write stays</td></tr>
      </table></div>
      <div className="scroll"><table>
      <tr><th>Handler</th><th>Receives</th></tr>
      <tr><td><code>beforeCreate</code></td><td><code>(data, ctx)</code>; change <code>data</code> or return a replacement</td></tr>
      <tr><td><code>beforeUpdate</code></td><td><code>(patch, existing, ctx)</code></td></tr>
      <tr><td><code>afterCreate</code>, <code>afterPublish</code>, <code>afterUnpublish</code>, <code>beforeDelete</code>, <code>afterDelete</code></td><td><code>(row, ctx)</code></td></tr>
      <tr><td><code>afterUpdate</code></td><td><code>(row, previous, ctx)</code></td></tr>
      <tr><td><code>change</code>, <code>committed</code></td><td><code>{"({ op, before, after }, ctx)"}</code>; <code>op</code> is <code>create</code>, <code>update</code>, <code>delete</code>, <code>publish</code> or <code>unpublish</code></td></tr>
      </table></div>
      <ul>
        <li>A kind can have several handlers for one event. They run in the order they were added.</li>
        <li>Every write path runs every handler: the API, the WordPress editor, the command line and jobs.</li>
        <li>A handler runs as the person who made the write. <code>.system</code> is the only bypass.</li>
        <li><Proposed /> <code>c.source</code> says where the write came from: <code>api</code>, <code>editor</code>, <code>cli</code>, <code>job</code> or <code>agent</code>.</li>
      </ul>
    </>
  );
}
