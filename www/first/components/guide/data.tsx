import { Section, Ref, Code, Source, Diff, Built, Decided } from "../Guide";

export function Data() {
  return (
    <>
      <Section id="data" />
      <p><Built /> A <b>kind</b> is one sort of thing your app stores. There are six, and each always stores in the same place.</p>
      <div className="scroll"><table>
      <tr><th>You write</th><th>Use it for</th><th>WordPress stores it as</th></tr>
      <tr><td><code>collection()</code></td><td>what people write and publish: posts, pages, products</td><td>a post type with a field group, drafts and revisions</td></tr>
      <tr><td><code>table()</code></td><td>rows your app filters, sorts, counts and joins</td><td>its own SQL table with typed columns and foreign keys</td></tr>
      <tr><td><code>taxonomy()</code></td><td>topics, tags, categories</td><td>a WordPress taxonomy with term fields</td></tr>
      <tr><td><code>global()</code></td><td>one record of site settings</td><td>a registered setting</td></tr>
      <tr><td><code>files()</code></td><td>private files with signed download links</td><td>a file bucket; files never get a public URL</td></tr>
      <tr><td><code>wp.users.extend()</code></td><td>your own fields on users</td><td>WordPress users and user meta; no second user table. <Decided /> name; written <code>userProjection()</code> today</td></tr>
      </table></div>
      <Code file="tp/schema.ts">{`import { collection, table, taxonomy, global, files, file,
         text, richText, integer, select, ref, media } from "typedpress";

export const authors = collection({
  name: text().max(80),
  avatar: media({ accept: "image" }).optional(),
});

export const posts = collection({
  title: text().max(200),
  body: richText(),
  writer: ref(authors),
  views: integer().default(0),
}, {
  url: "/blog/:slug",
  comments: true,
  access: { read: "anyone", create: "author", update: "author", delete: "editor" },
});

export const topics = taxonomy({ color: text().optional() }, { url: "/topics/:slug", on: [posts] });

export const likes = table({ post: ref(posts), count: integer().default(0) });

export const settings = global({ tagline: text().default("Notes from the field") });

export const decks = files({ accept: ["application/pdf"], maxBytes: 20_000_000, access: { read: "owner" } });`}</Code>
      <h3>Options on a kind</h3>
      <div className="scroll"><table>
      <tr><th>Option</th><th>What it does</th></tr>
      <tr><td><code>url: "/blog/:slug"</code></td><td>the item's address; one pattern reads incoming URLs and builds links. <code>:path</code> is a whole parent chain</td></tr>
      <tr><td><code>access</code></td><td>who may read, create, update and delete (below). Default: anyone reads, editors write</td></tr>
      <tr><td><code>title</code>, <code>content</code></td><td>which field is the WordPress title and which is the body</td></tr>
      <tr><td><code>drafts</code>, <code>revisions</code>, <code>staged</code></td><td>on for collections; a table may turn drafts and revisions on</td></tr>
      <tr><td><code>comments: true</code> or <code>{"{ guests, moderation, threaded, closeAfterDays }"}</code></td><td>WordPress comments on this kind</td></tr>
      <tr><td><code>hierarchical: true</code></td><td>items have a parent and an order, as WordPress Pages do</td></tr>
      <tr><td><code>sync: "content/posts/*.md"</code></td><td>keep the items as files too (section <Ref to="files" />)</td></tr>
      <tr><td><code>{"api: { list, get, create, update, delete }"}</code></td><td>switch single API operations off</td></tr>
      <tr><td><code>agents: false</code></td><td>keep this kind out of agent tools</td></tr>
      <tr><td><code>label</code>, <code>storageName</code>, <code>was</code>, <code>existingTable</code></td><td>the admin label; the stored name; a rename that keeps rows; a SQL table that already exists</td></tr>
      <tr><td><code>{"check: (row) => null | { field: \"message\" }"}</code></td><td><Decided /> a rule across several fields, run on every write and shown on the fields in the editor</td></tr>
      </table></div>
      <Code lang="ts">{`// users: your own fields on WordPress users. email and name are already there.
// Decided spelling; today this is userProjection() under a name you pick.
import { wp } from "typedpress";

export const users = wp.users.extend({
  plan: select(["free", "pro"]).default("free"),
  bio: text().max(500).optional(),
}, { guests: true });

// a compound index on a table
export const votes = table({ post: ref(posts), voter: ref(users) }).index(["post", "voter"], { unique: true });

// a docs section: a whole folder tree of Markdown
export const docs = collection({ title: text(), content: richText().optional() },
  { hierarchical: true, url: "/docs/:path", sync: "content/docs/**/*.md" });`}</Code>
      <h3>Field types</h3>
      <div className="scroll"><table>
      <tr><th>Field</th><th>Holds</th></tr>
      <tr><td><code>text()</code>, <code>{"text({ multiline: true })"}</code></td><td>a string</td></tr>
      <tr><td><code>richText()</code></td><td>formatted content, edited in the WordPress editor</td></tr>
      <tr><td><code>integer()</code>, <code>number()</code>, <code>boolean()</code></td><td>numbers and true or false</td></tr>
      <tr><td><code>date()</code>, <code>timestamp()</code></td><td>a calendar day, or a moment in UTC</td></tr>
      <tr><td><code>select(["a", "b"])</code></td><td>one of a fixed list; <code>.many()</code> for several</td></tr>
      <tr><td><code>email()</code>, <code>url()</code>, <code>{"slug({ source })"}</code></td><td>validated strings; a slug is unique and made from another field</td></tr>
      <tr><td><code>json&lt;T&gt;()</code></td><td>any JSON value, typed as <code>T</code></td></tr>
      <tr><td><code>media()</code>, <code>file(bucket)</code></td><td>an item in the media library, or a private file</td></tr>
      <tr><td><code>ref(kind)</code>, <code>ref(kind).many()</code></td><td>a link to one row of another kind, or an ordered list of them</td></tr>
      <tr><td><code>terms(taxonomy)</code></td><td>the terms an item carries</td></tr>
      <tr><td><code>group()</code>, <code>repeater()</code>, <code>blocks()</code></td><td>nested fields: one set, a list of sets, or a list of different layouts</td></tr>
      </table></div>
      <p>Fields are required unless you say otherwise. Add rules by chaining:</p>
      <div className="scroll"><table>
      <tr><th>Modifier</th><th>What it does</th></tr>
      <tr><td><code>.optional()</code>, <code>.default(v)</code>, <code>.defaultNow()</code></td><td>allow it to be left out</td></tr>
      <tr><td><code>.unique()</code>, <code>.min(n)</code>, <code>.max(n)</code>, <code>.pattern(/re/)</code></td><td>checks on every write</td></tr>
      <tr><td><code>.validate((value) =&gt; true | "message")</code></td><td>your own check, compiled to PHP</td></tr>
      <tr><td><code>{".access({ read, create, update })"}</code></td><td>who may see or write this one field; a hidden field is absent, not empty</td></tr>
      <tr><td><code>{".ui({ label, help, placeholder, width })"}</code>, <code>{".showIf({ … })"}</code></td><td>how the field looks in the editor, and when it shows</td></tr>
      <tr><td><code>.localized()</code></td><td>one value per language</td></tr>
      <tr><td><code>.onDelete("cascade" | "restrict" | "setNull")</code>, <code>.reverse("name")</code></td><td>on a <code>ref()</code>: what a delete does, and the name of the list on the other side</td></tr>
      <tr><td><code>.was("oldName")</code></td><td>a rename that keeps the stored values</td></tr>
      </table></div>
      <h3>Access rules</h3>
      <p>Each of <code>read</code>, <code>create</code>, <code>update</code> and <code>delete</code> takes one of these:</p>
      <div className="scroll"><table>
      <tr><th>Value</th><th>Meaning</th></tr>
      <tr><td><code>"anyone"</code></td><td>everyone, signed in or not</td></tr>
      <tr><td><code>"authenticated"</code></td><td>anyone signed in, guests included</td></tr>
      <tr><td><code>"guest"</code> &lt; <code>"subscriber"</code> &lt; <code>"author"</code> &lt; <code>"editor"</code> &lt; <code>"admin"</code></td><td>that role or a higher one</td></tr>
      <tr><td><code>"self"</code>, <code>"owner"</code></td><td>the signed-in user's own row, or the uploader of a file</td></tr>
      <tr><td><code>(ctx) =&gt; boolean | filter</code></td><td>your own rule; a returned filter narrows what the user can read or change</td></tr>
      </table></div>
      <p className="cap">These rules are the only gate, on every way into the data: the TypedPress API, WordPress's own REST API, the admin, the editor and agent tools.</p>
      <h3>When the schema changes</h3>
      <p><Built /> You never write a migration. The build compares the schema with the last build and writes the SQL. At deploy, every pending change is checked against the live rows before any of them runs.</p>
      <div className="scroll"><table>
      <tr><th>Change</th><th>Result</th></tr>
      <tr><td>a new kind, a new optional field, a field with a default, a new index</td><td>applies</td></tr>
      <tr><td>a field becomes required and has a default</td><td>rows without a value get the default, then it applies</td></tr>
      <tr><td>a field becomes required, no default, and rows lack it</td><td>refused, with the row count</td></tr>
      <tr><td>a kind or field that holds rows is removed</td><td>refused, with the row count, until the deploy names it explicitly</td></tr>
      <tr><td>a rename</td><td><code>.was("oldName")</code> keeps the rows</td></tr>
      </table></div>
      <p>One field added to the <code>cheers</code> table of the first project in section <Ref to="examples" />:</p>
      <Diff old="_built/schema.before.ts" new="_built/schema.after.ts" oldName="tp/schema.ts" newName="tp/schema.ts" />
      <tp-play example="tasks" hint="Try it: add a field to the table and the build writes the migration." />
      <p>The next build writes the migration. Nobody types it. This one is real output: the same field was added to the same table in the code as it is today, which is why the table name still says <code>first</code>.</p>
      <Source path="_built/0002_update.sql" as="tp/_generated/migrations/0002_update.sql" note="real output" />
      <ul>
        <li>Indexes are added for you: for unique fields, references, and every field a compiled <code>where</code> or <code>orderBy</code> names.</li>
        <li><Decided /> <code>{"export const backfill = migration(async () => { … })"}</code> runs your own data change once per site, in batches; a deploy waits for it.</li>
      </ul>
    </>
  );
}
