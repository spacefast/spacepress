//! The `typedpress` command line: one table, build commands here, site commands through WP-CLI
//! (docs/decisions/2026-11-07-one-cli.md). The fixture tests use a stand-in `wp` on PATH; the
//! WordPress test serves a real WordPress on SQLite (tests/php/wp.php serve) and checks that
//! `typedpress <site cmd> --site @alias` answers exactly what `wp @alias typedpress <site cmd>` answers.

#![cfg(feature = "cli")]

use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};

fn first() -> Command {
    Command::new(env!("CARGO_BIN_EXE_typedpress"))
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
        serde_json::from_slice(&std::fs::read(root().join("runtime/TypedPress/Cli/commands.json")).unwrap()).unwrap();
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
    // `typedpress help <command>` prints that command's arguments.
    let jobs = first().args(["help", "jobs"]).output().unwrap();
    assert_eq!(
        text(&jobs.stdout),
        "usage: typedpress jobs list [--state=s] | run <id> | retry <id> | cancel <id> | maintain | tick [--limit=n] [--budget-ms=ms]\n"
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
        serde_json::json!(["@prod", "typedpress", "migrate-legacy", "-", "--dry-run", "--space=s1"])
    );
    assert_eq!(seen["stdin"], "<?php return [];");

    // `typedpress wp` forwards any WP-CLI command; `--site=@x` works too.
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
    // `abilities pull` reads a site over HTTP from this binary; `abilities` alone is `wp typedpress abilities`.
    let wp = fake_wp();
    let mut command = first();
    command.args(["abilities", "--site", "@prod"]);
    with_path(&mut command, wp.path());
    let out = command.output().unwrap();
    assert_eq!(out.status.code(), Some(7));
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(seen["args"], serde_json::json!(["@prod", "typedpress", "abilities"]));
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
fn styles_pull_reads_the_site_through_wp_cli_and_refuses_a_url() {
    // The site answers through WP-CLI: an alias runs `wp @alias typedpress styles export`.
    let wp = fake_wp();
    let project = tempfile::tempdir().unwrap();
    let mut command = first();
    command
        .args(["styles", "pull"])
        .arg(project.path())
        .args(["--site", "@prod"]);
    with_path(&mut command, wp.path());
    let out = command.output().unwrap();
    assert_eq!(out.status.code(), Some(1));
    // The stand-in prints its arguments, which is no answer: nothing is written.
    assert!(
        text(&out.stderr).contains("\"args\":[\"@prod\",\"typedpress\",\"styles\",\"export\"]"),
        "{}",
        text(&out.stderr)
    );
    assert!(!project.path().join("tp/theme.json").exists());
    let out = first()
        .args(["styles", "pull", "--site", "https://example.test"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1));
    assert!(text(&out.stderr).contains("@alias"), "{}", text(&out.stderr));
    let out = first().args(["styles", "push"]).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(
        text(&out.stderr).starts_with("no command styles push\nusage: typedpress styles pull"),
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
    assert!(text(&out.stderr).starts_with("typedpress wp needs WP-CLI arguments\nusage: typedpress wp"));
}

#[test]
fn build_commands_refuse_options_they_do_not_take() {
    let out = first().args(["check", "--port", "9"]).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert!(text(&out.stderr).starts_with("unknown option --port for typedpress check\nusage: typedpress check"));
}

#[test]
fn remote_commands_sign_in_one_way() {
    let work = tempfile::tempdir().unwrap();
    let config = work.path().join("config");
    let run = |args: &[&str], env: &[(&str, &str)]| {
        let mut cmd = first();
        cmd.args(args)
            .current_dir(work.path())
            .env("TP_CONFIG_DIR", &config)
            .env_remove("TP_APP_PASSWORD")
            .env_remove("TP_TOKEN");
        for (k, v) in env {
            cmd.env(k, v);
        }
        cmd.output().unwrap()
    };
    // Signed out, every command that needs a site's credential says how to sign in, before it
    // reaches the site.
    let site = "http://127.0.0.1:9";
    for (args, code) in [(&["sync", "--site", site][..], 3), (&["pull", "--site", site][..], 1)] {
        let out = run(args, &[]);
        assert_eq!(out.status.code(), Some(code), "{args:?}: {}", text(&out.stderr));
        assert!(
            text(&out.stderr).starts_with(&format!("not signed in to {site}. Run: typedpress login {site}\n")),
            "{args:?}: {}",
            text(&out.stderr)
        );
        assert!(
            text(&out.stderr).contains("in CI: TP_APP_PASSWORD"),
            "{}",
            text(&out.stderr)
        );
    }
    // A credential written into the address is refused and never printed, signed in or not.
    for args in [
        &["sync", "--site", "https://demo:SENTINEL@example.test"][..],
        &["pull", "--site", "https://demo:SENTINEL@example.test"][..],
        &["export", "--site", "https://SENTINEL@example.test"][..],
        &["abilities", "pull", "--site", "https://demo:SENTINEL@example.test"][..],
    ] {
        for env in [&[][..], &[("TP_APP_PASSWORD", "a:b")][..]] {
            let out = run(args, env);
            assert!(!out.status.success(), "{args:?}");
            assert!(
                !text(&out.stderr).contains("SENTINEL") && !text(&out.stdout).contains("SENTINEL"),
                "{args:?}: {}",
                text(&out.stderr)
            );
        }
    }
    // Both variables at once is refused, by every command alike.
    for args in [&["sync", "--site", site][..], &["pull", "--site", site][..]] {
        let out = run(args, &[("TP_APP_PASSWORD", "a:b"), ("TP_TOKEN", "t")]);
        assert!(
            text(&out.stderr).starts_with("set TP_APP_PASSWORD or TP_TOKEN, not both"),
            "{args:?}: {}",
            text(&out.stderr)
        );
    }
    let out = run(&["sync", "--site", site], &[("TP_APP_PASSWORD", "no-colon")]);
    assert!(
        text(&out.stderr).starts_with("TP_APP_PASSWORD is user:application-password"),
        "{}",
        text(&out.stderr)
    );
    // What `typedpress login` stores is what sync signs in with: past the credential check, the
    // command reaches the site (and fails there, since nothing listens on port 9).
    std::fs::create_dir_all(&config).unwrap();
    std::fs::write(
        config.join("sites.json"),
        serde_json::json!({"sites": {site: {"rest": format!("{site}/wp-json"), "user": "admin", "password": "secret"}}}).to_string(),
    )
    .unwrap();
    let out = run(&["sync", "--site", &format!("{site}/")], &[]);
    assert!(!text(&out.stderr).contains("not signed in"), "{}", text(&out.stderr));
    assert!(
        !text(&out.stderr).contains("secret"),
        "the stored password is never printed: {}",
        text(&out.stderr)
    );
    // A stored login without its password is reported, not used.
    std::fs::write(
        config.join("sites.json"),
        serde_json::json!({"sites": {site: {"rest": format!("{site}/wp-json"), "user": "admin"}}}).to_string(),
    )
    .unwrap();
    let out = run(&["sync", "--site", site], &[]);
    assert!(
        text(&out.stderr).starts_with(&format!(
            "the stored credential for {site} is incomplete. Run: typedpress login {site}"
        )),
        "{}",
        text(&out.stderr)
    );
    // The environment overrides the stored credential (CI): the incomplete entry is never read.
    let out = run(&["sync", "--site", site], &[("TP_APP_PASSWORD", "ci:password")]);
    assert!(!text(&out.stderr).contains("incomplete"), "{}", text(&out.stderr));
    // Deploying takes an application password: a bearer token is refused before anything is sent.
    std::fs::write(work.path().join("typedpress.config.ts"), CONFIG).unwrap();
    let out = run(&["push", "--site", site], &[("TP_TOKEN", "t")]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        text(&out.stderr).starts_with("deploying needs an application password, not TP_TOKEN"),
        "{}",
        text(&out.stderr)
    );
}

#[test]
fn push_and_login_say_what_they_need_before_they_reach_a_site() {
    let work = tempfile::tempdir().unwrap();
    let config = work.path().join("config");
    let project = work.path().join("project");
    std::fs::create_dir_all(&project).unwrap();
    let run = |args: &[&str]| {
        first()
            .args(args)
            .current_dir(&project)
            .env("TP_CONFIG_DIR", &config)
            .env_remove("TP_APP_PASSWORD")
            .output()
            .unwrap()
    };
    // Not a project.
    let out = run(&["push"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        text(&out.stderr).starts_with("no typedpress.config.ts in "),
        "{}",
        text(&out.stderr)
    );
    std::fs::write(project.join("typedpress.config.ts"), CONFIG).unwrap();
    // A project nobody ran `typedpress login` in.
    let out = run(&["push"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        text(&out.stderr).starts_with("this project has no site to deploy to. Run typedpress login <site-url> here")
    );
    // A site with no stored credential: nothing is compiled or sent.
    let out = run(&["push", "--site", "http://127.0.0.1:9/"]);
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(
        text(&out.stderr),
        "not signed in to http://127.0.0.1:9. Run: typedpress login http://127.0.0.1:9\n"
    );
    assert!(!project.join(".tp").exists(), "nothing was written to the project");
    let out = run(&["push", "--force"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(text(&out.stderr).starts_with("unknown option --force\nusage: typedpress push"));
    // `typedpress login` takes a site's address and nothing that could carry a credential.
    for site in [
        "example.test",
        "https://user:secret@example.test",
        "https://example.test/?a=1",
    ] {
        let out = run(&["login", site]);
        assert_eq!(out.status.code(), Some(1), "{site}");
        assert!(!text(&out.stderr).contains("secret"), "{}", text(&out.stderr));
    }
    let out = run(&["login"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(text(&out.stderr).starts_with("usage: typedpress login <site-url>"));
    // Forgetting a site nobody signed in to is not an error, and creates nothing.
    let out = run(&["logout", "https://example.test/"]);
    assert!(out.status.success());
    assert_eq!(
        text(&out.stdout),
        "no credential for https://example.test is stored on this machine\n"
    );
    assert!(!config.exists());
}

#[test]
fn plugin_writes_the_archive_where_it_is_told() {
    let work = tempfile::tempdir().unwrap();
    let out = first().arg("plugin").current_dir(work.path()).output().unwrap();
    assert!(out.status.success(), "{}", text(&out.stderr));
    let default = std::fs::read(work.path().join("typedpress.zip")).unwrap();
    // A ZIP archive: the local file header's signature.
    assert_eq!(&default[..4], b"PK\x03\x04");
    let named = work.path().join("out/typedpress-plugin.zip");
    let out = first().args(["plugin", "--out"]).arg(&named).output().unwrap();
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert!(named.is_file());
    let out = first().args(["plugin", "--to", "x"]).output().unwrap();
    assert_eq!(out.status.code(), Some(2));
    assert_eq!(text(&out.stderr), "usage: typedpress plugin [--out <file.zip>]\n");
}

/// The served WordPress, stopped (and its directory removed) on drop.
struct Served(Child);

impl Drop for Served {
    fn drop(&mut self) {
        let _ = Command::new("kill").arg(self.0.id().to_string()).output();
        let _ = self.0.wait();
    }
}

const CONFIG: &str = r#"import { defineConfig, table, text, job, jobs, integer } from "typedpress";
const notes = table({ title: text() }, { access: { read: "anyone" } });
export { notes }; export const stamp = job({ input: { n: integer().optional() }, handler: async () => {} }); export default defineConfig({ name: "clilane" });
"#;

/// `typedpress <site cmd> --site @lane` and `wp @lane typedpress <site cmd>` on one real WordPress: the same
/// stdout, the same exit status. Needs PHP 8.2+ with pdo_sqlite and network for the pinned
/// downloads (cached in tests/wp/cache), as tests/sync.rs does.
#[test]
fn site_commands_reach_wp_zero_on_a_real_wordpress_and_answer_the_same_json() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("typedpress.config.ts"), CONFIG).unwrap();
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
        .arg(project.path().join("tp/dist/wp-content"))
        .env("TP_WP_CLI", "1")
        .env("TP_WP_IDENTITY", "1")
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
        command.arg("@lane").arg("typedpress").args(args);
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
            "first {args:?} vs wp typedpress {args:?}\n{}",
            text(&b.stderr)
        );
        assert_eq!(b.status.code(), a.status.code(), "{args:?}");
        serde_json::from_slice(&a.stdout).unwrap_or_else(|_| panic!("{args:?}: {}", text(&a.stdout)))
    };

    // Read-only commands answer the same JSON both ways.
    let empty = same(&["jobs", "list"]);
    assert_eq!(empty, serde_json::json!({"data": []}));
    assert_eq!(same(&["find", "notes"]), serde_json::json!({"data": []}));
    // A write through `typedpress`, read back both ways.
    let inserted = forwarded(&["insert", "notes", r#"{"title":"From first"}"#]);
    assert_eq!(inserted.status.code(), Some(0), "{}", text(&inserted.stdout));
    let found = same(&["find", "notes"]);
    assert_eq!(found["data"][0]["title"], "From first");
    // A failing command keeps WP-CLI's exit status and error document.
    let bad = same(&["jobs", "retry", "no-such-job"]);
    assert!(bad["error"]["code"].is_string(), "{bad}");
    // Identity lives under the one `typedpress` namespace.
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
    // `typedpress mcp --allow-remote-read`: `query` reads the same site through the same forwarding, by
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
    // `typedpress styles pull`: the owner's Global Styles on the site become the project's tp/theme.json
    // and tp/_generated/theme.css; a second pull with --check finds nothing to change.
    let mut command = Command::new(&wp);
    command.args([
        "@lane",
        "eval",
        "--user=admin",
        // As the Styles screen saves it: the user origin's palette, unkeyed.
        "$p = WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles(wp_get_theme(), true); \
         wp_update_post(['ID' => $p['ID'], 'post_content' => wp_slash(wp_json_encode(['version' => 3, 'isGlobalStylesUserThemeJSON' => true, \
         'settings' => ['color' => ['palette' => [['slug' => 'brand', 'color' => '#123456', 'name' => 'Brand']]]]]))]);",
    ]);
    env(&mut command);
    let saved = command.output().unwrap();
    assert!(saved.status.success(), "{}", text(&saved.stderr));
    let pull = |extra: &[&str]| {
        let mut command = first();
        command
            .args(["styles", "pull"])
            .arg(project.path())
            .args(["--site", "@lane"])
            .args(extra);
        env(&mut command);
        command.output().unwrap()
    };
    let pulled = pull(&[]);
    assert!(
        pulled.status.success(),
        "{}{}",
        text(&pulled.stdout),
        text(&pulled.stderr)
    );
    let theme: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(project.path().join("tp/theme.json")).unwrap()).unwrap();
    assert_eq!(
        theme["settings"]["color"]["palette"],
        serde_json::json!([{ "slug": "brand", "color": "#123456", "name": "Brand" }])
    );
    let tokens = std::fs::read_to_string(project.path().join("tp/_generated/theme.css")).unwrap();
    assert!(
        tokens.contains("  --color-brand: var(--wp--preset--color--brand);\n"),
        "{tokens}"
    );
    let again = pull(&["--check"]);
    assert_eq!(again.status.code(), Some(0), "{}", text(&again.stderr));
    // `typedpress wp` reaches plain WordPress commands.
    let mut command = first();
    command.args(["wp", "--site", "@lane", "option", "get", "blogname"]);
    env(&mut command);
    let blogname = command.output().unwrap();
    assert_eq!(
        text(&blogname.stdout).trim(),
        "TypedPress test site",
        "{}",
        text(&blogname.stderr)
    );
}

// ---------------------------------------------------------------------------------------------
// `typedpress mcp`: the real binary driven over stdin and stdout, one JSON-RPC message per line.
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
    assert_eq!(opened["serverInfo"]["name"], "typedpress");
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
    assert!(text(&bad.stderr).contains("usage: typedpress mcp [dir] [--allow-remote-read] [--allow-writes]"));
    assert!(bad.stdout.is_empty());
    // One project directory, and a directory: a second one or a file is refused, not guessed at.
    let config = agent_kit().join("typedpress.config.ts");
    for args in [
        vec![config.as_os_str()],
        vec![agent_kit().as_os_str(), config.as_os_str()],
    ] {
        let refused = first().arg("mcp").args(&args).stdin(Stdio::null()).output().unwrap();
        assert_eq!(refused.status.code(), Some(2), "{args:?}");
        assert!(refused.stdout.is_empty());
    }
    let timeout = first()
        .args(["mcp", "--allow-writes"])
        .env("TP_MCP_TIMEOUT", "soon")
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert_eq!(timeout.status.code(), Some(2));
    assert!(text(&timeout.stderr).contains("TP_MCP_TIMEOUT is a number of seconds"));
    let help = first().args(["help", "mcp"]).output().unwrap();
    assert_eq!(
        text(&help.stdout),
        "usage: typedpress mcp [dir] [--allow-remote-read] [--allow-writes]\n"
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
        "typedpress"
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
        serde_json::json!({ "uri": "typedpress-docs:///docs/nope.md" }),
    );
    assert_eq!(missing["error"]["code"], -32602, "{missing}");
    assert_eq!(missing["error"]["data"]["uri"], "typedpress-docs:///docs/nope.md");

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
    // Bytes that are not UTF-8 are a parse error like any other, and the server keeps reading.
    let stdin = mcp.stdin.as_mut().unwrap();
    stdin
        .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\",\"params\":{\"x\":\"\xff\"}}\n")
        .unwrap();
    stdin.flush().unwrap();
    assert_eq!(mcp.read()["error"]["code"], -32700);
    // A request whose method is not a string, or that has none, is invalid, and says so with its id.
    mcp.write(r#"{"jsonrpc":"2.0","id":5,"method":5}"#);
    let method = mcp.read();
    assert_eq!(
        (&method["id"], &method["error"]["code"]),
        (&serde_json::json!(5), &serde_json::json!(-32600))
    );
    mcp.write(r#"{"jsonrpc":"2.0","id":6}"#);
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
    assert_eq!(rename["endpoint"], "POST /__tp/api/v1/actions/rename");
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
    // A page that serves a kind's `url` names the kind as `kinds` lists it.
    assert_eq!(
        schema["routes"],
        serde_json::json!([
            { "pattern": "/api/list", "type": "route", "file": "tp/app/api/list/route.ts", "methods": ["GET"], "guard": "anyone" },
            { "pattern": "/events/:slug", "type": "page", "file": "tp/app/events/[slug]/page.tsx", "kind": "cookingEvents" },
            { "pattern": "/", "type": "page", "file": "tp/app/page.tsx" },
        ])
    );
    let events = &schema["kinds"]["cookingEvents"];
    assert_eq!(events["path"], "cooking_events");
    assert_eq!(events["url"], "/events/:slug");
    // A slug derived from another field is filled in, so a write need not send it.
    assert_eq!(
        events["fields"]["slug"],
        serde_json::json!({ "type": "slug", "generated": true, "unique": true, "source": "title" })
    );
    // A list of selects says it is a list; a single select does not.
    assert_eq!(
        events["fields"]["tags"],
        serde_json::json!({ "type": "select", "many": true, "values": ["vegan", "quick", "baking"] })
    );
    // Boolean rules stay booleans; a rule written as a function is named as one.
    assert_eq!(
        events["access"],
        serde_json::json!({ "read": true, "create": "editor", "update": "function", "delete": false })
    );
    assert_eq!(
        schema["kinds"]["shoppingList"]["hooks"],
        serde_json::json!(["beforeCreate"])
    );
    assert_eq!(
        schema["globals"]["settings"],
        serde_json::json!({
            "label": "Settings",
            "fields": { "storeName": { "type": "text", "default": "Corner shop" }, "open": { "type": "boolean", "default": true } },
            "access": { "read": "anyone", "update": "admin" },
            "agents": true,
        })
    );
    assert_eq!(
        schema["files"]["receipts"]["accept"],
        serde_json::json!(["application/pdf"])
    );
    assert_eq!(schema["files"]["receipts"]["maxBytes"], 5_000_000);
    assert_eq!(schema["files"]["receipts"]["access"]["read"], "owner");
    assert_eq!(
        schema["roles"],
        serde_json::json!(["guest", "subscriber", "author", "editor", "admin"])
    );
    assert_eq!(schema["endpoints"]["mcp"], "/wp-json/mcp/typedpress-agentkit");
    // Both admins, with TypedPress Admin the default (the kit does not set `admin: false`).
    assert_eq!(
        schema["admin"],
        serde_json::json!({ "default": "/wp-admin/new/", "classic": "/wp-admin/" })
    );
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
        "no kind recipes; this project's kinds are: cookingEvents, articles, shoppingList, substitutes"
    );
    mcp.finish();
}

#[test]
fn mcp_schema_reports_page_and_handler_guards() {
    let project = tempfile::tempdir().unwrap();
    copy_tree(&agent_kit(), project.path());
    let page = "export default function Page() { return <p>Page</p>; }";
    let post = "export async function POST() { return { body: \"ok\" }; }";
    let hybrid = format!("{page}\n{post}");
    let signature =
        "export const signature = { secret: env('HOOK_SECRET'), header: 'x-signature', scheme: 'hmac-sha256' };";
    for (name, file, exports) in [
        (
            "page-only",
            "page.tsx",
            format!("export const guard = 'subscriber';\n{page}"),
        ),
        (
            "handler-only",
            "route.ts",
            format!("export const guard = 'editor';\n{post}"),
        ),
        (
            "shared",
            "page.tsx",
            format!("export const guard = 'author';\n{hybrid}"),
        ),
        (
            "split",
            "page.tsx",
            format!("export const guard = {{ page: 'subscriber', handlers: 'admin' }};\n{hybrid}"),
        ),
        (
            "callbacks",
            "page.tsx",
            format!(
                "export const guard = {{ page: (ctx) => ctx.user !== null, handlers: (ctx) => ctx.user === null }};\n{hybrid}"
            ),
        ),
        (
            "public-page",
            "page.tsx",
            format!("export const guard = {{ handlers: 'subscriber' }};\n{hybrid}"),
        ),
        (
            "signed",
            "page.tsx",
            format!("import {{ env }} from 'typedpress';\nexport const guard = 'editor';\n{signature}\n{hybrid}"),
        ),
    ] {
        let dir = project.path().join("tp/app").join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(file), exports).unwrap();
    }

    let mut mcp = Mcp::initialized(project.path(), &[]);
    let schema = mcp.ok("schema", serde_json::json!({}));
    let routes = schema["routes"].as_array().unwrap();
    let route = |path: &str| routes.iter().find(|entry| entry["pattern"] == path).unwrap();
    for (path, guard) in [
        ("/page-only", serde_json::json!("subscriber")),
        ("/handler-only", serde_json::json!("editor")),
        ("/shared", serde_json::json!("author")),
        ("/split", serde_json::json!({"page": "subscriber", "handlers": "admin"})),
        (
            "/callbacks",
            serde_json::json!({"page": "function", "handlers": "function"}),
        ),
        ("/public-page", serde_json::json!({"handlers": "subscriber"})),
        ("/signed", serde_json::json!("editor")),
    ] {
        let entry = route(path);
        assert_eq!(entry["guard"], guard, "{path}");
        assert!(entry.get("access").is_none(), "{path}");
    }
    assert_eq!(route("/signed")["signed"], true);
    mcp.finish();
}

#[test]
fn mcp_check_returns_the_envelope_first_check_json_prints_and_sees_edits() {
    // On the fixture, the same document `typedpress check --json` writes.
    let printed = first().arg("check").arg(agent_kit()).arg("--json").output().unwrap();
    assert!(printed.status.success(), "{}", text(&printed.stderr));
    let printed: serde_json::Value = serde_json::from_slice(&printed.stdout).unwrap();
    let mut mcp = Mcp::initialized(&agent_kit(), &[]);
    let checked = mcp.ok("check", serde_json::json!({}));
    assert_eq!(checked, printed);
    assert_eq!(checked["schema"], "typedpress-diagnostics");
    assert_eq!(checked["ok"], true);
    mcp.finish();

    // The server compiles the files as they are at each call: an edit shows up without a restart.
    let project = tempfile::tempdir().unwrap();
    let config = project.path().join("typedpress.config.ts");
    std::fs::write(&config, CONFIG).unwrap();
    let mut mcp = Mcp::initialized(project.path(), &[]);
    assert_eq!(mcp.ok("check", serde_json::json!({}))["ok"], true);
    std::fs::write(&config, CONFIG.replace("title: text()", "title: nothing()")).unwrap();
    // A project that does not compile is still a successful call: the diagnostics are the answer.
    let broken = mcp.ok("check", serde_json::json!({}));
    assert_eq!(broken["ok"], false);
    let diagnostic = &broken["diagnostics"][0];
    assert_eq!(diagnostic["location"]["file"], "typedpress.config.ts");
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
    assert_eq!(written, ["typedpress.config.ts"]);
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
    // A section as long as a page is capped the same way, with its subsections to read next.
    let title = committed.lines().next().unwrap().trim_start_matches('#').trim();
    let whole = mcp.ok("docs_read", serde_json::json!({ "path": long, "section": title }));
    assert_eq!(whole["truncated"], true, "{long}: {title}");
    assert!(whole["text"].as_str().unwrap().len() < committed.len() / 2);
    assert!(!whole["sections"].as_array().unwrap().is_empty());
    // A heading of the query outranks a long section that only mentions its words; whole words only.
    let access = mcp.ok(
        "docs_search",
        serde_json::json!({ "query": "access rules owner", "limit": 3 }),
    );
    assert!(
        access["results"]
            .as_array()
            .unwrap()
            .iter()
            .any(|hit| hit["path"] == "docs/config-api.md" && hit["section"] == "Access"),
        "{access}"
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
    assert!(uris.contains(&"typedpress-docs:///docs/agents.md"), "{uris:?}");
    assert!(
        uris.contains(&"typedpress-docs:///docs-site/docs/getting-started.mdx"),
        "{uris:?}"
    );
    // The site's copy of a docs/ page is not a second page to search.
    assert!(
        !uris.contains(&"typedpress-docs:///docs-site/docs/agents.mdx"),
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
    assert!(started["description"].as_str().unwrap().contains("TypedPress app"));
    let read = mcp.result(
        "resources/read",
        serde_json::json!({ "uri": "typedpress-docs:///docs/compiler-diagnostics.md" }),
    );
    assert_eq!(
        read["contents"],
        serde_json::json!([{ "uri": "typedpress-docs:///docs/compiler-diagnostics.md", "mimeType": "text/markdown", "text": on_disk }])
    );
    // Through 2025-11-25 a missing resource is -32002.
    let missing = mcp.request(
        "resources/read",
        serde_json::json!({ "uri": "typedpress-docs:///docs/nope.md" }),
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
        serde_json::from_slice(&std::fs::read(root().join("runtime/TypedPress/Cli/commands.json")).unwrap()).unwrap();
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("typedpress.config.ts"), CONFIG).unwrap();
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
        serde_json::json!({ "state": "none", "start": "typedpress dev" })
    );
    // `typedpress dev status --json` is the same report, and starts nothing either.
    let status = first()
        .args(["dev", "status", "--json"])
        .arg(project.path())
        .output()
        .unwrap();
    assert!(status.status.success(), "{}", text(&status.stderr));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&status.stdout).unwrap(),
        serde_json::json!({ "state": "none", "start": "typedpress dev" })
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
    let no_site = "this project has no dev site yet; start one with `typedpress dev` (`typedpress dev --no-watch` starts it and returns)";
    assert_eq!(mcp.refused("query", serde_json::json!({ "kind": "notes" })), no_site);
    assert_eq!(
        mcp.refused(
            "insert",
            serde_json::json!({ "kind": "notes", "rows": [{ "title": "x" }] })
        ),
        no_site
    );
    assert!(!project.path().join(".tp").exists());
    mcp.finish();
}

#[test]
fn mcp_refuses_writes_and_other_sites_unless_its_flags_allow_them() {
    // A stand-in `wp` records anything that reaches a site; nothing may.
    let wp = fake_wp();
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("typedpress.config.ts"), CONFIG).unwrap();
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
                "{tool} writes to the dev site, and this server was started read-only. Start it as `typedpress mcp --allow-writes` to allow writes to this project's dev site."
            )
        );
    }
    assert_eq!(
        mcp.refused("query", serde_json::json!({ "kind": "notes", "site": "@prod" })),
        "query reads this project's dev site only, and was asked for @prod. Start the server as `typedpress mcp --allow-remote-read` to read another site."
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

    // --allow-remote-read forwards a read to the named site, as `typedpress find --site` does.
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
            "typedpress",
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
    // The limit is checked, not quietly lowered.
    assert_eq!(
        mcp.refused(
            "query",
            serde_json::json!({ "kind": "notes", "site": "@prod", "limit": 501 })
        ),
        "`limit` is at most 500; page with `offset` for more"
    );
    // Without `limit`, 20 rows.
    let default = mcp.call("query", serde_json::json!({ "kind": "notes", "site": "@prod" }));
    assert_eq!(default["structuredContent"]["args"][4], r#"{"limit":20}"#);
    mcp.finish();

    // The site commands take a kind by its storage name; the tools take the name `schema` lists.
    let mut mcp = Mcp::start(&agent_kit(), &["--allow-remote-read"], |command| {
        with_path(command, wp.path())
    });
    mcp.modern = true;
    let seen = mcp.call("query", serde_json::json!({ "kind": "shoppingList", "site": "@prod" }));
    assert_eq!(seen["structuredContent"]["args"][3], "shopping_list", "{seen}");
    mcp.finish();

    // --allow-writes: neither `update` nor `run_action` takes a `site`.
    let mut mcp = Mcp::start(project.path(), &["--allow-writes"], |command| {
        with_path(command, wp.path())
    });
    mcp.modern = true;
    for (tool, arguments) in [
        (
            "update",
            serde_json::json!({ "kind": "notes", "where": { "id": 1 }, "set": { "title": "y" }, "site": "@prod" }),
        ),
        ("run_action", serde_json::json!({ "name": "rename", "site": "@prod" })),
    ] {
        assert_eq!(
            mcp.refused(tool, arguments),
            format!("{tool} writes to this project's dev site and no other; it takes no `site`")
        );
    }
    mcp.finish();
}

/// A stand-in `wp` that runs `script` (sh), for the timing and output cases of the site tools.
fn scripted_wp(script: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("wp");
    std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    dir
}

/// Whether a process that wrote its pid to `file` is still running.
#[cfg(unix)]
fn running(file: &Path) -> bool {
    let pid = std::fs::read_to_string(file).unwrap_or_default();
    !pid.trim().is_empty()
        && Command::new("/bin/sh")
            .args(["-c", "kill -0 \"$1\" 2>/dev/null", "sh", pid.trim()])
            .status()
            .unwrap()
            .success()
}

#[cfg(unix)]
#[test]
fn mcp_stops_a_command_at_the_timeout_and_when_the_request_is_cancelled() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("typedpress.config.ts"), CONFIG).unwrap();
    let pids = tempfile::tempdir().unwrap();
    // A site that never answers. Each call records the pid of the command it is stuck in.
    let wp = scripted_wp(&format!("sleep 600 & echo $! > {}/$$; wait", pids.path().display()));
    let stuck = |pids: &Path| -> Vec<PathBuf> {
        std::fs::read_dir(pids)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect()
    };
    let query = serde_json::json!({ "kind": "notes", "site": "@slow" });

    // The timeout ends the command and everything it started, and the call says why.
    let mut mcp = Mcp::start(project.path(), &["--allow-remote-read"], |command| {
        with_path(command, wp.path());
        command.env("TP_MCP_TIMEOUT", "1");
    });
    mcp.modern = true;
    assert_eq!(
        mcp.refused("query", query.clone()),
        "typedpress find took longer than 1 seconds and was stopped; TP_MCP_TIMEOUT sets the limit"
    );
    let started = stuck(pids.path());
    assert_eq!(started.len(), 1);
    assert!(!running(&started[0]), "the command the site command started is gone");
    mcp.finish();
    std::fs::remove_file(&started[0]).unwrap();

    // A cancelled request is stopped and never answered; the next request is answered at once.
    let mut mcp = Mcp::start(project.path(), &["--allow-remote-read"], |command| {
        with_path(command, wp.path())
    });
    mcp.modern = true;
    mcp.write(
        &serde_json::json!({ "jsonrpc": "2.0", "id": "slow", "method": "tools/call",
            "params": { "name": "query", "arguments": query, "_meta": modern_meta() } })
        .to_string(),
    );
    // Wait until the site command is running, so the cancellation reaches a command and not a queue.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
    while stuck(pids.path()).is_empty() || !running(&stuck(pids.path())[0]) {
        assert!(std::time::Instant::now() < deadline, "the site command never started");
        std::thread::yield_now();
    }
    mcp.write(r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"slow","reason":"test"}}"#);
    let started = std::time::Instant::now();
    let discovered = mcp.request("server/discover", serde_json::json!({}));
    assert!(discovered.get("result").is_some(), "{discovered}");
    assert!(started.elapsed() < std::time::Duration::from_secs(60));
    assert!(!running(&stuck(pids.path())[0]), "the cancelled command is gone");
    // A request cancelled while it waits its turn never runs: two queued, the first cancelled.
    mcp.write(
        &serde_json::json!({ "jsonrpc": "2.0", "id": "queued", "method": "tools/call",
            "params": { "name": "check", "arguments": {}, "_meta": modern_meta() } })
        .to_string(),
    );
    mcp.write(r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"queued"}}"#);
    let after = mcp.request("server/discover", serde_json::json!({}));
    assert!(after.get("result").is_some(), "only the discover is answered: {after}");
    // finish() checks nothing else is ever written.
    mcp.finish();
}

