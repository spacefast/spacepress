//! The `first` command line: one table, build commands here, site commands through WP-CLI
//! (docs/decisions/2026-11-07-one-cli.md). The fixture tests use a stand-in `wp` on PATH; the
//! WordPress test serves a real WordPress on SQLite (tests/php/wp.php serve) and checks that
//! `first <site cmd> --site @alias` answers exactly what `wp @alias first <site cmd>` answers.

#![cfg(feature = "cli")]

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};

fn first() -> Command {
    Command::new(env!("CARGO_BIN_EXE_first"))
}

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// A directory with an executable `wp` that prints its arguments and stdin as JSON, then exits 7.
fn fake_wp() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let script = dir.path().join("wp");
    std::fs::write(
        &script,
        "#!/usr/bin/env php\n<?php echo json_encode(['args' => array_slice($argv, 1), 'stdin' => stream_get_contents(STDIN), 'cwd' => getcwd()]), \"\\n\"; exit(7);\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    dir
}

fn with_path(command: &mut Command, dir: &Path) {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let mut paths = vec![dir.to_path_buf()];
    paths.extend(std::env::split_paths(&path));
    command.env("PATH", std::env::join_paths(paths).unwrap());
}

fn run_with_stdin(mut command: Command, stdin: &str) -> Output {
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn help_lists_build_and_site_commands_from_one_table() {
    let table: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("runtime/First/Cli/commands.json")).unwrap()).unwrap();
    let out = first().arg("help").output().unwrap();
    assert!(out.status.success());
    let help = text(&out.stdout);
    let build = help.find("\nBuild").expect("a build group");
    let site = help.find("\nSite").expect("a site group");
    assert!(build < site);
    for (group, start, end) in [("build", build, site), ("site", site, help.len())] {
        for row in table[group].as_array().unwrap() {
            let name = row["name"].as_str().unwrap();
            let line = format!("\n  {name} ");
            let at = help[start..end]
                .find(&line)
                .unwrap_or_else(|| panic!("{name} under {group}:\n{help}"));
            assert!(
                help[start + at..end]
                    .lines()
                    .nth(1)
                    .unwrap()
                    .contains(row["summary"].as_str().unwrap())
            );
        }
    }
    // No command and an unknown command both print the same help on stderr and exit 2.
    let bare = first().output().unwrap();
    assert_eq!(bare.status.code(), Some(2));
    assert_eq!(text(&bare.stderr), help);
    let unknown = first().arg("frobnicate").output().unwrap();
    assert_eq!(unknown.status.code(), Some(2));
    assert_eq!(text(&unknown.stderr), format!("no command frobnicate\n{help}"));
    // `first help <command>` prints that command's arguments.
    let jobs = first().args(["help", "jobs"]).output().unwrap();
    assert_eq!(
        text(&jobs.stdout),
        "usage: first jobs list [--state=s] | run <id> | retry <id> | cancel <id> | maintain | tick [--limit=n] [--budget-ms=ms]\n"
    );
}

#[test]
fn site_commands_forward_arguments_stdin_and_exit_status_to_wp_cli() {
    let wp = fake_wp();
    let mut command = first();
    command.args(["migrate-legacy", "-", "--dry-run", "--site", "@prod", "--space=s1"]);
    with_path(&mut command, wp.path());
    let out = run_with_stdin(command, "<?php return [];");
    assert_eq!(out.status.code(), Some(7), "{}", text(&out.stderr));
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        seen["args"],
        serde_json::json!(["@prod", "first", "migrate-legacy", "-", "--dry-run", "--space=s1"])
    );
    assert_eq!(seen["stdin"], "<?php return [];");

    // `first wp` forwards any WP-CLI command; `--site=@x` works too.
    let mut command = first();
    command.args(["wp", "--site=@staging", "plugin", "list", "--format=json"]);
    with_path(&mut command, wp.path());
    let out = command.output().unwrap();
    assert_eq!(out.status.code(), Some(7));
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        seen["args"],
        serde_json::json!(["@staging", "plugin", "list", "--format=json"])
    );
}

#[test]
fn abilities_pull_runs_here_and_bare_abilities_forwards_to_the_site() {
    // `abilities pull` reads a site over HTTP from this binary; `abilities` alone is `wp first abilities`.
    let wp = fake_wp();
    let mut command = first();
    command.args(["abilities", "--site", "@prod"]);
    with_path(&mut command, wp.path());
    let out = command.output().unwrap();
    assert_eq!(out.status.code(), Some(7));
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(seen["args"], serde_json::json!(["@prod", "first", "abilities"]));
    let mut command = first();
    command.args(["abilities", "pull"]);
    with_path(&mut command, wp.path());
    let out = command.output().unwrap();
    assert!(out.stdout.is_empty(), "pull must not reach WP-CLI");
    assert!(
        text(&out.stderr).starts_with("--site is required"),
        "{}",
        text(&out.stderr)
    );
}

