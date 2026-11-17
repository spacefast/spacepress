import { Section, Code, Built, Decided, Proposed } from "../Guide";

export function Rules() {
  return (
    <>
      <Section id="rules" />
      <p>A TypedPress site is a WordPress site that TypedPress manages. That keeps what runs on it known.</p>
      <div className="scroll"><table>
      <tr><th>Rule</th><th>Works today</th><th>Decided or proposed</th></tr>
      <tr><td>Installing plugins or themes from the admin, and the file editors</td><td>refused</td><td>the same</td></tr>
      <tr><td>Extra plugins in the config</td><td>allowed, pinned by version and checksum</td><td><Decided /> a build error unless <code>dangerouslyEnablePlugins: true</code></td></tr>
      <tr><td>Only listed code runs (<code>sealed</code>)</td><td>opt-in</td><td><Decided /> the default</td></tr>
      <tr><td>Plugins TypedPress pins itself</td><td>Secure Custom Fields, Action Scheduler, MCP Adapter</td><td>the same</td></tr>
      <tr><td>Installing on a site that already has content</td><td>no check</td><td><Proposed /> a warning that lists what was found</td></tr>
      </table></div>
      <Code file="typedpress.config.ts">{`export default defineConfig({
  name: "my-site",
  dangerouslyEnablePlugins: true,          // without this, "plugins" is a build error
  plugins: { "classic-editor": "1.6.7" },
});`}</Code>
      <p className="cap">A plugin you add yourself is your own responsibility.</p>
      <h3>Search engines: with a plugin or without <Decided /></h3>
      <p>Pages put their metadata into WordPress's own head functions. With no plugin, WordPress prints the tags. With an SEO plugin, the plugin receives the same values and prints one set.</p>
      <div className="scroll"><table>
      <tr><th>Thing</th><th>Without a plugin</th><th>With an SEO plugin</th><th>Today</th></tr>
      <tr><td>Title, description</td><td>from the page's <code>metadata</code></td><td>the plugin's templates apply; an editor's value wins for that item</td><td>the page prints its own</td></tr>
      <tr><td>Canonical URL</td><td>from <code>metadata</code> or the kind's <code>url</code></td><td>the plugin reads the same value</td><td>through WordPress for static pages</td></tr>
      <tr><td>Robots (noindex)</td><td>WordPress's robots tag</td><td>the same tag</td><td><Built /></td></tr>
      <tr><td>Social cards</td><td>from <code>metadata.openGraph</code></td><td>the plugin's tags, filled from the same values</td><td>the page prints its own</td></tr>
      <tr><td>Sitemap</td><td>WordPress's sitemap, with your pages in it</td><td>the plugin's sitemap gets the pages too</td><td><Built /> for WordPress's</td></tr>
      <tr><td>Redirect when a slug changes</td><td>automatic</td><td>the same</td><td><Built /></td></tr>
      <tr><td>Structured data (JSON-LD)</td><td><Proposed /> basic article and breadcrumb data</td><td>the plugin's</td><td>not built</td></tr>
      </table></div>
      <p className="cap">Plugins to support first: Jetpack, then Yoast.</p>
      <h3>What TypedPress switches off in WordPress <Built /></h3>
      <p>While an app is active, WordPress runs with these settings. Deactivate the app and WordPress behaves as it ships again.</p>
      <div className="scroll"><table>
      <tr><th>Thing</th><th>Effect</th></tr>
      <tr><td>XML-RPC, pingbacks, trackbacks</td><td>closed</td></tr>
      <tr><td>File editors, the Customizer, automatic updates</td><td>off</td></tr>
      <tr><td>Comments</td><td>closed on every kind that does not turn them on</td></tr>
      <tr><td>The list of users</td><td>not shown to the public: no author archives, no user routes</td></tr>
      <tr><td>Sign-in errors</td><td>never reveal which accounts exist</td></tr>
      <tr><td>The schema</td><td>changed in your project and nowhere on the site</td></tr>
      <tr><td>Permalinks</td><td>pretty permalinks, always</td></tr>
      <tr><td>Theme</td><td>a block theme always renders</td></tr>
      </table></div>
    </>
  );
}
