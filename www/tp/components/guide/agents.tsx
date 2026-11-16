import { Section, Ref, Built, Decided, Proposed } from "../Guide";

export function Agents() {
  return (
    <>
      <Section id="agents" />
      <p><Built /> An agent meets a project in two places.</p>
      <div className="scroll"><table>
      <tr><th></th><th>While you build</th><th>When the app runs</th></tr>
      <tr><td>What it is</td><td><code>typedpress mcp</code>, a local MCP server</td><td>the site's MCP endpoint, <code>/wp-json/mcp/typedpress-&lt;app&gt;</code></td></tr>
      <tr><td>Who uses it</td><td>a coding agent working on the source</td><td>any agent using the app's data and functions</td></tr>
      <tr><td>What it answers</td><td>the schema, compiler errors, the documentation, the dev site</td><td>one tool per kind operation and per function</td></tr>
      <tr><td>Access</td><td>the local files and dev site</td><td>a WordPress user's access rules; scoped agent credentials</td></tr>
      </table></div>
      <ul>
        <li><code>typedpress init</code> writes <code>AGENTS.md</code>, <code>.mcp.json</code> and the agent skill into the project.</li>
        <li>An agent credential is read-only with no access to personal data until you grant more: <code>--write</code>, <code>--personal</code>, or <code>--abilities=blog/posts-list,blog/*</code>. A scope only narrows what the user's role already allows.</li>
        <li><code>agents: false</code> on a kind, function or job keeps it out of agent tools. Uploads are never offered. <Proposed /> This option becomes <code>abilities: false</code>, so that the word agent only means the agents in section <Ref to="app-agents" />.</li>
        <li>Every public page also has a Markdown version at the same address plus <code>.md</code>, and the site serves <code>llms.txt</code>.</li>
        <li><Decided /> One skill shipped inside the npm package, with a path for each task, and the documentation shipped with it.</li>
      </ul>
    </>
  );
}
