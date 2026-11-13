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
        "usage: first jobs list [--state=s] | run <id> | retry <id> | cancel <id> | maintain\n"
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

/// A project from the scaffolder, as `npm create @spacefast/first` writes it, without the npm install.
fn scaffold(parent: &Path) -> PathBuf {
    let project = parent.join("app");
    let created = Command::new("node")
        .arg(root().join("packages/create-first/bin/create-first.mjs"))
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

/// Every file under `dir` with its bytes, sorted, leaving out what a build writes.
fn tree(dir: &Path) -> Vec<(String, Vec<u8>)> {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.strip_prefix(root).unwrap().to_string_lossy().into_owned();
            if path.is_dir() {
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

/// `first add db` on a fresh scaffold: the project still checks and builds, the build plans the
/// tables with their foreign key, and the typed client example type-checks against the generated
/// client. Needs node and tsc (or TSC), as the other generated-client tests do.
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

    let added = add(&project, &["db"]);
    assert_eq!(added.status.code(), Some(0), "{}", text(&added.stderr));
    let report = text(&added.stdout);
    for file in ["first/tables.ts", "tables.client.ts", "first/DATABASE.md"] {
        assert!(project.join(file).is_file(), "{file}");
        assert!(
            report.lines().any(|l| l.contains("created") && l.contains(file)),
            "{report}"
        );
    }

    let checked = first().arg("check").arg(&project).output().unwrap();
    assert_eq!(checked.status.code(), Some(0), "{}", text(&checked.stderr));
    assert!(
        text(&checked.stdout).contains("1 collections, 2 tables"),
        "{}",
        text(&checked.stdout)
    );
    let built = first().arg("build").arg(&project).output().unwrap();
    assert_eq!(built.status.code(), Some(0), "{}", text(&built.stderr));
    let sql = std::fs::read_to_string(project.join("first/_generated/migrations/0001_init.sql")).unwrap();
    assert!(sql.contains("CREATE TABLE `{prefix}first_projects`"), "{sql}");
    assert!(
        sql.contains("FOREIGN KEY (`projectId`) REFERENCES `{prefix}first_projects` (`id`) ON DELETE CASCADE"),
        "{sql}"
    );
    // The scaffold's own kind stays a WordPress post type: it gets no table.
    assert!(!sql.contains("first_notes"), "{sql}");

    std::fs::write(
        project.join("tsconfig.test.json"),
        serde_json::to_vec(&serde_json::json!({
            "compilerOptions": {
                "strict": true, "noEmit": true, "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
                "allowImportingTsExtensions": true, "types": [],
                "paths": { "first": [root().join("types/first/index.d.ts")] }
            },
            "files": ["first.config.ts", "first/tables.ts", "tables.client.ts", "client.ts", "first/_generated/db.d.ts"]
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
}

#[test]
fn add_only_creates_missing_files_and_never_changes_one_that_is_there() {
    let tmp = tempfile::tempdir().unwrap();
    let project = scaffold(tmp.path());
    // The author already has a file where the module would put its tables.
    std::fs::create_dir_all(project.join("first")).unwrap();
    let mine = "import { table, text } from \"first\";\nexport const orders = table({ code: text().max(40) });\n";
    std::fs::write(project.join("first/tables.ts"), mine).unwrap();

    let added = add(&project, &["db"]);
    assert_eq!(added.status.code(), Some(0), "{}", text(&added.stderr));
    let report = text(&added.stdout);
    assert!(
        report
            .lines()
            .any(|l| l.contains("kept") && l.contains("first/tables.ts")),
        "{report}"
    );
    assert!(
        report
            .lines()
            .any(|l| l.contains("created") && l.contains("first/DATABASE.md")),
        "{report}"
    );
    assert_eq!(std::fs::read_to_string(project.join("first/tables.ts")).unwrap(), mine);

    // Edits survive a second run, which has nothing left to add.
    std::fs::write(project.join("first/DATABASE.md"), "my notes\n").unwrap();
    let state = tree(&project);
    let again = add(&project, &["db"]);
    assert_eq!(again.status.code(), Some(0), "{}", text(&again.stderr));
    assert!(
        text(&again.stdout).contains("nothing to add"),
        "{}",
        text(&again.stdout)
    );
    assert_eq!(tree(&project), state);

    // A deleted file comes back; the others are still not touched.
    std::fs::remove_file(project.join("tables.client.ts")).unwrap();
    let third = add(&project, &["db"]);
    assert_eq!(third.status.code(), Some(0), "{}", text(&third.stderr));
    assert!(project.join("tables.client.ts").is_file());
    assert_eq!(std::fs::read_to_string(project.join("first/tables.ts")).unwrap(), mine);
    assert_eq!(
        std::fs::read_to_string(project.join("first/DATABASE.md")).unwrap(),
        "my notes\n"
    );

    // A link that points nowhere is something of the author's too: it is neither followed nor replaced.
    #[cfg(unix)]
    {
        std::fs::remove_file(project.join("tables.client.ts")).unwrap();
        std::os::unix::fs::symlink(tmp.path().join("elsewhere.ts"), project.join("tables.client.ts")).unwrap();
        let linked = add(&project, &["db"]);
        assert_eq!(linked.status.code(), Some(0), "{}", text(&linked.stderr));
        assert!(!tmp.path().join("elsewhere.ts").exists());
        assert!(
            project
                .join("tables.client.ts")
                .symlink_metadata()
                .unwrap()
                .is_symlink()
        );
    }
}

#[test]
fn add_changes_nothing_when_the_project_or_the_result_does_not_compile() {
    let tmp = tempfile::tempdir().unwrap();
    let project = scaffold(tmp.path());
    // An export of the author's already uses a name the module's example exports.
    std::fs::create_dir_all(project.join("first/server")).unwrap();
    std::fs::write(
        project.join("first/server/tasks.ts"),
        "import { action } from \"first\";\nexport const tasks = action({ input: {}, async handler() { return 1; } });\n",
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
    std::fs::write(project.join("first/server/tasks.ts"), "export const broken = ;\n").unwrap();
    let state = tree(&project);
    let broken = add(&project, &["db"]);
    assert_eq!(broken.status.code(), Some(1), "{}", text(&broken.stdout));
    assert!(
        text(&broken.stderr).contains("first/server/tasks.ts:1"),
        "{}",
        text(&broken.stderr)
    );
    assert!(
        text(&broken.stderr).contains("Nothing was added"),
        "{}",
        text(&broken.stderr)
    );
    assert_eq!(tree(&project), state);

    // With no first/ directory yet, a refused add doesn't leave an empty one behind.
    let bare = tmp.path().join("bare");
    std::fs::create_dir_all(&bare).unwrap();
    std::fs::write(
        bare.join("first.config.ts"),
        "import { action, defineConfig } from \"first\";\nexport default defineConfig({ name: \"bare\", actions: { projects: action({ input: {}, async handler() { return 1; } }) } });\n",
    )
    .unwrap();
    let state = tree(&bare);
    let refused = add(&bare, &["db"]);
    assert_eq!(refused.status.code(), Some(1), "{}", text(&refused.stdout));
    assert_eq!(tree(&bare), state);
}

#[test]
fn add_names_its_modules_when_the_module_is_missing_or_unknown() {
    let modules = "usage: first add <module> [dir]\nmodules:\n  db  ";
    let none = first().arg("add").output().unwrap();
    assert_eq!(none.status.code(), Some(2));
    assert!(
        text(&none.stderr).starts_with(&format!("first add needs a module\n{modules}")),
        "{}",
        text(&none.stderr)
    );
    let tmp = tempfile::tempdir().unwrap();
    let unknown = add(tmp.path(), &["pages"]);
    assert_eq!(unknown.status.code(), Some(2));
    assert!(
        text(&unknown.stderr).starts_with(&format!("no module pages\n{modules}")),
        "{}",
        text(&unknown.stderr)
    );
    let option = add(tmp.path(), &["db", "--force"]);
    assert_eq!(option.status.code(), Some(2));
    assert!(
        text(&option.stderr).starts_with("unknown option --force for first add\n"),
        "{}",
        text(&option.stderr)
    );
    assert!(std::fs::read_dir(tmp.path()).unwrap().next().is_none());
}
