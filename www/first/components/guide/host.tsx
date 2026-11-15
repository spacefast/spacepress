import { Section, Code, Decided, Proposed } from "../Guide";

export function Host() {
  return (
    <>
      <Section id="host" />
      <p><Decided /> TypedPress ships as one WordPress plugin and nothing else. Any WordPress site that meets the requirements can take an app, and every host is treated the same way, Spacefast included. The steps below are built on a branch that is not merged yet.</p>
      <Code lang="sh">{`typedpress plugin                          # writes the plugin as a zip
# in the WordPress admin: Plugins, Add Plugin, Upload Plugin, activate
typedpress login https://example.com       # approve the command line in the browser
typedpress push                            # compile, upload, show the plan, go live
`}</Code>
      <div className="scroll"><table>
      <tr><th>Step</th><th>What happens</th></tr>
      <tr><td>Activate the plugin</td><td>it installs and activates the plugins it depends on, each at a pinned version and checked against a pinned SHA-256. There is no setup screen to click through</td></tr>
      <tr><td><code>typedpress login &lt;url&gt;</code></td><td>opens WordPress's own Authorize Application screen; the site gives the command line an application password, kept on your machine</td></tr>
      <tr><td><code>typedpress push</code></td><td>compiles on your machine, uploads the build, prints what installing it would change (tables, each migration, pages, URL rules), then makes it live. <code>--dry-run</code> stops before installing</td></tr>
      <tr><td>A build that would lose rows</td><td>is not installed, and the live build keeps serving</td></tr>
      <tr><td>Going back</td><td>every push is a version. <b>Make live</b> on an earlier one switches the site to that build's code. It does not undo database migrations; that comes later</td></tr>
      <tr><td><code>typedpress logout &lt;url&gt;</code></td><td>forgets the credential on this machine</td></tr>
      </table></div>
      <div className="scroll"><table>
      <tr><th>Rule</th><th>Today</th></tr>
      <tr><td>Apps per site</td><td>one. On a WordPress network (multisite), one app per site of the network, each with its own builds, history and tables</td></tr>
      <tr><td>Who may deploy</td><td>administrators; on a network, only its super admins. An agent credential cannot deploy</td></tr>
      <tr><td>What a deploy sends</td><td>a build compiled on your machine. A site compiling uploaded sources itself is not built</td></tr>
      <tr><td>Secrets and settings</td><td>set on the site in <code>wp-config.php</code>; nothing else of the server's environment reaches the app</td></tr>
      <tr><td>Mail and background work</td><td>mail leaves through WordPress's mailer, so an SMTP plugin applies; jobs need WP-Cron or a real cron to reach the site</td></tr>
      <tr><td>Users</td><td>WordPress is the user store</td></tr>
      <tr><td>Co-editing</td><td>collections are WordPress post types, so WordPress's real-time collaboration covers them</td></tr>
      <tr><td>Starters</td><td><Decided /> TypedPress ships its own starters instead of supporting general WordPress themes. Tailwind is the standard: <code>typedpress add tailwind</code></td></tr>
      <tr><td>Previews</td><td><Decided /> a preview never changes the live database. <Proposed /> each preview gets its own SQLite database, deleted with the preview</td></tr>
      </table></div>
    </>
  );
}
