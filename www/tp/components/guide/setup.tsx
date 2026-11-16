import { Section, Code, Built, Decided, Proposed } from "../Guide";

export function Setup() {
  return (
    <>
      <Section id="setup" />
      <Code lang="sh">{`npm create typedpress my-site    # a project with WordPress content only
cd my-site
typedpress dev                   # local WordPress, rebuilds when you save
typedpress add db                # later: SQL tables of your own
typedpress add pages             # later: your own front end`}</Code>
      <div className="scroll"><table>
      <tr><th>Step</th><th>Status</th><th>Note</th></tr>
      <tr><td>Create a project and run <code>dev</code></td><td><Built /></td><td>Local WordPress, PHP and SQLite come from WordPress Studio. You need Node 22 or later.</td></tr>
      <tr><td><code>add db</code>, <code>add api-reference</code></td><td><Built /></td><td><code>add</code> writes files you own. It never edits your files and is safe to run again.</td></tr>
      <tr><td><code>add pages</code>, <code>react</code>, <code>next</code>, <code>tanstack</code>, <code>astro</code></td><td><Proposed /></td><td>The same rules as <code>add db</code>.</td></tr>
      <tr><td>Install from npm</td><td><Decided /></td><td>Today the compiler is built from source.</td></tr>
      </table></div>
      <p className="cap">A new project starts with content only: things people write and publish. You add a database, pages and other frontends when you need them.</p>
    </>
  );
}