#[test]
fn a_site_url_is_refused_for_wp_cli_commands() {
    let out = first()
        .args(["jobs", "list", "--site", "https://example.test"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(text(&out.stderr).contains("--site @name"), "{}", text(&out.stderr));
    let out = first()
        .args(["wp", "--site", "@a", "--site", "@b", "option", "get"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(text(&out.stderr).contains("--site given twice"));
    let out = first().arg("wp").output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(text(&out.stderr).starts_with("first wp needs WP-CLI arguments\nusage: first wp"));
}

#[test]
fn build_commands_refuse_options_they_do_not_take() {
    let out = first().args(["check", "--port", "9"]).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(text(&out.stderr).starts_with("unknown option --port for first check\nusage: first check"));
}

#[test]
fn sync_takes_its_credential_from_the_environment_only() {
    let out = first()
        .args(["sync", "--site", "http://127.0.0.1:9"])
        .env_remove("FIRST_APP_PASSWORD")
        .env_remove("FIRST_TOKEN")
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(3));
    assert!(text(&out.stderr).starts_with("first sync needs a credential in FIRST_APP_PASSWORD or FIRST_TOKEN"));
    let out = first()
        .args(["sync", "--site", "http://127.0.0.1:9"])
        .env("FIRST_APP_PASSWORD", "a:b")
        .env("FIRST_TOKEN", "t")
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(3));
    assert!(text(&out.stderr).starts_with("set FIRST_APP_PASSWORD or FIRST_TOKEN, not both"));
}

/// The served WordPress, stopped (and its directory removed) on drop.
struct Served(Child);

impl Drop for Served {
    fn drop(&mut self) {
        let _ = Command::new("kill").arg(self.0.id().to_string()).output();
        let _ = self.0.wait();
    }
}

const CONFIG: &str = r#"import { defineConfig, table, text, job, jobs, integer } from "first";
const notes = table({ title: text() }, { access: { read: "anyone" } });
export default defineConfig({
  name: "clilane",
  tables: { notes },
  jobs: { stamp: job({ input: { n: integer().optional() }, handler: async () => {} }) },
});
"#;

/// `first <site cmd> --site @lane` and `wp @lane first <site cmd>` on one real WordPress: the same
/// stdout, the same exit status. Needs PHP 8.2+ with pdo_sqlite and network for the pinned
/// downloads (cached in tests/wp/cache), as tests/sync.rs does.
#[test]
fn site_commands_reach_wp_zero_on_a_real_wordpress_and_answer_the_same_json() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("first.config.ts"), CONFIG).unwrap();
    let built = first()
        .arg("build")
        .arg(project.path())
        .arg("--quiet")
        .output()
        .unwrap();
    assert!(built.status.success(), "build: {}", text(&built.stderr));

    let mut child = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("serve")
        .arg(project.path().join("first/dist/wp-content"))
        .env("FIRST_WP_CLI", "1")
        .env("FIRST_WP_IDENTITY", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("php");
    let mut line = String::new();
    std::io::BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let _served = Served(child);
    let served: serde_json::Value = serde_json::from_str(&line).unwrap_or_else(|_| panic!("serve: {line}"));

    // A real `wp` on PATH (the pinned phar) and a WP-CLI alias for the served site, as an author
    // would configure one in wp-cli.yml.
    let tools = tempfile::tempdir().unwrap();
    let wp = tools.path().join("wp");
    std::fs::write(
        &wp,
        format!(
            "#!/bin/sh\nexec php -d memory_limit=512M -d error_reporting=8191 {} \"$@\"\n",
            served["wpCli"]["phar"].as_str().unwrap()
        ),
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&wp, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let config = tools.path().join("wp-cli.yml");
    std::fs::write(
        &config,
        format!(
            "@lane:\n  path: {}\n  url: {}\n",
            served["wpCli"]["path"].as_str().unwrap(),
            served["url"].as_str().unwrap()
        ),
    )
    .unwrap();
    let env = |command: &mut Command| {
        with_path(command, tools.path());
        command
            .env("WP_CLI_CONFIG_PATH", &config)
            .env("WP_CLI_CACHE_DIR", tools.path().join("cache"))
            .env("WP_CLI_PACKAGES_DIR", tools.path().join("packages"))
            .current_dir(tools.path());
    };
    let direct = |args: &[&str]| {
        let mut command = Command::new(&wp);
        command.arg("@lane").arg("first").args(args);
        env(&mut command);
        command.output().unwrap()
    };
    let forwarded = |args: &[&str]| {
        let mut command = first();
        command.args(args).args(["--site", "@lane"]);
        env(&mut command);
        command.output().unwrap()
    };
    let same = |args: &[&str]| -> serde_json::Value {
        let (a, b) = (direct(args), forwarded(args));
        assert_eq!(
            text(&b.stdout),
            text(&a.stdout),
            "first {args:?} vs wp first {args:?}\n{}",
            text(&b.stderr)
        );
        assert_eq!(b.status.code(), a.status.code(), "{args:?}");
        serde_json::from_slice(&a.stdout).unwrap_or_else(|_| panic!("{args:?}: {}", text(&a.stdout)))
    };

    // Read-only commands answer the same JSON both ways.
    let empty = same(&["jobs", "list"]);
    assert_eq!(empty, serde_json::json!({"data": []}));
    assert_eq!(same(&["find", "notes"]), serde_json::json!({"data": []}));
    // A write through `first`, read back both ways.
    let inserted = forwarded(&["insert", "notes", r#"{"title":"From first"}"#]);
    assert_eq!(inserted.status.code(), Some(0), "{}", text(&inserted.stdout));
    let found = same(&["find", "notes"]);
    assert_eq!(found["data"][0]["title"], "From first");
    // A failing command keeps WP-CLI's exit status and error document.
    let bad = same(&["jobs", "retry", "no-such-job"]);
    assert!(bad["error"]["code"].is_string(), "{bad}");
    // Identity lives under the one `first` namespace.
    let app = same(&[
        "identity",
        "app",
        "add",
        "--name=Lane",
        "--redirect=https://lane.example/cb",
        "--origin=https://lane.example",
        "--id=app_lane",
    ]);
    assert_eq!(app["data"]["id"], "app_lane", "{app}");
    let usage = same(&["identity", "frobnicate"]);
    assert_eq!(usage["error"]["code"], "invalid_command");
    // `first mcp --allow-remote-read`: `query` reads the same site through the same forwarding, by
    // the kind's name, with its filter; a kind the site lacks is the site's own error document.
    let mut mcp = Mcp::start(project.path(), &["--allow-remote-read"], |command| env(command));
    mcp.modern = true;
    forwarded(&["insert", "notes", r#"{"title":"Second"}"#]);
    let read = mcp.ok(
        "query",
        serde_json::json!({ "kind": "notes", "site": "@lane", "where": { "title": "Second" }, "columns": { "title": true } }),
    );
    assert_eq!(read, serde_json::json!({ "data": [{ "title": "Second" }] }));
    let all = mcp.ok(
        "query",
        serde_json::json!({ "kind": "notes", "site": "@lane", "orderBy": { "id": "desc" }, "limit": 1 }),
    );
    assert_eq!(all["data"].as_array().unwrap().len(), 1);
    assert_eq!(all["data"][0]["title"], "Second");
    let unknown = mcp.call("query", serde_json::json!({ "kind": "nope", "site": "@lane" }));
    assert_eq!(unknown["isError"], true);
    assert_eq!(
        unknown["structuredContent"]["error"]["code"], "invalid_query",
        "{unknown}"
    );
    mcp.finish();
    // `first wp` reaches plain WordPress commands.
    let mut command = first();
    command.args(["wp", "--site", "@lane", "option", "get", "blogname"]);
    env(&mut command);
    let blogname = command.output().unwrap();
    assert_eq!(
        text(&blogname.stdout).trim(),
        "First test site",
        "{}",
        text(&blogname.stderr)
    );
}

// ---------------------------------------------------------------------------------------------
// `first mcp`: the real binary driven over stdin and stdout, one JSON-RPC message per line.
// ---------------------------------------------------------------------------------------------

/// What every 2026-07-28 request carries in `params._meta`.
fn modern_meta() -> serde_json::Value {
    serde_json::json!({
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { "name": "cli-test", "version": "1" },
        "io.modelcontextprotocol/clientCapabilities": {},
    })
}

struct Mcp {
    child: Child,
    stdin: Option<std::process::ChildStdin>,
    lines: std::sync::mpsc::Receiver<String>,
    next_id: u64,
    /// Send the per-request metadata of 2026-07-28 instead of opening with `initialize`.
    modern: bool,
}

impl Mcp {
    fn start(project: &Path, flags: &[&str], configure: impl FnOnce(&mut Command)) -> Mcp {
        let mut command = first();
        command.arg("mcp").arg(project).args(flags);
        configure(&mut command);
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (send, lines) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for line in std::io::BufReader::new(stdout).lines() {
                if send.send(line.unwrap()).is_err() {
                    break;
                }
            }
        });
        Mcp {
            stdin: child.stdin.take(),
            child,
            lines,
            next_id: 0,
            modern: false,
        }
    }

    /// A server whose client opened with the `initialize` handshake.
    fn initialized(project: &Path, flags: &[&str]) -> Mcp {
        let mut mcp = Mcp::start(project, flags, |_| {});
        let opened = mcp.result(
            "initialize",
            serde_json::json!({ "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": { "name": "cli-test", "version": "1" } }),
        );
        assert_eq!(opened["protocolVersion"], "2025-11-25");
        mcp.notify("notifications/initialized");
        mcp
    }

    fn write(&mut self, line: &str) {
        let stdin = self.stdin.as_mut().unwrap();
        stdin.write_all(line.as_bytes()).unwrap();
        stdin.write_all(b"\n").unwrap();
        stdin.flush().unwrap();
    }

    fn notify(&mut self, method: &str) {
        self.write(&serde_json::json!({ "jsonrpc": "2.0", "method": method }).to_string());
    }

    /// The next message. Everything the server writes to stdout is one JSON object on one line.
    fn read(&mut self) -> serde_json::Value {
        let line = self
            .lines
            .recv_timeout(std::time::Duration::from_secs(300))
            .expect("the server answers");
        let message: serde_json::Value = serde_json::from_str(&line).unwrap_or_else(|_| panic!("not JSON: {line}"));
        assert_eq!(message["jsonrpc"], "2.0", "{line}");
        message
    }

    fn request(&mut self, method: &str, mut params: serde_json::Value) -> serde_json::Value {
        self.next_id += 1;
        if self.modern {
            params["_meta"] = modern_meta();
        }
        let id = self.next_id;
        self.write(&serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }).to_string());
        let answer = self.read();
        assert_eq!(answer["id"], id, "{answer}");
        answer
    }

    fn result(&mut self, method: &str, params: serde_json::Value) -> serde_json::Value {
        let answer = self.request(method, params);
        assert!(answer.get("error").is_none(), "{method}: {answer}");
        answer["result"].clone()
    }

    /// `tools/call`: the result. A successful one's text content is its structured content as JSON.
    fn call(&mut self, tool: &str, arguments: serde_json::Value) -> serde_json::Value {
        let result = self.result(
            "tools/call",
            serde_json::json!({ "name": tool, "arguments": arguments }),
        );
        assert_eq!(result["content"][0]["type"], "text", "{tool}: {result}");
        if result["isError"] == false {
            let structured = &result["structuredContent"];
            let text: serde_json::Value = serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
            assert_eq!(&text, structured, "{tool}");
        }
        result
    }

    /// A call that ran and succeeded: its structured content.
    fn ok(&mut self, tool: &str, arguments: serde_json::Value) -> serde_json::Value {
        let result = self.call(tool, arguments);
        assert_eq!(result["isError"], false, "{tool}: {result}");
        result["structuredContent"].clone()
    }

    /// A call the tool refused or that failed: what it said.
    fn refused(&mut self, tool: &str, arguments: serde_json::Value) -> String {
        let result = self.call(tool, arguments);
        assert_eq!(result["isError"], true, "{tool}: {result}");
        result["content"][0]["text"].as_str().unwrap().to_string()
    }

    /// Closing stdin is the client's shutdown: the server exits by itself, having written nothing more.
    fn finish(mut self) {
        drop(self.stdin.take());
        assert!(self.child.wait().unwrap().success());
        assert!(self.lines.recv().is_err(), "nothing after the last answer");
    }
}

impl Drop for Mcp {
    fn drop(&mut self) {
        drop(self.stdin.take());
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn agent_kit() -> PathBuf {
    root().join("tests/fixtures/agent-kit")
}

fn tool_names(tools: &serde_json::Value) -> Vec<&str> {
    tools["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| tool["name"].as_str().unwrap())
        .collect()
}

#[test]
fn mcp_opens_with_initialize_and_lists_read_only_tools_unless_writes_are_allowed() {
    let mut mcp = Mcp::start(&agent_kit(), &[], |_| {});
    // A method before the handshake, with no protocol version of its own, is refused and says how to open.
    let early = mcp.request("tools/list", serde_json::json!({}));
    assert_eq!(early["error"]["code"], -32602, "{early}");
    assert_eq!(
        early["error"]["data"]["supported"],
        serde_json::json!(["2026-07-28", "2025-11-25", "2025-06-18"])
    );
    // The server answers the revision the client asked for when it speaks it, otherwise its newest
    // revision that has a handshake.
    let opened = mcp.result(
        "initialize",
        serde_json::json!({ "protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": { "name": "old", "version": "1" } }),
    );
    assert_eq!(opened["protocolVersion"], "2025-11-25");
    assert_eq!(opened["serverInfo"]["name"], "first");
    assert_eq!(opened["serverInfo"]["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(
        opened["capabilities"],
        serde_json::json!({ "tools": {}, "resources": {} })
    );
    assert!(opened["instructions"].as_str().unwrap().contains("schema"));
    mcp.notify("notifications/initialized");
    assert_eq!(mcp.result("ping", serde_json::json!({})), serde_json::json!({}));

    let tools = mcp.result("tools/list", serde_json::json!({}));
    assert_eq!(
        tool_names(&tools),
        [
            "schema",
            "check",
            "docs_search",
            "docs_read",
            "commands",
            "dev_status",
            "query"
        ]
    );
    for tool in tools["tools"].as_array().unwrap() {
        assert_eq!(tool["inputSchema"]["type"], "object", "{tool}");
        assert_eq!(tool["annotations"]["readOnlyHint"], true, "{tool}");
        assert!(!tool["description"].as_str().unwrap().is_empty());
    }
    // Without --allow-remote-read, `query` has no `site` to ask for.
    let query = &tools["tools"][6]["inputSchema"]["properties"];
    assert!(query.get("site").is_none(), "{query}");
    // The legacy revisions carry none of 2026-07-28's result fields.
    assert!(
        tools.get("resultType").is_none() && tools.get("ttlMs").is_none(),
        "{tools}"
    );
    // The lists fit one page: a cursor this server never handed out is invalid.
    let paged = mcp.request("tools/list", serde_json::json!({ "cursor": "2" }));
    assert_eq!(paged["error"]["code"], -32602, "{paged}");
    let unknown = mcp.request("prompts/list", serde_json::json!({}));
    assert_eq!(unknown["error"]["code"], -32601, "{unknown}");
    mcp.finish();

    let mut writable = Mcp::initialized(&agent_kit(), &["--allow-writes", "--allow-remote-read"]);
    let tools = writable.result("tools/list", serde_json::json!({}));
    assert_eq!(
        tool_names(&tools),
        [
            "schema",
            "check",
            "docs_search",
            "docs_read",
            "commands",
            "dev_status",
            "query",
            "run_action",
            "insert",
            "update"
        ]
    );
    assert_eq!(tools["tools"][6]["inputSchema"]["properties"]["site"]["type"], "string");
    for tool in &tools["tools"].as_array().unwrap()[7..] {
        assert_eq!(tool["annotations"]["readOnlyHint"], false, "{tool}");
    }
    writable.finish();

    // An option the command does not take is a usage error, before any protocol.
    let bad = first().args(["mcp", "--allow-everything"]).output().unwrap();
    assert_eq!(bad.status.code(), Some(2));
    assert!(text(&bad.stderr).contains("usage: first mcp [dir] [--allow-remote-read] [--allow-writes]"));
    assert!(bad.stdout.is_empty());
    let help = first().args(["help", "mcp"]).output().unwrap();
    assert_eq!(
        text(&help.stdout),
        "usage: first mcp [dir] [--allow-remote-read] [--allow-writes]\n"
    );
}

#[test]
fn mcp_serves_the_stateless_revision_from_per_request_metadata() {
    let mut mcp = Mcp::start(&agent_kit(), &[], |_| {});
    mcp.modern = true;
    let discovered = mcp.result("server/discover", serde_json::json!({}));
    assert_eq!(discovered["supportedVersions"], serde_json::json!(["2026-07-28"]));
    assert_eq!(
        discovered["capabilities"],
        serde_json::json!({ "tools": {}, "resources": {} })
    );
    assert_eq!(discovered["resultType"], "complete");
    assert_eq!(
        discovered["_meta"]["io.modelcontextprotocol/serverInfo"]["name"],
        "first"
    );
    assert_eq!(discovered["cacheScope"], "public");
    assert!(discovered["ttlMs"].as_u64().is_some());

    // No handshake: any request is answered from its own metadata, with the revision's result fields.
    let tools = mcp.result("tools/list", serde_json::json!({}));
    assert_eq!(tools["resultType"], "complete");
    assert_eq!(tools["cacheScope"], "public");
    assert_eq!(tool_names(&tools).len(), 7);
    let commands = mcp.result("tools/call", serde_json::json!({ "name": "commands", "arguments": {} }));
    assert_eq!(commands["resultType"], "complete");
    assert!(
        commands.get("ttlMs").is_none(),
        "a tool result is not cacheable: {commands}"
    );
    // The handshake's own method is not one of this revision's.
    let handshake = mcp.request("ping", serde_json::json!({}));
    assert_eq!(handshake["error"]["code"], -32601, "{handshake}");
    // A missing resource is Invalid Params in this revision (it was -32002 before).
    let missing = mcp.request(
        "resources/read",
        serde_json::json!({ "uri": "first-docs:///docs/nope.md" }),
    );
    assert_eq!(missing["error"]["code"], -32602, "{missing}");
    assert_eq!(missing["error"]["data"]["uri"], "first-docs:///docs/nope.md");

    // A revision this server does not speak is refused with the ones it does.
    mcp.modern = false;
    let mut meta = modern_meta();
    meta["io.modelcontextprotocol/protocolVersion"] = serde_json::json!("1900-01-01");
    let refused = mcp.request("tools/list", serde_json::json!({ "_meta": meta }));
    assert_eq!(refused["error"]["code"], -32022, "{refused}");
    assert_eq!(
        refused["error"]["data"],
        serde_json::json!({ "supported": ["2026-07-28"], "requested": "1900-01-01" })
    );
    // The required capabilities field is missing: malformed.
    let bare = mcp.request(
        "tools/list",
        serde_json::json!({ "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } }),
    );
    assert_eq!(bare["error"]["code"], -32602, "{bare}");

    // A subscription is acknowledged with the notification types the server honours: none, because
    // nothing it lists changes. The request stays open, so there is no response to it.
    mcp.write(
        &serde_json::json!({ "jsonrpc": "2.0", "id": "listen", "method": "subscriptions/listen",
            "params": { "_meta": modern_meta(), "notifications": { "toolsListChanged": true } } })
        .to_string(),
    );
    let acknowledged = mcp.read();
    assert_eq!(acknowledged["method"], "notifications/subscriptions/acknowledged");
    assert!(acknowledged.get("id").is_none(), "{acknowledged}");
    assert_eq!(
        acknowledged["params"],
        serde_json::json!({ "_meta": { "io.modelcontextprotocol/subscriptionId": "listen" }, "notifications": {} })
    );
    mcp.finish();
}

#[test]
fn mcp_answers_malformed_input_without_stopping() {
    let mut mcp = Mcp::initialized(&agent_kit(), &[]);
    mcp.write("this is not json");
    let parse = mcp.read();
    assert_eq!(parse["error"]["code"], -32700);
    assert!(
        parse.get("id").is_none(),
        "an unreadable id is left out, never null: {parse}"
    );
    mcp.write(r#"[{"jsonrpc":"2.0","id":1,"method":"ping"}]"#);
    assert_eq!(mcp.read()["error"]["code"], -32600);
    mcp.write(r#"{"jsonrpc":"2.0","id":null,"method":"ping"}"#);
    assert_eq!(mcp.read()["error"]["code"], -32600);
    mcp.write(r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":["schema"]}"#);
    let params = mcp.read();
    assert_eq!(
        (&params["id"], &params["error"]["code"]),
        (&serde_json::json!(7), &serde_json::json!(-32602))
    );
    // Notifications, blank lines and a stray response are never answered: the next answer is the ping's.
    mcp.notify("notifications/cancelled");
    mcp.write("");
    mcp.write(r#"{"jsonrpc":"2.0","id":99,"result":{}}"#);
    assert_eq!(mcp.result("ping", serde_json::json!({})), serde_json::json!({}));
    // An unknown tool is a protocol error; a wrong argument is a tool result the model can correct.
    let unknown = mcp.request("tools/call", serde_json::json!({ "name": "deploy", "arguments": {} }));
    assert_eq!(unknown["error"]["code"], -32602, "{unknown}");
    assert_eq!(unknown["error"]["message"], "Unknown tool: deploy");
    assert_eq!(
        mcp.refused("check", serde_json::json!({ "fix": true })),
        "check takes no arguments, and was given `fix`"
    );
    assert_eq!(mcp.refused("docs_search", serde_json::json!({})), "`query` is required");
    mcp.finish();
}

#[test]
fn mcp_schema_describes_the_projects_kinds_actions_jobs_and_routes() {
    let mut mcp = Mcp::initialized(&agent_kit(), &[]);
    let schema = mcp.ok("schema", serde_json::json!({}));
    assert_eq!(schema["name"], "agentkit");
    // Kinds are keyed by the name the author exported; `path` is the name the API and the site commands use.
    let list = &schema["kinds"]["shoppingList"];
    assert_eq!(list["type"], "table");
    assert_eq!(list["path"], "shopping_list");
    assert_eq!(
        list["access"],
        serde_json::json!({ "read": "anyone", "create": "editor", "update": "editor", "delete": "admin" })
    );
    assert_eq!(
        list["operations"],
        serde_json::json!(["list", "get", "create", "update", "delete"])
    );
    assert_eq!(
        list["fields"]["name"],
        serde_json::json!({ "type": "text", "required": true })
    );
    assert_eq!(
        list["fields"]["quantity"],
        serde_json::json!({ "type": "integer", "default": 1, "min": 1 })
    );
    assert_eq!(
        list["fields"]["aisle"],
        serde_json::json!({ "type": "select", "values": ["produce", "dairy", "pantry"] })
    );
    assert_eq!(
        list["fields"]["id"],
        serde_json::json!({ "type": "integer", "primaryKey": true, "generated": true })
    );
    // A ref is reported as the author wrote it, with the relation it gives each side.
    let substitutes = &schema["kinds"]["substitutes"];
    assert_eq!(
        substitutes["fields"]["item"],
        serde_json::json!({ "type": "ref", "required": true, "to": "shoppingList", "onDelete": "cascade" })
    );
    assert_eq!(
        substitutes["relations"],
        serde_json::json!({ "item": { "kind": "one", "to": "shoppingList" } })
    );
    assert_eq!(
        list["relations"],
        serde_json::json!({ "substitutes": { "kind": "many", "to": "substitutes" } })
    );
    let articles = &schema["kinds"]["articles"];
    assert_eq!(articles["type"], "collection");
    assert_eq!(articles["access"]["create"], "author");
    assert_eq!(
        articles["fields"]["title"],
        serde_json::json!({ "type": "text", "required": true, "max": 160 })
    );
    assert_eq!(
        articles["fields"]["reviewNote"],
        serde_json::json!({ "type": "text", "access": { "read": "editor" } })
    );
    assert_eq!(articles["drafts"], true);

    let rename = &schema["actions"]["rename"];
    assert_eq!(rename["access"], "editor");
    assert_eq!(rename["endpoint"], "POST /__first/api/v1/actions/rename");
    assert_eq!(rename["ability"], "agentkit/rename");
    assert_eq!(
        rename["input"]["id"],
        serde_json::json!({ "type": "integer", "required": true })
    );
    assert_eq!(rename["output"]["type"], "object");
    assert_eq!(
        schema["jobs"]["clearDone"],
        serde_json::json!({ "input": { "keep": { "type": "integer", "default": 0 } }, "retries": 2, "agents": false })
    );
    assert_eq!(
        schema["routes"],
        serde_json::json!([
            { "pattern": "/api/list", "type": "route", "file": "first/app/api/list/route.ts", "methods": ["GET"], "access": "anyone" },
            { "pattern": "/", "type": "page", "file": "first/app/page.tsx" },
        ])
    );
    assert_eq!(
        schema["roles"],
        serde_json::json!(["guest", "subscriber", "author", "editor", "admin"])
    );
    assert_eq!(schema["endpoints"]["mcp"], "/wp-json/mcp/first-agentkit");
    let abilities: Vec<&str> = schema["abilities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a.as_str().unwrap())
        .collect();
    for ability in [
        "agentkit/shopping-list-list",
        "agentkit/articles-create",
        "agentkit/rename",
    ] {
        assert!(abilities.contains(&ability), "{ability} in {abilities:?}");
    }
    // The job does not opt in to agents, so the site registers no Ability for it.
    assert!(!abilities.iter().any(|a| a.contains("clear-done")), "{abilities:?}");

    // One kind on request; a kind the project lacks names the ones it has.
    let one = mcp.ok("schema", serde_json::json!({ "kind": "articles" }));
    assert_eq!(
        one["kinds"].as_object().unwrap().keys().collect::<Vec<_>>(),
        ["articles"]
    );
    assert!(one.get("actions").is_none());
    assert_eq!(
        mcp.refused("schema", serde_json::json!({ "kind": "recipes" })),
        "no kind recipes; this project's kinds are: articles, shoppingList, substitutes"
    );
    mcp.finish();
}

#[test]
fn mcp_check_returns_the_envelope_first_check_json_prints_and_sees_edits() {
    // On the fixture, the same document `first check --json` writes.
    let printed = first().arg("check").arg(agent_kit()).arg("--json").output().unwrap();
    assert!(printed.status.success(), "{}", text(&printed.stderr));
    let printed: serde_json::Value = serde_json::from_slice(&printed.stdout).unwrap();
    let mut mcp = Mcp::initialized(&agent_kit(), &[]);
    let checked = mcp.ok("check", serde_json::json!({}));
    assert_eq!(checked, printed);
    assert_eq!(checked["schema"], "first-diagnostics");
    assert_eq!(checked["ok"], true);
    mcp.finish();

    // The server compiles the files as they are at each call: an edit shows up without a restart.
    let project = tempfile::tempdir().unwrap();
    let config = project.path().join("first.config.ts");
    std::fs::write(&config, CONFIG).unwrap();
    let mut mcp = Mcp::initialized(project.path(), &[]);
    assert_eq!(mcp.ok("check", serde_json::json!({}))["ok"], true);
    std::fs::write(&config, CONFIG.replace("title: text()", "title: nothing()")).unwrap();
    // A project that does not compile is still a successful call: the diagnostics are the answer.
    let broken = mcp.ok("check", serde_json::json!({}));
    assert_eq!(broken["ok"], false);
    let diagnostic = &broken["diagnostics"][0];
    assert_eq!(diagnostic["location"]["file"], "first.config.ts");
    assert_eq!(diagnostic["location"]["line"], 2);
    assert!(diagnostic["code"].as_str().unwrap().starts_with('F'), "{diagnostic}");
    let printed = first().arg("check").arg(project.path()).arg("--json").output().unwrap();
    assert_eq!(printed.status.code(), Some(1));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&printed.stdout).unwrap(),
        broken
    );
    // No schema until it compiles; the diagnostics come back instead.
    let refused = mcp.call("schema", serde_json::json!({}));
    assert_eq!(refused["isError"], true);
    assert_eq!(refused["structuredContent"], broken);
    std::fs::write(&config, CONFIG).unwrap();
    assert_eq!(mcp.ok("schema", serde_json::json!({}))["name"], "clilane");
    // Checking wrote nothing into the project.
    let written: Vec<_> = std::fs::read_dir(project.path())
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(written, ["first.config.ts"]);
    mcp.finish();
}

#[test]
fn mcp_searches_and_reads_the_documentation_built_into_the_binary() {
    let mut mcp = Mcp::initialized(&agent_kit(), &[]);
    let found = mcp.ok(
        "docs_search",
        serde_json::json!({ "query": "compiler diagnostics envelope", "limit": 5 }),
    );
    let results = found["results"].as_array().unwrap();
    assert!(!results.is_empty() && results.len() <= 5, "{found}");
    let hit = results
        .iter()
        .find(|hit| hit["path"] == "docs/compiler-diagnostics.md")
        .unwrap_or_else(|| panic!("the diagnostics page among {found}"));
    assert_eq!(hit["title"], "Compiler diagnostics");
    assert!(!hit["snippet"].as_str().unwrap().is_empty());
    // Words no page has: no results, not an error.
    let nothing = mcp.ok("docs_search", serde_json::json!({ "query": "zzqqxxyy" }));
    assert_eq!(nothing["results"], serde_json::json!([]));

    // A page as committed, whole, with its outline.
    let on_disk = std::fs::read_to_string(root().join("docs/compiler-diagnostics.md")).unwrap();
    let page = mcp.ok(
        "docs_read",
        serde_json::json!({ "path": "docs/compiler-diagnostics.md" }),
    );
    assert_eq!(page["title"], "Compiler diagnostics");
    assert_eq!(page["text"], on_disk);
    assert!(page.get("truncated").is_none());
    // One section by its heading (in any letter case): that heading first, and only text of the page.
    let section = |mcp: &mut Mcp, path: &str, name: &str, committed: &str| {
        let read = mcp.ok(
            "docs_read",
            serde_json::json!({ "path": path, "section": name.to_uppercase() }),
        );
        let text = read["text"].as_str().unwrap();
        let heading = text.lines().next().unwrap();
        assert_eq!(heading.trim_start_matches('#').trim(), name, "{path}");
        assert!(heading.starts_with('#') && committed.contains(text), "{path} {name}");
        assert!(text.len() < committed.len());
    };
    let last = page["sections"].as_array().unwrap().last().unwrap().as_str().unwrap();
    section(&mut mcp, "docs/compiler-diagnostics.md", last, &on_disk);
    // A long page read whole answers with its opening and its outline, to read one section at a time.
    let listed = mcp.result("resources/list", serde_json::json!({}));
    let resources = listed["resources"].as_array().unwrap();
    let long = resources
        .iter()
        .filter(|page| page["name"].as_str().unwrap().starts_with("docs/"))
        .max_by_key(|page| page["size"].as_u64().unwrap())
        .unwrap()["name"]
        .as_str()
        .unwrap();
    let committed = std::fs::read_to_string(root().join(long)).unwrap();
    let opening = mcp.ok("docs_read", serde_json::json!({ "path": long }));
    assert_eq!(opening["truncated"], true, "{long}");
    let text = opening["text"].as_str().unwrap();
    assert!(
        committed.starts_with(text) && text.len() < committed.len() / 2,
        "{long}"
    );
    let sections = opening["sections"].as_array().unwrap();
    assert!(sections.len() > 3, "{long}: {sections:?}");
    section(
        &mut mcp,
        long,
        sections[sections.len() / 2].as_str().unwrap(),
        &committed,
    );
    assert!(
        mcp.refused("docs_read", serde_json::json!({ "path": "docs/nope.md" }))
            .starts_with("no documentation page docs/nope.md")
    );
    assert!(
        mcp.refused(
            "docs_read",
            serde_json::json!({ "path": "docs/agents.md", "section": "No such heading" })
        )
        .starts_with("docs/agents.md has no section \"No such heading\"; its sections are: ")
    );

    // The same pages are the server's resources. Design proposals are not documentation of what ships.
    let uris: Vec<&str> = resources.iter().map(|r| r["uri"].as_str().unwrap()).collect();
    assert!(uris.contains(&"first-docs:///docs/agents.md"), "{uris:?}");
    assert!(
        uris.contains(&"first-docs:///docs-site/docs/getting-started.mdx"),
        "{uris:?}"
    );
    // The site's copy of a docs/ page is not a second page to search.
    assert!(!uris.contains(&"first-docs:///docs-site/docs/agents.mdx"), "{uris:?}");
    assert!(
        !uris
            .iter()
            .any(|uri| uri.contains("/design-") || uri.contains("/spec/")),
        "{uris:?}"
    );
    let started = resources
        .iter()
        .find(|r| r["name"] == "docs-site/docs/getting-started.mdx")
        .unwrap();
    assert_eq!(started["title"], "Get started");
    assert_eq!(started["mimeType"], "text/markdown");
    assert!(started["description"].as_str().unwrap().contains("First app"));
    let read = mcp.result(
        "resources/read",
        serde_json::json!({ "uri": "first-docs:///docs/compiler-diagnostics.md" }),
    );
    assert_eq!(
        read["contents"],
        serde_json::json!([{ "uri": "first-docs:///docs/compiler-diagnostics.md", "mimeType": "text/markdown", "text": on_disk }])
    );
    // Through 2025-11-25 a missing resource is -32002.
    let missing = mcp.request(
        "resources/read",
        serde_json::json!({ "uri": "first-docs:///docs/nope.md" }),
    );
    assert_eq!(missing["error"]["code"], -32002, "{missing}");
    assert_eq!(
        mcp.result("resources/templates/list", serde_json::json!({}))["resourceTemplates"],
        serde_json::json!([])
    );
    mcp.finish();
}

#[test]
fn mcp_commands_is_the_command_table_and_dev_status_reports_a_project_with_no_site() {
    let table: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("runtime/First/Cli/commands.json")).unwrap()).unwrap();
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("first.config.ts"), CONFIG).unwrap();
    let mut mcp = Mcp::initialized(project.path(), &["--allow-writes"]);
    assert_eq!(mcp.ok("commands", serde_json::json!({})), table);
    // The table lists the server's own command.
    assert!(
        table["build"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["name"] == "mcp")
    );

    // No dev site was ever started here: the tools say so and start nothing.
    assert_eq!(
        mcp.ok("dev_status", serde_json::json!({})),
        serde_json::json!({ "state": "none", "start": "first dev" })
    );
    // `first dev status --json` is the same report, and starts nothing either.
    let status = first()
        .args(["dev", "status", "--json"])
        .arg(project.path())
        .output()
        .unwrap();
    assert!(status.status.success(), "{}", text(&status.stderr));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&status.stdout).unwrap(),
        serde_json::json!({ "state": "none", "start": "first dev" })
    );
    // The flags belong to the commands that take them.
    for misplaced in [
        &["dev", "--json"][..],
        &["dev", "stop", "--detach"],
        &["build", "--detach"],
    ] {
        let out = first().args(misplaced).arg(project.path()).output().unwrap();
        assert_eq!(out.status.code(), Some(2), "{misplaced:?}: {}", text(&out.stderr));
        assert!(
            text(&out.stderr).starts_with("unknown option "),
            "{}",
            text(&out.stderr)
        );
    }
    let no_site =
        "this project has no dev site yet; start one with `first dev` (`first dev --no-watch` starts it and returns)";
    assert_eq!(mcp.refused("query", serde_json::json!({ "kind": "notes" })), no_site);
    assert_eq!(
        mcp.refused(
            "insert",
            serde_json::json!({ "kind": "notes", "rows": [{ "title": "x" }] })
        ),
        no_site
    );
    assert!(!project.path().join(".first").exists());
    mcp.finish();
}

#[test]
fn mcp_refuses_writes_and_other_sites_unless_its_flags_allow_them() {
    // A stand-in `wp` records anything that reaches a site; nothing may.
    let wp = fake_wp();
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("first.config.ts"), CONFIG).unwrap();
    let mut mcp = Mcp::start(project.path(), &[], |command| with_path(command, wp.path()));
    mcp.modern = true;
    for (tool, arguments) in [
        ("run_action", serde_json::json!({ "name": "rename", "input": {} })),
        (
            "insert",
            serde_json::json!({ "kind": "notes", "rows": [{ "title": "x" }] }),
        ),
        (
            "update",
            serde_json::json!({ "kind": "notes", "where": { "id": 1 }, "set": { "title": "y" } }),
        ),
    ] {
        assert_eq!(
            mcp.refused(tool, arguments),
            format!(
                "{tool} writes to the dev site, and this server was started read-only. Start it as `first mcp --allow-writes` to allow writes to this project's dev site."
            )
        );
    }
    assert_eq!(
        mcp.refused("query", serde_json::json!({ "kind": "notes", "site": "@prod" })),
        "query reads this project's dev site only, and was asked for @prod. Start the server as `first mcp --allow-remote-read` to read another site."
    );
    mcp.finish();

    // --allow-writes opens the dev site to writes, never another site.
    let mut mcp = Mcp::start(project.path(), &["--allow-writes"], |command| {
        with_path(command, wp.path())
    });
    mcp.modern = true;
    assert_eq!(
        mcp.refused(
            "insert",
            serde_json::json!({ "kind": "notes", "rows": [{ "title": "x" }], "site": "@prod" })
        ),
        "insert writes to this project's dev site and no other; it takes no `site`"
    );
    assert!(
        mcp.refused("query", serde_json::json!({ "kind": "notes", "site": "@prod" }))
            .starts_with("query reads this project's dev site only")
    );
    mcp.finish();

    // --allow-remote-read forwards a read to the named site, as `first find --site` does.
    let mut mcp = Mcp::start(project.path(), &["--allow-remote-read"], |command| {
        with_path(command, wp.path())
    });
    mcp.modern = true;
    let seen = mcp.call(
        "query",
        serde_json::json!({ "kind": "notes", "site": "@prod", "where": { "title": "x" }, "limit": 3 }),
    );
    // The stand-in exits 7 after printing what it was given, so the call reports an error with it.
    assert_eq!(seen["isError"], true, "{seen}");
    assert_eq!(
        seen["structuredContent"]["args"],
        serde_json::json!([
            "@prod",
            "first",
            "find",
            "notes",
            r#"{"where":{"title":"x"},"limit":3}"#
        ])
    );
    // A name is never an option of the command it is passed to.
    assert_eq!(
        mcp.refused(
            "query",
            serde_json::json!({ "kind": "--exec=phpinfo();", "site": "@prod" })
        ),
        "`kind` is a name as `schema` lists it, not \"--exec=phpinfo();\""
    );
    assert_eq!(
        mcp.refused(
            "query",
            serde_json::json!({ "kind": "notes", "site": "--path=/elsewhere" })
        ),
        "`site` is a project directory, a deployment workspace or a WP-CLI @alias"
    );
    assert_eq!(
        mcp.refused(
            "query",
            serde_json::json!({ "kind": "notes", "site": "@prod", "wher": {} })
        ),
        "query takes kind, where, orderBy, limit, offset, columns, with, site, not `wher`"
    );
    assert!(
        mcp.refused("run_action", serde_json::json!({ "name": "rename" }))
            .starts_with("run_action writes to the dev site")
    );
    mcp.finish();
}

// ---------------------------------------------------------------------------------------------
// `first init`: AGENTS.md, .mcp.json and the agent skills, written from the project's config.
// ---------------------------------------------------------------------------------------------

fn copy_tree(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// Every file under `dir`, relative to it, sorted.
fn files_under(dir: &Path) -> Vec<String> {
    fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(&path, root, out);
            } else {
                out.push(path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"));
            }
        }
    }
    let mut out = Vec::new();
    if dir.is_dir() {
        walk(dir, dir, &mut out);
    }
    out.sort();
    out
}

fn init(project: &Path, args: &[&str]) -> Output {
    first().arg("init").arg(project).args(args).output().unwrap()
}

#[test]
fn init_writes_the_agent_files_from_the_project_and_a_rerun_replaces_only_its_own_section() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("kit");
    copy_tree(&agent_kit(), &project);
    let read = |name: &str| std::fs::read_to_string(project.join(name)).unwrap();
    // The author's own AGENTS.md and their own MCP servers are there first.
    std::fs::write(project.join("AGENTS.md"), "# House rules\n\nTabs, not spaces.\n").unwrap();
    std::fs::write(
        project.join(".mcp.json"),
        r#"{ "mcpServers": { "tracker": { "command": "tracker-mcp" } } }"#,
    )
    .unwrap();

    // Before: --check names every file that is missing, exits 1 and writes nothing.
    let before = init(&project, &["--check"]);
    assert_eq!(before.status.code(), Some(1));
    assert!(
        text(&before.stderr).contains("out of date: AGENTS.md"),
        "{}",
        text(&before.stderr)
    );
    assert_eq!(read("AGENTS.md"), "# House rules\n\nTabs, not spaces.\n");
    assert!(!project.join(".agents").exists());

    let wrote = init(&project, &[]);
    assert!(wrote.status.success(), "{}", text(&wrote.stderr));
    let agents = read("AGENTS.md");
    // The author's text stays, and the section follows it between the markers.
    assert!(
        agents.starts_with("# House rules\n\nTabs, not spaces.\n\n<!-- first:begin -->\n"),
        "{agents}"
    );
    assert!(agents.ends_with("<!-- first:end -->\n"));
    // It describes this project: its kinds with their access rules and API paths, its fields, its
    // action with its endpoint, its job, its page and route, and the site's MCP endpoint.
    for line in [
        "This project is the First app `agentkit`.",
        "| `shoppingList` | table | anyone | editor | editor | admin | `/__first/api/v1/shopping_list` |",
        "| `articles` | collection | anyone | author | editor | editor | `/__first/api/v1/articles` |",
        "- `substitutes`: `item`: ref → shoppingList, `name`: text",
        "| `rename` | `id`: integer, `name`: text | editor | `POST /__first/api/v1/actions/rename` |",
        "- `clearDone`: input `keep?`: integer; retried up to 2 times",
        "| `/api/list` | route (GET) | `first/app/api/list/route.ts` |",
        "| `/` | page | `first/app/page.tsx` |",
        "guest < subscriber < author < editor < admin.",
        "`/wp-json/mcp/first-agentkit`",
    ] {
        assert!(agents.contains(line), "{line}\nin\n{agents}");
    }
    // Every command of the table is listed with its arguments.
    let table: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("runtime/First/Cli/commands.json")).unwrap()).unwrap();
    for group in ["build", "site"] {
        for row in table[group].as_array().unwrap() {
            let usage = format!(
                "first {} {}",
                row["name"].as_str().unwrap(),
                row["args"].as_str().unwrap()
            );
            let line = format!("- `{}`: {}", usage.trim_end(), row["summary"].as_str().unwrap());
            assert!(agents.contains(&line), "{line}");
        }
    }

    // .mcp.json keeps the author's server and gains one that starts `first mcp`.
    let mcp: serde_json::Value = serde_json::from_str(&read(".mcp.json")).unwrap();
    assert_eq!(mcp["mcpServers"]["tracker"]["command"], "tracker-mcp");
    assert_eq!(
        mcp["mcpServers"]["first"],
        serde_json::json!({ "command": "npx", "args": ["--no-install", "first", "mcp"] })
    );

    // The skills this binary carries, as committed under skills/, in both places agents read.
    let skills = files_under(&root().join("skills"));
    assert!(
        skills.contains(&"first-fix-diagnostic/SKILL.md".to_string()),
        "{skills:?}"
    );
    for dir in [".agents/skills", ".claude/skills"] {
        assert_eq!(files_under(&project.join(dir)), skills, "{dir}");
        for skill in &skills {
            assert_eq!(
                read(&format!("{dir}/{skill}")),
                std::fs::read_to_string(root().join("skills").join(skill)).unwrap(),
                "{dir}/{skill}"
            );
        }
    }
    // Each skill is listed in the section by its name.
    assert!(agents.contains("- `first-fix-diagnostic` (`.agents/skills/first-fix-diagnostic/SKILL.md`): "));

    // Now everything matches: --check exits 0, a rerun writes nothing, and `first check` has no hint.
    let current = init(&project, &["--check"]);
    assert_eq!(current.status.code(), Some(0), "{}", text(&current.stderr));
    let again = init(&project, &[]);
    assert_eq!(
        text(&again.stdout),
        "AGENTS.md, .mcp.json and the agent skills are up to date\n"
    );
    assert_eq!(read("AGENTS.md"), agents);
    let checked = first().arg("check").arg(&project).output().unwrap();
    assert!(checked.status.success());
    assert!(
        !text(&checked.stderr).contains("first init"),
        "{}",
        text(&checked.stderr)
    );

    // The config changes: `first check` and `first build` say so in one line, --check fails for CI
    // and names the file, and nothing but the section is rewritten.
    let schema = project.join("first/schema.ts");
    let source = std::fs::read_to_string(&schema).unwrap();
    std::fs::write(
        &schema,
        format!("{source}\nexport const recipes = table({{ title: text() }});\n"),
    )
    .unwrap();
    std::fs::write(project.join("AGENTS.md"), format!("{agents}\n## After\n\nMine too.\n")).unwrap();
    let hint = "hint: AGENTS.md and the agent skills no longer match this project or this compiler; run first init to update them\n";
    for command in ["check", "build"] {
        let ran = first().arg(command).arg(&project).output().unwrap();
        assert!(ran.status.success(), "{}", text(&ran.stderr));
        assert_eq!(
            text(&ran.stderr).matches("first init").count(),
            1,
            "{}",
            text(&ran.stderr)
        );
        assert!(text(&ran.stderr).contains(hint), "{}", text(&ran.stderr));
    }
    // --quiet and --json keep their output as it was.
    let quiet = first().arg("build").arg(&project).arg("--quiet").output().unwrap();
    assert!(!text(&quiet.stderr).contains("first init"));
    let json = first().arg("check").arg(&project).arg("--json").output().unwrap();
    assert!(json.stderr.is_empty(), "{}", text(&json.stderr));
    let stale = init(&project, &["--check"]);
    assert_eq!(stale.status.code(), Some(1));
    assert_eq!(
        text(&stale.stderr),
        "out of date: AGENTS.md\nrun first init to update them\n"
    );
    let updated = init(&project, &[]);
    assert_eq!(text(&updated.stdout), "wrote AGENTS.md\n");
    let agents = read("AGENTS.md");
    assert!(agents.starts_with("# House rules\n\nTabs, not spaces.\n\n<!-- first:begin -->\n"));
    assert!(
        agents.ends_with("<!-- first:end -->\n\n## After\n\nMine too.\n"),
        "{agents}"
    );
    assert_eq!(agents.matches("<!-- first:begin -->").count(), 1);
    assert!(agents.contains("| `recipes` | table |"));
    assert_eq!(init(&project, &["--check"]).status.code(), Some(0));

    // A skill edited in the project is out of date like any other file, and is written back.
    let skill = project.join(".claude/skills/first-fix-diagnostic/SKILL.md");
    std::fs::write(&skill, "changed").unwrap();
    let edited = init(&project, &["--check"]);
    assert_eq!(
        text(&edited.stderr),
        "out of date: .claude/skills/first-fix-diagnostic/SKILL.md\nrun first init to update them\n"
    );
    assert!(init(&project, &[]).status.success());
    assert_eq!(
        std::fs::read_to_string(&skill).unwrap(),
        std::fs::read_to_string(root().join("skills/first-fix-diagnostic/SKILL.md")).unwrap()
    );

    // A `first` server the author configured themselves is theirs: it is never replaced.
    std::fs::write(
        project.join(".mcp.json"),
        r#"{"mcpServers":{"first":{"command":"/opt/first","args":["mcp","--allow-writes"]}}}"#,
    )
    .unwrap();
    assert_eq!(init(&project, &["--check"]).status.code(), Some(0));
    assert!(init(&project, &[]).status.success());
    assert_eq!(
        read(".mcp.json"),
        r#"{"mcpServers":{"first":{"command":"/opt/first","args":["mcp","--allow-writes"]}}}"#
    );
}

#[test]
fn init_refuses_what_it_cannot_describe_and_leaves_other_projects_without_a_hint() {
    // A project that never ran `first init` gets no hint about it.
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("first.config.ts"), CONFIG).unwrap();
    let checked = first().arg("check").arg(dir.path()).output().unwrap();
    assert!(checked.status.success());
    assert!(
        !text(&checked.stderr).contains("first init"),
        "{}",
        text(&checked.stderr)
    );
    // Nor does one whose AGENTS.md is the author's alone.
    std::fs::write(dir.path().join("AGENTS.md"), "# Mine\n").unwrap();
    let checked = first().arg("check").arg(dir.path()).output().unwrap();
    assert!(
        !text(&checked.stderr).contains("first init"),
        "{}",
        text(&checked.stderr)
    );

    // A project that does not compile has nothing to describe: the diagnostic, exit 1, no files.
    std::fs::write(
        dir.path().join("first.config.ts"),
        CONFIG.replace("title: text()", "title: nothing()"),
    )
    .unwrap();
    let broken = init(dir.path(), &[]);
    assert_eq!(broken.status.code(), Some(1));
    assert!(
        text(&broken.stderr).contains("first.config.ts:2:"),
        "{}",
        text(&broken.stderr)
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap(),
        "# Mine\n"
    );
    assert!(!dir.path().join(".mcp.json").exists() && !dir.path().join(".agents").exists());
    std::fs::write(dir.path().join("first.config.ts"), CONFIG).unwrap();

    // One marker without the other: the author's file is not guessed at.
    std::fs::write(dir.path().join("AGENTS.md"), "# Mine\n<!-- first:begin -->\nhalf\n").unwrap();
    let half = init(dir.path(), &[]);
    assert_eq!(half.status.code(), Some(1));
    assert!(
        text(&half.stderr).contains("without the other"),
        "{}",
        text(&half.stderr)
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap(),
        "# Mine\n<!-- first:begin -->\nhalf\n"
    );
    // An .mcp.json that is not JSON is the author's to fix; nothing is written over it.
    std::fs::write(dir.path().join("AGENTS.md"), "# Mine\n").unwrap();
    std::fs::write(dir.path().join(".mcp.json"), "{ not json").unwrap();
    let invalid = init(dir.path(), &[]);
    assert_eq!(invalid.status.code(), Some(1));
    assert!(
        text(&invalid.stderr).contains(".mcp.json is not valid JSON"),
        "{}",
        text(&invalid.stderr)
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join(".mcp.json")).unwrap(),
        "{ not json"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap(),
        "# Mine\n"
    );

    // No project, and an option it does not take.
    let empty = tempfile::tempdir().unwrap();
    let none = init(empty.path(), &[]);
    assert_eq!(none.status.code(), Some(1));
    assert!(
        text(&none.stderr).starts_with("no first.config.ts in "),
        "{}",
        text(&none.stderr)
    );
    assert_eq!(std::fs::read_dir(empty.path()).unwrap().count(), 0);
    let bad = first().args(["init", "--force"]).output().unwrap();
    assert_eq!(bad.status.code(), Some(2));
    assert!(text(&bad.stderr).contains("usage: first init [dir] [--check]"));
}

