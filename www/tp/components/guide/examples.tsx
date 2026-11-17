import { Section, Ref, Example } from "../Guide";

export function Examples() {
  return (
    <>
      <Section id="examples" />
      <p>Each project below is complete: every file is shown. Click a file in the tree to read it. Under each one, <b>Edit and build this</b> opens the same app for editing. They are the real example apps that exist in the code today, written in the spelling this page describes; section <Ref to="rename" /> shows the exact lines that differ.</p>
      <h3>A site with pages</h3>
      <p>Notes that an editor writes in WordPress, pages written in TSX, one button that works in the browser, a JSON feed and a signed webhook.</p>
      <Example name="notes" open="tp/schema.ts" />
      <tp-play example="full-site" hint="The same app as it is written today. Change a page, build it here, and open the site in WordPress." open="" />
      <div className="scroll"><table>
      <tr><th>From these files you get</th><th>Without writing it</th></tr>
      <tr><td><code>/</code>, <code>/notes</code>, <code>/notes/&lt;slug&gt;</code>, <code>/about</code>, a 404 page</td><td>routing, titles, canonical URLs, the page cache and its purges</td></tr>
      <tr><td>Notes in the WordPress editor</td><td>drafts, revisions, scheduling, staged versions, the admin screens</td></tr>
      <tr><td><code>GET /notes</code>, <code>{"GET /notes/{id}"}</code>, <code>POST /notes</code>, <code>PATCH</code> and <code>DELETE</code>, the same for <code>cheers</code></td><td>the API under <code>/__tp/api/v1</code>, its OpenAPI document and the typed client</td></tr>
      <tr><td><code>{"tp.cheer({ noteId })"}</code></td><td>input checking from the parameter type, a rate limit, one transaction</td></tr>
      <tr><td><code>deskNotes</code> hidden from visitors</td><td>the field is absent from pages, the API, search and agent tools alike</td></tr>
      <tr><td>One agent tool per operation</td><td>the MCP endpoint and its scoped credentials</td></tr>
      </table></div>
      <h3>An app with its own tables, and a React front end</h3>
      <p>A pantry: SQL tables, handlers that run inside every write, a background job, a weekly schedule, and a React app that uses the backend through the one client. The whole backend is two files, because names come from exports and not from file paths.</p>
      <Example name="pantry" open="tp/index.ts" />
      <tp-play example="pantry" hint="The same backend as it is written today. Add a field to a table and a migration appears." />
      <div className="scroll"><table>
      <tr><th>What happens when the React app calls <code>consume</code></th><th>Where</th></tr>
      <tr><td>1. The client posts to the function's endpoint with the signed-in user's session</td><td>browser</td></tr>
      <tr><td>2. The role is checked against <code>access: "editor"</code>, and the input against the parameter type</td><td>PHP</td></tr>
      <tr><td>3. A transaction starts. <code>items.update()</code> runs the <code>afterUpdate</code> handler</td><td>PHP</td></tr>
      <tr><td>4. The handler sees the quantity is low, adds a shopping-list row and queues <code>notifyLowStock</code> in the same transaction</td><td>PHP</td></tr>
      <tr><td>5. The transaction commits. Only now can the job run</td><td>database</td></tr>
      <tr><td>6. Every open read of <code>items</code> and <code>expiringSoon</code> refreshes</td><td>browser</td></tr>
      <tr><td>7. Action Scheduler runs the job, and retries it twice if it throws</td><td>PHP</td></tr>
      </table></div>
      <h3>Content as files, and an Astro site in front</h3>
      <p>Plants kept as Markdown files in git. Editors change the same plants in the WordPress editor. A separate Astro project builds the public site from them.</p>
      <Example name="garden" open="cms/tp/schema.ts" />
      <p className="cap">The Astro site above is a separate project with its own build, so it cannot be built here. Its TypedPress half can; that is what an Astro front end reads from.</p>
      <h3>A blog in two languages</h3>
      <p>Posts with translations, authors, moderated comments, member accounts, image sizes, private files and signed webhooks. One file.</p>
      <tp-play example="blog" hint="Edit the blog and build it here. It opens in the WordPress editor." />
      <h3>A reading list in 94 lines</h3>
      <p>Books are WordPress posts, reads are a SQL table, and each reader sees only their own. It also serves one HTML route and uses two npm packages on the server.</p>
      <tp-play example="reading-list" hint="Edit the reading list and build it here." />
      <p className="cap">The first two projects also use spellings that are decided and not built yet: <code>.on("event", fn)</code> and <code>@typedpress/client</code>. The same apps run today under the spellings in section <Ref to="rename" />.</p>
    </>
  );
}
