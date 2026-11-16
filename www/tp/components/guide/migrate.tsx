import { Section, Ref, Code, Built, Decided } from "../Guide";

export function Migrate() {
  return (
    <>
      <Section id="migrate" />
      <p><Decided /> Migrating creates a new project with the same configuration, then content is synchronized into it. It is one system: <code>sync</code> is the only thing that writes content.</p>
      <Code lang="sh">{`typedpress migrate --from astro ../old-site --out my-site   # a new project, kinds translated
cd my-site && typedpress dev
typedpress sync                                             # content files to the site, and back`}</Code>
      <div className="scroll"><table>
      <tr><th>Source</th><th>Configuration</th><th>Content</th></tr>
      <tr><td>Astro</td><td><Built /> as a reader of the content config</td><td>already Markdown files; <code>sync</code> <Built /></td></tr>
      <tr><td>EmDash, Payload, Sanity</td><td><Built /></td><td>not built</td></tr>
      <tr><td>Zero 0.8</td><td><Built /></td><td><Built /></td></tr>
      </table></div>
      <p className="cap">You can also keep the Astro site and use TypedPress only as its data source (section <Ref to="frontend" />), or run both side by side.</p>
    </>
  );
}