/// The server `.mcp.json` names is one a client can start: the command as written, run in the
/// project with the project's own `first` in `node_modules/.bin`, answers `server/discover`.
#[cfg(unix)]
#[test]
fn init_configures_an_mcp_server_that_starts_from_the_project() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("kit");
    copy_tree(&agent_kit(), &project);
    assert!(init(&project, &[]).status.success());
    let bin = project.join("node_modules/.bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::os::unix::fs::symlink(env!("CARGO_BIN_EXE_first"), bin.join("first")).unwrap();
    let config: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(project.join(".mcp.json")).unwrap()).unwrap();
    let server = &config["mcpServers"]["first"];
    let mut command = Command::new(server["command"].as_str().unwrap());
    command
        .args(
            server["args"]
                .as_array()
                .unwrap()
                .iter()
                .map(|arg| arg.as_str().unwrap()),
        )
        .current_dir(&project);
    let request = serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": { "name": "schema", "arguments": {}, "_meta": modern_meta() } });
    let out = run_with_stdin(command, &format!("{request}\n"));
    assert!(out.status.success(), "{}", text(&out.stderr));
    let answer: serde_json::Value =
        serde_json::from_slice(&out.stdout).unwrap_or_else(|_| panic!("{}", text(&out.stdout)));
    assert_eq!(answer["result"]["structuredContent"]["name"], "agentkit", "{answer}");
}

