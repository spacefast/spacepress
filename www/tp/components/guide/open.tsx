import { Section, Ref } from "../Guide";

export function Open() {
  return (
    <>
      <Section id="open" />
      <div className="scroll"><table>
      <tr><th>Question</th><th>Options</th></tr>
      <tr><td>Do <code>tp/app/</code> pages render inside the theme by default?</td><td>inside the theme with an opt-out, or the whole document with an opt-in</td></tr>
      <tr><td>A header or footer written in TSX</td><td>a component placed in the theme's header, or kept in <code>layout.tsx</code></td></tr>
      <tr><td>Editing on the page</td><td>the marker design in section <Ref to="editing" />, or always open the WordPress editor</td></tr>
      <tr><td>Structured data without a plugin</td><td>TypedPress writes basic article and breadcrumb data, or leaves it to plugins</td></tr>
      <tr><td>Installing on a site that already has content</td><td>warn, or refuse</td></tr>
      <tr><td>The preview database</td><td>a separate SQLite database per preview, or the live tables read-only</td></tr>
      <tr><td>Which library runs an agent's loop</td><td>Agents API on its own, or Data Machine on top of it</td></tr>
      <tr><td>The option that hides a kind or function from outside agents</td><td><code>abilities: false</code>, or keep <code>agents: false</code></td></tr>
      <tr><td>Names stored on the site after the rename</td><td><code>/__tp</code>, <code>wp_tp_</code>, <code>TP_</code>, or keep today's</td></tr>
      </table></div>
    </>
  );
}
