import { Section, Code, Built } from "../Guide";

export function Wordpress() {
  return (
    <>
      <Section id="wordpress" />
      <p><Built /> When you need WordPress itself, you can reach it from TypeScript.</p>
      <Code lang="ts">{`// a short, checked list of WordPress functions
import { current_user_can, get_post, esc_html, update_option, abilities } from "php/wordpress";

if (!current_user_can("edit_posts")) throw new HttpError(403, "forbidden", "Editors only");
const result = await abilities.call("acme/word-count", { text });   // any ability on the site, a plugin's included`}</Code>
      <Code file="tp/wp-hooks/the_content/20-frame.ts" note="a WordPress filter, named by its file">{`import type { Handler } from "php/wordpress";

const frame: Handler<"the_content"> = (content) => \`<div class="frame">\${content}</div>\`;
export default frame;`}</Code>
      <div className="scroll"><table>
      <tr><th>Thing</th><th>How</th></tr>
      <tr><td>WordPress functions</td><td>a curated list from <code>"php/wordpress"</code>: options, posts, users, capabilities, escaping and sanitizing</td></tr>
      <tr><td>WordPress actions and filters</td><td>a file in <code>tp/wp-hooks/</code>, named after the hook; a number prefix sets the order</td></tr>
      <tr><td>Abilities</td><td><code>abilities.call("vendor/name", input)</code></td></tr>
      <tr><td>A SQL table that already exists</td><td><code>{"table(fields, { existingTable: \"wp_orders\" })"}</code>; only this site's own tables</td></tr>
      <tr><td>An admin screen of your own</td><td>declared once, shown in both admins</td></tr>
      <tr><td>Schema changes on a running site</td><td><code>runtimeSchema: true</code>: an editor adds a field or a collection without a build; <code>typedpress pull</code> brings it back into the project</td></tr>
      </table></div>
    </>
  );
}
