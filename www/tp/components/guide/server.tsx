import { Section, Code, Built, Decided } from "../Guide";

export function Server() {
  return (
    <>
      <Section id="server" />
      <h3>Queries and mutations <Decided /></h3>
      <p>A query reads, a mutation writes. Input types come from the handler's own parameter. <Built /> as one form, <code>{"action({ input, handler })"}</code>.</p>
      <Code lang="ts">{`import { query, mutation, job, cron, HttpError } from "typedpress";

export const popular = query({ access: "anyone" },
  async ({ limit = 10 }: { limit?: number }) =>
    posts.list({ orderBy: { views: "desc" }, limit }));

export const like = mutation({ access: "subscriber", rateLimit: "10/min" },
  async ({ id }: { id: number }) => {
    const post = await posts.get(id);
    if (!post) throw new HttpError(404, "not_found", "No such post");
    await posts.system.update(id, { views: post.views + 1 });
  });`}</Code>
      <div className="scroll"><table>
      <tr><th></th><th><code>query</code></th><th><code>mutation</code></th></tr>
      <tr><td>May write</td><td>no</td><td>yes, in one transaction</td></tr>
      <tr><td>Cached and subscribable</td><td>yes</td><td>no</td></tr>
      <tr><td>After it runs</td><td>nothing</td><td>purges the pages its writes changed</td></tr>
      <tr><td>As an agent tool</td><td>marked read-only</td><td>marked as a write</td></tr>
      <tr><td>As a form action</td><td>no</td><td>yes, and it works without JavaScript</td></tr>
      </table></div>
      <ul>
        <li><b>From the browser</b> you call a function by its export name: <code>{"tp.popular({ limit: 5 })"}</code>, <code>{"tp.like({ id })"}</code>.</li>
        <li><b>From server code</b> you import it and call it. It runs as the current caller with its access check, and as the system inside a job.</li>
        <li><b>Default access is <code>"editor"</code>.</b> A mutation open to <code>"anyone"</code> gets a default rate limit. Limits count per user, or per address when signed out.</li>
        <li><b>A mutation accepts an idempotency key</b>, so a retried call does not write twice.</li>
        <li><b>Every function, handler and route gets one <code>ctx</code>:</b> <code>ctx.user</code>, <code>ctx.can(op, kind, row?)</code>, <code>ctx.env</code>, and <code>ctx.request</code> in routes.</li>
        <li><b>Errors carry field messages.</b> A refused write answers a standard problem document with <code>fields</code>, a map from field name to message, so a form can show each message beside its field.</li>
        <li><b>Old pages after a deploy.</b> A call to a function the new build removed answers <code>409 stale_client</code> and the client reloads the page. <code>.was("oldName")</code> keeps an old name answering for one release.</li>
      </ul>
      <h3>Background jobs and schedules</h3>
      <Code lang="ts">{`export const notifySubscribers = job({ retries: 3 }, async ({ postId }: { postId: number }) => { /* … */ });
export const nightly = cron("0 3 * * *", async () => { /* … */ });

await notifySubscribers.enqueue({ postId: 42 }, { delay: 60, key: "post-42" });`}</Code>
      <ul>
        <li><Built /> Jobs: queued inside the request's transaction, run after it commits, retried with backoff. They run on Action Scheduler, the queue WordPress sites already use. <code>key</code> collapses duplicates that are still waiting.</li>
        <li>Inside a job, <code>ctx.attempt</code> and <code>ctx.jobId</code> say which run this is.</li>
        <li><Decided /> <code>cron()</code>, the two-argument <code>job(options, handler)</code> form, <code>{"job({ every: \"1h\" }, handler)"}</code> for a repeat, and <code>x.enqueue()</code>. Today a job is <code>{"job({ input, handler })"}</code> and is queued with <code>jobs.x.enqueue()</code>.</li>
      </ul>
      <h3>HTTP routes <Built /></h3>
      <p>A <code>route.ts</code> file serves your own methods on a path of the site: a feed, a webhook, anything that is not a JSON call.</p>
      <Code file="tp/app/webhooks/stripe/route.ts" note="POST /webhooks/stripe">{`import { env, type RouteRequest } from "typedpress";

export const signature = { secret: env("STRIPE_WEBHOOK_SECRET"), header: "stripe-signature", scheme: "hmac-sha256" };

export function POST(req: RouteRequest) {
  const event = JSON.parse(req.body) as { type: string };
  return { status: 202, body: "ok " + event.type };
}`}</Code>
      <Code file="tp/app/api/feed.json/route.ts" note="GET /api/feed.json">{`export const access = "anyone";

export async function GET(req: RouteRequest) {
  const limit = Number(req.query.get("limit") ?? "20");
  const rows = await posts.list({ limit });
  return { headers: { "content-type": "application/feed+json" }, body: JSON.stringify({ items: rows }) };
}`}</Code>
      <ul>
        <li>A route exports the methods it serves (<code>GET</code>, <code>POST</code>, …) and returns <code>{"{ status?, headers?, body }"}</code>. It has <code>access</code> or a <code>signature</code>.</li>
        <li><code>req</code> has <code>method</code>, <code>url</code>, <code>path</code>, <code>params</code>, <code>query</code>, <code>headers</code> and the raw <code>body</code>.</li>
        <li>A <code>page.tsx</code> can export <code>POST</code> too.</li>
        <li><Decided /> A file such as <code>tp/app/feed.xml.ts</code> serves <code>/feed.xml</code> without a folder.</li>
      </ul>
      <h3>Also on the server <Built /></h3>
      <div className="scroll"><table>
      <tr><th>Thing</th><th>How</th></tr>
      <tr><td>Email</td><td><code>{"await mail.send({ to, subject, text, html })"}</code>; sent from a queue</td></tr>
      <tr><td>Outgoing webhooks</td><td><code>{"webhooks: [{ url, secret, events: [\"posts.created\"] }]"}</code> in the config; signed and retried</td></tr>
      <tr><td>Secrets and settings</td><td><code>env("NAME")</code>, read on the site when it is used, never at build time</td></tr>
      <tr><td>Run something once</td><td><code>await once(key, fn)</code>; a repeat with the same key returns the first result</td></tr>
      <tr><td>Errors</td><td><code>throw new HttpError(status, code, message)</code></td></tr>
      <tr><td>Outbound HTTP</td><td><code>fetch()</code> from a handler</td></tr>
      <tr><td>Hashing and signatures</td><td><code>{"import { createHmac, timingSafeEqual } from \"node:crypto\""}</code>; <code>crypto.randomUUID()</code></td></tr>
      </table></div>
      <p className="cap">Handlers are written in a checked subset of TypeScript. Anything outside it fails the build at the file, line and column, with the fix.</p>
    </>
  );
}
