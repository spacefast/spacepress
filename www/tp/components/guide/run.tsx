import { Section, Ref, Built } from "../Guide";

export function Run() {
  return (
    <>
      <Section id="run" />
      <div className="scroll"><table>
      <tr><th></th><th>Needs</th></tr>
      <tr><td>WordPress</td><td>7.2 (beta 5 or later)</td></tr>
      <tr><td>PHP</td><td>8.2 with <code>mbstring</code>, <code>gd</code>, <code>fileinfo</code>, <code>openssl</code>, <code>sodium</code>, and <code>zip</code> for pushes</td></tr>
      <tr><td>Database</td><td>MySQL 8.0, MariaDB 10.11, or SQLite through the SQLite Database Integration plugin</td></tr>
      <tr><td>Local development</td><td>Node 22 or later, and npm</td></tr>
      <tr><td>Frontends</td><td>anything that can call <code>fetch</code>; Astro 7.4 or later for the loaders</td></tr>
      <tr><td>Agents</td><td>any MCP client</td></tr>
      </table></div>
      <ul>
        <li><Built /> Without the one plugin: <code>typedpress build</code> writes a set of plugin ZIP files that you upload or copy like any plugin. The runtime refuses to start on a site that misses a requirement and names each one.</li>
        <li><Built /> Static hosts: <code>typedpress export</code> writes plain files (section <Ref to="pages" />).</li>
        <li><Built /> <code>typedpress doctor --site &lt;url&gt;</code> checks a build and a running site.</li>
        <li><Built /> In a browser, with nothing installed: the <a href="/play/">playground</a> builds an app and runs it in WordPress.</li>
      </ul>
    </>
  );
}
