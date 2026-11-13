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

/// A project from the scaffolder, as `npm create @spacefast/first` writes it, without the npm
/// install. Its directory name has a space, as a real one may.
fn scaffold(parent: &Path) -> PathBuf {
    let project = parent.join("my app");
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

/// The report line `first add` printed for `file`: "created", "kept" or "skipped", and its reason.
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

/// `first add db` on a fresh scaffold: the project still checks and builds, the build plans the
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
    for file in ["first/tables.ts", "tables.client.ts", "first/DATABASE.md"] {
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
    let mut ledger: Vec<String> = std::fs::read_dir(project.join("first/_generated/migrations"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    ledger.sort();
    assert_eq!(ledger, ["0001_init.sql", "snapshot.json"]);
    let sql = std::fs::read_to_string(project.join("first/_generated/migrations/0001_init.sql")).unwrap();
    assert_eq!(sql.matches("CREATE TABLE `{prefix}first_projects`").count(), 1, "{sql}");
    assert!(
        sql.contains("FOREIGN KEY (`project`) REFERENCES `{prefix}first_projects` (`id`) ON DELETE CASCADE"),
        "{sql}"
    );
    // The scaffold's own kind stays a WordPress post type: it gets no table.
    assert!(!sql.contains("first_notes"), "{sql}");

    // The scaffold's own tsconfig covers the new files. Only the path to the types differs here,
    // where nothing is installed from npm.
    std::fs::write(
        project.join("tsconfig.test.json"),
        serde_json::to_vec(&serde_json::json!({
            "extends": "./tsconfig.json",
            "compilerOptions": { "types": [], "paths": { "first": [root().join("types/first/index.d.ts")] } }
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
    for file in ["first/tables.ts", "tables.client.ts"] {
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
        std::fs::read_to_string(project.join("first/tables.ts")).unwrap()
    );
    std::fs::write(project.join("first/tables.ts"), &mine).unwrap();
    std::fs::write(project.join("first/DATABASE.md"), "my notes\n").unwrap();
    let state = tree(&project);
    let again = add(&project, &["db"]);
    assert_eq!(again.status.code(), Some(0), "{}", text(&again.stderr));
    let report = text(&again.stdout);
    assert!(report.starts_with("first add db: nothing to add\n"), "{report}");
    for file in ["first/tables.ts", "tables.client.ts", "first/DATABASE.md"] {
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
    std::fs::create_dir_all(project.join("first")).unwrap();
    let mine = "import { table, text } from \"first\";\nexport const orders = table({ code: text().max(40) });\n";
    // At the module's own path first, then anywhere else under first/.
    for (at, status) in [("first/tables.ts", "kept"), ("first/schema.ts", "skipped")] {
        std::fs::write(project.join(at), mine).unwrap();
        let _ = std::fs::remove_file(project.join("first/DATABASE.md"));
        let added = add(&project, &["db"]);
        assert_eq!(added.status.code(), Some(0), "{}", text(&added.stderr));
        let report = text(&added.stdout);
        assert_eq!(reported(&report, "first/tables.ts").0, status, "{report}");
        let (client, why) = reported(&report, "tables.client.ts");
        assert_eq!(client, "skipped", "{report}");
        assert!(why.contains("`projects`"), "{report}");
        assert_eq!(reported(&report, "first/DATABASE.md").0, "created", "{report}");
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
    assert!(project.join("first/tables.ts").is_file() && project.join("tables.client.ts").is_file());
    std::fs::remove_file(project.join("first/tables.ts")).unwrap();
    std::fs::remove_file(project.join("tables.client.ts")).unwrap();
    std::fs::write(project.join("first/schema.ts"), mine).unwrap();
    let state = tree(&project);
    let again = add(&project, &["db"]);
    assert_eq!(again.status.code(), Some(0), "{}", text(&again.stderr));
    assert!(text(&again.stdout).starts_with("first add db: nothing to add\n"));
    assert_eq!(tree(&project), state);
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

    // A directory that isn't a project says so, and gets nothing.
    let empty = tmp.path().join("empty");
    std::fs::create_dir_all(&empty).unwrap();
    let none = add(&empty, &["db"]);
    assert_eq!(none.status.code(), Some(1));
    assert!(
        text(&none.stderr).starts_with("first add db: no first.config.ts in "),
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
        .arg(env!("CARGO_BIN_EXE_first"))
        .args(["add", "db"])
        .arg(&project)
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1), "{}{}", text(&out.stdout), text(&out.stderr));
    assert!(
        text(&out.stderr).contains("can't write first/tables.ts") && text(&out.stderr).contains("Nothing was added"),
        "{}",
        text(&out.stderr)
    );
    assert_eq!(tree(&project), state);
    // The project still compiles, and the next run adds everything.
    let added = add(&project, &["db"]);
    assert_eq!(added.status.code(), Some(0), "{}", text(&added.stderr));
    assert_eq!(reported(&text(&added.stdout), "first/tables.ts").0, "created");
}

#[test]
fn add_names_its_modules_when_the_module_is_missing_or_unknown() {
    // `first help add` lists the modules; the command table's summary names each of them.
    let help = first().args(["help", "add"]).output().unwrap();
    assert_eq!(help.status.code(), Some(0));
    let modules = text(&help.stdout);
    assert!(
        modules.starts_with("usage: first add <module> [dir]\nmodules:\n  db  "),
        "{modules}"
    );
    let table: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("runtime/First/Cli/commands.json")).unwrap()).unwrap();
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
    assert_eq!(text(&none.stderr), format!("first add needs a module\n{modules}"));
    let tmp = tempfile::tempdir().unwrap();
    let unknown = add(tmp.path(), &["pages"]);
    assert_eq!(unknown.status.code(), Some(2));
    assert_eq!(text(&unknown.stderr), format!("no module pages\n{modules}"));
    let option = add(tmp.path(), &["db", "--force"]);
    assert_eq!(option.status.code(), Some(2));
    assert_eq!(
        text(&option.stderr),
        format!("unknown option --force for first add\n{modules}")
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
        .arg(project.join("first/dist/wp-content"))
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
    let base = format!("{}/__first/api/v1", served["url"].as_str().unwrap());
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
