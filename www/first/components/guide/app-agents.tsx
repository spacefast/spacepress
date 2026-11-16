import { Section, Ref, Code, Built, Decided, Proposed } from "../Guide";

export function AppAgents() {
  return (
    <>
      <Section id="app-agents" />
      <p><Decided /> An app can declare its own agents: an assistant that answers from the app's data, or one that does a task every morning. Agents are a separate add-on that comes after the rest of TypedPress, and an app that does not add it gets nothing extra. The add-on brings no engine, scheduler or key store of its own. It uses what WordPress and TypedPress already have.</p>
      <div className="note"><b>Not built.</b> This is a design. The spelling below is a proposal.</div>
      <div className="scroll"><table>
      <tr><th>Part</th><th>Where it comes from</th></tr>
      <tr><td>The agent: instructions, tools, who may start it</td><td>your project, in <code>tp/</code>, after <code>typedpress add agents</code></td></tr>
      <tr><td>The tools</td><td>your own queries, mutations and kinds. Each one is already a WordPress ability with typed input and output <Built /></td></tr>
      <tr><td>The call to the model</td><td>WordPress's built-in AI client</td></tr>
      <tr><td>The model and its key</td><td>a provider set up in WordPress under Settings, Connectors. A host can register its own provider there, so its sites need no setup. Never a key in the project</td></tr>
      <tr><td>Schedules, background runs, retries</td><td><code>cron()</code> and <code>job()</code>, the same ones as in section <Ref to="server" />. An agent has no schedule of its own</td></tr>
      <tr><td>A person approving a content change</td><td>staged versions (section <Ref to="rw" />): the agent stages, a person promotes</td></tr>
      <tr><td>Replies appearing in a chat</td><td>live reads (<code>useQuery</code>), the same as any other data</td></tr>
      <tr><td>The loop that calls the model and the tools, and the conversation history</td><td><Proposed /> <a href="https://github.com/Automattic/agents-api">Agents API</a>, Automattic's library for WordPress agents. WordPress itself has no such loop yet</td></tr>
      </table></div>
      <Code file="tp/agents.ts">{`import { query, mutation, job, cron } from "typedpress";
import { agent } from "@typedpress/agents";
import { items } from "typedpress:db";

export const expiringSoon = query({ access: "author" },
  async ({ days = 3 }: { days?: number }) => {
    const cutoff = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    return items.list({ where: { expiresOn: { lte: cutoff }, quantity: { gt: 0 } } });
  });

export const discard = mutation({ access: "author" },
  async ({ id }: { id: number }) => items.update(id, { quantity: 0 }));

export const pantryHelper = agent({
  label: "Pantry helper",
  instructions: "./agents/pantry.md",        // a Markdown file, bundled at build time
  tools: [expiringSoon, discard],            // the same functions the browser calls
  access: "author",                          // who may start it
  runAs: "pantry-bot",                       // the WordPress user it acts as when a schedule starts it
  maxTurns: 8,
});

// a schedule is an ordinary cron()
export const morning = cron("0 8 * * *", () =>
  pantryHelper.run("List what expires in the next 3 days and say what to use first."));

// a chat is an ordinary job, mutation and query
export const answer = job({},
  async ({ session, message }: { session: string; message: string }) => {
    await pantryHelper.run(message, { session });
  });

export const ask = mutation({ access: "author", rateLimit: "20/min" },
  async (input: { session: string; message: string }) => { await answer.enqueue(input); });

export const thread = query({ access: "author" },
  async ({ session }: { session: string }) => pantryHelper.messages(session));`}</Code>
      <p className="cap"><Proposed /> In the browser, <code>useMutation</code> on <code>ask</code> sends a message and <code>useQuery</code> on <code>thread</code> shows the replies as they arrive.</p>
      <h3>The rules an agent runs under</h3>
      <ul>
        <li><b>It always acts as a WordPress user.</b> A run started by a signed-in person acts as that person. A run started by a schedule acts as the account named in <code>runAs</code>, which may not be an admin. It never runs with the trusted access that <code>.system</code> gives.</li>
        <li><b>It can call only the tools it lists.</b> Each call passes the same access rules as a call from the browser.</li>
        <li><b>It has a turn limit</b>, and a failed run is retried the way a failed job is.</li>
        <li><b>The project holds no model key.</b> If the site has no model set up, the run fails with a message that says so.</li>
      </ul>
      <h3>Building the rest from the same parts</h3>
      <div className="scroll"><table>
      <tr><th>You want</th><th>How you build it</th><th>Status</th></tr>
      <tr><td>An agent on a schedule</td><td><code>cron()</code> that calls <code>agent.run()</code></td><td>first version</td></tr>
      <tr><td>A chat inside your app</td><td>a job, a mutation and a query, as above; your own page for the chat window</td><td>first version</td></tr>
      <tr><td>Slack, email or another channel</td><td>a <code>route.ts</code> that receives the message and queues the same job, with the thread as the session</td><td>first version, you write the route</td></tr>
      <tr><td>Memory</td><td>a table of your own, with a query and a mutation the agent lists as tools</td><td>first version</td></tr>
      <tr><td>A person approving a content change</td><td>give the agent's account the right to stage and not to promote, on a kind with <code>staged: true</code></td><td>first version</td></tr>
      <tr><td>A person approving any other change</td><td><code>{"approval: { by: \"editor\" }"}</code> on the mutation, so it stores a proposal instead of running</td><td>later; it needs a place to keep proposals</td></tr>
      <tr><td>One agent handing work to another</td><td>list the other agent in <code>tools</code></td><td>later</td></tr>
      <tr><td>Skills loaded only when needed</td><td>more Markdown files next to the instructions</td><td>later</td></tr>
      <tr><td>An agent that runs code in a sandbox</td><td>not planned</td><td>no</td></tr>
      </table></div>
    </>
  );
}
