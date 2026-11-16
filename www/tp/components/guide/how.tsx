import { Section, Ref, Source, Tree, Built } from "../Guide";

export function How() {
  return (
    <>
      <Section id="how" />
      <p>You write TypeScript. A compiler turns it into a WordPress plugin once, at build time. After that, WordPress runs the plugin and nothing else: there is no Node process, no JavaScript engine and no second database on the server.</p>
      <div className="scroll"><table>
      <tr><th>Step</th><th>What happens</th><th>Where it runs</th></tr>
      <tr><td>1. You write</td><td>kinds, functions, pages and components in <code>tp/</code></td><td>your editor; the TypeScript compiler checks it</td></tr>
      <tr><td>2. <code>typedpress build</code></td><td>the compiler reads every file under <code>tp/</code>, checks that the server code stays inside the subset it can translate, and writes PHP, SQL migrations, an OpenAPI document, typed client files and small browser scripts</td><td>your machine or CI</td></tr>
      <tr><td>3. Deploy</td><td>the plugin is uploaded; pending schema changes are checked against the live rows, then applied</td><td>the site</td></tr>
      <tr><td>4. A request arrives</td><td>WordPress routes it. A page is rendered by the compiled PHP as the person viewing it. An API call runs the compiled function inside one database transaction</td><td>PHP, on the site</td></tr>
      <tr><td>5. An editor saves</td><td>the WordPress editor writes the same rows, through the same access rules and the same handlers</td><td>PHP, on the site</td></tr>
      <tr><td>6. Background work</td><td>jobs and schedules are queued in the same transaction as the write and run after it commits</td><td>Action Scheduler, the queue WordPress sites already use</td></tr>
      <tr><td>7. In the browser</td><td>pages arrive as HTML. Only <code>"use client"</code> components ship a script, and they run on the WordPress Interactivity API</td><td>the visitor's browser</td></tr>
      </table></div>
      <p>The files below are what the build wrote for the first project in section <Ref to="examples" />. <Built /> This listing and the two files after it are real output from the current compiler.</p>
      <Tree>{`tp/dist/wp-content/plugins/
  typedpress-app-fullsite/  your app, 15 files
    typedpress-app-fullsite.php  the plugin's entry file
    tp/
      app/
        schema.php  the kinds, their fields and access rules
        functions.php  every handler, function, page and component, as PHP
        openapi.json  the API description
        migrations/
          0001_init.sql  written by the build
        client/
          typedpress-client.js  the browser side of live reads and calls
          cheerbutton.e3030df70ef8.js  one "use client" component
        assets/
          global-c5e7e023ed0d8fff.css  your stylesheet, with a content hash
  typedpress-runtime/  the runtime every app shares, PHP only
  typedpress-identity/  sign-in screens, passkeys, guests
  secure-custom-fields/  fields in the WordPress editor
  action-scheduler/  the job queue
  mcp-adapter/  the endpoint agents connect to
  two-factor/  two-step verification
`}</Tree>
      <tp-play example="full-site" hint="Build that project here and read every file the build writes." />
      <p>The <code>cheer</code> function of that project, as the compiler wrote it:</p>
      <Source path="_built/functions.php" as="typedpress-app-fullsite/tp/app/functions.php" note="real output, lines 26 to 43" />
      <p>And the table for <code>cheers</code>:</p>
      <Source path="_built/0001_init.sql" as="typedpress-app-fullsite/tp/app/migrations/0001_init.sql" note="real output, first statement" />
      <ul>
        <li><b>What the compiler refuses.</b> Server code that it cannot translate fails the build at the file, line and column, with the fix. It never ships code that would behave differently in PHP.</li>
        <li><b>What stays TypeScript.</b> Types. The same types reach the browser client, so a call such as <code>{"tp.cheer({ noteId })"}</code> is checked against the function's own parameter.</li>
        <li><b>What WordPress supplies.</b> Storage, users and roles, the editor, revisions, the media library, the REST API, the cron and job queue, the page cache and the plugin system.</li>
      </ul>
    </>
  );
}