#[test]
fn mcp_reads_a_site_commands_answer_after_other_output() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("typedpress.config.ts"), CONFIG).unwrap();
    // A PHP notice before the document, as a site with WP_DEBUG prints it.
    let wp = scripted_wp(
        r#"echo "PHP Notice:  Undefined index: x in /site/wp-content/plugins/other.php on line 3"; echo '{"data":[{"id":1}]}'"#,
    );
    let mut mcp = Mcp::start(project.path(), &["--allow-remote-read"], |command| {
        with_path(command, wp.path())
    });
    mcp.modern = true;
    assert_eq!(
        mcp.ok("query", serde_json::json!({ "kind": "notes", "site": "@noisy" })),
        serde_json::json!({ "data": [{ "id": 1 }] })
    );
    mcp.finish();
}

/// `typedpress add api-reference` on a fresh scaffold: the pages check, build and type-check, and the
/// app's routes now include /api and /api/<tag>/<operation>.
#[test]
fn add_api_reference_on_a_fresh_scaffold_checks_builds_and_type_checks() {
    let tmp = tempfile::tempdir().unwrap();
    let project = scaffold(tmp.path());
    let added = add(&project, &["api-reference"]);
    assert_eq!(added.status.code(), Some(0), "{}", text(&added.stderr));
    let report = text(&added.stdout);
    for file in [
        "tp/app/api/page.tsx",
        "tp/app/api/[tag]/[operation]/page.tsx",
        "tp/components/ApiFields.tsx",
        "tp/API.md",
    ] {
        assert!(project.join(file).is_file(), "{file}");
        assert_eq!(reported(&report, file).0, "created", "{report}");
    }
    let built = first().arg("build").arg(&project).output().unwrap();
    assert_eq!(built.status.code(), Some(0), "{}", text(&built.stderr));
    let routes = std::fs::read_to_string(project.join("tp/_generated/routes.d.ts")).unwrap();
    assert!(routes.contains("\"api\": { path: `/api`"), "{routes}");
    assert!(
        routes.contains("\"api/[tag]/[operation]\": { path: `/api/${string}/${string}`"),
        "{routes}"
    );
    // The pages type-check against TypedPress's types, with the generated routes.
    std::fs::write(
        project.join("tsconfig.test.json"),
        serde_json::to_vec(&serde_json::json!({
            "extends": "./tsconfig.json",
            "compilerOptions": {
                "types": [], "skipLibCheck": true,
                "paths": {
                    "typedpress": [root().join("types/typedpress/index.d.ts")],
                    "typedpress/*": [root().join("types/typedpress/*.d.ts")],
                    "typedpress:db": [root().join("types/typedpress/db.d.cts")],
                    "php/wordpress": [root().join("types/typedpress/wordpress.d.ts")],
                }
            },
            "include": ["tp/**/*.ts", "tp/**/*.tsx"],
            "exclude": ["tp/dist"]
        }))
        .unwrap(),
    )
    .unwrap();
    let typed = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .arg("--project")
        .arg(project.join("tsconfig.test.json"))
        .output()
        .expect("tsc (or TSC) must be installed to check the added files");
    assert!(typed.status.success(), "{}{}", text(&typed.stdout), text(&typed.stderr));
    // A second run keeps every file as it is.
    let again = add(&project, &["api-reference"]);
    assert!(
        text(&again.stdout).starts_with("typedpress add api-reference: nothing to add\n"),
        "{}",
        text(&again.stdout)
    );
}

