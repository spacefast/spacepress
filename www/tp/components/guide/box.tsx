import { Section, Built } from "../Guide";

export function Box() {
  return (
    <>
      <Section id="box" />
      <p><Built /> All of this comes from the schema alone.</p>
      <div className="scroll"><table>
      <tr><th>Thing</th><th>What it is</th></tr>
      <tr><td>TypedPress Admin</td><td>a modern admin at <code>/wp-admin/new/</code>; the classic admin stays complete beside it</td></tr>
      <tr><td>Editor</td><td>the WordPress editor for every collection, with drafts, revisions and scheduling</td></tr>
      <tr><td>API</td><td>typed endpoints for every kind and function, with an OpenAPI 3.1 document; WordPress's own REST API follows the same rules</td></tr>
      <tr><td>Typed client</td><td>plain <code>fetch</code>, no dependencies; every argument and result is typed from your schema</td></tr>
      <tr><td>Sign-in</td><td>password, passkeys, email code, Google, two-step verification with recovery codes, and guests who keep their rows when they sign up; members are WordPress users</td></tr>
      <tr><td>Media and files</td><td>the media library with named image sizes and focal-point crops; private buckets with signed links; S3-compatible storage</td></tr>
      <tr><td>Live reads</td><td><code>subscribe()</code> on any read; it polls, and a host can add a push transport</td></tr>
      <tr><td>Staged versions</td><td>save a change to a published item that visitors do not see, then compare, preview, schedule, promote or discard it</td></tr>
      <tr><td>Languages</td><td><code>{"locales: { default: \"en\", all: [\"en\", \"de\"] }"}</code> and <code>.localized()</code> fields; one row per language, through Polylang</td></tr>
      <tr><td>Search</td><td>an index kept current on every write, respecting access rules</td></tr>
      <tr><td>Comments</td><td>threads, moderation and guest rules, set per kind</td></tr>
      <tr><td>Sitemap and redirects</td><td>WordPress's sitemap with your pages in it; old slugs redirect</td></tr>
      <tr><td>For agents</td><td>MCP tools for every operation, a Markdown version of every public page at <code>&lt;url&gt;.md</code>, and <code>llms.txt</code></td></tr>
      <tr><td>Schema check at deploy</td><td>a change that would lose rows is refused, with the row count</td></tr>
      <tr><td>Services</td><td>contact forms with queued email, and Stripe hosted checkout, switched on in the config</td></tr>
      </table></div>
    </>
  );
}
