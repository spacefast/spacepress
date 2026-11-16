import { Section, Code, Built, Decided, Proposed } from "../Guide";

export function Visitor() {
  return (
    <>
      <Section id="visitor" />
      <p><Decided /> One built-in theme, always active. Its templates and styles are edited in the WordPress Site Editor. There is no choice between themes.</p>
      <div className="grid">
        <div>
          <div className="mock">
            <div className="bar"><span>My Site</span><span>Home</span></div>
            <p className="t">Hello, world</p>
            <div className="ln" style={{ width: "96%" }}></div><div className="ln" style={{ width: "88%" }}></div><div className="ln" style={{ width: "92%" }}></div><div className="ln" style={{ width: "55%" }}></div>
            <div className="foot">My Site</div>
          </div>
          <p className="cap"><b>You add a post and open it.</b> With no pages of your own, the built-in theme shows the title and the body between a header and a footer.</p>
        </div>
        <div>
          <div className="mock">
            <div className="bar"><span>theme header</span><span>menu</span></div>
            <p className="t">Hello, world</p>
            <div className="ln" style={{ width: "90%" }}></div><div className="ln" style={{ width: "70%" }}></div>
            <p style={{ margin: "10px 0 0" }}><span className="b built">12 likes</span></p>
            <div className="foot">theme footer</div>
          </div>
          <p className="cap"><b>You add <code>tp/app/blog/[slug]/page.tsx</code>.</b> That file now renders every URL that matches the kind's <code>url</code>.</p>
        </div>
      </div>
      <div className="scroll"><table>
      <tr><th>Your project has</th><th>Who renders a URL</th><th>Status</th></tr>
      <tr><td>no <code>tp/app/</code></td><td>the theme: posts, term pages, home, archives, search</td><td><Built /></td></tr>
      <tr><td><code>tp/app/</code></td><td>your pages; a kind's URL with no page still goes to the theme</td><td><Built /></td></tr>
      <tr><td><code>frontend: false</code></td><td>nobody: the site is an API only</td><td><Built /></td></tr>
      <tr><td><code>frontend: "https://…"</code></td><td>another site, such as an Astro or Next.js app</td><td><Built /></td></tr>
      </table></div>
      <p><Proposed /> Today a page in <code>tp/app/</code> writes its whole HTML document itself. The proposal is that it renders inside the theme: the page becomes one block that a template places between the theme's header and footer, so the Site Editor can change what surrounds it. <code>export const shell = false</code> would keep the whole document for a page that wants it.</p>
      <Code lang="html">{`<!-- wp:template-part {"slug":"header"} /-->
<!-- wp:typedpress/route /-->
<!-- wp:template-part {"slug":"footer"} /-->`}</Code>
    </>
  );
}
