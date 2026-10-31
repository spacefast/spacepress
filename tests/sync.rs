//! `zero sync` against a real standalone app (design §5.7): a project is built with `zero build`,
//! served with `php -S`, and synced with the `zero` binary. Each step drives the CLI and checks the
//! files, the site (over its API) and the exit code.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};

const CONFIG: &str = r#"import { collection, id, integer, richText, select, slug, text, defineConfig } from "zero";

const people = collection("people", {
  id: id(),
  name: text().notNull(),
}, { editor: false, uid: true, access: { read: "anyone" } });

const notes = collection("notes", {
  id: id(),
  title: text().notNull(),
  slug: slug({ source: "title" }),
  body: richText(),
  level: select({ options: ["intro", "advanced"] }),
  authorId: integer().references(() => people.id, { onDelete: "set null" }),
}, { editor: false, title: "title", content: "body", sync: "content/notes/*.md", access: { read: "anyone" } });

// A JSON collection without a content column: `body` is an ordinary field.
const snippets = collection("snippets", {
  id: id(),
  name: text().notNull(),
  body: text(),
}, { editor: false, sync: "content/snippets/*.json", access: { read: "anyone" } });

// Two collections that reference each other.
const teams = collection("teams", {
  id: id(),
  name: text().notNull(),
  leadId: integer().references((): any => players.id, { onDelete: "set null" }),
}, { editor: false, sync: "content/teams/*.json", access: { read: "anyone" } });
const players = collection("players", {
  id: id(),
  name: text().notNull(),
  teamId: integer().references(() => teams.id, { onDelete: "set null" }),
}, { editor: false, sync: "content/players/*.json", access: { read: "anyone" } });

export default defineConfig({ name: "notes", schema: { people, notes, snippets, teams, players } });
"#;

struct Site {
    child: Child,
    port: u16,
    token: String,
    /// An author's token: signed in, but the collections' update rule is "editor".
    author: String,
}

impl Drop for Site {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Site {
    fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn call(&self, method: &str, path: &str, body: Option<serde_json::Value>) -> (u16, serde_json::Value) {
        let mut s = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        let body = body.map(|b| b.to_string()).unwrap_or_default();
        let request = format!(
            "{method} /api{path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nAuthorization: Bearer {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            self.token,
            body.len()
        );
        s.write_all(request.as_bytes()).unwrap();
        let mut raw = String::new();
        s.read_to_string(&mut raw).unwrap();
        let status = raw[9..12].parse().unwrap();
        let json = raw.split_once("\r\n\r\n").map(|(_, b)| b).unwrap_or("");
        (status, serde_json::from_str(json).unwrap_or(serde_json::Value::Null))
    }