/// The added pages in a static site (`output: "static"`): the operation page lists one page per
/// operation in `staticParams`, and `typedpress export --site` writes exactly those pages, one per
/// operation of the app's OpenAPI document.
#[test]
fn add_api_reference_exports_every_operation_in_a_static_site() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().to_path_buf();
    std::fs::write(
        project.join("typedpress.config.ts"),
        r#"import { collection, defineConfig, text } from "typedpress";
export const notes = collection({ title: text() }, { title: "title" });
export default defineConfig({ name: "static-api", output: "static" });
"#,
    )
    .unwrap();
    let added = add(&project, &["api-reference"]);
    assert_eq!(
        added.status.code(),
        Some(0),
        "{}{}",
        text(&added.stdout),
        text(&added.stderr)
    );
    // Export requires a home page for the WordPress header's home link.
    std::fs::write(
        project.join("tp/app/page.tsx"),
        "export default function Home() { return <main>API documentation</main>; }\n",
    )
    .unwrap();
    let built = first().arg("build").arg(&project).output().unwrap();
    assert_eq!(built.status.code(), Some(0), "{}", text(&built.stderr));
    // The operations, from the document the pages read.
    let openapi: serde_json::Value =
        serde_json::from_slice(&std::fs::read(project.join("tp/_generated/openapi.json")).unwrap()).unwrap();
    let operations = openapi["paths"]
        .as_object()
        .unwrap()
        .values()
        .flat_map(|item| item.as_object().unwrap().keys())
        .filter(|method| ["get", "post", "put", "patch", "delete"].contains(&method.as_str()))
        .count();
    assert!(operations > 10, "{operations}");
    // A hosted site for the export to render from: the static samples call its API.
    let mut child = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("serve")
        .arg(project.join("tp/dist/wp-content"))
        .arg("chief=editor")
        .env("TP_WP_THEMES", "1")
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
    let exported = first()
        .arg("export")
        .arg(&project)
        .args(["--site", served["url"].as_str().unwrap()])
        .env(
            "TP_APP_PASSWORD",
            served["users"]["chief"]["appPassword"].as_str().unwrap(),
        )
        .output()
        .unwrap();
    assert!(
        exported.status.success(),
        "{}{}",
        text(&exported.stdout),
        text(&exported.stderr)
    );
    assert!(
        std::fs::read_to_string(project.join("tp/dist/static/index.html"))
            .unwrap()
            .contains("API documentation")
    );
    let api = project.join("tp/dist/static/api");
    let pages = std::fs::read_dir(&api)
        .unwrap()
        .map(|tag| tag.unwrap().path())
        .filter(|tag| tag.is_dir())
        .flat_map(|tag| std::fs::read_dir(tag).unwrap().map(|f| f.unwrap().path()))
        .filter(|f| f.extension().is_some_and(|e| e == "html"))
        .count();
    assert_eq!(pages, operations, "one page per operation under {}", api.display());
}

