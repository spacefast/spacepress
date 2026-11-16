import { Section, Ref, Built, Decided } from "../Guide";

export function Cli() {
  return (
    <>
      <Section id="cli" />
      <div className="scroll"><table>
      <tr><th>Command</th><th>What it does</th><th>Status</th></tr>
      <tr><td><code>typedpress dev</code></td><td>start local WordPress and rebuild on change; <code>dev stop</code>, <code>dev status</code></td><td><Built /></td></tr>
      <tr><td><code>typedpress build</code></td><td>write the WordPress plugins</td><td><Built /></td></tr>
      <tr><td><code>typedpress check</code></td><td>compile and report problems; write nothing</td><td><Built /></td></tr>
      <tr><td><code>typedpress add &lt;module&gt;</code></td><td>add a module as files you own</td><td><Built /> for <code>db</code>, <code>api-reference</code></td></tr>
      <tr><td><code>typedpress export</code></td><td>write the pages as a static site</td><td><Built /></td></tr>
      <tr><td><code>typedpress sync</code></td><td>content files to the site and back</td><td><Built /></td></tr>
      <tr><td><code>typedpress migrate</code></td><td>create a project from another system</td><td><Built /> as <code>migrate config</code> and <code>migrate app</code></td></tr>
      <tr><td><code>typedpress doctor</code></td><td>check a build and a running site; <code>--links</code> follows every link</td><td><Built /></td></tr>
      <tr><td><code>typedpress init</code>, <code>typedpress mcp</code></td><td>set a project up for coding agents; serve it to one</td><td><Built /></td></tr>
      <tr><td><code>typedpress wp &lt;args&gt;</code></td><td>run any WP-CLI command on the dev site</td><td><Built /></td></tr>
      <tr><td><code>typedpress pull</code></td><td>bring a site's runtime schema changes into the project</td><td><Built /></td></tr>
      <tr><td><code>typedpress deploy</code></td><td>check a build before it ships; back up and restore</td><td><Built /></td></tr>
      <tr><td><code>typedpress test</code></td><td>run your app on a real WordPress with SQLite: <code>asUser(role)</code>, a clock the test sets, and a call that runs every queued job</td><td><Decided /></td></tr>
      <tr><td><code>typedpress logs [--fn name]</code></td><td>read the site's function logs; agents get the same</td><td><Decided /></td></tr>
      <tr><td><code>typedpress plugin</code>, <code>login &lt;url&gt;</code>, <code>push</code>, <code>logout &lt;url&gt;</code></td><td>write the one plugin; connect the command line to a site; deploy a build to it (section <Ref to="host" />)</td><td>built on a branch, not merged</td></tr>
      </table></div>
      <p>On the site, through WP-CLI <Built />: apply database migrations, list, retry and cancel jobs, manage staged versions, read and write records, run a function, and manage sign-in apps and agent credentials.</p>
    </>
  );
}
