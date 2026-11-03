# A native Zero agent notebook

Run real MCP calls against WordPress, then see the same content in its editor and
on a public page. This adapts EmDash's official MCP smoke example and agent
workflow to Zero's core WordPress Abilities and MCP Adapter. Source mapping and
the boundaries of this adaptation are in [UPSTREAM.md](UPSTREAM.md).

From the repository root, with Node.js 22+ and the Zero binary built:

```sh
npm --prefix examples/emdash/agents ci
npm --prefix examples/emdash/agents exec -- playwright install chromium
node --test examples/emdash/agents/acceptance.test.mjs
```

Set `ZERO_BIN=/absolute/path/to/zero` to select another build. The test creates a
unique project under `/tmp`, chooses a free port, and uses `zero dev` with native
Studio. Its dev PATH contains neither Docker nor host PHP. It creates its own
users and application passwords, performs HTTP MCP initialization, lists and
calls named tools, edits the same article through WordPress REST and SCF,
publishes through MCP, and verifies anonymous public reads. It also proves field
masking, row filtering, permission failures, input errors, settings updates and
the stored effect of an Action Scheduler job. Chromium renders the live public
page at desktop/mobile sizes and checks that classic plugins/settings remain
usable. Credentials are never written to
the evidence file. The printed `/tmp/zero-emdash-agents-*/evidence.json` survives;
the test stops and unregisters only its own Studio site and removes its project.
Desktop/mobile screenshots remain alongside the JSON evidence.
If cleanup fails, the test fails and retains the project for inspection; its
evidence identifies the exact site and failed cleanup step. The tracked
`admin` / `zero-test-admin` login is intentional, applies only to disposable local
test sites, and must never be reused for personal or deployed accounts.

For an interactive notebook, copy this example into a fresh directory, then run:

```sh
target/debug/zero dev /absolute/path/to/notebook --port 8789 --no-watch
target/debug/zero dev status /absolute/path/to/notebook
```

Use a free port; keep this project separate from existing sites. Open the URL
printed by Zero plus `/wp-content/plugins/zero-app-agents/public/index.html`.
The page starts empty. Published articles appear as soon as you refresh. Full
WordPress admin remains at `/wp-admin/`, including plugins and settings; the
optional Zero admin is also installed. Use the dev login printed by Zero rather
than changing an existing site's credentials.

Create a separate editor for your agent and give that account an application
password through **Users → Profile → Application Passwords**, or the native CLI:

```sh
target/debug/zero dev wp /absolute/path/to/notebook -- user create agent agent@example.test --role=editor
target/debug/zero dev wp /absolute/path/to/notebook -- user application-password create agent notebook-agent --porcelain
```

Keep the password in your MCP client's secret storage. The endpoint is
`http://localhost:8789/wp-json/mcp/zero-agents`, authenticated with WordPress HTTP
Basic application-password authentication. Local Studio permits application
passwords over loopback HTTP; deployed sites must use HTTPS. Follow
[AGENT_GUIDE.md](AGENT_GUIDE.md) for actual tool names and a copyable protocol
command. No AI service key or generated answer is needed to qualify transport.

Stop only this project when finished:

```sh
target/debug/zero dev stop /absolute/path/to/notebook
npx --yes wp-studio@2.1.1 delete --path /absolute/path/to/notebook/.zero/dev/wordpress --no-files
```

The second command unregisters the disposable Studio site. It leaves its files
available for inspection; delete the copied notebook yourself when you no longer
need its data.