    fn rows(&self, collection: &str) -> Vec<serde_json::Value> {
        let (s, out) = self.call("GET", &format!("/{collection}?limit=200&orderBy=id"), None);
        assert_eq!(s, 200, "{out}");
        out["data"].as_array().unwrap().clone()
    }
}

fn zero() -> Command {
    Command::new(env!("CARGO_BIN_EXE_zero"))
}

fn git(project: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(project).args(args).output().unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap()
}

fn setup() -> (PathBuf, Site) {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let project = std::env::temp_dir().join(format!("zero-sync-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&project);
    std::fs::create_dir_all(project.join("content/notes")).unwrap();
    std::fs::write(project.join("zero.config.ts"), CONFIG).unwrap();
    let out = zero().arg("build").arg(&project).output().unwrap();
    assert!(out.status.success(), "build: {}", String::from_utf8_lossy(&out.stderr));
    let cli = |args: &[&str]| {
        let out = zero().args(args).arg("--dir").arg(&project).output().unwrap();
        assert!(
            out.status.success(),
            "{args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        serde_json::from_slice::<serde_json::Value>(&out.stdout).unwrap()
    };
    cli(&["users", "add", "ed", "--role", "editor"]);
    cli(&["users", "add", "au", "--role", "author"]);
    let token = cli(&["tokens", "create", "ed"])["data"]["token"]
        .as_str()
        .unwrap()
        .to_string();
    let author = cli(&["tokens", "create", "au"])["data"]["token"]
        .as_str()
        .unwrap()
        .to_string();
    let app = project.join(".zero/app");
    let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let child = Command::new("php")
        .args(["-S", &format!("127.0.0.1:{port}"), "-t"])
        .arg(app.join("public"))
        .arg(app.join("public/index.php"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("php -S");
    let deadline = Instant::now() + Duration::from_secs(10);
    while TcpStream::connect(("127.0.0.1", port)).is_err() {
        assert!(Instant::now() < deadline, "php -S didn't start");
        std::thread::yield_now();
    }
    git(&project, &["init", "-q"]);
    git(
        &project,
        &[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.test",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "start",
        ],
    );
    (
        project,
        Site {
            child,
            port,
            token,
            author,
        },
    )
}

fn sync(project: &Path, site: &Site, extra: &[&str]) -> Output {
    zero()
        .arg("sync")
        .args(extra)
        .arg(project)
        .args(["--site", &site.url(), "--token", &site.token, "--json"])
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@example.test")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@example.test")
        .output()
        .unwrap()
}

fn data(out: &Output) -> serde_json::Value {
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or_else(|_| {
        panic!(
            "stdout {} stderr {}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        )
    });
    json.get("data").cloned().unwrap_or_else(|| panic!("{json}"))
}

fn read(project: &Path, rel: &str) -> String {
    std::fs::read_to_string(project.join(rel)).unwrap_or_else(|e| panic!("{rel}: {e}"))
}

#[test]
fn syncs_files_and_records_both_ways_against_a_standalone_app() {
    let (project, site) = setup();

    // A file written by hand (no uid yet) and a record created on the site.
    std::fs::write(project.join("content/notes/hello.md"), "---\ntitle: Hello\nslug: hello\nlevel: intro\nauthorId: null\n---\n# Hello\n\nFirst paragraph.\n\nSecond paragraph.\n").unwrap();
    let (s, ada) = site.call("POST", "/people", Some(serde_json::json!({"name": "Ada"})));
    assert_eq!(s, 201, "{ada}");
    let (s, made) = site.call("POST", "/notes", Some(serde_json::json!({"title": "From the site", "authorId": ada["data"]["id"], "body": "<!-- wp:paragraph -->\n<p>Made <strong>online</strong>.</p>\n<!-- /wp:paragraph -->"})));
    assert_eq!(s, 201, "{made}");

    // --check: exit 2, nothing written anywhere.
    let check = sync(&project, &site, &["--check"]);
    assert_eq!(
        check.status.code(),
        Some(2),
        "{}",
        String::from_utf8_lossy(&check.stdout)
    );
    assert!(!read(&project, "content/notes/hello.md").contains("uid:"));
    assert_eq!(site.rows("notes").len(), 1);

    // First run: the file gets a uid and is pushed; the site's record becomes a file; one commit
    // holding only what sync wrote.
    std::fs::write(project.join("unrelated.txt"), "not sync's").unwrap();
    let first = sync(&project, &site, &[]);
    assert_eq!(
        first.status.code(),
        Some(0),
        "{}{}",
        String::from_utf8_lossy(&first.stdout),
        String::from_utf8_lossy(&first.stderr)
    );
    let hello = read(&project, "content/notes/hello.md");
    let uid = hello
        .lines()
        .find_map(|l| l.strip_prefix("uid: "))
        .expect("a uid was written")
        .to_string();
    let rows = site.rows("notes");
    let pushed = rows
        .iter()
        .find(|r| r["uid"] == uid.as_str())
        .expect("the file was pushed");
    assert!(
        pushed["body"].as_str().unwrap().contains("<!-- wp:heading"),
        "stored as blocks: {pushed}"
    );
    let pulled = read(&project, "content/notes/from-the-site.md");
    assert!(
        pulled.contains(&format!("authorId: {}", ada["data"]["uid"].as_str().unwrap())),
        "references travel as uids:\n{pulled}"
    );
    assert!(pulled.ends_with("---\nMade **online**.\n"), "{pulled}");
    let committed = git(&project, &["show", "--name-only", "--format=%s", "HEAD"]);
    assert!(committed.starts_with("zero sync: "), "{committed}");
    assert!(
        committed.contains("content/notes/hello.md")
            && committed.contains(".zero/sync-base.json")
            && !committed.contains("unrelated.txt"),
        "{committed}"
    );

    // A second run changes nothing and commits nothing.
    let head = git(&project, &["rev-parse", "HEAD"]);
    let second = sync(&project, &site, &[]);
    assert_eq!(
        (second.status.code(), data(&second)["applied"].as_u64()),
        (Some(0), Some(0)),
        "{}",
        String::from_utf8_lossy(&second.stdout)
    );
    assert_eq!(git(&project, &["rev-parse", "HEAD"]), head);

    // Both sides change different fields and different paragraphs: everything merges.
    let id = pushed["id"].as_i64().unwrap();
    std::fs::write(
        project.join("content/notes/hello.md"),
        hello
            .replace("level: intro", "level: advanced")
            .replace("First paragraph.", "First paragraph, edited in the file."),
    )
    .unwrap();
    let blocks = pushed["body"]
        .as_str()
        .unwrap()
        .replace("Second paragraph.", "Second paragraph, edited on the site.");
    let (s, edited) = site.call(
        "PATCH",
        &format!("/notes/{id}"),
        Some(serde_json::json!({"body": blocks, "title": "Hello there"})),
    );
    assert_eq!(s, 200, "{edited}");
    let merged = sync(&project, &site, &[]);
    assert_eq!(
        merged.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&merged.stdout)
    );
    let row = site.rows("notes").into_iter().find(|r| r["id"] == id).unwrap();
    assert_eq!(
        (row["level"].as_str(), row["title"].as_str()),
        (Some("advanced"), Some("Hello there"))
    );
    assert!(
        row["body"].as_str().unwrap().contains("edited in the file")
            && row["body"].as_str().unwrap().contains("edited on the site"),
        "{row}"
    );
    // The slug didn't change, so the file stays where it was, now holding both edits.
    let both = read(&project, "content/notes/hello.md");
    assert!(
        both.contains("title: Hello there") && both.contains("edited on the site"),
        "{both}"
    );

    // The same field changed differently on both sides: a conflict file, neither side touched.
    std::fs::write(
        project.join("content/notes/hello.md"),
        both.replace("title: Hello there", "title: Local title"),
    )
    .unwrap();
    let (s, _) = site.call(
        "PATCH",
        &format!("/notes/{id}"),
        Some(serde_json::json!({"title": "Remote title"})),
    );
    assert_eq!(s, 200);
    let conflicted = sync(&project, &site, &[]);
    assert_eq!(conflicted.status.code(), Some(0));
    let report = data(&conflicted);
    assert_eq!(report["conflicts"].as_array().unwrap().len(), 1, "{report}");
    let conflict = read(&project, &format!(".zero/conflicts/{uid}.md"));
    assert!(
        conflict.contains("# Fields: /fields/title")
            && conflict.contains("<<<<<<< files")
            && conflict.contains("||||||| base")
            && conflict.contains(">>>>>>> site"),
        "{conflict}"
    );
    assert!(read(&project, "content/notes/hello.md").contains("title: Local title"));
    assert_eq!(
        site.rows("notes").into_iter().find(|r| r["id"] == id).unwrap()["title"],
        "Remote title"
    );
    let with_conflict = sync(&project, &site, &["--check"]);
    assert_eq!(
        with_conflict.status.code(),
        Some(2),
        "a pending conflict makes --check exit 2"
    );

    // Resolve: keep the remote version with a new title. Markers left in are refused first.
    let refused = sync(&project, &site, &["resolve", &uid]);
    assert_eq!(refused.status.code(), Some(1));
    let theirs = conflict
        .split("=======\n")
        .nth(1)
        .unwrap()
        .split(">>>>>>> site")
        .next()
        .unwrap();
    let header: String = conflict
        .lines()
        .take_while(|l| l.starts_with('#'))
        .map(|l| format!("{l}\n"))
        .collect();
    std::fs::write(
        project.join(format!(".zero/conflicts/{uid}.md")),
        format!(
            "{header}{}",
            theirs.replace("title: Remote title", "title: Agreed title")
        ),
    )
    .unwrap();
    let resolved = sync(&project, &site, &["resolve", &uid]);
    assert_eq!(
        resolved.status.code(),
        Some(0),
        "{}{}",
        String::from_utf8_lossy(&resolved.stdout),
        String::from_utf8_lossy(&resolved.stderr)
    );
    assert!(!project.join(format!(".zero/conflicts/{uid}.md")).exists());
    assert_eq!(
        site.rows("notes").into_iter().find(|r| r["id"] == id).unwrap()["title"],
        "Agreed title"
    );
    assert!(read(&project, "content/notes/hello.md").contains("title: Agreed title"));
    assert_eq!(
        data(&sync(&project, &site, &[]))["applied"].as_u64(),
        Some(0),
        "resolved means both sides agree"
    );

    // Renaming the slug on the site moves the file.
    let (s, _) = site.call(
        "PATCH",
        &format!("/notes/{id}"),
        Some(serde_json::json!({"slug": "renamed"})),
    );
    assert_eq!(s, 200);
    assert_eq!(sync(&project, &site, &[]).status.code(), Some(0));
    assert!(project.join("content/notes/renamed.md").exists() && !project.join("content/notes/hello.md").exists());

    // Deleting the file deletes the record; deleting the record deletes the file.
    std::fs::remove_file(project.join("content/notes/renamed.md")).unwrap();
    assert_eq!(sync(&project, &site, &[]).status.code(), Some(0));
    assert!(!site.rows("notes").iter().any(|r| r["id"] == id));
    let other = site.rows("notes")[0]["id"].as_i64().unwrap();
    let (s, _) = site.call("DELETE", &format!("/notes/{other}"), None);
    assert_eq!(s, 200);
    assert_eq!(sync(&project, &site, &[]).status.code(), Some(0));
    assert!(!project.join("content/notes/from-the-site.md").exists());

    // A wrong credential is exit 4, before any file is read.
    let denied = zero()
        .arg("sync")
        .arg(&project)
        .args(["--site", &site.url(), "--token", "nope"])
        .output()
        .unwrap();
    assert_eq!(
        denied.status.code(),
        Some(4),
        "{}",
        String::from_utf8_lossy(&denied.stderr)
    );
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn a_first_run_against_a_new_site_never_deletes() {
    let (project, site) = setup();
    std::fs::write(
        project.join("content/notes/kept.md"),
        "---\nuid: zr_0123456789abcdef0123\ntitle: Kept\nslug: kept\nlevel: null\nauthorId: null\n---\n",
    )
    .unwrap();
    // Bases from another site: none of them apply to this one.
    std::fs::create_dir_all(project.join(".zero")).unwrap();
    std::fs::write(project.join(".zero/sync-base.json"), r#"{"version":1,"sites":{"some-other-site":{"notes":{"zr_0123456789abcdef0123":{"digest":"sha256:x","record":{}}}}}}"#).unwrap();
    let out = sync(&project, &site, &[]);
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stdout));
    assert!(project.join("content/notes/kept.md").exists());
    assert!(
        site.rows("notes").iter().any(|r| r["uid"] == "zr_0123456789abcdef0123"),
        "the file was pushed, not treated as deleted"
    );
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn an_unreadable_file_is_reported_and_never_read_as_a_deletion() {
    let (project, site) = setup();
    std::fs::write(project.join("content/notes/a.md"), "---\ntitle: A\nslug: a\n---\n").unwrap();
    assert_eq!(sync(&project, &site, &[]).status.code(), Some(0));
    let a = read(&project, "content/notes/a.md");
    std::fs::write(
        project.join("content/notes/a.md"),
        a.replace("title: A", "title: &anchor A"),
    )
    .unwrap();
    let out = sync(&project, &site, &[]);
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stdout);
    assert!(stderr.contains("content/notes/a.md:3: anchors"), "{stderr}");
    assert_eq!(site.rows("notes").len(), 1, "the record survives its broken file");
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn check_reports_a_new_file_alone_and_a_local_slug_edit_moves_its_file() {
    let (project, site) = setup();
    std::fs::write(
        project.join("content/notes/fresh.md"),
        "---\ntitle: Fresh\nslug: fresh\n---\n",
    )
    .unwrap();
    let check = sync(&project, &site, &["--only", "notes", "--check"]);
    assert_eq!(
        check.status.code(),
        Some(2),
        "a uid-less file is a pending creation: {}",
        String::from_utf8_lossy(&check.stdout)
    );
    assert!(
        !read(&project, "content/notes/fresh.md").contains("uid:"),
        "--check writes nothing"
    );

    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    std::fs::write(
        project.join("content/notes/fresh.md"),
        read(&project, "content/notes/fresh.md").replace("slug: fresh", "slug: renamed-here"),
    )
    .unwrap();
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    assert!(project.join("content/notes/renamed-here.md").exists() && !project.join("content/notes/fresh.md").exists());
    assert!(site.rows("notes").iter().any(|r| r["slug"] == "renamed-here"));
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn a_json_collection_keeps_an_ordinary_body_column() {
    let (project, site) = setup();
    std::fs::create_dir_all(project.join("content/snippets")).unwrap();
    std::fs::write(
        project.join("content/snippets/a.json"),
        r#"{"name": "A", "body": "plain text"}"#,
    )
    .unwrap();
    assert_eq!(sync(&project, &site, &["--only", "snippets"]).status.code(), Some(0));
    assert_eq!(site.rows("snippets")[0]["body"], "plain text");
    let file: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(
            std::fs::read_dir(project.join("content/snippets"))
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .path(),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(file["body"], "plain text");
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn records_that_reference_each_other_are_created_in_one_run() {
    let (project, site) = setup();
    for dir in ["content/teams", "content/players"] {
        std::fs::create_dir_all(project.join(dir)).unwrap();
    }
    let (team, player) = ("zr_aaaaaaaaaaaaaaaaaaa1", "zr_aaaaaaaaaaaaaaaaaaa2");
    std::fs::write(
        project.join("content/teams/t.json"),
        format!(r#"{{"uid": "{team}", "name": "Reds", "leadId": "{player}"}}"#),
    )
    .unwrap();
    std::fs::write(
        project.join("content/players/p.json"),
        format!(r#"{{"uid": "{player}", "name": "Kim", "teamId": "{team}"}}"#),
    )
    .unwrap();
    let out = sync(&project, &site, &["--only", "teams,players"]);
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stdout));
    let teams = site.rows("teams");
    let players = site.rows("players");
    assert_eq!(
        (teams[0]["leadId"].clone(), players[0]["teamId"].clone()),
        (players[0]["id"].clone(), teams[0]["id"].clone())
    );
    assert_eq!(
        data(&sync(&project, &site, &["--only", "teams,players"]))["applied"].as_u64(),
        Some(0),
        "both sides agree afterwards"
    );
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn access_refusals_exit_4_and_an_unreadable_directory_deletes_nothing() {
    let (project, site) = setup();
    std::fs::write(project.join("content/notes/n.md"), "---\ntitle: N\nslug: n\n---\n").unwrap();
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));

    // An author is signed in but may not sync (the update rule is "editor").
    let author = site.author.clone();
    let denied = zero()
        .arg("sync")
        .arg(&project)
        .args(["--only", "notes", "--site", &site.url(), "--token", &author])
        .output()
        .unwrap();
    assert_eq!(
        denied.status.code(),
        Some(4),
        "{}{}",
        String::from_utf8_lossy(&denied.stdout),
        String::from_utf8_lossy(&denied.stderr)
    );

    // The directory turns into a file: it can't be listed, so its record must not be trashed.
    std::fs::rename(project.join("content/notes"), project.join("content/notes.bak")).unwrap();
    std::fs::write(project.join("content/notes"), "not a directory").unwrap();
    let out = sync(&project, &site, &["--only", "notes", "--no-commit"]);
    assert_eq!(out.status.code(), Some(1), "{}", String::from_utf8_lossy(&out.stdout));
    assert_eq!(
        site.rows("notes").len(),
        1,
        "the record survives an unreadable directory"
    );
    let _ = std::fs::remove_dir_all(&project);
}
