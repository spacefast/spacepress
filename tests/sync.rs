//! `first sync` against a real WordPress site (design §5.7): a project is built with `first build`,
//! installed on a fresh WordPress-on-SQLite served by `php -S` (tests/php/wp.php serve), and synced
//! with the `first` binary over application passwords. Each step drives the CLI and checks the files,
//! the site (over its API) and the exit code.

// Runs the `first` binary: only with the cli feature (the browser build of the core has none).
#![cfg(feature = "cli")]

use std::io::{BufRead, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};

const CONFIG: &str = r#"import { collection, integer, richText, select, slug, text, defineConfig , table, ref } from "first";

const people = table({
  name: text(),
}, { uid: true, access: { read: "anyone" } });

const notes = table({
  title: text(),
  slug: slug({ source: "title" }).optional(),
  body: richText().optional(),
  level: select(["intro", "advanced"]).optional(),
  authorId: ref(people).optional(),
}, { title: "title", content: "body", sync: "content/notes/*.md", access: { read: "anyone" } });

// A JSON collection without a content column: `body` is an ordinary field.
const snippets = table({
  name: text(),
  key: integer().unique().optional(),
  body: text().optional(),
}, { sync: "content/snippets/*.json", access: { read: "anyone" } });

// Two collections that reference each other.
const teams = table({
  name: text(),
  leadId: ref(() => players).optional(),
  ownerId: ref(people),
}, { sync: "content/teams/*.json", access: { read: "anyone" } });
const players = table({
  name: text(),
  teamId: ref(teams).optional(),
}, { sync: "content/players/*.json", access: { read: "anyone" } });

// A chain of required references inside one collection, and a required cycle between two.
const steps = table({
  name: text(),
  // Required: a step can't be created before the one it follows, so a chain needs a pass per link.
  prevId: ref(people),
  afterId: ref(() => steps).optional().onDelete("restrict"),
}, { sync: "content/steps/*.json", access: { read: "anyone" } });
// A chain of required references across records of one collection.
// A chain across three collections that must be created in order. Each requires (NOT NULL) a record
// of the next, and the last requires a person. Collections are synced in config order here (no
// reference makes one wait for another: the references go "backwards", against that order), so the
// run meets the chain from its far end and needs a pass per link.
const tops = table({
  midId: ref(() => mids),
  loopId: ref(() => bottoms).optional().onDelete("restrict"),
}, { sync: "content/tops/*.json", access: { read: "anyone" } });
const mids = table({
  bottomId: ref(() => bottoms),
  loopId: ref(tops).optional().onDelete("restrict"),
}, { sync: "content/mids/*.json", access: { read: "anyone" } });
const bottoms = table({
  personId: ref(people),
  loopId: ref(mids).optional().onDelete("restrict"),
}, { sync: "content/bottoms/*.json", access: { read: "anyone" } });
const eggs = table({
  chickenId: ref(() => chickens),
}, { sync: "content/eggs/*.json", access: { read: "anyone" } });
const chickens = table({
  eggId: ref(eggs),
}, { sync: "content/chickens/*.json", access: { read: "anyone" } });
// A head requires a rung; a rung requires the next rung and may name its head. The last rung of a
// ladder points at a rung already on the site. Heads and rungs reference each other, so neither
// collection is ordered first.
const heads = table({
  rungId: ref(() => rungs),
}, { sync: "content/heads/*.json", access: { read: "anyone" } });
const rungs = table({
  nextId: ref(() => rungs),
  headId: ref(heads).optional().onDelete("restrict"),
}, { sync: "content/rungs/*.json", access: { read: "anyone" } });
// Content only admins may read (field access): editors sync these without a body.
const dossiers = table({
  title: text(),
  slug: slug({ source: "title" }).optional(),
  body: richText().access({ read: "admin" }).optional(),
}, { title: "title", content: "body", sync: "content/dossiers/*.md", access: { read: "anyone" } });
// A required reference to a target the syncing editor may not list (admins only), on a record whose
// identity is pushed first because of an optional reference to a record not on the site yet.
const safes = table({
  vaultId: ref(() => vaults),
  keeperId: ref(people).optional().onDelete("restrict"),
  snippetId: ref(snippets).access({ read: "admin" }).optional(),
}, { sync: "content/safes/*.json", access: { read: "anyone" } });
// A reference target the syncing editor may not read (admins only): knowing its UID grants no access.
const vaults = table({
  name: text(),
}, { uid: true, access: { read: "admin" } });

// A docs section: a hierarchical collection synced from a folder tree (content/docs/**/*.md).
const docs = collection({
  title: text(),
  slug: slug({ source: "title" }),
  body: richText().optional(),
}, { content: "body", hierarchical: true, sync: "content/docs/**/*.md", access: { read: "anyone" } });

export default defineConfig({ name: "notes", collections: { docs }, tables: { people, notes, snippets, teams, players, steps, tops, mids, bottoms, eggs, chickens, vaults, safes, heads, rungs, dossiers } });
"#;

struct Site {
    /// The `php tests/php/wp.php serve` process: WordPress on SQLite behind php -S, gone with it.
    child: Child,
    port: u16,
    /// The site's directory (its SQLite file lives below `content/database`).
    dir: PathBuf,
    /// An editor's `user:application password`: the credential `first sync` sends as Basic auth.
    token: String,
    /// An author's credential: signed in, but the collections' update rule is "editor".
    author: String,
    /// An administrator's credential.
    admin: String,
}

impl Drop for Site {
    fn drop(&mut self) {
        // SIGTERM lets the server remove its site directory; kill() would leave it behind.
        let _ = Command::new("kill").arg(self.child.id().to_string()).output();
        let _ = self.child.wait();
    }
}

impl Site {
    fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn call(&self, method: &str, path: &str, body: Option<serde_json::Value>) -> (u16, serde_json::Value) {
        http_call(self.port, &self.token, method, path, body)
    }

    fn rows(&self, collection: &str) -> Vec<serde_json::Value> {
        let (s, out) = self.call("GET", &format!("/{collection}?limit=200&orderBy=id"), None);
        assert_eq!(s, 200, "{out}");
        out["data"].as_array().unwrap().clone()
    }

    /// The same site as another user: the calls go to the same server with that credential.
    fn as_user(&self, credential: &str) -> SiteAs {
        SiteAs {
            port: self.port,
            token: credential.to_string(),
        }
    }

    /// One SQL statement on the site's database, through the plugin's connection (what WP-CLI's
    /// `wp db query` is to an operator): `{prefix}` is the table prefix.
    fn sql(&self, statement: &str) {
        let out = Command::new("php")
            .args(["-d", "memory_limit=512M", "-r"])
            .arg("require $argv[1]; wpLoad($argv[2]); \\First\\Wp\\Runtime::plugin()->connection()->run(str_replace('{prefix}', \\First\\Wp\\Runtime::plugin()->connection()->prefix(), $argv[3]));")
            .arg(root().join("tests/php/wp.php"))
            .arg(&self.dir)
            .arg(statement)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
    }
}

/// A view of a served site as one user (see `Site::as_user`).
struct SiteAs {
    port: u16,
    token: String,
}

impl SiteAs {
    fn call(&self, method: &str, path: &str, body: Option<serde_json::Value>) -> (u16, serde_json::Value) {
        http_call(self.port, &self.token, method, path, body)
    }

    fn rows(&self, collection: &str) -> Vec<serde_json::Value> {
        let (s, out) = self.call("GET", &format!("/{collection}?limit=200&orderBy=id"), None);
        assert_eq!(s, 200, "{out}");
        out["data"].as_array().unwrap().clone()
    }
}

fn http_call(
    port: u16,
    token: &str,
    method: &str,
    path: &str,
    body: Option<serde_json::Value>,
) -> (u16, serde_json::Value) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    let body = body.map(|b| b.to_string()).unwrap_or_default();
    let request = format!(
        "{method} /__first/api/v1{path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nAuthorization: Basic {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        base64(token.as_bytes()),
        body.len()
    );
    s.write_all(request.as_bytes()).unwrap();
    let mut raw = String::new();
    s.read_to_string(&mut raw).unwrap();
    let status = raw[9..12].parse().unwrap();
    let json = raw.split_once("\r\n\r\n").map(|(_, b)| b).unwrap_or("");
    (status, serde_json::from_str(json).unwrap_or(serde_json::Value::Null))
}

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().fold(0u32, |acc, b| (acc << 8) | *b as u32) << (8 * (3 - chunk.len()));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

