import { Section, Ref, Tree } from "../Guide";

export function Layout() {
  return (
    <>
      <Section id="layout" />
      <p>Everything lives in <code>tp/</code>. You declare a thing once and its export name is its name everywhere: in the API, the client, the admin and the database. File names inside <code>tp/</code> are yours to choose, except <code>app/</code>. Section <Ref to="examples" /> has three complete projects.</p>
      <Tree>{`my-site/
  typedpress.config.ts     site name and switches
  tp/
    schema.ts              kinds: what your data is
    server.ts              queries, mutations, jobs, event handlers
    app/                   optional pages and HTTP routes
    content/               optional Markdown, kept equal to the site by sync
    _generated/            types, the typed client, migrations (never edit)
`}</Tree>
    </>
  );
}
