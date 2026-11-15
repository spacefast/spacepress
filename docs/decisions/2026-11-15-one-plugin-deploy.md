# First deploys to any WordPress through one plugin

Date: 2026-11-15. Status: accepted and built.

## Ruling

"I want to make sure First is built as a plugin and nothing else." One WordPress plugin, a setup
screen, `first login <url>`, and a push from the command line. A host gets First the way any
WordPress does: by installing the plugin. First adds nothing host-specific for this.

## What was built

The plugin (`runtime/first-plugin/`, written by `first plugin`) is a host in the sense of
[the host contract](../host-contract.md): it keeps a [build store](2026-11-07-build-store.md) on
the site, mounts one build per request with `First\Loader\Loader::load`, and installs a build only
through `Loader::initialize` ([install is explicit](2026-11-14-install-is-explicit.md)). The runtime
is unchanged. This is the "plain WordPress" mode that decision left for later, and it decides the
half that one left open for this host: one live build per site, recorded in an option, chosen by a
deployment or by a person on the First screen.

`first push` compiles locally with `compile_to_store` against the snapshot and migrations the site
sends for its last deployment, then uploads the two content-addressed trees.

## Choices

- **A build is trusted by who sent it, and checked by what it is.** Deploying needs a capability
  that already means "may run PHP here" (`activate_plugins`; `manage_network_plugins` on a
  network). The site recomputes each tree's digest and publishes it only under the name the build's
  manifest gives it, so an upload can't replace or add to a tree that exists.
- **The candidate build is loaded only for its own two requests.** `plan` mounts it to inspect,
  where none of the app's code runs; `activate` mounts it to install. A per-deployment token in a
  header selects it, only on that deployment's routes, and the routes still require the
  administrator. Every other request keeps the live build.
- **The store is private by name, not by server config.** It lives in `wp-content` under a random
  directory name that no URL carries, and browser files are copied to a public directory beside it.
  A site that can keep the store outside the web root sets `FIRST_STORE_DIR`.
- **A build that can't mount never takes the site down.** WordPress keeps serving and the First
  screen says why.
- **Sign-in is core's Authorize Application screen.** No new credential type; the password is an
  ordinary application password the owner can revoke.
- **Going back switches code only.** As the host contract says of rollback. The next compile is
  compared with the last deployment, which is what the database holds.

## Recommended options taken without asking

- On multisite, only super admins deploy. The other option (subsite admins deploy sources) depends
  on the site compiling sources, which is not built.
- Builds only, compiled on the developer's machine. The earlier ruling also wanted sources
  compiled on the server or in the browser; neither is built here.

## Not built

Several apps per site, a mount path, server-side or in-browser compilation, collecting old builds,
a closed state while a deployment changes storage, undoing migrations when an earlier build is
made live, and uploading only the files of the app tree that changed.

## Proof

`tests/wp/plugin/run.sh` runs the whole path on a stock WordPress in Docker: the plugin uploaded
and activated through wp-admin (which installs the pinned plugins), `first login` approved through core's
screen, `first push` twice with a migration between, the refusals, and making an earlier build live.
`tests/wp/plugin/multisite-run.sh` does it on a network: First activated for the network, two
sites each given their own app, and each site's tables, builds and history checked to be its own.
