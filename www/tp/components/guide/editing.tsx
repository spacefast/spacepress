import { Section, Code, Built, Decided, Proposed } from "../Guide";

export function Editing() {
  return (
    <>
      <Section id="editing" />
      <p><Decided /> Editing uses the standard WordPress experience wherever it can.</p>
      <div className="scroll"><table>
      <tr><th>Thing</th><th>Edited in</th><th>Status</th></tr>
      <tr><td>An item's fields and body</td><td>the WordPress editor</td><td><Built /></td></tr>
      <tr><td>A component used inside a body</td><td>the WordPress editor, as a block with its props in the sidebar</td><td><Built /></td></tr>
      <tr><td>The same content as Markdown files</td><td>your code editor; <code>sync</code> keeps both sides equal</td><td><Built /></td></tr>
      <tr><td>A <code>page.md</code> page</td><td>the WordPress editor, after its first build</td><td><Built /></td></tr>
      <tr><td>Theme templates and styles</td><td>the WordPress Site Editor</td><td><Built /></td></tr>
      <tr><td>What surrounds a <code>tp/app/</code> page</td><td>the WordPress Site Editor</td><td><Proposed /></td></tr>
      <tr><td>The markup inside a <code>tp/app/</code> page</td><td>code only</td><td>by design</td></tr>
      </table></div>
      <h3>Your components as editor blocks <Built /></h3>
      <Code file="tp/components/Callout.tsx" note="listing a component makes it a block">{`export const blocks = ["Callout"];

export function Callout({ type, children }: { type: "note" | "warning"; children?: JSX.Element }) {
  return <aside className={\`callout callout-\${type}\`}>{children}</aside>;
}`}</Code>
      <p className="cap">In the editor it is a block. In a Markdown file it is the tag <code>&lt;Callout type="warning"&gt;</code>. Both store the same thing.</p>
      <h3>Editing on the page <Proposed /></h3>
      <p>A signed-in editor clicks content on the live page to change it. The page marks what is editable, and WordPress does the editing. There is no second editor.</p>
      <Code lang="tsx">{`<h1 {...post.edit.title}>{post.title}</h1>
<Content value={post.body} {...post.edit.body} />`}</Code>
      <div className="scroll"><table>
      <tr><th>You click</th><th>What happens</th></tr>
      <tr><td>a plain text field, such as a title</td><td>you type on the page; it saves as a draft change</td></tr>
      <tr><td>an image</td><td>the WordPress media library opens</td></tr>
      <tr><td>the body</td><td>the WordPress editor opens over the page for that item; on save, that part of the page refreshes</td></tr>
      <tr><td>the header, footer or styles</td><td>the WordPress Site Editor</td></tr>
      </table></div>
      <p className="cap">Visitors never receive the markers or the script.</p>
    </>
  );
}