/// In a project that renders per request, the added pages render per request too: no
/// `staticParams`, so a guarded layout above /api (signed-in readers only) still takes them.
#[test]
fn add_api_reference_renders_per_request_under_a_guarded_layout() {
    let tmp = tempfile::tempdir().unwrap();
    let project = scaffold(tmp.path());
    std::fs::create_dir_all(project.join("tp/app/api/help")).unwrap();
    std::fs::write(
        project.join("tp/app/api/help/page.tsx"),
        "export default function Help() { return <p>Ask in the forum.</p>; }\n",
    )
    .unwrap();
    std::fs::write(
        project.join("tp/app/api/layout.tsx"),
        "import type { LayoutProps } from \"typedpress/app\";\nexport const guard = \"subscriber\";\nexport default function ApiLayout({ children }: LayoutProps) { return <div>{children}</div>; }\n",
    )
    .unwrap();
    let added = add(&project, &["api-reference"]);
    assert_eq!(
        added.status.code(),
        Some(0),
        "{}{}",
        text(&added.stdout),
        text(&added.stderr)
    );
    let page = std::fs::read_to_string(project.join("tp/app/api/[tag]/[operation]/page.tsx")).unwrap();
    assert!(!page.contains("staticParams"), "{page}");
    let built = first().arg("build").arg(&project).output().unwrap();
    assert_eq!(built.status.code(), Some(0), "{}", text(&built.stderr));
}

/// A project from the scaffolder, as `npm create typedpress` writes it, without the npm
/// install. Its directory name has a space, as a real one may.
fn scaffold(parent: &Path) -> PathBuf {
    let project = parent.join("my app");
    let created = Command::new("node")
        .arg(root().join("packages/create-typedpress/bin/create-typedpress.mjs"))
        .arg(&project)
        .arg("--no-install")
        .output()
        .expect("node");
    assert!(created.status.success(), "{}", text(&created.stderr));
    project
}

fn add(project: &Path, args: &[&str]) -> Output {
    first().arg("add").args(args).arg(project).output().unwrap()
}

/// The report line `typedpress add` printed for `file`: "created", "kept" or "skipped", and its reason.
fn reported(report: &str, file: &str) -> (String, String) {
    let line = report
        .lines()
        .find(|l| l.split_whitespace().nth(1) == Some(file))
        .unwrap_or_else(|| panic!("no line for {file} in:\n{report}"));
    let mut words = line.split_whitespace();
    let status = words.next().unwrap().to_string();
    (status, words.skip(1).collect::<Vec<_>>().join(" "))
}

/// Every file and directory under `dir`, with each file's bytes, sorted.
fn tree(dir: &Path) -> Vec<(String, Vec<u8>)> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.strip_prefix(root).unwrap().to_string_lossy().into_owned();
            if path.is_symlink() {
                out.push((format!("{name}@"), Vec::new()));
            } else if path.is_dir() {
                walk(root, &path, out);
                out.push((format!("{name}/"), Vec::new()));
            } else {
                out.push((name, std::fs::read(&path).unwrap()));
            }
        }
    }
    let mut out = Vec::new();
    walk(dir, dir, &mut out);
    out.sort();
    out
}

