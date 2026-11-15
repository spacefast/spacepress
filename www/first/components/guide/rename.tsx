import { Section, Diff, Decided, Proposed } from "../Guide";

export function Rename() {
  return (
    <>
      <Section id="rename" />
      <p>If you read the code or the older documentation, these are the differences from this page.</p>
      <div className="scroll"><table>
      <tr><th>On this page</th><th>In the code today</th><th>Status</th></tr>
      <tr><td><code>typedpress</code>, <code>@typedpress/*</code>, <code>create-typedpress</code></td><td><code>first</code>, <code>@first/astro</code>, <code>@spacefast/create-first</code></td><td><Decided /></td></tr>
      <tr><td><code>tp/</code></td><td><code>first/</code></td><td><Decided /></td></tr>
      <tr><td><code>typedpress.config.ts</code>, <code>typedpress/app</code>, <code>typedpress/state</code>, <code>typedpress:db</code></td><td><code>first.config.ts</code>, <code>first/app</code>, <code>first/client</code>, <code>first:db</code></td><td><Proposed /> spellings</td></tr>
      <tr><td><code>/__tp/api/v1</code>, <code>wp_tp_&lt;name&gt;</code>, <code>TypedPress\</code>, <code>TP_URL</code></td><td><code>/__first/api/v1</code>, <code>wp_first_&lt;name&gt;</code>, <code>First\</code>, <code>FIRST_URL</code></td><td><Proposed /></td></tr>
      <tr><td><code>kind.on("event", fn)</code> from any file</td><td><code>{"kind.on({ event })"}</code> in the declaring file</td><td><Decided /></td></tr>
      <tr><td><code>change</code>, <code>committed</code>, <code>afterUnpublish</code> events</td><td>not there</td><td><Decided /></td></tr>
      <tr><td>handlers run as the caller</td><td>handlers are trusted</td><td><Decided /></td></tr>
      <tr><td><code>query()</code>, <code>mutation()</code></td><td><code>{"action({ input, handler })"}</code></td><td><Decided /></td></tr>
      <tr><td><code>{"tp.like({ id })"}</code></td><td><code>{"first.actions.like({ id })"}</code></td><td><Decided /></td></tr>
      <tr><td><code>posts.list()</code> everywhere</td><td><code>db.query.posts.findMany()</code> also exists, trusted</td><td><Decided /> <code>db.*</code> goes away</td></tr>
      <tr><td><code>job(options, handler)</code>, <code>x.enqueue()</code>, <code>cron()</code></td><td><code>{"job({ input, handler })"}</code>, <code>jobs.x.enqueue()</code></td><td><Decided /></td></tr>
      <tr><td><code>wp.users.extend()</code>, and the kind is always called <code>users</code></td><td><code>userProjection()</code> under a name you pick</td><td><Decided /></td></tr>
      <tr><td><code>useQuery</code> in client components</td><td><code>useLive</code></td><td><Decided /></td></tr>
      <tr><td><code>@typedpress/client</code> from npm, hooks at <code>/react</code></td><td>generated into <code>first/_generated/client/</code>; hooks through <code>createHooks(React)</code></td><td><Decided /></td></tr>
      <tr><td><code>loader</code>, <code>liveLoader</code>, <code>webhook</code> from <code>@typedpress/astro</code></td><td><code>firstLoader</code>, <code>firstLiveLoader</code>, <code>firstWebhook</code></td><td><Proposed /> spellings</td></tr>
      <tr><td><code>agent()</code> from the <code>@typedpress/agents</code> add-on</td><td>not there</td><td><Decided /> as a separate add-on; <Proposed /> spelling</td></tr>
      <tr><td><code>typedpress migrate --from astro</code></td><td><code>first migrate config</code> and <code>first migrate app</code></td><td><Decided /></td></tr>
      </table></div>
      <h3>The same files, today and after</h3>
      <p>Red lines are how the example apps in the code are written today. Green lines are the spelling this page uses. Lines with no colour do not change.</p>
      <p>A server function: <code>action()</code> becomes <code>mutation()</code>, the input comes from the parameter's type, and <code>db.*</code> becomes calls on the kind.</p>
      <Diff old="_today/full-site/first/actions.ts" new="notes/tp/server.ts" oldName="first/actions.ts" newName="tp/server.ts" />
      <p>A page: only the read changes.</p>
      <Diff old="_today/full-site/first/app/notes/[slug]/page.tsx" new="notes/tp/app/notes/[slug]/page.tsx" oldName="first/app/notes/[slug]/page.tsx" newName="tp/app/notes/[slug]/page.tsx" />
      <p>A component that runs in the browser: two imports.</p>
      <Diff old="_today/full-site/first/components/CheerButton.tsx" new="notes/tp/components/CheerButton.tsx" oldName="first/components/CheerButton.tsx" newName="tp/components/CheerButton.tsx" />
      <p>A backend with handlers, a job and two functions: one handler per <code>.on()</code> call, <code>job(options, handler)</code>, and the registries at the bottom of the file go away.</p>
      <Diff old="_today/pantry/first.config.ts" new="pantry/tp/index.ts" oldName="first.config.ts" newName="tp/index.ts" />
    </>
  );
}