/// The skills under skills/, in the layout of github.com/WordPress/agent-skills: one directory per
/// skill with a SKILL.md whose front matter has `name` (the directory's name), `description` and
/// `compatibility`, and whose body has that repository's sections.
#[test]
fn every_skill_has_the_agent_skills_layout_and_names_only_commands_and_pages_that_exist() {
    let table: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("runtime/First/Cli/commands.json")).unwrap()).unwrap();
    let commands: Vec<&str> = ["build", "site"]
        .iter()
        .flat_map(|group| table[*group].as_array().unwrap())
        .map(|row| row["name"].as_str().unwrap())
        .collect();
    let mut names = Vec::new();
    for entry in std::fs::read_dir(root().join("skills")).unwrap() {
        let dir = entry.unwrap().path();
        let name = dir.file_name().unwrap().to_str().unwrap().to_string();
        let skill = std::fs::read_to_string(dir.join("SKILL.md")).unwrap_or_else(|_| panic!("{name}/SKILL.md"));
        let rest = skill
            .strip_prefix("---\n")
            .unwrap_or_else(|| panic!("{name}: front matter first"));
        let (front, body) = rest
            .split_once("\n---\n")
            .unwrap_or_else(|| panic!("{name}: front matter ends"));
        let value = |key: &str| {
            front
                .lines()
                .find_map(|line| line.strip_prefix(key)?.strip_prefix(": "))
                .unwrap_or_else(|| panic!("{name}: {key} in the front matter"))
                .trim_matches('"')
        };
        assert_eq!(value("name"), name);
        assert!(
            name.len() <= 64
                && name
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        );
        assert!(
            value("description").starts_with("Use when ") && value("description").len() <= 1024,
            "{name}"
        );
        assert!(value("compatibility").len() <= 500, "{name}");
        // The compatibility line names the versions this compiler targets.
        let series = env!("CARGO_PKG_VERSION").rsplit_once('.').unwrap().0;
        assert!(
            value("compatibility").contains(&format!("First {series} ")),
            "{name}: {}",
            value("compatibility")
        );
        for section in [
            "## When to use",
            "## Inputs required",
            "## Procedure",
            "## Verification",
            "## Failure modes / debugging",
            "## Escalation",
        ] {
            assert!(body.contains(&format!("\n{section}\n")), "{name}: {section}");
        }
        // Short: depth is in the documentation it links.
        assert!(skill.lines().count() <= 120, "{name}: {} lines", skill.lines().count());

        // Every `first <command>` it names, in inline code or in a shell block, is in the command
        // table (or is `first help`).
        // The skill's reference files count too.
        let every_file: String = files_under(&dir)
            .iter()
            .map(|file| std::fs::read_to_string(dir.join(file)).unwrap())
            .collect();
        let mut named = Vec::new();
        for (i, part) in every_file.split("```").enumerate() {
            if i % 2 == 1 {
                named.extend(part.lines().map(str::trim).filter(|line| line.starts_with("first ")));
            } else {
                named.extend(
                    part.split('`')
                        .skip(1)
                        .step_by(2)
                        .filter(|code| code.starts_with("first ")),
                );
            }
        }
        assert!(!named.is_empty(), "{name} names no command");
        for usage in named {
            let words: Vec<&str> = usage.split_whitespace().skip(1).take(2).collect();
            let two = words.join(" ");
            assert!(
                words[0] == "help" || commands.contains(&words[0]) || commands.contains(&two.as_str()),
                "{name} names `{usage}`, which is not in the command table"
            );
        }
        // Every documentation page it points to is committed.
        for (at, _) in every_file.match_indices("`docs") {
            let path: &str = every_file[at + 1..].split('`').next().unwrap();
            if path.ends_with(".md") || path.ends_with(".mdx") {
                assert!(root().join(path).is_file(), "{name} points to {path}");
            }
        }
        names.push(name);
    }
    names.sort();
    // One skill per task an agent performs.
    assert_eq!(
        names,
        [
            "first-add-kind",
            "first-add-page",
            "first-connect-mcp",
            "first-dev-site",
            "first-fix-diagnostic",
            "first-migrate",
            "first-write-action"
        ]
    );
}

