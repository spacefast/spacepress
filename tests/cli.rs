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
    assert_eq!(results[0]["path"], "docs/compiler-diagnostics.md", "{found}");
    assert_eq!(results[0]["title"], "Compiler diagnostics");
    assert!(!results[0]["snippet"].as_str().unwrap().is_empty());
    // Words no page has: no results, not an error.
    let nothing = mcp.ok("docs_search", serde_json::json!({ "query": "zzqqxxyy" }));
    assert_eq!(nothing["results"], serde_json::json!([]));

    // The page as committed, whole.
    let on_disk = std::fs::read_to_string(root().join("docs/compiler-diagnostics.md")).unwrap();
    let page = mcp.ok(
        "docs_read",
        serde_json::json!({ "path": "docs/compiler-diagnostics.md" }),
    );
    assert_eq!(page["title"], "Compiler diagnostics");
    assert_eq!(page["text"], on_disk);
    // One section, by heading, with nothing of the section before it.
    let codes = mcp.ok(
        "docs_read",
        serde_json::json!({ "path": "docs/compiler-diagnostics.md", "section": "Codes" }),
    );
    let codes = codes["text"].as_str().unwrap();
    assert!(codes.starts_with("## Codes\n"), "{codes}");
    assert!(
        codes.contains("`F1001`") && !codes.contains("offsetEncoding"),
        "{codes}"
    );
    // A long page read whole answers with its opening and its sections, to read one at a time.
    let long = mcp.ok("docs_read", serde_json::json!({ "path": "docs/config-api.md" }));
    assert_eq!(long["truncated"], true);
    let sections: Vec<&str> = long["sections"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap())
        .collect();
    assert!(sections.contains(&"Sync"), "{sections:?}");
    let sync = mcp.ok(
        "docs_read",
        serde_json::json!({ "path": "docs/config-api.md", "section": "sync" }),
    );
    assert!(sync["text"].as_str().unwrap().starts_with("## Sync\n"));
    assert!(
        mcp.refused("docs_read", serde_json::json!({ "path": "docs/nope.md" }))
            .starts_with("no documentation page docs/nope.md")
    );
    assert!(
        mcp.refused(
            "docs_read",
            serde_json::json!({ "path": "docs/agents.md", "section": "Nope" })
        )
        .starts_with("docs/agents.md has no section \"Nope\"; its sections are: ")
    );

    // The same pages are the server's resources. Design proposals are not documentation of what ships.
    let listed = mcp.result("resources/list", serde_json::json!({}));
    let resources = listed["resources"].as_array().unwrap();
    let uris: Vec<&str> = resources.iter().map(|r| r["uri"].as_str().unwrap()).collect();
    assert!(uris.contains(&"first-docs:///docs/agents.md"), "{uris:?}");
    assert!(
        uris.contains(&"first-docs:///docs-site/docs/getting-started.mdx"),
        "{uris:?}"
    );
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