/// `typedpress add db` on a fresh scaffold: the project still checks and builds, the build plans the
/// tables with their foreign key, and the new files type-check under the scaffold's own tsconfig.
/// Needs node and tsc (or TSC), as the other generated-client tests do.
#[test]
fn add_db_on_a_fresh_scaffold_checks_builds_and_type_checks() {
    let tmp = tempfile::tempdir().unwrap();
    let project = scaffold(tmp.path());
    let before = first().arg("check").arg(&project).output().unwrap();
    assert!(
        text(&before.stdout).contains("1 collections, 0 tables"),
        "{}",
        text(&before.stdout)
    );

    // Run inside the project, with no directory argument.
    let added = first().args(["add", "db"]).current_dir(&project).output().unwrap();
    assert_eq!(added.status.code(), Some(0), "{}", text(&added.stderr));
    let report = text(&added.stdout);
    for file in ["tp/tables.ts", "tables.client.ts", "tp/DATABASE.md"] {
        assert!(project.join(file).is_file(), "{file}");
        assert_eq!(reported(&report, file).0, "created", "{report}");
    }
    // A second run before the first build adds nothing, so the build plans each table once.
    let again = add(&project, &["db"]);
    assert_eq!(again.status.code(), Some(0), "{}", text(&again.stderr));

    let checked = first().arg("check").arg(&project).output().unwrap();
    assert_eq!(checked.status.code(), Some(0), "{}", text(&checked.stderr));
    assert!(
        text(&checked.stdout).contains("1 collections, 2 tables"),
        "{}",
        text(&checked.stdout)
    );
    let built = first().arg("build").arg(&project).output().unwrap();
    assert_eq!(built.status.code(), Some(0), "{}", text(&built.stderr));
    let mut ledger: Vec<String> = std::fs::read_dir(project.join("tp/_generated/migrations"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    ledger.sort();
    assert_eq!(ledger, ["0001_init.sql", "snapshot.json"]);
    let sql = std::fs::read_to_string(project.join("tp/_generated/migrations/0001_init.sql")).unwrap();
    assert_eq!(sql.matches("CREATE TABLE `{prefix}tp_projects`").count(), 1, "{sql}");
    assert!(
        sql.contains("FOREIGN KEY (`project`) REFERENCES `{prefix}tp_projects` (`id`) ON DELETE CASCADE"),
        "{sql}"
    );
    // The scaffold's own kind stays a WordPress post type: it gets no table.
    assert!(!sql.contains("tp_notes"), "{sql}");

    // The scaffold's own tsconfig covers the new files. Only the path to the types differs here,
    // where nothing is installed from npm.
    std::fs::write(
        project.join("tsconfig.test.json"),
        serde_json::to_vec(&serde_json::json!({
            "extends": "./tsconfig.json",
            "compilerOptions": {
                "types": [],
                "paths": {
                    "typedpress": [root().join("types/typedpress/index.d.ts")],
                    "typedpress/*": [root().join("types/typedpress/*.d.ts")],
                    "typedpress:db": [root().join("types/typedpress/db.d.cts")],
                    "php/wordpress": [root().join("types/typedpress/wordpress.d.ts")],
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let tsc = |extra: &[&str]| {
        Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
            .arg("--project")
            .arg(project.join("tsconfig.test.json"))
            .args(extra)
            .output()
            .expect("tsc (or TSC) must be installed to check the added files")
    };
    let listed = text(&tsc(&["--listFilesOnly"]).stdout);
    for file in ["tp/tables.ts", "tables.client.ts"] {
        assert!(
            listed.lines().any(|l| l.ends_with(file)),
            "{file} is not type-checked:\n{listed}"
        );
    }
    let typed = tsc(&[]);
    assert!(typed.status.success(), "{}{}", text(&typed.stdout), text(&typed.stderr));

    // A mistake in the added client file is a type error: a field the table doesn't have.
    let client = std::fs::read_to_string(project.join("tables.client.ts")).unwrap();
    std::fs::write(
        project.join("tables.client.ts"),
        format!("{client}\nexport const wrong = () => first.tasks.create({{ project: 1, title: \"x\", owner: 2 }});\n"),
    )
    .unwrap();
    let typed = tsc(&[]);
    assert!(!typed.status.success());
    assert!(
        text(&typed.stdout).contains("tables.client.ts") && text(&typed.stdout).contains("owner"),
        "{}",
        text(&typed.stdout)
    );
}

#[test]
fn add_only_creates_missing_files_and_never_changes_one_that_is_there() {
    let tmp = tempfile::tempdir().unwrap();
    let project = scaffold(tmp.path());
    assert_eq!(add(&project, &["db"]).status.code(), Some(0));
    // The author edits what they were given.
    let mine = format!(
        "{}\n// mine\n",
        std::fs::read_to_string(project.join("tp/tables.ts")).unwrap()
    );
    std::fs::write(project.join("tp/tables.ts"), &mine).unwrap();
    std::fs::write(project.join("tp/DATABASE.md"), "my notes\n").unwrap();
    let state = tree(&project);
    let again = add(&project, &["db"]);
    assert_eq!(again.status.code(), Some(0), "{}", text(&again.stderr));
    let report = text(&again.stdout);
    assert!(report.starts_with("typedpress add db: nothing to add\n"), "{report}");
    for file in ["tp/tables.ts", "tables.client.ts", "tp/DATABASE.md"] {
        assert_eq!(reported(&report, file).0, "kept", "{report}");
    }
    assert_eq!(tree(&project), state);

    // A deleted file comes back; the others are still not touched.
    std::fs::remove_file(project.join("tables.client.ts")).unwrap();
    let third = add(&project, &["db"]);
    assert_eq!(third.status.code(), Some(0), "{}", text(&third.stderr));
    assert_eq!(reported(&text(&third.stdout), "tables.client.ts").0, "created");
    assert_eq!(tree(&project), state);

    // A link that points nowhere is something of the author's too: it is neither followed nor replaced.
    #[cfg(unix)]
    {
        std::fs::remove_file(project.join("tables.client.ts")).unwrap();
        std::os::unix::fs::symlink(tmp.path().join("elsewhere.ts"), project.join("tables.client.ts")).unwrap();
        let state = tree(&project);
        let linked = add(&project, &["db"]);
        assert_eq!(linked.status.code(), Some(0), "{}", text(&linked.stderr));
        assert_eq!(reported(&text(&linked.stdout), "tables.client.ts").0, "kept");
        assert!(!tmp.path().join("elsewhere.ts").exists());
        assert_eq!(tree(&project), state);
    }
}

/// The example is for a project with no tables. One that has its own gets the note, not a second
/// set of tables, and no client code for tables it doesn't have.
#[test]
fn add_db_leaves_out_the_example_where_the_project_has_its_own_tables() {
    let tmp = tempfile::tempdir().unwrap();
    let project = scaffold(tmp.path());
    std::fs::create_dir_all(project.join("tp")).unwrap();
    let mine = "import { table, text } from \"typedpress\";\nexport const orders = table({ code: text().max(40) });\n";
    // At the module's own path first, then anywhere else under tp/.
    for (at, status) in [("tp/tables.ts", "kept"), ("tp/schema.ts", "skipped")] {
        std::fs::write(project.join(at), mine).unwrap();
        let _ = std::fs::remove_file(project.join("tp/DATABASE.md"));
        let added = add(&project, &["db"]);
        assert_eq!(added.status.code(), Some(0), "{}", text(&added.stderr));
        let report = text(&added.stdout);
        assert_eq!(reported(&report, "tp/tables.ts").0, status, "{report}");
        let (client, why) = reported(&report, "tables.client.ts");
        assert_eq!(client, "skipped", "{report}");
        assert!(why.contains("`projects`"), "{report}");
        assert_eq!(reported(&report, "tp/DATABASE.md").0, "created", "{report}");
        assert!(!project.join("tables.client.ts").exists());
        let checked = first().arg("check").arg(&project).output().unwrap();
        assert!(
            text(&checked.stdout).contains("1 collections, 1 tables"),
            "{}",
            text(&checked.stdout)
        );
        std::fs::remove_file(project.join(at)).unwrap();
    }

    // An author who took the example and then moved and renamed its tables doesn't get it back.
    assert_eq!(add(&project, &["db"]).status.code(), Some(0));
    assert!(project.join("tp/tables.ts").is_file() && project.join("tables.client.ts").is_file());
    std::fs::remove_file(project.join("tp/tables.ts")).unwrap();
    std::fs::remove_file(project.join("tables.client.ts")).unwrap();
    std::fs::write(project.join("tp/schema.ts"), mine).unwrap();
    let state = tree(&project);
    let again = add(&project, &["db"]);
    assert_eq!(again.status.code(), Some(0), "{}", text(&again.stderr));
    assert!(text(&again.stdout).starts_with("typedpress add db: nothing to add\n"));
    assert_eq!(tree(&project), state);
}

#[test]
fn add_changes_nothing_when_the_project_or_the_result_does_not_compile() {
    let tmp = tempfile::tempdir().unwrap();
    let project = scaffold(tmp.path());
    // An export of the author's already uses a name the module's example exports.
    std::fs::create_dir_all(project.join("tp/server")).unwrap();
    std::fs::write(
        project.join("tp/server/tasks.ts"),
        "import { action } from \"typedpress\";\nexport const tasks = action({ input: {}, async handler() { return 1; } });\n",
    )
    .unwrap();
    let state = tree(&project);
    let clash = add(&project, &["db"]);
    assert_eq!(clash.status.code(), Some(1), "{}", text(&clash.stdout));
    let error = text(&clash.stderr);
    assert!(error.contains("`tasks` names two things"), "{error}");
    assert!(error.contains("nothing was added"), "{error}");
    assert_eq!(tree(&project), state);

    // A project that doesn't compile today is refused before anything is written, with its own error.
    std::fs::write(project.join("tp/server/tasks.ts"), "export const broken = ;\n").unwrap();
    let state = tree(&project);
    let broken = add(&project, &["db"]);
    assert_eq!(broken.status.code(), Some(1), "{}", text(&broken.stdout));
    assert!(
        text(&broken.stderr).contains("tp/server/tasks.ts:1"),
        "{}",
        text(&broken.stderr)
    );
    assert!(
        text(&broken.stderr).contains("Nothing was added"),
        "{}",
        text(&broken.stderr)
    );
    assert_eq!(tree(&project), state);

    // With no tp/ directory yet, a refused add doesn't leave an empty one behind.
    let bare = tmp.path().join("bare");
    std::fs::create_dir_all(&bare).unwrap();
    std::fs::write(
        bare.join("typedpress.config.ts"),
        "import { action, defineConfig } from \"typedpress\";\nconst __projects = action({ input: {}, async handler() { return 1; } }); export { __projects as projects }; export default defineConfig({ name: \"bare\" });\n",
    )
    .unwrap();
    let state = tree(&bare);
    let refused = add(&bare, &["db"]);
    assert_eq!(refused.status.code(), Some(1), "{}", text(&refused.stdout));
    assert_eq!(tree(&bare), state);

    // A directory that isn't a project says so, and gets nothing.
    let empty = tmp.path().join("empty");
    std::fs::create_dir_all(&empty).unwrap();
    let none = add(&empty, &["db"]);
    assert_eq!(none.status.code(), Some(1));
    assert!(
        text(&none.stderr).starts_with("typedpress add db: no typedpress.config.ts in "),
        "{}",
        text(&none.stderr)
    );
    assert!(std::fs::read_dir(&empty).unwrap().next().is_none());
}

/// A file that can't be written whole (a full disk, a quota) is not left behind half written.
/// The file size limit stands in for the full disk: the first write past it fails.
#[cfg(unix)]
#[test]
fn add_removes_a_file_it_could_not_finish_writing() {
    let tmp = tempfile::tempdir().unwrap();
    let project = scaffold(tmp.path());
    let state = tree(&project);
    let out = Command::new("sh")
        .args(["-c", "trap '' XFSZ; ulimit -f 1; exec \"$@\"", "sh"])
        .arg(env!("CARGO_BIN_EXE_typedpress"))
        .args(["add", "db"])
        .arg(&project)
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1), "{}{}", text(&out.stdout), text(&out.stderr));
    assert!(
        text(&out.stderr).contains("can't write tp/tables.ts") && text(&out.stderr).contains("Nothing was added"),
        "{}",
        text(&out.stderr)
    );
    assert_eq!(tree(&project), state);
    // The project still compiles, and the next run adds everything.
    let added = add(&project, &["db"]);
    assert_eq!(added.status.code(), Some(0), "{}", text(&added.stderr));
    assert_eq!(reported(&text(&added.stdout), "tp/tables.ts").0, "created");
}

#[test]
fn add_names_its_modules_when_the_module_is_missing_or_unknown() {
    // `typedpress help add` lists the modules; the command table's summary names each of them.
    let help = first().args(["help", "add"]).output().unwrap();
    assert_eq!(help.status.code(), Some(0));
    let modules = text(&help.stdout);
    assert!(
        modules.starts_with("usage: typedpress add <module> [dir]\nmodules:\n  db  "),
        "{modules}"
    );
    let table: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("runtime/TypedPress/Cli/commands.json")).unwrap()).unwrap();
    let row = table["build"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["name"] == "add")
        .expect("an add row");
    let named = row["summary"]
        .as_str()
        .unwrap()
        .split_once("Modules: ")
        .expect("Modules:")
        .1;
    for line in modules.lines().skip(2) {
        let name = line.split_whitespace().next().unwrap();
        assert!(named.split([' ', ',']).any(|word| word == name), "{name} in {named:?}");
    }

    let none = first().arg("add").output().unwrap();
    assert_eq!(none.status.code(), Some(2));
    assert_eq!(text(&none.stderr), format!("typedpress add needs a module\n{modules}"));
    let tmp = tempfile::tempdir().unwrap();
    let unknown = add(tmp.path(), &["pages"]);
    assert_eq!(unknown.status.code(), Some(2));
    assert_eq!(text(&unknown.stderr), format!("no module pages\n{modules}"));
    let option = add(tmp.path(), &["db", "--force"]);
    assert_eq!(option.status.code(), Some(2));
    assert_eq!(
        text(&option.stderr),
        format!("unknown option --force for typedpress add\n{modules}")
    );
    assert!(std::fs::read_dir(tmp.path()).unwrap().next().is_none());
}

/// The example's access rules on a real WordPress, over HTTP: reading and writing tasks needs an
/// account, anyone with one changes a task only while it is open, and an editor changes any.
/// Needs PHP 8.2+ with pdo_sqlite, curl, and network for the pinned downloads (cached in
/// tests/wp/cache), as the site test above does.
#[test]
fn the_added_tables_enforce_their_access_rules_on_a_real_wordpress() {
    let tmp = tempfile::tempdir().unwrap();
    let project = scaffold(tmp.path());
    assert_eq!(add(&project, &["db"]).status.code(), Some(0));
    let built = first().arg("build").arg(&project).arg("--quiet").output().unwrap();
    assert!(built.status.success(), "build: {}", text(&built.stderr));
    let mut child = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("serve")
        .arg(project.join("tp/dist/wp-content"))
        .args(["sub=subscriber", "ed=editor"])
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
    let base = format!("{}/__tp/api/v1", served["url"].as_str().unwrap());
    // (status, body) of one request, as `who` (a served user) or signed out.
    let call = |who: Option<&str>, method: &str, path: &str, body: Option<serde_json::Value>| {
        let mut curl = Command::new("curl");
        curl.args([
            "--silent",
            "--max-time",
            "60",
            "--write-out",
            "\n%{http_code}",
            "--request",
            method,
        ]);
        if let Some(who) = who {
            curl.args(["--user", served["users"][who]["appPassword"].as_str().unwrap()]);
        }
        if let Some(body) = &body {
            curl.args([
                "--header",
                "Content-Type: application/json",
                "--data",
                &body.to_string(),
            ]);
        }
        let out = curl.arg(format!("{base}{path}")).output().expect("curl");
        let answer = text(&out.stdout);
        let (body, status) = answer
            .rsplit_once('\n')
            .unwrap_or_else(|| panic!("{method} {path}: {answer}"));
        (
            status
                .parse::<u16>()
                .unwrap_or_else(|_| panic!("{method} {path}: {answer}")),
            serde_json::from_str::<serde_json::Value>(body).unwrap_or(serde_json::Value::Null),
        )
    };
    let json = |text: &str| -> serde_json::Value { serde_json::from_str(text).unwrap() };

    // Projects: editors write, anyone with an account reads.
    let (status, _) = call(Some("sub"), "POST", "/projects", Some(json(r#"{"name":"Launch"}"#)));
    assert_eq!(status, 403);
    let (status, project_row) = call(Some("ed"), "POST", "/projects", Some(json(r#"{"name":"Launch"}"#)));
    assert_eq!(status, 201, "{project_row}");
    let project_id = project_row["data"]["id"].clone();
    assert_eq!(call(None, "GET", "/projects", None).0, 401);
    assert_eq!(call(Some("sub"), "GET", "/projects", None).0, 200);

    // Tasks: the foreign key is real, and creating one needs an account.
    let task = |title: &str| serde_json::json!({ "project": project_id, "title": title });
    assert_eq!(call(None, "POST", "/tasks", Some(task("signed out"))).0, 401);
    let (status, refused) = call(
        Some("sub"),
        "POST",
        "/tasks",
        Some(serde_json::json!({ "project": 999, "title": "no project" })),
    );
    assert_eq!(status, 409, "{refused}");
    let (status, open) = call(Some("sub"), "POST", "/tasks", Some(task("Write the post")));
    assert_eq!(status, 201, "{open}");
    assert_eq!(open["data"]["done"], false);
    let id = open["data"]["id"].as_i64().unwrap();
    let path = format!("/tasks/{id}");

    // Signed out: no read, no change, and the refusal doesn't hand back the row.
    assert_eq!(call(None, "GET", "/tasks", None).0, 401);
    let (status, answer) = call(None, "PATCH", &path, Some(json(r#"{"title":"defaced"}"#)));
    assert_eq!(status, 401, "{answer}");
    assert!(answer["data"].is_null(), "{answer}");
    assert_eq!(call(None, "DELETE", &path, None).0, 401);
    // With an account: an open task changes, a finished one doesn't, and only an editor deletes.
    let (status, closed) = call(Some("sub"), "PATCH", &path, Some(json(r#"{"done":true}"#)));
    assert_eq!(status, 200, "{closed}");
    assert_eq!(closed["data"]["done"], true);
    let (status, answer) = call(Some("sub"), "PATCH", &path, Some(json(r#"{"title":"reopened?"}"#)));
    assert_eq!(status, 404, "{answer}");
    assert_eq!(call(Some("sub"), "DELETE", &path, None).0, 403);
    let (status, edited) = call(
        Some("ed"),
        "PATCH",
        &path,
        Some(json(r#"{"title":"Write the post (done)"}"#)),
    );
    assert_eq!(status, 200, "{edited}");
    let (_, read) = call(Some("sub"), "GET", &path, None);
    assert_eq!(read["data"]["title"], "Write the post (done)");

    // The field is the relation, in both directions.
    let (_, with_project) = call(Some("sub"), "GET", "/tasks?with=project", None);
    assert_eq!(with_project["data"][0]["project"]["name"], "Launch", "{with_project}");
    let (_, with_tasks) = call(Some("sub"), "GET", "/projects?with=tasks", None);
    assert_eq!(with_tasks["data"][0]["tasks"][0]["id"], id, "{with_tasks}");

    // Deleting the project deletes its tasks.
    let project_path = format!("/projects/{}", project_id);
    assert_eq!(call(Some("ed"), "DELETE", &project_path, None).0, 200);
    let (status, left) = call(Some("ed"), "GET", "/tasks", None);
    assert_eq!(status, 200);
    assert_eq!(left["data"], serde_json::json!([]));
}

// ---------------------------------------------------------------------------------------------
// `typedpress init`: AGENTS.md, .mcp.json and the agent skills, written from the project's config.
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
        agents.starts_with("# House rules\n\nTabs, not spaces.\n\n<!-- typedpress:begin -->\n"),
        "{agents}"
    );
    assert!(agents.ends_with("<!-- typedpress:end -->\n"));
    // It describes this project: its kinds with their access rules and API paths, its fields, its
    // action with its endpoint, its job, its page and route, and the site's MCP endpoint.
    for line in [
        "This project is the TypedPress app `agentkit`.",
        "| `shoppingList` | table | anyone | editor | editor | admin | `/__tp/api/v1/shopping_list` |",
        "| `articles` | collection | anyone | author | editor | editor | `/__tp/api/v1/articles` |",
        "- `substitutes`: `item`: ref → shoppingList, `name`: text",
        "| `rename` | `id`: integer, `name`: text | editor | `POST /__tp/api/v1/actions/rename` |",
        "- `clearDone`: input `keep?`: integer; retried up to 2 times",
        "| `/api/list` | route (GET) | `tp/app/api/list/route.ts` |",
        "| `/` | page | `tp/app/page.tsx` |",
        "guest < subscriber < author < editor < admin.",
        "`/wp-json/mcp/typedpress-agentkit`",
    ] {
        assert!(agents.contains(line), "{line}\nin\n{agents}");
    }
    // Every command of the table is listed with its arguments.
    let table: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("runtime/TypedPress/Cli/commands.json")).unwrap()).unwrap();
    for group in ["build", "site"] {
        for row in table[group].as_array().unwrap() {
            let usage = format!(
                "typedpress {} {}",
                row["name"].as_str().unwrap(),
                row["args"].as_str().unwrap()
            );
            let line = format!("- `{}`: {}", usage.trim_end(), row["summary"].as_str().unwrap());
            assert!(agents.contains(&line), "{line}");
        }
    }

    // .mcp.json keeps the author's server and gains one that starts `typedpress mcp`.
    let mcp: serde_json::Value = serde_json::from_str(&read(".mcp.json")).unwrap();
    assert_eq!(mcp["mcpServers"]["tracker"]["command"], "tracker-mcp");
    assert_eq!(
        mcp["mcpServers"]["typedpress"],
        serde_json::json!({ "command": "npx", "args": ["--no-install", "typedpress", "mcp"] })
    );

    // The skills this binary carries, as committed under skills/, in both places agents read.
    let skills = files_under(&root().join("skills"));
    assert!(
        skills.contains(&"typedpress-fix-diagnostic/SKILL.md".to_string()),
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
    assert!(agents.contains("- `typedpress-fix-diagnostic` (`.agents/skills/typedpress-fix-diagnostic/SKILL.md`): "));

    // Now everything matches: --check exits 0, a rerun writes nothing, and `typedpress check` has no hint.
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
        !text(&checked.stderr).contains("typedpress init"),
        "{}",
        text(&checked.stderr)
    );

    // The config changes: `typedpress check` and `typedpress build` say so in one line, --check fails for CI
    // and names the file, and nothing but the section is rewritten.
    let schema = project.join("tp/schema.ts");
    let source = std::fs::read_to_string(&schema).unwrap();
    std::fs::write(
        &schema,
        format!("{source}\nexport const recipes = table({{ title: text() }});\n"),
    )
    .unwrap();
    std::fs::write(project.join("AGENTS.md"), format!("{agents}\n## After\n\nMine too.\n")).unwrap();
    let hint = "hint: AGENTS.md and the agent skills no longer match this project or this compiler; run typedpress init to update them\n";
    for command in ["check", "build"] {
        let ran = first().arg(command).arg(&project).output().unwrap();
        assert!(ran.status.success(), "{}", text(&ran.stderr));
        assert_eq!(
            text(&ran.stderr).matches("typedpress init").count(),
            1,
            "{}",
            text(&ran.stderr)
        );
        assert!(text(&ran.stderr).contains(hint), "{}", text(&ran.stderr));
    }
    // --quiet and --json keep their output as it was.
    let quiet = first().arg("build").arg(&project).arg("--quiet").output().unwrap();
    assert!(!text(&quiet.stderr).contains("typedpress init"));
    let json = first().arg("check").arg(&project).arg("--json").output().unwrap();
    assert!(json.stderr.is_empty(), "{}", text(&json.stderr));
    let stale = init(&project, &["--check"]);
    assert_eq!(stale.status.code(), Some(1));
    assert_eq!(
        text(&stale.stderr),
        "out of date: AGENTS.md\nrun typedpress init to update them\n"
    );
    let updated = init(&project, &[]);
    assert_eq!(text(&updated.stdout), "wrote AGENTS.md\n");
    let agents = read("AGENTS.md");
    assert!(agents.starts_with("# House rules\n\nTabs, not spaces.\n\n<!-- typedpress:begin -->\n"));
    assert!(
        agents.ends_with("<!-- typedpress:end -->\n\n## After\n\nMine too.\n"),
        "{agents}"
    );
    assert_eq!(agents.matches("<!-- typedpress:begin -->").count(), 1);
    assert!(agents.contains("| `recipes` | table |"));
    assert_eq!(init(&project, &["--check"]).status.code(), Some(0));

    // A skill edited in the project is out of date like any other file, and is written back.
    let skill = project.join(".claude/skills/typedpress-fix-diagnostic/SKILL.md");
    std::fs::write(&skill, "changed").unwrap();
    let edited = init(&project, &["--check"]);
    assert_eq!(
        text(&edited.stderr),
        "out of date: .claude/skills/typedpress-fix-diagnostic/SKILL.md\nrun typedpress init to update them\n"
    );
    assert!(init(&project, &[]).status.success());
    assert_eq!(
        std::fs::read_to_string(&skill).unwrap(),
        std::fs::read_to_string(root().join("skills/typedpress-fix-diagnostic/SKILL.md")).unwrap()
    );

    // A `typedpress` server the author configured themselves is theirs: it is never replaced.
    std::fs::write(
        project.join(".mcp.json"),
        r#"{"mcpServers":{"typedpress":{"command":"/opt/tp","args":["mcp","--allow-writes"]}}}"#,
    )
    .unwrap();
    assert_eq!(init(&project, &["--check"]).status.code(), Some(0));
    assert!(init(&project, &[]).status.success());
    assert_eq!(
        read(".mcp.json"),
        r#"{"mcpServers":{"typedpress":{"command":"/opt/tp","args":["mcp","--allow-writes"]}}}"#
    );
}

#[test]
fn init_refuses_what_it_cannot_describe_and_leaves_other_projects_without_a_hint() {
    // A project that never ran `typedpress init` gets no hint about it.
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("typedpress.config.ts"), CONFIG).unwrap();
    let checked = first().arg("check").arg(dir.path()).output().unwrap();
    assert!(checked.status.success());
    assert!(
        !text(&checked.stderr).contains("typedpress init"),
        "{}",
        text(&checked.stderr)
    );
    // Nor does one whose AGENTS.md is the author's alone.
    std::fs::write(dir.path().join("AGENTS.md"), "# Mine\n").unwrap();
    let checked = first().arg("check").arg(dir.path()).output().unwrap();
    assert!(
        !text(&checked.stderr).contains("typedpress init"),
        "{}",
        text(&checked.stderr)
    );

    // A project that does not compile has nothing to describe: the diagnostic, exit 1, no files.
    std::fs::write(
        dir.path().join("typedpress.config.ts"),
        CONFIG.replace("title: text()", "title: nothing()"),
    )
    .unwrap();
    let broken = init(dir.path(), &[]);
    assert_eq!(broken.status.code(), Some(1));
    assert!(
        text(&broken.stderr).contains("typedpress.config.ts:2:"),
        "{}",
        text(&broken.stderr)
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap(),
        "# Mine\n"
    );
    assert!(!dir.path().join(".mcp.json").exists() && !dir.path().join(".agents").exists());
    std::fs::write(dir.path().join("typedpress.config.ts"), CONFIG).unwrap();

    // One marker without the other: the author's file is not guessed at.
    std::fs::write(
        dir.path().join("AGENTS.md"),
        "# Mine\n<!-- typedpress:begin -->\nhalf\n",
    )
    .unwrap();
    let half = init(dir.path(), &[]);
    assert_eq!(half.status.code(), Some(1));
    assert!(
        text(&half.stderr).contains("without the other"),
        "{}",
        text(&half.stderr)
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("AGENTS.md")).unwrap(),
        "# Mine\n<!-- typedpress:begin -->\nhalf\n"
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
        text(&none.stderr).starts_with("no typedpress.config.ts in "),
        "{}",
        text(&none.stderr)
    );
    assert_eq!(std::fs::read_dir(empty.path()).unwrap().count(), 0);
    let bad = first().args(["init", "--force"]).output().unwrap();
    assert_eq!(bad.status.code(), Some(2));
    assert!(text(&bad.stderr).contains("usage: typedpress init [dir] [--check]"));
}

/// The server `.mcp.json` names is one a client can start: the command as written, run in the
/// project with the project's own `typedpress` in `node_modules/.bin`, answers `server/discover`.
#[cfg(unix)]
#[test]
fn init_configures_an_mcp_server_that_starts_from_the_project() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("kit");
    copy_tree(&agent_kit(), &project);
    assert!(init(&project, &[]).status.success());
    let bin = project.join("node_modules/.bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::os::unix::fs::symlink(env!("CARGO_BIN_EXE_typedpress"), bin.join("typedpress")).unwrap();
    let config: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(project.join(".mcp.json")).unwrap()).unwrap();
    let server = &config["mcpServers"]["typedpress"];
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
        serde_json::from_slice(&std::fs::read(root().join("runtime/TypedPress/Cli/commands.json")).unwrap()).unwrap();
    let commands: Vec<&str> = ["build", "site"]
        .iter()
        .flat_map(|group| table[*group].as_array().unwrap())
        .map(|row| row["name"].as_str().unwrap())
        .collect();
    // The documentation the binary embeds, to check each page a skill points to.
    let mut embedded = Mcp::initialized(&agent_kit(), &[]);
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
            value("compatibility").contains(&format!("TypedPress {series} ")),
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

        // Every `typedpress <command>` it names, in inline code or in a shell block, is in the command
        // table (or is `typedpress help`).
        // The skill's reference files count too.
        let every_file: String = files_under(&dir)
            .iter()
            .map(|file| std::fs::read_to_string(dir.join(file)).unwrap())
            .collect();
        let mut named = Vec::new();
        for (i, part) in every_file.split("```").enumerate() {
            if i % 2 == 1 {
                named.extend(
                    part.lines()
                        .map(str::trim)
                        .filter(|line| line.starts_with("typedpress ")),
                );
            } else {
                named.extend(
                    part.split('`')
                        .skip(1)
                        .step_by(2)
                        .filter(|code| code.starts_with("typedpress ")),
                );
            }
        }
        assert!(!named.is_empty(), "{name} names no command");
        for usage in named {
            let words: Vec<&str> = usage.split_whitespace().skip(1).collect();
            let two = words.iter().take(2).copied().collect::<Vec<_>>().join(" ");
            let command = if commands.contains(&two.as_str()) {
                two
            } else {
                words[0].to_string()
            };
            if command == "help" {
                continue;
            }
            let row = ["build", "site"]
                .iter()
                .flat_map(|group| table[*group].as_array().unwrap())
                .find(|row| row["name"] == command.as_str())
                .unwrap_or_else(|| panic!("{name} names `{usage}`, which is not in the command table"));
            // Each option it passes is one the command takes. `typedpress wp` forwards WP-CLI's own.
            if command != "wp" {
                let takes = row["args"].as_str().unwrap();
                for flag in words.iter().filter(|word| word.starts_with("--")) {
                    let flag = flag.split('=').next().unwrap();
                    assert!(
                        takes.contains(flag),
                        "{name} passes {flag} to `typedpress {command}`, which takes {takes}"
                    );
                }
            }
        }
        // Every documentation page it points to is one `typedpress mcp`'s `docs_read` serves, unless the
        // skill says it is not.
        for (at, _) in every_file.match_indices("`docs") {
            let path: &str = every_file[at + 1..].split('`').next().unwrap();
            if path.ends_with(".md") || path.ends_with(".mdx") {
                assert!(root().join(path).is_file(), "{name} points to {path}");
                let line = every_file[at..].lines().next().unwrap();
                if !line.contains("not served by `docs_read`") {
                    let read = embedded.call("docs_read", serde_json::json!({ "path": path }));
                    assert_eq!(
                        read["isError"], false,
                        "{name} points to {path}, which docs_read does not serve"
                    );
                }
            }
        }
        names.push(name);
    }
    names.sort();
    // One skill per task an agent performs.
    assert_eq!(
        names,
        [
            "typedpress-add-kind",
            "typedpress-add-page",
            "typedpress-connect-mcp",
            "typedpress-dev-site",
            "typedpress-fix-diagnostic",
            "typedpress-migrate",
            "typedpress-migrate-astro",
            "typedpress-write-action"
        ]
    );
}

/// The TypeScript in the skills is what an agent will copy, so it has to compile: every fenced
/// block that names its file (`// tp/…`) is written to that path in a project, and `typedpress check`
/// accepts the project.
#[test]
fn the_code_in_the_skills_compiles_as_one_project() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(
        project.path().join("typedpress.config.ts"),
        "import { defineConfig } from \"typedpress\";\nexport default defineConfig({ name: \"skills\" });\n",
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
            // Every block says its language, so a TypeScript sample is never skipped for lack of a tag.
            assert!(!language.trim().is_empty(), "{skill}: a code block without a language");
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
                .filter(|path| path.starts_with("tp/"))
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
    // What the skills say about the kinds in their samples is what the compiler makes of them: a
    // kind's storage name is the snake_case of its export name, and the API path uses it.
    let mut mcp = Mcp::initialized(project.path(), &[]);
    let schema = mcp.ok("schema", serde_json::json!({}));
    for (kind, described) in schema["kinds"].as_object().unwrap() {
        let snake: String = kind
            .chars()
            .flat_map(|c| {
                let lower = c.to_ascii_lowercase();
                if c.is_ascii_uppercase() {
                    vec!['_', lower]
                } else {
                    vec![c]
                }
            })
            .collect();
        assert_eq!(described["path"], snake.as_str(), "{kind}");
    }
    mcp.finish();
}

/// `npm create typedpress` ends with `typedpress init`: a new project has the agent files, written
/// by the same generator from the template's own config. `--no-install` here, so the compiler is
/// the one `TP_BIN` names.
#[test]
fn a_scaffolded_project_starts_with_the_agent_files_first_init_writes() {
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("Field Notes");
    let scaffolded = Command::new("node")
        .arg(root().join("packages/create-typedpress/bin/create-typedpress.mjs"))
        .arg(&project)
        .arg("--no-install")
        .env("TP_BIN", env!("CARGO_BIN_EXE_typedpress"))
        .output()
        .expect("node");
    assert!(scaffolded.status.success(), "{}", text(&scaffolded.stderr));
    let said = text(&scaffolded.stdout);
    assert!(said.contains("Created field-notes."), "{said}");
    assert!(
        said.contains("AGENTS.md, .mcp.json and the agent skills describe this project"),
        "{said}"
    );
    assert!(!said.contains("npx typedpress init  "), "nothing left to run: {said}");
    // The section is about this project: the name the scaffolder gave it and the template's kind.
    let agents = std::fs::read_to_string(project.join("AGENTS.md")).unwrap();
    assert!(agents.starts_with("<!-- typedpress:begin -->\n"), "{agents}");
    assert!(
        agents.contains("This project is the TypedPress app `field-notes`."),
        "{agents}"
    );
    assert!(agents.contains("`/wp-json/mcp/typedpress-field-notes`"), "{agents}");
    let schema = first().arg("check").arg(&project).arg("--json").output().unwrap();
    assert!(
        schema.status.success(),
        "the template compiles: {}",
        text(&schema.stdout)
    );
    let mcp: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(project.join(".mcp.json")).unwrap()).unwrap();
    assert_eq!(
        mcp["mcpServers"]["typedpress"]["args"],
        serde_json::json!(["--no-install", "typedpress", "mcp"])
    );
    assert_eq!(
        files_under(&project.join(".agents/skills")),
        files_under(&root().join("skills"))
    );
    assert_eq!(
        files_under(&project.join(".claude/skills")),
        files_under(&root().join("skills"))
    );
    // Exactly what `typedpress init` writes: nothing is out of date.
    let current = init(&project, &["--check"]);
    assert_eq!(current.status.code(), Some(0), "{}", text(&current.stderr));
    // The scaffolder's own files are as before.
    assert!(project.join("typedpress.config.ts").is_file() && project.join("package.json").is_file());

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
        .arg(root().join("packages/create-typedpress/bin/create-typedpress.mjs"))
        .arg(&other)
        .arg("--no-install")
        .env("TP_BIN", &failing)
        .output()
        .unwrap();
    assert!(scaffolded.status.success(), "{}", text(&scaffolded.stderr));
    assert!(
        text(&scaffolded.stdout).contains("  npx typedpress init "),
        "{}",
        text(&scaffolded.stdout)
    );
    assert!(other.join("typedpress.config.ts").is_file() && !other.join("AGENTS.md").exists());
}

/// `typedpress init --github` writes the content sync workflow at the repository's root, with the
/// project's synced folders as its push paths; reruns keep it in step until its header line is
/// deleted. With `ACTIONLINT` set (a path to actionlint), the file is also linted.
#[test]
fn init_github_writes_the_sync_workflow_and_keeps_it_in_step() {
    let dir = tempfile::tempdir().unwrap();
    let repo = dir.path();
    let project = repo.join("site");
    std::fs::create_dir_all(&project).unwrap();
    let config = |dirs: &[&str]| {
        let kinds: Vec<String> = dirs
            .iter()
            .enumerate()
            .map(|(i, d)| {
                format!("export const k{i} = collection({{ title: text(), body: richText().optional() }}, {{ content: \"body\", sync: \"{d}/*.md\" }});\n")
            })
            .collect();
        format!(
            "import {{ defineConfig, collection, text, richText }} from \"typedpress\";\n{}export default defineConfig({{ name: \"gh\" }});\n",
            kinds.concat()
        )
    };
    std::fs::write(project.join("typedpress.config.ts"), config(&["content/posts"])).unwrap();
    // Outside a git repository there is no root for GitHub to read the workflow from: refused.
    let out = init(&project, &["--github"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(text(&out.stderr).contains("git repository"), "{}", text(&out.stderr));
    let git = Command::new("git").args(["init", "-q"]).arg(repo).output().unwrap();
    assert!(git.status.success());
    let path = repo.join(".github/workflows/typedpress-sync.yml");

    // Without --github: no workflow.
    let out = init(&project, &[]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert!(!path.exists());

    let out = init(&project, &["--github"]);
    assert!(out.status.success(), "{}", text(&out.stderr));
    assert!(
        text(&out.stdout).contains(&format!(
            "wrote {}",
            std::path::Path::new("..")
                .join(".github/workflows/typedpress-sync.yml")
                .display()
        )),
        "{}",
        text(&out.stdout)
    );
    let workflow = std::fs::read_to_string(&path).unwrap();
    for expected in [
        "# Written by `typedpress init --github` for site; delete this line to keep your own edits.\n",
        "  push:\n    branches: [\"**\"]\n",
        "    types: [typedpress-content-changed]\n",
        "  schedule:\n",
        "      - \"site/content/posts/**\"\n",
        "        working-directory: \"site\"\n",
        "  contents: write\n  pull-requests: write\n",
        "run: npx --no-install typedpress sync --pr --site \"$TP_SITE_URL\"\n",
        "TP_APP_PASSWORD: ${{ secrets.TP_APP_PASSWORD }}\n",
    ] {
        assert!(workflow.contains(expected), "{expected:?} in\n{workflow}");
    }
    // Every action is pinned by a full commit SHA.
    for line in workflow.lines().filter(|l| l.contains("uses: ")) {
        let pin = line.split('@').nth(1).unwrap().split_whitespace().next().unwrap();
        assert!(pin.len() == 40 && pin.bytes().all(|b| b.is_ascii_hexdigit()), "{line}");
    }
    if let Some(actionlint) = std::env::var_os("ACTIONLINT") {
        let lint = Command::new(actionlint).arg(&path).output().unwrap();
        assert!(lint.status.success(), "{}{}", text(&lint.stdout), text(&lint.stderr));
    }

    // In step: --check passes, and a rerun without --github writes nothing.
    assert!(init(&project, &["--check"]).status.success());
    // A new synced folder: typedpress check says so, --check fails, and a plain rerun updates the paths.
    std::fs::write(project.join("typedpress.config.ts"), config(&["content/posts", "docs"])).unwrap();
    let checked = first().arg("check").arg(&project).output().unwrap();
    assert!(
        text(&checked.stderr).contains(".github/workflows/typedpress-sync.yml is out of date"),
        "{}",
        text(&checked.stderr)
    );
    assert_eq!(init(&project, &["--check"]).status.code(), Some(1));
    assert!(init(&project, &[]).status.success());
    assert!(
        std::fs::read_to_string(&path)
            .unwrap()
            .contains("      - \"site/docs/**\"\n")
    );

    // Another project in the same repository: its plain typedpress init and typedpress check leave this
    // project's workflow alone, and its --github refuses to take it.
    let other = repo.join("other");
    std::fs::create_dir_all(&other).unwrap();
    std::fs::write(other.join("typedpress.config.ts"), config(&["notes"])).unwrap();
    let ours = std::fs::read_to_string(&path).unwrap();
    assert!(init(&other, &[]).status.success());
    assert_eq!(
        std::fs::read_to_string(&path).unwrap(),
        ours,
        "another project's init never rewrites it"
    );
    let checked = first().arg("check").arg(&other).output().unwrap();
    assert!(
        !text(&checked.stderr).contains("typedpress-sync.yml"),
        "{}",
        text(&checked.stderr)
    );
    let taken = init(&other, &["--github"]);
    assert_eq!(taken.status.code(), Some(1));
    assert!(
        text(&taken.stderr).contains("written for the project at site"),
        "{}",
        text(&taken.stderr)
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), ours);
    assert!(init(&project, &["--check"]).status.success());

    // Its header line deleted, the file is the author's: never rewritten, never reported, and
    // --github says so rather than replace it.
    let mine = std::fs::read_to_string(&path)
        .unwrap()
        .replacen("# Written by", "# Adapted from", 1);
    std::fs::write(&path, &mine).unwrap();
    std::fs::write(project.join("typedpress.config.ts"), config(&["content/posts"])).unwrap();
    assert!(init(&project, &[]).status.success());
    let refused = init(&project, &["--github"]);
    assert_eq!(refused.status.code(), Some(1));
    assert!(
        text(&refused.stderr).contains("is your own"),
        "{}",
        text(&refused.stderr)
    );
    assert_eq!(std::fs::read_to_string(&path).unwrap(), mine);
    let checked = first().arg("check").arg(&project).output().unwrap();
    assert!(
        !text(&checked.stderr).contains("typedpress-sync.yml"),
        "{}",
        text(&checked.stderr)
    );
}

/// What `typedpress init` must leave alone: an author's prose that quotes a marker, the formatting of
/// their `.mcp.json`, a link they made, the permissions of their files, a skills directory they
/// removed, and anything outside the project.
#[cfg(unix)]
#[test]
fn init_keeps_the_authors_files_as_they_wrote_them_and_writes_only_inside_the_project() {
    use std::os::unix::fs::PermissionsExt as _;
    let dir = tempfile::tempdir().unwrap();
    let project = dir.path().join("kit");
    copy_tree(&agent_kit(), &project);
    let read = |name: &str| std::fs::read_to_string(project.join(name)).unwrap();

    // A marker quoted in prose is text: the section goes after it, and a rerun keeps the prose.
    let prose = "Do not edit below `<!-- typedpress:begin -->`.\n\n# Team notes\n\nRule A.\n";
    std::fs::write(project.join("AGENTS.md"), prose).unwrap();
    // The author's .mcp.json: its numbers and layout are theirs.
    let mcp =
        "{\"t\":1e3,\"big\":123456789012345678901234567890,\n    \"mcpServers\": {\"x\": {\"command\": \"y\"}}}\n";
    std::fs::write(project.join(".mcp.json"), mcp).unwrap();
    assert!(init(&project, &[]).status.success());
    let agents = read("AGENTS.md");
    assert!(agents.starts_with(prose), "{agents}");
    assert_eq!(agents.matches("\n<!-- typedpress:begin -->\n").count(), 1);
    assert!(init(&project, &[]).status.success());
    assert!(read("AGENTS.md").starts_with(prose));
    let written = read(".mcp.json");
    assert!(
        written.starts_with("{\"t\":1e3,\"big\":123456789012345678901234567890,\n    \"mcpServers\": {"),
        "{written}"
    );
    assert!(written.ends_with("\"x\": {\"command\": \"y\"}}}\n"), "{written}");
    let parsed: serde_json::Value = serde_json::from_str(&written).unwrap();
    assert_eq!(parsed["mcpServers"]["typedpress"]["args"][2], "mcp");
    assert_eq!(init(&project, &["--check"]).status.code(), Some(0));

    // Permissions: an existing file keeps its own; a new one gets what any new file gets.
    std::fs::set_permissions(project.join("AGENTS.md"), std::fs::Permissions::from_mode(0o664)).unwrap();
    std::fs::write(
        project.join("tp/schema.ts"),
        read("tp/schema.ts") + "\nexport const extra = table({ n: text() });\n",
    )
    .unwrap();
    assert!(init(&project, &[]).status.success());
    let mode = |name: &str| std::fs::metadata(project.join(name)).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode("AGENTS.md"), 0o664);
    let fresh = dir.path().join("fresh");
    std::fs::write(&fresh, "").unwrap();
    let usual = std::fs::metadata(&fresh).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(".agents/skills/typedpress-add-kind/SKILL.md"), usual);

    // A skills directory the author deleted stays deleted, and nothing reports it out of date.
    std::fs::remove_dir_all(project.join(".claude")).unwrap();
    assert_eq!(init(&project, &["--check"]).status.code(), Some(0));
    let checked = first().arg("check").arg(&project).output().unwrap();
    assert!(
        !text(&checked.stderr).contains("typedpress init"),
        "{}",
        text(&checked.stderr)
    );
    assert!(init(&project, &[]).status.success());
    assert!(!project.join(".claude").exists());

    // AGENTS.md as a link to another file of the project: written through, and still a link.
    let linked = dir.path().join("linked");
    copy_tree(&agent_kit(), &linked);
    std::fs::write(linked.join("CLAUDE.md"), "# Mine\n").unwrap();
    std::os::unix::fs::symlink("CLAUDE.md", linked.join("AGENTS.md")).unwrap();
    assert!(init(&linked, &[]).status.success());
    assert!(
        std::fs::symlink_metadata(linked.join("AGENTS.md"))
            .unwrap()
            .file_type()
            .is_symlink()
    );
    let claude = std::fs::read_to_string(linked.join("CLAUDE.md")).unwrap();
    assert!(
        claude.starts_with("# Mine\n") && claude.contains("<!-- typedpress:begin -->"),
        "{claude}"
    );

    // A skills directory that links out of the project is refused before anything is written.
    let escaping = dir.path().join("escaping");
    copy_tree(&agent_kit(), &escaping);
    let outside = dir.path().join("outside");
    std::fs::create_dir(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, escaping.join(".claude")).unwrap();
    let refused = init(&escaping, &[]);
    assert_eq!(refused.status.code(), Some(1));
    assert!(
        text(&refused.stderr).contains(".claude is a symbolic link"),
        "{}",
        text(&refused.stderr)
    );
    assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 0);
    assert!(!escaping.join("AGENTS.md").exists() && !escaping.join(".agents").exists());
}

/// A server started with no PATH (a client that passes a bare environment) still compiles: what
/// it runs around a command needs no program from PATH.
#[test]
fn mcp_compiles_with_no_path() {
    let mut mcp = Mcp::start(&agent_kit(), &[], |command| {
        command.env("PATH", "");
    });
    mcp.modern = true;
    assert_eq!(mcp.ok("check", serde_json::json!({}))["ok"], true);
    assert_eq!(mcp.ok("schema", serde_json::json!({}))["name"], "agentkit");
    mcp.finish();
}

/// A client that kills the server (SIGTERM, as the stdio transport's shutdown escalates to) leaves
/// nothing the server started running.
#[cfg(unix)]
#[test]
fn mcp_killed_by_its_client_leaves_no_command_running() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("typedpress.config.ts"), CONFIG).unwrap();
    let pids = tempfile::tempdir().unwrap();
    let wp = scripted_wp(&format!("sleep 600 & echo $! > {}/$$; wait", pids.path().display()));
    let mut mcp = Mcp::start(project.path(), &["--allow-remote-read"], |command| {
        with_path(command, wp.path())
    });
    mcp.write(
        &serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": { "name": "query", "arguments": { "kind": "notes", "site": "@slow" }, "_meta": modern_meta() } })
        .to_string(),
    );
    let started = || -> Vec<PathBuf> {
        std::fs::read_dir(pids.path())
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect()
    };
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
    while started().is_empty() || !running(&started()[0]) {
        assert!(std::time::Instant::now() < deadline, "the site command never started");
        std::thread::yield_now();
    }
    let server = mcp.child.id();
    assert!(Command::new("kill").arg(server.to_string()).status().unwrap().success());
    mcp.child.wait().unwrap();
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while running(&started()[0]) {
        assert!(std::time::Instant::now() < deadline, "the command outlived the server");
        std::thread::yield_now();
    }
}

/// `dev_status` on a site with no state file asks Studio through `npx`; a hung `npx` (offline, a
/// stalled registry) is stopped at the server's timeout, and the next request is answered.
#[cfg(unix)]
#[test]
fn mcp_dev_status_is_bounded_by_the_servers_timeout() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(project.path().join("typedpress.config.ts"), CONFIG).unwrap();
    // A site `typedpress dev` created, from before the state file.
    std::fs::create_dir_all(project.path().join(".tp/dev")).unwrap();
    std::fs::write(project.path().join(".tp/dev/owner.json"), r#"{"created":true}"#).unwrap();
    let tools = tempfile::tempdir().unwrap();
    let npx = tools.path().join("npx");
    std::fs::write(&npx, "#!/bin/sh\nsleep 600\n").unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&npx, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let mut mcp = Mcp::start(project.path(), &[], |command| {
        with_path(command, tools.path());
        command.env("TP_MCP_TIMEOUT", "2");
    });
    mcp.modern = true;
    let started = std::time::Instant::now();
    let refused = mcp.refused("dev_status", serde_json::json!({}));
    assert!(refused.contains("took longer than 2 seconds"), "{refused}");
    assert!(started.elapsed() < std::time::Duration::from_secs(60));
    assert!(
        mcp.result("server/discover", serde_json::json!({}))
            .get("supportedVersions")
            .is_some()
    );
    mcp.finish();
}