fn first() -> Command {
    Command::new(env!("CARGO_BIN_EXE_first"))
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
    let project = std::env::temp_dir().join(format!("first-sync-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&project);
    std::fs::create_dir_all(project.join("content/notes")).unwrap();
    std::fs::write(project.join("first.config.ts"), CONFIG).unwrap();
    let out = first().arg("build").arg(&project).output().unwrap();
    assert!(out.status.success(), "build: {}", String::from_utf8_lossy(&out.stderr));
    // A fresh WordPress on SQLite with the built plugins active, served by php -S: one JSON line with
    // its url and the users' application passwords, then it serves until it's told to stop.
    let mut child = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("serve")
        .arg(project.join("first/dist/wp-content"))
        .args(["ed=editor", "au=author", "root=admin"])
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("php");
    let mut line = String::new();
    std::io::BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .expect("the served site's description");
    let served: serde_json::Value = serde_json::from_str(&line).unwrap_or_else(|_| panic!("serve: {line}"));
    let credential = |name: &str| served["users"][name]["appPassword"].as_str().unwrap().to_string();
    let port: u16 = served["url"]
        .as_str()
        .unwrap()
        .rsplit(':')
        .next()
        .unwrap()
        .parse()
        .unwrap();
    let site = Site {
        child,
        port,
        dir: PathBuf::from(served["dir"].as_str().unwrap()),
        token: credential("ed"),
        author: credential("au"),
        admin: credential("root"),
    };
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
    (project, site)
}

fn sync(project: &Path, site: &Site, extra: &[&str]) -> Output {
    first()
        .arg("sync")
        .args(extra)
        .arg(project)
        .env("FIRST_APP_PASSWORD", &site.token)
        .args(["--site", &site.url(), "--json"])
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
fn syncs_files_and_records_both_ways_against_a_wordpress_site() {
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
    let ignore = read(&project, ".gitignore");
    assert!(
        ignore.contains(".first/*\n!.first/sync-base.json\n"),
        "first build ignores .first except the bases:\n{ignore}"
    );
    std::fs::write(project.join("unrelated.txt"), "not sync's").unwrap();
    let initial = sync(&project, &site, &[]);
    assert_eq!(
        initial.status.code(),
        Some(0),
        "{}{}",
        String::from_utf8_lossy(&initial.stdout),
        String::from_utf8_lossy(&initial.stderr)
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
    assert!(committed.starts_with("first sync: "), "{committed}");
    assert!(
        committed.contains("content/notes/hello.md")
            && committed.contains(".first/sync-base.json")
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
    let conflict = read(&project, &format!(".first/conflicts/{uid}.md"));
    assert!(
        conflict.contains("# Fields: /fields/title")
            && conflict.contains("<<<<<<< files")
            && conflict.contains("||||||| base")
            && conflict.contains(">>>>>>> wordpress"),
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
    let usage = sync(&project, &site, &["resolve", &uid, "--check"]);
    assert_eq!(usage.status.code(), Some(3), "resolve has no read-only mode");
    assert!(
        project.join(format!(".first/conflicts/{uid}.md")).exists(),
        "and wrote nothing"
    );
    let refused = sync(&project, &site, &["resolve", &uid]);
    assert_eq!(refused.status.code(), Some(1));
    let theirs = conflict
        .split("=======\n")
        .nth(1)
        .unwrap()
        .split(">>>>>>> wordpress")
        .next()
        .unwrap();
    let header: String = conflict
        .lines()
        .take_while(|l| l.starts_with('#'))
        .map(|l| format!("{l}\n"))
        .collect();
    std::fs::write(
        project.join(format!(".first/conflicts/{uid}.md")),
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
    assert!(!project.join(format!(".first/conflicts/{uid}.md")).exists());
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
    let denied = first()
        .arg("sync")
        .arg(&project)
        .env("FIRST_APP_PASSWORD", "nobody:nope")
        .args(["--site", &site.url()])
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
    std::fs::create_dir_all(project.join(".first")).unwrap();
    std::fs::write(project.join(".first/sync-base.json"), r#"{"version":1,"sites":{"some-other-site":{"notes":{"zr_0123456789abcdef0123":{"digest":"sha256:x","record":{}}}}}}"#).unwrap();
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
    // A required reference to a record already on the site must survive the identity-only first push.
    let (s, owner) = site.call("POST", "/people", Some(serde_json::json!({"name": "Owner"})));
    assert_eq!(s, 201, "{owner}");
    let owner = owner["data"]["uid"].as_str().unwrap().to_string();
    std::fs::write(
        project.join("content/teams/t.json"),
        format!(r#"{{"uid": "{team}", "name": "Reds", "leadId": "{player}", "ownerId": "{owner}"}}"#),
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
    assert_eq!(
        teams[0]["ownerId"],
        site.rows("people").iter().find(|p| p["uid"] == owner.as_str()).unwrap()["id"]
    );
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
    let denied = first()
        .arg("sync")
        .arg(&project)
        .env("FIRST_APP_PASSWORD", &author)
        .args(["--only", "notes", "--site", &site.url()])
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

#[test]
fn a_deferred_push_keeps_what_the_merge_took_from_the_site() {
    let (project, site) = setup();
    for dir in ["content/teams", "content/players"] {
        std::fs::create_dir_all(project.join(dir)).unwrap();
    }
    let (s, owner) = site.call("POST", "/people", Some(serde_json::json!({"name": "Owner"})));
    assert_eq!(s, 201);
    let owner = owner["data"]["uid"].as_str().unwrap().to_string();
    let team = "zr_bbbbbbbbbbbbbbbbbbb1";
    std::fs::write(
        project.join("content/teams/t.json"),
        format!(r#"{{"uid": "{team}", "name": "Blues", "leadId": null, "ownerId": "{owner}"}}"#),
    )
    .unwrap();
    assert_eq!(
        sync(&project, &site, &["--only", "teams,players"]).status.code(),
        Some(0)
    );
    // The site renames the team; the file points it at a player that only exists in the files so far.
    let id = site.rows("teams")[0]["id"].as_i64().unwrap();
    let (s, _) = site.call(
        "PATCH",
        &format!("/teams/{id}"),
        Some(serde_json::json!({"name": "Renamed on the site"})),
    );
    assert_eq!(s, 200);
    let player = "zr_bbbbbbbbbbbbbbbbbbb2";
    // Without a slug, the CLI names the file by its uid.
    let team_file = project.join(format!("content/teams/{team}.json"));
    let t = std::fs::read_to_string(&team_file).unwrap();
    std::fs::write(
        &team_file,
        t.replace(r#""leadId": null"#, &format!(r#""leadId": "{player}""#)),
    )
    .unwrap();
    std::fs::write(
        project.join("content/players/p.json"),
        format!(r#"{{"uid": "{player}", "name": "Ana", "teamId": "{team}"}}"#),
    )
    .unwrap();
    let out = sync(&project, &site, &["--only", "teams,players"]);
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stdout));
    let row = site.rows("teams").into_iter().find(|r| r["id"] == id).unwrap();
    assert_eq!(
        row["name"], "Renamed on the site",
        "the site's rename survives the deferred push: {row}"
    );
    assert_eq!(row["leadId"], site.rows("players")[0]["id"]);
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn deferred_records_land_in_dependency_order_and_irreducible_cycles_are_reported() {
    let (project, site) = setup();
    for dir in [
        "content/tops",
        "content/mids",
        "content/bottoms",
        "content/eggs",
        "content/chickens",
    ] {
        std::fs::create_dir_all(project.join(dir)).unwrap();
    }
    let (s, person) = site.call("POST", "/people", Some(serde_json::json!({"name": "Start"})));
    assert_eq!(s, 201, "{person}");
    let person = person["data"]["uid"].as_str().unwrap().to_string();
    // top needs mid, mid needs bottom, bottom needs the person (all NOT NULL). The optional loopIds tie
    // the three into one reference cycle, so no collection is ordered before another and the CLI meets
    // top first: top waits for mid, which waits for bottom. Only repeated passes land all three.
    let (top, mid, bottom) = (
        "zr_cccccccccccccccccc01",
        "zr_cccccccccccccccccc02",
        "zr_cccccccccccccccccc03",
    );
    std::fs::write(
        project.join("content/tops/t.json"),
        format!(r#"{{"uid": "{top}", "midId": "{mid}", "loopId": null}}"#),
    )
    .unwrap();
    std::fs::write(
        project.join("content/mids/m.json"),
        format!(r#"{{"uid": "{mid}", "bottomId": "{bottom}", "loopId": null}}"#),
    )
    .unwrap();
    std::fs::write(
        project.join("content/bottoms/b.json"),
        format!(r#"{{"uid": "{bottom}", "personId": "{person}", "loopId": null}}"#),
    )
    .unwrap();
    // Two records each requiring the other: no order creates them, so nothing is written for them.
    let (egg, chicken) = ("zr_dddddddddddddddddd01", "zr_dddddddddddddddddd02");
    std::fs::write(
        project.join("content/eggs/e.json"),
        format!(r#"{{"uid": "{egg}", "chickenId": "{chicken}"}}"#),
    )
    .unwrap();
    std::fs::write(
        project.join("content/chickens/c.json"),
        format!(r#"{{"uid": "{chicken}", "eggId": "{egg}"}}"#),
    )
    .unwrap();
    let out = sync(&project, &site, &["--only", "tops,mids,bottoms,eggs,chickens"]);
    assert_eq!(out.status.code(), Some(1), "{}", String::from_utf8_lossy(&out.stdout));
    let failed = data_or_error(&out)["failed"].to_string();
    assert!(
        failed.contains(egg) && failed.contains(chicken) && failed.contains("can't be created first"),
        "{failed}"
    );
    assert!(
        !failed.contains(top) && !failed.contains(mid) && !failed.contains(bottom),
        "the chain landed: {failed}"
    );
    let (tops, mids, bottoms) = (site.rows("tops"), site.rows("mids"), site.rows("bottoms"));
    assert_eq!((tops.len(), mids.len(), bottoms.len()), (1, 1, 1));
    assert_eq!(tops[0]["midId"], mids[0]["id"]);
    assert_eq!(mids[0]["bottomId"], bottoms[0]["id"]);
    assert!(
        site.rows("eggs").is_empty() && site.rows("chickens").is_empty(),
        "an irreducible cycle writes nothing"
    );
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn a_pointerless_reference_refusal_is_not_reported_as_a_missing_target() {
    let (project, site) = setup();
    let (status, created) = site.call(
        "POST",
        "/snippets",
        Some(serde_json::json!({"name": "Original", "key": 1})),
    );
    assert_eq!(status, 201, "{created}");
    let uid = created["data"]["uid"].as_str().unwrap();
    let pulled = sync(&project, &site, &["--only", "snippets"]);
    assert_eq!(
        pulled.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&pulled.stdout)
    );
    let path = project.join(format!("content/snippets/{uid}.json"));
    std::fs::remove_file(&path).unwrap();

    // Even an empty hidden incoming relationship (`safes.snippetId`, admin-only) refuses the delete.
    // This is not a target another push could create, so preserve the server's refusal rather than
    // defer it.
    let out = sync(&project, &site, &["--only", "snippets"]);
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(
        data_or_error(&out)["failed"],
        serde_json::json!([format!(
            "snippets/{uid}: Rows in safes may reference this row (reference_violation)"
        )])
    );
    assert_eq!(site.rows("snippets").len(), 1, "the refused delete did not land");
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn a_reference_to_an_unreadable_record_never_lands() {
    let (project, site) = setup();
    let admin_site = site.as_user(&site.admin);
    let (s, vault) = admin_site.call("POST", "/vaults", Some(serde_json::json!({"name": "Secret"})));
    assert_eq!(s, 201, "{vault}");
    let vault = vault["data"]["uid"].as_str().unwrap().to_string();
    std::fs::create_dir_all(project.join("content/safes")).unwrap();
    std::fs::create_dir_all(project.join("content/people")).unwrap();
    // An unavailable optional keeper must not turn the identity-only pass into a bypass for the
    // required vault reference: the editor cannot read that row even when its UID is known.
    let safe = "zr_eeeeeeeeeeeeeeeeee01";
    std::fs::write(
        project.join("content/safes/s.json"),
        format!(r#"{{"uid": "{safe}", "vaultId": "{vault}", "keeperId": "zr_eeeeeeeeeeeeeeeeee99"}}"#),
    )
    .unwrap();
    let out = sync(&project, &site, &["--only", "safes"]);
    let report = data_or_error(&out);
    let safes = admin_site.rows("safes");
    assert!(
        safes.is_empty(),
        "no pass may persist an unreadable reference: {report}"
    );
    assert_eq!(out.status.code(), Some(1));
    assert!(report["failed"].to_string().contains(safe), "{report}");
    assert_eq!(admin_site.rows("vaults").len(), 1, "the target remains unchanged");
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn an_edit_made_between_passes_is_not_overwritten() {
    let (project, site) = setup();
    for dir in ["content/teams", "content/players"] {
        std::fs::create_dir_all(project.join(dir)).unwrap();
    }
    let (s, owner) = site.call("POST", "/people", Some(serde_json::json!({"name": "Owner"})));
    assert_eq!(s, 201);
    let owner = owner["data"]["uid"].as_str().unwrap().to_string();
    let team = "zr_ffffffffffffffffff01";
    std::fs::write(
        project.join("content/teams/t.json"),
        format!(r#"{{"uid": "{team}", "name": "Before", "leadId": null, "ownerId": "{owner}"}}"#),
    )
    .unwrap();
    assert_eq!(
        sync(&project, &site, &["--only", "teams,players"]).status.code(),
        Some(0)
    );
    let id = site.rows("teams")[0]["id"].as_i64().unwrap();
    // The file points the team at a new player; a site hook-free edit lands while that push waits.
    let player = "zr_ffffffffffffffffff02";
    let team_file = project.join(format!("content/teams/{team}.json"));
    let t = std::fs::read_to_string(&team_file).unwrap();
    std::fs::write(
        &team_file,
        t.replace(r#""leadId": null"#, &format!(r#""leadId": "{player}""#)),
    )
    .unwrap();
    std::fs::write(
        project.join("content/players/p.json"),
        format!(r#"{{"uid": "{player}", "name": "Mo", "teamId": "{team}"}}"#),
    )
    .unwrap();
    // A wrapper site that renames the team between the first and second pass: the first /sync/players
    // push is the moment the deferred team push is waiting.
    let edited = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let editor = site.as_user(&site.token);
    let proxy = proxy_acting_on_first(
        &site,
        "/__first/api/v1/sync/players",
        move || {
            let (s, _) = editor.call(
                "PATCH",
                &format!("/teams/{id}"),
                Some(serde_json::json!({"name": "Renamed between passes"})),
            );
            assert_eq!(s, 200);
        },
        edited.clone(),
    );
    let out = first()
        .arg("sync")
        .arg(&project)
        .env("FIRST_APP_PASSWORD", &site.token)
        .args(["--only", "teams,players", "--site", &proxy, "--json", "--no-commit"])
        .output()
        .unwrap();
    assert!(
        edited.load(std::sync::atomic::Ordering::SeqCst),
        "the edit happened between passes"
    );
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stdout));
    let row = site.rows("teams").into_iter().find(|r| r["id"] == id).unwrap();
    assert_eq!(
        row["name"], "Renamed between passes",
        "the edit between passes survives: {row}"
    );
    assert_eq!(
        row["leadId"],
        site.rows("players")[0]["id"],
        "and the deferred reference landed"
    );
    let _ = std::fs::remove_dir_all(&project);
}

fn data_or_error(out: &Output) -> serde_json::Value {
    let json: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    json.get("data")
        .cloned()
        .unwrap_or_else(|| json["error"]["data"].clone())
}

/// A pass-through HTTP proxy in front of `site` that, the first time a POST to `trigger` passes through,
/// first runs `act`: the deterministic moment at which someone else edits (the site, or a file).
fn proxy_acting_on_first(
    site: &Site,
    trigger: &'static str,
    act: impl Fn() + Send + 'static,
    done: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> String {
    proxy_with_outage(site, trigger, act, done, None)
}

/// As proxy_acting_on_first; once `act` has run, every GET starting with `outage` gets a broken
/// answer, which makes the run stop there.
fn proxy_with_outage(
    site: &Site,
    trigger: &'static str,
    act: impl Fn() + Send + 'static,
    done: std::sync::Arc<std::sync::atomic::AtomicBool>,
    outage: Option<&'static str>,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let upstream = site.port;
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut client) = stream else { continue };
            let mut request = Vec::new();
            let mut buf = [0u8; 65536];
            // Read the head, then the body by Content-Length.
            loop {
                let n = client.read(&mut buf).unwrap_or(0);
                if n == 0 {
                    break;
                }
                request.extend_from_slice(&buf[..n]);
                if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&request[..end]).to_string();
                    let length = head
                        .lines()
                        .find_map(|l| {
                            l.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                        })
                        .unwrap_or(0);
                    while request.len() < end + 4 + length {
                        let n = client.read(&mut buf).unwrap_or(0);
                        if n == 0 {
                            break;
                        }
                        request.extend_from_slice(&buf[..n]);
                    }
                    break;
                }
            }
            let head = String::from_utf8_lossy(&request).to_string();
            // `trigger` is a path (matched on POST), or "GET <path prefix>".
            let hit = match trigger.strip_prefix("GET ") {
                Some(prefix) => head.starts_with(&format!("GET {prefix}")),
                None => head.starts_with(&format!("POST {trigger} ")),
            };
            if hit && !done.swap(true, std::sync::atomic::Ordering::SeqCst) {
                act();
            }
            // Forward as one write with Connection: close, and relay the answer.
            let text = String::from_utf8_lossy(&request).replace("Connection: keep-alive", "Connection: close");
            let text = if text.to_ascii_lowercase().contains("\r\nconnection:") {
                text
            } else {
                text.replacen("\r\n", "\r\nConnection: close\r\n", 1)
            };
            if let Some(prefix) = outage
                && done.load(std::sync::atomic::Ordering::SeqCst)
                && head.starts_with(&format!("GET {prefix}"))
            {
                let _ =
                    client.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 4\r\nConnection: close\r\n\r\ndown");
                continue;
            }
            let mut server = TcpStream::connect(("127.0.0.1", upstream)).unwrap();
            server.write_all(text.as_bytes()).unwrap();
            let mut answer = Vec::new();
            server.read_to_end(&mut answer).unwrap();
            let _ = client.write_all(&answer);
        }
    });
    format!("http://127.0.0.1:{port}")
}

#[test]
fn a_file_edited_while_its_push_waits_is_planned_again() {
    let (project, site) = setup();
    for dir in ["content/teams", "content/players"] {
        std::fs::create_dir_all(project.join(dir)).unwrap();
    }
    let (s, owner) = site.call("POST", "/people", Some(serde_json::json!({"name": "Owner"})));
    assert_eq!(s, 201);
    let owner = owner["data"]["uid"].as_str().unwrap().to_string();
    let team = "zr_fafafafafafafafafa01";
    std::fs::write(
        project.join("content/teams/t.json"),
        format!(r#"{{"uid": "{team}", "name": "Before", "leadId": null, "ownerId": "{owner}"}}"#),
    )
    .unwrap();
    assert_eq!(
        sync(&project, &site, &["--only", "teams,players"]).status.code(),
        Some(0)
    );
    // The file points the team at a new player, so its push waits for the player; while it waits,
    // someone edits the same file again. The later pass must send that edit, not the stale plan.
    let player = "zr_fafafafafafafafafa02";
    let team_file = project.join(format!("content/teams/{team}.json"));
    let t = std::fs::read_to_string(&team_file).unwrap();
    std::fs::write(
        &team_file,
        t.replace(r#""leadId": null"#, &format!(r#""leadId": "{player}""#)),
    )
    .unwrap();
    std::fs::write(
        project.join("content/players/p.json"),
        format!(r#"{{"uid": "{player}", "name": "Jo", "teamId": "{team}"}}"#),
    )
    .unwrap();
    let edited = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let path = team_file.clone();
    let proxy = proxy_acting_on_first(
        &site,
        "/__first/api/v1/sync/players",
        move || {
            let t = std::fs::read_to_string(&path).unwrap();
            std::fs::write(
                &path,
                t.replace(r#""name": "Before""#, r#""name": "Edited while waiting""#),
            )
            .unwrap();
        },
        edited.clone(),
    );
    let out = first()
        .arg("sync")
        .arg(&project)
        .env("FIRST_APP_PASSWORD", &site.token)
        .args(["--only", "teams,players", "--site", &proxy, "--json", "--no-commit"])
        .output()
        .unwrap();
    assert!(
        edited.load(std::sync::atomic::Ordering::SeqCst),
        "the file was edited between passes"
    );
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stdout));
    let row = site.rows("teams").into_iter().find(|r| r["uid"] == team).unwrap();
    assert_eq!(
        row["name"], "Edited while waiting",
        "the edit made while waiting reached the site: {row}"
    );
    assert!(
        std::fs::read_to_string(&team_file)
            .unwrap()
            .contains("Edited while waiting"),
        "and the file kept it"
    );
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn creating_an_identity_counts_as_progress() {
    let (project, site) = setup();
    for dir in ["content/heads", "content/rungs"] {
        std::fs::create_dir_all(project.join(dir)).unwrap();
    }
    // A rung already on the site that ends the ladder (its required nextId is itself). The API can't
    // create a row that references itself, so it's written straight into the site's table.
    let anchor = "zr_a0a0a0a0a0a0a0a0a0a0";
    site.sql(&format!(
        "INSERT INTO {{prefix}}first_rungs (id, nextId, headId, uid) VALUES (1000, 1000, NULL, '{anchor}')"
    ));
    // head A -> rung B -> rung C -> anchor, all required; B and C name A as their head (optional).
    //   first pass:  A can't be created (B missing), B can't (C missing); C's identity is created.
    //   later pass:  A still can't; B's identity is created now that C exists; C still waits for A.
    //                Nothing completed, all three still wait, yet the site gained B.
    //   later pass:  A lands (B exists), then B and C land (A exists).
    let (a, b, c) = (
        "zr_a0a0a0a0a0a0a0a0a0a1",
        "zr_a0a0a0a0a0a0a0a0a0a2",
        "zr_a0a0a0a0a0a0a0a0a0a3",
    );
    std::fs::write(
        project.join("content/heads/a.json"),
        format!(r#"{{"uid": "{a}", "rungId": "{b}"}}"#),
    )
    .unwrap();
    std::fs::write(
        project.join("content/rungs/1.json"),
        format!(r#"{{"uid": "{b}", "nextId": "{c}", "headId": "{a}"}}"#),
    )
    .unwrap();
    std::fs::write(
        project.join("content/rungs/2.json"),
        format!(r#"{{"uid": "{c}", "nextId": "{anchor}", "headId": "{a}"}}"#),
    )
    .unwrap();
    let out = sync(&project, &site, &["--only", "heads,rungs"]);
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stdout));
    let (heads, rungs) = (site.rows("heads"), site.rows("rungs"));
    let rung = |uid: &str| {
        rungs
            .iter()
            .find(|r| r["uid"] == uid)
            .unwrap_or_else(|| panic!("{uid}: {rungs:?}"))
            .clone()
    };
    let head = heads.iter().find(|r| r["uid"] == a).expect("the head landed").clone();
    assert_eq!(head["rungId"], rung(b)["id"]);
    assert_eq!(
        (rung(b)["nextId"].clone(), rung(c)["nextId"].clone()),
        (rung(c)["id"].clone(), rung(anchor)["id"].clone())
    );
    assert_eq!(
        (rung(b)["headId"].clone(), rung(c)["headId"].clone()),
        (head["id"].clone(), head["id"].clone()),
        "the optional back-references landed too"
    );
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn an_identity_created_this_run_is_provisional_when_its_file_changes() {
    let (project, site) = setup();
    for dir in ["content/teams", "content/players"] {
        std::fs::create_dir_all(project.join(dir)).unwrap();
    }
    let (s, owner) = site.call("POST", "/people", Some(serde_json::json!({"name": "Owner"})));
    assert_eq!(s, 201);
    let owner = owner["data"]["uid"].as_str().unwrap().to_string();
    // A new team and player that reference each other: the team's identity (leadId null) is created
    // first. Then, at the interleaving point, the team's file is edited (case 1) or deleted (case 2).
    for (case, delete) in [("edit", false), ("delete", true)] {
        let (team, player) = if delete {
            ("zr_dededededededede0001", "zr_dededededededede0002")
        } else {
            ("zr_edededededededed0001", "zr_edededededededed0002")
        };
        let team_file = project.join(format!("content/teams/{case}.json"));
        std::fs::write(
            &team_file,
            format!(r#"{{"uid": "{team}", "name": "New", "leadId": "{player}", "ownerId": "{owner}"}}"#),
        )
        .unwrap();
        std::fs::write(
            project.join(format!("content/players/{case}.json")),
            format!(r#"{{"uid": "{player}", "name": "P", "teamId": "{team}"}}"#),
        )
        .unwrap();
        let edited = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let path = team_file.clone();
        let proxy = proxy_acting_on_first(
            &site,
            "/__first/api/v1/sync/players",
            move || {
                if delete {
                    std::fs::remove_file(&path).unwrap();
                } else {
                    let t = std::fs::read_to_string(&path).unwrap();
                    std::fs::write(
                        &path,
                        t.replace(r#""name": "New""#, r#""name": "Renamed while waiting""#),
                    )
                    .unwrap();
                }
            },
            edited.clone(),
        );
        let out = first()
            .arg("sync")
            .arg(&project)
            .env("FIRST_APP_PASSWORD", &site.token)
            .args(["--only", "teams,players", "--site", &proxy, "--json", "--no-commit"])
            .output()
            .unwrap();
        assert!(
            edited.load(std::sync::atomic::Ordering::SeqCst),
            "{case}: the file changed between passes"
        );
        let report = data_or_error(&out);
        let team_row = site.rows("teams").into_iter().find(|r| r["uid"] == team);
        let base = std::fs::read_to_string(project.join(".first/sync-base.json")).unwrap_or_default();
        if delete {
            assert!(
                team_row.is_none(),
                "{case}: the provisional team identity is trashed, not adopted: {report}"
            );
            assert!(
                !std::fs::read_dir(project.join("content/teams"))
                    .unwrap()
                    .any(|e| std::fs::read_to_string(e.unwrap().path()).unwrap().contains(team)),
                "{case}: no file recreated for it"
            );
        } else {
            let row = team_row.expect("the team exists");
            assert_eq!(
                row["name"], "Renamed while waiting",
                "{case}: the edit reached the site whole: {report}"
            );
            assert!(!row["leadId"].is_null(), "{case}: with its reference: {row}");
        }
        assert!(
            !base.contains(r#""leadId": null"#) || !base.contains(team),
            "{case}: no base holds the provisional identity"
        );
        assert!(
            report["conflicts"].as_array().is_none_or(|c| c.is_empty()),
            "{case}: no false conflict: {report}"
        );
    }
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn a_file_edited_during_the_push_itself_is_not_overwritten() {
    let (project, site) = setup();
    std::fs::write(
        project.join("content/notes/n.md"),
        "---\ntitle: Note\nslug: n\nlevel: null\nauthorId: null\n---\nFirst.\n",
    )
    .unwrap();
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    let file = project.join("content/notes/n.md");
    // The file clears its slug, which the site derives again from the title, so the push answers
    // `normalized` and the CLI would rewrite the file with the stored record. An edit lands while that
    // very push is in flight.
    let t = std::fs::read_to_string(&file).unwrap();
    std::fs::write(
        &file,
        t.replace("slug: n\n", "slug: null\n")
            .replace("title: Note", "title: Renamed"),
    )
    .unwrap();
    let edited = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let path = file.clone();
    let proxy = proxy_acting_on_first(
        &site,
        "/__first/api/v1/sync/notes",
        move || {
            let t = std::fs::read_to_string(&path).unwrap();
            std::fs::write(&path, t.replace("First.", "Typed during the push.")).unwrap();
        },
        edited.clone(),
    );
    let out = first()
        .arg("sync")
        .arg(&project)
        .env("FIRST_APP_PASSWORD", &site.token)
        .args(["--only", "notes", "--site", &proxy, "--json", "--no-commit"])
        .output()
        .unwrap();
    assert!(edited.load(std::sync::atomic::Ordering::SeqCst));
    let report = data_or_error(&out);
    assert!(
        std::fs::read_to_string(&file)
            .unwrap()
            .contains("Typed during the push."),
        "the edit survives: {report}"
    );
    assert_eq!(
        out.status.code(),
        Some(1),
        "and the run reports the file it left alone: {report}"
    );
    // The push itself landed but the base didn't move, so the next run compares the edited file with
    // the old base: the body edit goes up, and the slug the site derived is a field both sides changed,
    // reported as a conflict for the user rather than decided for them. Nothing is lost.
    let next = sync(&project, &site, &["--only", "notes"]);
    let report = data_or_error(&next);
    assert_eq!(report["conflicts"].as_array().map(Vec::len), Some(1), "{report}");
    assert!(
        report["conflicts"][0].as_str().unwrap().contains("/fields/slug"),
        "{report}"
    );
    assert!(
        std::fs::read_to_string(&file)
            .unwrap()
            .contains("Typed during the push."),
        "the file still has the edit"
    );
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn hidden_content_round_trips_through_conflicts_resolve_and_trash() {
    let (project, site) = setup();
    let admin_site = site.as_user(&site.admin);
    let (s, made) = admin_site.call("POST", "/dossiers", Some(serde_json::json!({"title": "Secret", "body": "<!-- wp:paragraph -->\n<p>Admins only.</p>\n<!-- /wp:paragraph -->"})));
    assert_eq!(s, 201, "{made}");
    let id = made["data"]["id"].as_i64().unwrap();
    std::fs::create_dir_all(project.join("content/dossiers")).unwrap();
    assert_eq!(sync(&project, &site, &["--only", "dossiers"]).status.code(), Some(0));
    let file = project.join("content/dossiers/secret.md");
    assert!(
        std::fs::read_to_string(&file).unwrap().ends_with("---\n"),
        "the editor's file has no body"
    );
    // A same-field conflict, resolved by the editor: the hidden body is untouched.
    std::fs::write(
        &file,
        std::fs::read_to_string(&file)
            .unwrap()
            .replace("title: Secret", "title: Local"),
    )
    .unwrap();
    let (s, _) = site.call(
        "PATCH",
        &format!("/dossiers/{id}"),
        Some(serde_json::json!({"title": "Remote"})),
    );
    assert_eq!(s, 200);
    let conflicted = sync(&project, &site, &["--only", "dossiers"]);
    let uid = made["data"]["uid"].as_str().unwrap().to_string();
    let conflict_path = project.join(format!(".first/conflicts/{uid}.md"));
    assert!(
        conflict_path.exists(),
        "{}",
        String::from_utf8_lossy(&conflicted.stdout)
    );
    let conflict = std::fs::read_to_string(&conflict_path).unwrap();
    let header: String = conflict
        .lines()
        .take_while(|l| l.starts_with('#'))
        .map(|l| format!("{l}\n"))
        .collect();
    let theirs = conflict
        .split("=======\n")
        .nth(1)
        .unwrap()
        .split(">>>>>>>")
        .next()
        .unwrap();
    std::fs::write(
        &conflict_path,
        format!("{header}{}", theirs.replace("title: Remote", "title: Agreed")),
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
    let row = admin_site.rows("dossiers").into_iter().find(|r| r["id"] == id).unwrap();
    assert_eq!(
        (
            row["title"].as_str(),
            row["body"].as_str().map(|b| b.contains("Admins only."))
        ),
        (Some("Agreed"), Some(true)),
        "{row}"
    );
    // Trashed on the site: the unchanged bodyless file is deleted, not conflicted.
    let (s, _) = admin_site.call("DELETE", &format!("/dossiers/{id}"), None);
    assert_eq!(s, 200);
    let out = sync(&project, &site, &["--only", "dossiers"]);
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stdout));
    assert!(data(&out)["conflicts"].as_array().unwrap().is_empty());
    assert!(
        !file.exists(),
        "the unchanged bodyless file (its explicit slug kept it at secret.md) is deleted"
    );
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn an_unreadable_file_never_trashes_its_provisional_identity() {
    let (project, site) = setup();
    for dir in ["content/teams", "content/players"] {
        std::fs::create_dir_all(project.join(dir)).unwrap();
    }
    let (s, owner) = site.call("POST", "/people", Some(serde_json::json!({"name": "Owner"})));
    assert_eq!(s, 201);
    let owner = owner["data"]["uid"].as_str().unwrap().to_string();
    let (team, player) = ("zr_cdcdcdcdcdcdcdcd0001", "zr_cdcdcdcdcdcdcdcd0002");
    let team_file = project.join("content/teams/t.json");
    std::fs::write(
        &team_file,
        format!(r#"{{"uid": "{team}", "name": "New", "leadId": "{player}", "ownerId": "{owner}"}}"#),
    )
    .unwrap();
    std::fs::write(
        project.join("content/players/p.json"),
        format!(r#"{{"uid": "{player}", "name": "P", "teamId": "{team}"}}"#),
    )
    .unwrap();
    // While the team's identity waits, its file becomes malformed: unreadable, not deleted.
    let edited = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let path = team_file.clone();
    let proxy = proxy_acting_on_first(
        &site,
        "/__first/api/v1/sync/players",
        move || std::fs::write(&path, "{ not json").unwrap(),
        edited.clone(),
    );
    let out = first()
        .arg("sync")
        .arg(&project)
        .env("FIRST_APP_PASSWORD", &site.token)
        .args(["--only", "teams,players", "--site", &proxy, "--json", "--no-commit"])
        .output()
        .unwrap();
    assert!(edited.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(
        out.status.code(),
        Some(1),
        "the unreadable file is reported: {}",
        String::from_utf8_lossy(&out.stdout)
    );
    assert!(
        site.rows("teams").iter().any(|r| r["uid"] == team),
        "its identity stays on the site"
    );
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn files_edited_mid_run_survive_plain_pushes_and_resolve() {
    let (project, site) = setup();
    // A plain (not normalized) push: the edit made while it is in flight is kept and reported.
    std::fs::write(
        project.join("content/notes/n.md"),
        "---\ntitle: Note\nslug: n\nlevel: null\nauthorId: null\n---\nFirst.\n",
    )
    .unwrap();
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    let file = project.join("content/notes/n.md");
    let t = std::fs::read_to_string(&file).unwrap();
    std::fs::write(&file, t.replace("level: null", "level: intro")).unwrap();
    let edited = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let path = file.clone();
    let proxy = proxy_acting_on_first(
        &site,
        "/__first/api/v1/sync/notes",
        move || {
            let t = std::fs::read_to_string(&path).unwrap();
            std::fs::write(&path, t.replace("First.", "Typed during a plain push.")).unwrap();
        },
        edited.clone(),
    );
    let out = first()
        .arg("sync")
        .arg(&project)
        .env("FIRST_APP_PASSWORD", &site.token)
        .args(["--only", "notes", "--site", &proxy, "--json", "--no-commit"])
        .output()
        .unwrap();
    assert!(edited.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(out.status.code(), Some(1), "{}", String::from_utf8_lossy(&out.stdout));
    let base = std::fs::read_to_string(project.join(".first/sync-base.json")).unwrap();
    assert!(
        !base.contains("\"intro\""),
        "the base didn't move to the pushed record: {base}"
    );
    assert!(
        std::fs::read_to_string(&file)
            .unwrap()
            .contains("Typed during a plain push.")
    );

    // resolve: the conflict draft is edited while resolve's push is in flight. resolve applies the
    // version it read, but keeps the newer draft instead of deleting it.
    let t = std::fs::read_to_string(&file).unwrap();
    std::fs::write(&file, t.replace("title: Note", "title: Local")).unwrap();
    let id = site.rows("notes")[0]["id"].as_i64().unwrap();
    let (s, _) = site.call(
        "PATCH",
        &format!("/notes/{id}"),
        Some(serde_json::json!({"title": "Remote"})),
    );
    assert_eq!(s, 200);
    let conflicted = sync(&project, &site, &["--only", "notes"]);
    let uid = site.rows("notes")[0]["uid"].as_str().unwrap().to_string();
    let draft = project.join(format!(".first/conflicts/{uid}.md"));
    assert!(draft.exists(), "{}", String::from_utf8_lossy(&conflicted.stdout));
    let conflict = std::fs::read_to_string(&draft).unwrap();
    let header: String = conflict
        .lines()
        .take_while(|l| l.starts_with('#'))
        .map(|l| format!("{l}\n"))
        .collect();
    let theirs = conflict
        .split("=======\n")
        .nth(1)
        .unwrap()
        .split(">>>>>>>")
        .next()
        .unwrap();
    std::fs::write(
        &draft,
        format!("{header}{}", theirs.replace("title: Remote", "title: Agreed")),
    )
    .unwrap();
    let edited = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let path = draft.clone();
    let proxy = proxy_acting_on_first(
        &site,
        "/__first/api/v1/sync/notes",
        move || {
            let t = std::fs::read_to_string(&path).unwrap();
            std::fs::write(&path, t.replace("title: Agreed", "title: Agreed, then reconsidered")).unwrap();
        },
        edited.clone(),
    );
    let out = first()
        .arg("sync")
        .args(["resolve", &uid])
        .arg(&project)
        .env("FIRST_APP_PASSWORD", &site.token)
        .args(["--site", &proxy, "--json"])
        .output()
        .unwrap();
    assert!(edited.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(
        out.status.code(),
        Some(1),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(
        std::fs::read_to_string(&draft)
            .unwrap()
            .contains("Agreed, then reconsidered"),
        "the newer draft is kept"
    );
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn a_conflict_draft_is_never_rewritten_and_a_kept_draft_resolves_again() {
    let (project, site) = setup();
    std::fs::write(
        project.join("content/notes/n.md"),
        "---\ntitle: Note\nslug: n\nlevel: null\nauthorId: null\n---\nFirst.\n",
    )
    .unwrap();
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    let file = project.join("content/notes/n.md");
    let id = site.rows("notes")[0]["id"].as_i64().unwrap();
    let uid = site.rows("notes")[0]["uid"].as_str().unwrap().to_string();
    std::fs::write(
        &file,
        std::fs::read_to_string(&file)
            .unwrap()
            .replace("title: Note", "title: Local"),
    )
    .unwrap();
    let (s, _) = site.call(
        "PATCH",
        &format!("/notes/{id}"),
        Some(serde_json::json!({"title": "Remote"})),
    );
    assert_eq!(s, 200);
    sync(&project, &site, &["--only", "notes"]);
    let draft = project.join(format!(".first/conflicts/{uid}.md"));
    let conflict = std::fs::read_to_string(&draft).unwrap();
    let header: String = conflict
        .lines()
        .take_while(|l| l.starts_with('#'))
        .map(|l| format!("{l}\n"))
        .collect();
    let theirs = conflict
        .split("=======\n")
        .nth(1)
        .unwrap()
        .split(">>>>>>>")
        .next()
        .unwrap();
    // The user starts resolving; another plain sync must not throw that work away.
    let resolution = format!("{header}{}", theirs.replace("title: Remote", "title: Agreed"));
    std::fs::write(&draft, &resolution).unwrap();
    sync(&project, &site, &["--only", "notes"]);
    assert_eq!(
        std::fs::read_to_string(&draft).unwrap(),
        resolution,
        "a rerun keeps the draft as the user left it"
    );

    // resolve runs while the user edits the draft again: the earlier version applies, the newer draft
    // is kept, and it resolves in turn.
    let edited = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let path = draft.clone();
    let proxy = proxy_acting_on_first(
        &site,
        "/__first/api/v1/sync/notes",
        move || {
            let t = std::fs::read_to_string(&path).unwrap();
            std::fs::write(&path, t.replace("title: Agreed", "title: Agreed, then reconsidered")).unwrap();
        },
        edited.clone(),
    );
    let initial = first()
        .arg("sync")
        .args(["resolve", &uid])
        .arg(&project)
        .env("FIRST_APP_PASSWORD", &site.token)
        .args(["--site", &proxy])
        .output()
        .unwrap();
    assert!(edited.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(
        initial.status.code(),
        Some(1),
        "{}",
        String::from_utf8_lossy(&initial.stderr)
    );
    assert_eq!(site.rows("notes")[0]["title"], "Agreed");
    let second = sync(&project, &site, &["resolve", &uid]);
    assert_eq!(
        second.status.code(),
        Some(0),
        "the kept draft resolves: {}{}",
        String::from_utf8_lossy(&second.stdout),
        String::from_utf8_lossy(&second.stderr)
    );
    assert_eq!(site.rows("notes")[0]["title"], "Agreed, then reconsidered");
    assert!(!draft.exists());
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn a_file_restored_while_the_site_is_read_is_not_trashed() {
    let (project, site) = setup();
    std::fs::write(
        project.join("content/notes/n.md"),
        "---\ntitle: Note\nslug: n\nlevel: null\nauthorId: null\n---\nFirst.\n",
    )
    .unwrap();
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    let file = project.join("content/notes/n.md");
    let kept = std::fs::read_to_string(&file).unwrap();
    std::fs::remove_file(&file).unwrap();
    // The run reads the directory (file missing), then pulls the site; the file comes back meanwhile.
    let restored = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let path = file.clone();
    let proxy = proxy_acting_on_first(
        &site,
        "GET /__first/api/v1/sync/notes",
        move || std::fs::write(&path, &kept).unwrap(),
        restored.clone(),
    );
    let out = first()
        .arg("sync")
        .arg(&project)
        .env("FIRST_APP_PASSWORD", &site.token)
        .args(["--only", "notes", "--site", &proxy, "--json", "--no-commit"])
        .output()
        .unwrap();
    assert!(restored.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(
        site.rows("notes").len(),
        1,
        "the record is not trashed: {}",
        String::from_utf8_lossy(&out.stdout)
    );
    assert_eq!(out.status.code(), Some(1), "and the run says why");
    assert_eq!(
        data(&sync(&project, &site, &["--only", "notes"]))["applied"].as_u64(),
        Some(0),
        "the next run sees agreement"
    );
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn a_slug_changed_alike_on_both_sides_moves_the_file_in_the_same_run() {
    let (project, site) = setup();
    std::fs::write(
        project.join("content/notes/old.md"),
        "---\ntitle: Note\nslug: old\nlevel: null\nauthorId: null\n---\nFirst.\n",
    )
    .unwrap();
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    let id = site.rows("notes")[0]["id"].as_i64().unwrap();
    let file = project.join("content/notes/old.md");
    std::fs::write(
        &file,
        std::fs::read_to_string(&file)
            .unwrap()
            .replace("slug: old", "slug: new"),
    )
    .unwrap();
    let (s, _) = site.call(
        "PATCH",
        &format!("/notes/{id}"),
        Some(serde_json::json!({"slug": "new"})),
    );
    assert_eq!(s, 200);
    assert_eq!(
        sync(&project, &site, &["--only", "notes", "--check"]).status.code(),
        Some(2),
        "--check reports the pending move"
    );
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    assert!(
        project.join("content/notes/new.md").exists() && !file.exists(),
        "moved in this run"
    );
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn a_file_restored_during_the_trash_request_comes_back_on_the_next_run() {
    let (project, site) = setup();
    std::fs::write(
        project.join("content/notes/n.md"),
        "---\ntitle: Note\nslug: n\nlevel: null\nauthorId: null\n---\nFirst.\n",
    )
    .unwrap();
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    let file = project.join("content/notes/n.md");
    let kept = std::fs::read_to_string(&file).unwrap();
    std::fs::remove_file(&file).unwrap();
    // The file comes back while its trash request is in flight.
    let restored = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let path = file.clone();
    let proxy = proxy_acting_on_first(
        &site,
        "/__first/api/v1/sync/notes/trash",
        move || std::fs::write(&path, &kept).unwrap(),
        restored.clone(),
    );
    let out = first()
        .arg("sync")
        .arg(&project)
        .env("FIRST_APP_PASSWORD", &site.token)
        .args(["--only", "notes", "--site", &proxy, "--json", "--no-commit"])
        .output()
        .unwrap();
    assert!(restored.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(
        out.status.code(),
        Some(1),
        "the run reports the file that came back: {}",
        String::from_utf8_lossy(&out.stdout)
    );
    // The next run keeps the file and puts the record back.
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    assert!(file.exists(), "the restored file is not deleted");
    assert_eq!(site.rows("notes").len(), 1, "its record is back on the site");
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn an_unreadable_file_restored_mid_run_blocks_the_trash() {
    let (project, site) = setup();
    std::fs::write(
        project.join("content/notes/n.md"),
        "---\ntitle: Note\nslug: n\nlevel: null\nauthorId: null\n---\nFirst.\n",
    )
    .unwrap();
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    let file = project.join("content/notes/n.md");
    std::fs::remove_file(&file).unwrap();
    // While the site is read, a file appears that can't be parsed: it might be the same record.
    let restored = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let path = file.clone();
    let proxy = proxy_acting_on_first(
        &site,
        "GET /__first/api/v1/sync/notes",
        move || std::fs::write(&path, "---\ntitle: &broken\n---\n").unwrap(),
        restored.clone(),
    );
    let out = first()
        .arg("sync")
        .arg(&project)
        .env("FIRST_APP_PASSWORD", &site.token)
        .args(["--only", "notes", "--site", &proxy, "--json", "--no-commit"])
        .output()
        .unwrap();
    assert!(restored.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(out.status.code(), Some(1));
    assert_eq!(
        site.rows("notes").len(),
        1,
        "nothing is trashed while the directory can't be read with certainty"
    );
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn a_record_whose_uid_another_file_mentions_can_still_be_deleted() {
    let (project, site) = setup();
    std::fs::write(
        project.join("content/notes/a.md"),
        "---\ntitle: A\nslug: a\nlevel: null\nauthorId: null\n---\nFirst.\n",
    )
    .unwrap();
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    let a_uid = site.rows("notes")[0]["uid"].as_str().unwrap().to_string();
    // Another note's body names A's uid; that is not A coming back.
    std::fs::write(
        project.join("content/notes/b.md"),
        format!("---\ntitle: B\nslug: b\nlevel: null\nauthorId: null\n---\nSee {a_uid}.\n"),
    )
    .unwrap();
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    std::fs::remove_file(project.join("content/notes/a.md")).unwrap();
    let out = sync(&project, &site, &["--only", "notes"]);
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stdout));
    assert!(
        !site.rows("notes").iter().any(|r| r["uid"] == a_uid.as_str()),
        "A is trashed"
    );
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn a_failure_later_in_the_run_keeps_the_bases_already_moved() {
    let (project, site) = setup();
    std::fs::create_dir_all(project.join("content/snippets")).unwrap();
    std::fs::write(
        project.join("content/notes/n.md"),
        "---\ntitle: Note\nslug: n\nlevel: null\nauthorId: null\n---\nFirst.\n",
    )
    .unwrap();
    assert_eq!(
        sync(&project, &site, &["--only", "notes,snippets"]).status.code(),
        Some(0)
    );
    let file = project.join("content/notes/n.md");
    let kept = std::fs::read_to_string(&file).unwrap();
    std::fs::remove_file(&file).unwrap();
    // The file comes back during its trash request, and then the next collection's pull fails, which
    // stops the run. The trashed record's base must still be gone afterwards.
    let restored = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let path = file.clone();
    let proxy = proxy_with_outage(
        &site,
        "/__first/api/v1/sync/notes/trash",
        move || std::fs::write(&path, &kept).unwrap(),
        restored.clone(),
        Some("/__first/api/v1/sync/snippets"),
    );
    let out = first()
        .arg("sync")
        .arg(&project)
        .env("FIRST_APP_PASSWORD", &site.token)
        .args(["--only", "notes,snippets", "--site", &proxy, "--json", "--no-commit"])
        .output()
        .unwrap();
    assert!(restored.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(
        out.status.code(),
        Some(1),
        "the run stopped: {}",
        String::from_utf8_lossy(&out.stdout)
    );
    assert_eq!(
        sync(&project, &site, &["--only", "notes,snippets"]).status.code(),
        Some(0)
    );
    assert!(file.exists(), "the restored file survives the next run");
    assert_eq!(site.rows("notes").len(), 1, "and its record is back");
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn a_delete_versus_edit_conflict_can_be_resolved_as_a_deletion_either_way() {
    let (project, site) = setup();
    for (case, delete_file) in [("file deleted", true), ("record deleted", false)] {
        let slug = if delete_file { "gone-locally" } else { "gone-remotely" };
        std::fs::write(
            project.join(format!("content/notes/{slug}.md")),
            format!("---\ntitle: T\nslug: {slug}\nlevel: null\nauthorId: null\n---\nFirst.\n"),
        )
        .unwrap();
        assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
        let row = site.rows("notes").into_iter().find(|r| r["slug"] == slug).unwrap();
        let (id, uid) = (row["id"].as_i64().unwrap(), row["uid"].as_str().unwrap().to_string());
        let file = project.join(format!("content/notes/{slug}.md"));
        if delete_file {
            std::fs::remove_file(&file).unwrap();
            let (s, _) = site.call(
                "PATCH",
                &format!("/notes/{id}"),
                Some(serde_json::json!({"title": "Edited online"})),
            );
            assert_eq!(s, 200);
        } else {
            std::fs::write(
                &file,
                std::fs::read_to_string(&file)
                    .unwrap()
                    .replace("title: T", "title: Edited locally"),
            )
            .unwrap();
            let (s, _) = site.call("DELETE", &format!("/notes/{id}"), None);
            assert_eq!(s, 200);
        }
        sync(&project, &site, &["--only", "notes"]);
        let draft = project.join(format!(".first/conflicts/{uid}.md"));
        let conflict = std::fs::read_to_string(&draft).unwrap_or_else(|_| panic!("{case}: a conflict draft"));
        let header: String = conflict
            .lines()
            .take_while(|l| l.starts_with('#'))
            .map(|l| format!("{l}\n"))
            .collect();
        std::fs::write(&draft, format!("{header}(deleted)\n")).unwrap();
        let out = sync(&project, &site, &["resolve", &uid]);
        assert_eq!(
            out.status.code(),
            Some(0),
            "{case}: {}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        assert!(!file.exists(), "{case}: no file");
        assert!(
            !site.rows("notes").iter().any(|r| r["uid"] == uid.as_str()),
            "{case}: no record"
        );
        assert!(!draft.exists(), "{case}: no draft");
        assert_eq!(
            data(&sync(&project, &site, &["--only", "notes"]))["applied"].as_u64(),
            Some(0),
            "{case}: settled"
        );
    }
    let _ = std::fs::remove_dir_all(&project);
}

#[test]
fn a_file_edited_while_resolve_deletes_it_is_kept() {
    let (project, site) = setup();
    std::fs::write(
        project.join("content/notes/n.md"),
        "---\ntitle: Note\nslug: n\nlevel: null\nauthorId: null\n---\nFirst.\n",
    )
    .unwrap();
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    let file = project.join("content/notes/n.md");
    let id = site.rows("notes")[0]["id"].as_i64().unwrap();
    let uid = site.rows("notes")[0]["uid"].as_str().unwrap().to_string();
    // An edit/edit conflict, resolved as a deletion; the file is edited while the trash request runs.
    std::fs::write(
        &file,
        std::fs::read_to_string(&file)
            .unwrap()
            .replace("title: Note", "title: Local"),
    )
    .unwrap();
    let (s, _) = site.call(
        "PATCH",
        &format!("/notes/{id}"),
        Some(serde_json::json!({"title": "Remote"})),
    );
    assert_eq!(s, 200);
    sync(&project, &site, &["--only", "notes"]);
    let draft = project.join(format!(".first/conflicts/{uid}.md"));
    let conflict = std::fs::read_to_string(&draft).unwrap();
    let header: String = conflict
        .lines()
        .take_while(|l| l.starts_with('#'))
        .map(|l| format!("{l}\n"))
        .collect();
    std::fs::write(&draft, format!("{header}(deleted)\n")).unwrap();
    let edited = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let path = file.clone();
    let proxy = proxy_acting_on_first(
        &site,
        "/__first/api/v1/sync/notes/trash",
        move || {
            let t = std::fs::read_to_string(&path).unwrap();
            std::fs::write(&path, t.replace("First.", "Kept: typed during the delete.")).unwrap();
        },
        edited.clone(),
    );
    let out = first()
        .arg("sync")
        .args(["resolve", &uid])
        .arg(&project)
        .env("FIRST_APP_PASSWORD", &site.token)
        .args(["--site", &proxy])
        .output()
        .unwrap();
    assert!(edited.load(std::sync::atomic::Ordering::SeqCst));
    assert_eq!(out.status.code(), Some(1), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(
        std::fs::read_to_string(&file)
            .unwrap()
            .contains("Kept: typed during the delete."),
        "the newer file is kept"
    );
    assert!(draft.exists(), "and the draft too");
    // The next run treats the surviving file as new and pushes it back.
    std::fs::remove_file(&draft).unwrap();
    assert_eq!(sync(&project, &site, &["--only", "notes"]).status.code(), Some(0));
    assert!(site.rows("notes").iter().any(|r| {
        r["body"]
            .as_str()
            .is_some_and(|b| b.contains("Kept: typed during the delete."))
    }));
    let _ = std::fs::remove_dir_all(&project);
}

/// A folder tree of Markdown syncs with a hierarchical kind: a file's folders are its parent chain
/// and its name its slug, so neither is written in front matter; a page moved on the site moves
/// its file, and a page that gains children becomes its folder's index file.
#[test]
fn a_folder_tree_syncs_with_a_hierarchical_kind_both_ways() {
    let (project, site) = setup();
    let dir = project.join("content/docs");
    std::fs::create_dir_all(dir.join("guides")).unwrap();
    std::fs::write(dir.join("intro.md"), "---\ntitle: Intro\norder: 1\n---\nHello.\n").unwrap();
    std::fs::write(
        dir.join("guides/index.md"),
        "---\ntitle: Guides\norder: 2\n---\nHow to.\n",
    )
    .unwrap();
    std::fs::write(dir.join("guides/install.md"), "---\ntitle: Install\n---\nRun it.\n").unwrap();
    let out = sync(&project, &site, &["--only", "docs"]);
    assert_eq!(out.status.code(), Some(0), "{}", String::from_utf8_lossy(&out.stderr));
    let rows = site.rows("docs");
    let by_slug = |slug: &str| {
        rows.iter()
            .find(|r| r["slug"] == slug)
            .unwrap_or_else(|| panic!("{slug}: {rows:?}"))
            .clone()
    };
    let (intro, guides, install) = (by_slug("intro"), by_slug("guides"), by_slug("install"));
    assert_eq!(intro["parent"], serde_json::Value::Null);
    assert_eq!(intro["order"], 1);
    assert_eq!(guides["order"], 2);
    assert_eq!(install["parent"], guides["id"], "a file's folder is its parent");
    // The files carry their uid, and never their slug or parent: the path says those.
    let install_file = read(&project, "content/docs/guides/install.md");
    assert!(install_file.starts_with("---\nuid: zr_"), "{install_file}");
    assert!(
        !install_file.contains("slug:") && !install_file.contains("parent:"),
        "{install_file}"
    );

    // On the site: Intro moves under Guides, and Install gets a child of its own.
    let (s, moved) = site.call(
        "PATCH",
        &format!("/docs/{}", intro["id"]),
        Some(serde_json::json!({ "parent": guides["id"], "order": 0 })),
    );
    assert_eq!(s, 200, "{moved}");
    let (s, child) = site.call(
        "POST",
        "/docs",
        Some(serde_json::json!({ "title": "On Linux", "slug": "linux", "parent": install["id"], "body": "<!-- wp:paragraph -->\n<p>Use the package.</p>\n<!-- /wp:paragraph -->" })),
    );
    assert_eq!(s, 201, "{child}");
    let out = sync(&project, &site, &["--only", "docs"]);
    assert_eq!(
        out.status.code(),
        Some(0),
        "{}\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let pulled = data(&out);
    let mut files: Vec<String> = Vec::new();
    let mut pending = vec![dir.clone()];
    while let Some(d) = pending.pop() {
        for e in std::fs::read_dir(&d).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                pending.push(p);
            } else {
                files.push(p.strip_prefix(&dir).unwrap().to_string_lossy().into_owned());
            }
        }
    }
    files.sort();
    assert_eq!(
        files,
        [
            "guides/index.md",
            "guides/install/index.md",
            "guides/install/linux.md",
            "guides/intro.md"
        ],
        "the files follow the tree: {pulled}"
    );
    assert!(read(&project, "content/docs/guides/install/linux.md").contains("Use the package."));
    // A second run changes nothing: the tree and the files agree.
    let again = data(&sync(&project, &site, &["--only", "docs", "--check"]));
    assert_eq!(again["pending"], serde_json::json!([]), "{again}");
    let _ = std::fs::remove_dir_all(&project);
}