/// The TypeScript in the skills is what an agent will copy, so it has to compile: every fenced
/// block that names its file (`// first/…`) is written to that path in a project, and `first check`
/// accepts the project.
#[test]
fn the_code_in_the_skills_compiles_as_one_project() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(
        project.path().join("first.config.ts"),
        "import { defineConfig } from \"first\";\nexport default defineConfig({ name: \"skills\" });\n",
    )
    .unwrap();
    let mut written = Vec::new();
    for skill in files_under(&root().join("skills")) {
        let text = std::fs::read_to_string(root().join("skills").join(&skill)).unwrap();
        let mut blocks = text.split("```");
        blocks.next();
        while let (Some(block), Some(_)) = (blocks.next(), blocks.next()) {
            let Some((language, code)) = block.split_once('\n') else {
                continue;
            };
            if !matches!(language.trim(), "ts" | "tsx") {
                continue;
            }
            // Blocks sit inside a numbered list: drop the list's indentation.
            let code: String = code
                .lines()
                .map(|line| line.strip_prefix("   ").unwrap_or(line))
                .collect::<Vec<_>>()
                .join("\n");
            let path = code
                .lines()
                .next()
                .and_then(|first| first.strip_prefix("// "))
                .map(|rest| rest.split([' ', ':']).next().unwrap())
                .filter(|path| path.starts_with("first/"))
                .unwrap_or_else(|| panic!("{skill}: a ts block names its file in its first line:\n{code}"));
            let target = project.path().join(path);
            assert!(!target.exists(), "{skill}: {path} is written by two blocks");
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(&target, code.clone() + "\n").unwrap();
            written.push(path.to_string());
        }
    }
    assert!(written.len() >= 4, "{written:?}");
    let checked = first().arg("check").arg(project.path()).output().unwrap();
    assert!(checked.status.success(), "{written:?}\n{}", text(&checked.stderr));
}

