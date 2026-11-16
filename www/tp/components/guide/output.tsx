import { Section, Code } from "../Guide";

export function Output() {
  return (
    <>
      <Section id="output" />
      <p><code>typedpress build</code> compiles the project to WordPress plugins. The compiler is written in Rust and runs at build time only. On the site everything is PHP, with no JavaScript engine.</p>
      <div className="scroll"><table>
      <tr><th>You write</th><th>WordPress gets</th></tr>
      <tr><td><code>collection()</code></td><td>a post type, a field group and registered post meta</td></tr>
      <tr><td><code>table()</code></td><td>a SQL table, with migrations written for you by comparing with the last build</td></tr>
      <tr><td><code>taxonomy()</code>, <code>global()</code></td><td>a taxonomy with term meta; a registered setting</td></tr>
      <tr><td><code>url: "/blog/:slug"</code></td><td>rewrite rules, permalinks, and a redirect when a slug changes</td></tr>
      <tr><td>handlers, queries, mutations</td><td>plain PHP functions</td></tr>
      <tr><td><code>job()</code>, <code>cron()</code></td><td>Action Scheduler actions</td></tr>
      <tr><td><code>page.tsx</code></td><td>a PHP renderer; the HTML matches what React would render</td></tr>
      <tr><td><code>"use client"</code></td><td>an Interactivity API store and directives</td></tr>
      <tr><td>every operation</td><td>a WordPress Ability, also offered to agents over MCP</td></tr>
      </table></div>
      <p>A handler such as <code>{"beforeCreate(data) { data.title = data.title.trim() }"}</code> becomes:</p>
      <Code lang="php">{`function posts__beforeCreate(\\TypedPress\\JsObject $data)
{
    \\TypedPress\\Js::set($data, 'title', \\TypedPress\\Js::trim(\\TypedPress\\Js::prop($data, 'title')));
}`}</Code>
    </>
  );
}