/// `npm create @spacefast/first` ends with `first init`: a new project has the agent files, written
/// by the same generator from the template's own config. `--no-install` here, so the compiler is
/// the one `FIRST_BIN` names.
#[test]
fn a_scaffolded_project_starts_with_the_agent_files_first_init_writes() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("Field Notes");
    let scaffolded = Command::new("node")
        .arg(root().join("packages/create-first/bin/create-first.mjs"))
        .arg(&project)
        .arg("--no-install")
        .env("FIRST_BIN", env!("CARGO_BIN_EXE_first"))
        .output()
        .expect("node");
    assert!(scaffolded.status.success(), "{}", text(&scaffolded.stderr));
    let said = text(&scaffolded.stdout);
    assert!(said.contains("Created field-notes."), "{said}");
    assert!(
        said.contains("AGENTS.md, .mcp.json and the agent skills describe this project"),
        "{said}"
    );
    assert!(!said.contains("npx first init  "), "nothing left to run: {said}");
    // The section is about this project: the name the scaffolder gave it and the template's kind.
    let agents = std::fs::read_to_string(project.join("AGENTS.md")).unwrap();
    assert!(agents.starts_with("<!-- first:begin -->\n"), "{agents}");
    assert!(
        agents.contains("This project is the First app `field-notes`."),
        "{agents}"
    );
    assert!(agents.contains("`/wp-json/mcp/first-field-notes`"), "{agents}");
    let schema = first().arg("check").arg(&project).arg("--json").output().unwrap();
    assert!(
        schema.status.success(),
        "the template compiles: {}",
        text(&schema.stdout)
    );
    let mcp: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(project.join(".mcp.json")).unwrap()).unwrap();
    assert_eq!(
        mcp["mcpServers"]["first"]["args"],
        serde_json::json!(["--no-install", "first", "mcp"])
    );
    assert_eq!(
        files_under(&project.join(".agents/skills")),
        files_under(&root().join("skills"))
    );
    assert_eq!(
        files_under(&project.join(".claude/skills")),
        files_under(&root().join("skills"))
    );
    // Exactly what `first init` writes: nothing is out of date.
    let current = init(&project, &["--check"]);
    assert_eq!(current.status.code(), Some(0), "{}", text(&current.stderr));
    // The scaffolder's own files are as before.
    assert!(project.join("first.config.ts").is_file() && project.join("package.json").is_file());

    // A compiler that cannot do it (here: one that fails) does not undo the scaffold: the project
    // is created and the output says what to run.
    let other = dir.path().join("second");
    let failing = dir.path().join("failing-first");
    std::fs::write(&failing, "#!/bin/sh\nexit 3\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&failing, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let scaffolded = Command::new("node")
        .arg(root().join("packages/create-first/bin/create-first.mjs"))
        .arg(&other)
        .arg("--no-install")
        .env("FIRST_BIN", &failing)
        .output()
        .unwrap();
    assert!(scaffolded.status.success(), "{}", text(&scaffolded.stderr));
    assert!(
        text(&scaffolded.stdout).contains("  npx first init "),
        "{}",
        text(&scaffolded.stdout)
    );
    assert!(other.join("first.config.ts").is_file() && !other.join("AGENTS.md").exists());
}
