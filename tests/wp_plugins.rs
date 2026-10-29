//! Module-owned artifact tests: real HTTP ZIP acquisition through the real CLI.
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn zip(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, bytes) in files {
        writer
            .start_file(
                *name,
                zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated),
            )
            .unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn replace_zip_names(mut bytes: Vec<u8>, from: &[u8], to: &[u8], all: bool) -> Vec<u8> {
    assert_eq!(from.len(), to.len());
    let positions: Vec<_> = bytes
        .windows(from.len())
        .enumerate()
        .filter_map(|(i, name)| (name == from).then_some(i))
        .collect();
    assert!(!positions.is_empty());
    for i in positions {
        bytes[i..i + to.len()].copy_from_slice(to);
        if !all {
            break;
        }
    }
    bytes
}

fn plugin_zip(slug: &str, version: &str, requires: &str) -> Vec<u8> {
    let header = format!(
        "<?php\n/**\n * Plugin Name: {slug}\n * Version: {version}\n * Requires Plugins: {requires}\n */\nthrow new Exception('BUILD MUST NEVER EXECUTE PLUGIN PHP');\n"
    );
    zip(&[
        (&format!("{slug}/{slug}.php"), header.as_bytes()),
        (&format!("{slug}/assets/data.txt"), b"artifact bytes"),
    ])
}

struct Server {
    base: String,
    address: std::net::SocketAddr,
    thread: Option<JoinHandle<()>>,
}
impl Server {
    fn new(routes: BTreeMap<String, Vec<u8>>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let routes = Arc::new(routes);
        let thread = std::thread::spawn(move || {
            for conn in listener.incoming() {
                let mut conn = conn.unwrap();
                conn.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
                let mut request = Vec::new();
                let mut byte = [0];
                while conn.read(&mut byte).unwrap_or(0) != 0 {
                    request.push(byte[0]);
                    if request.ends_with(b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&request);
                let path = request.split_whitespace().nth(1).unwrap_or("");
                if path == "/__stop" {
                    break;
                }
                let (status, body) = match routes.get(path) {
                    Some(b) => ("200 OK", b.as_slice()),
                    None => ("404 Not Found", b"not found".as_slice()),
                };
                write!(
                    conn,
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .unwrap();
                let _ = conn.write_all(body);
            }
        });
        Self {
            base: format!("http://{address}"),
            address,
            thread: Some(thread),
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        if let Some(thread) = self.thread.take() {
            let mut conn = TcpStream::connect(self.address).unwrap();
            conn.write_all(b"GET /__stop HTTP/1.1\r\nHost: localhost\r\n\r\n")
                .unwrap();
            thread.join().unwrap();
        }
    }
}

struct Project {
    _temp: tempfile::TempDir,
    root: PathBuf,
    out: PathBuf,
}
impl Project {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("app");
        std::fs::create_dir(&root).unwrap();
        let out = root.join(".zero/wp-content");
        Self { _temp: temp, root, out }
    }
    fn config(&self, plugins: &[Value]) {
        let plugins: serde_json::Map<String, Value> = plugins
            .iter()
            .map(|p| {
                let mut entry = p.as_object().unwrap().clone();
                let slug = entry.remove("slug").unwrap().as_str().unwrap().to_string();
                (slug, Value::Object(entry))
            })
            .collect();
        let body = format!(
            "import {{ defineConfig }} from 'zero';\nexport default defineConfig({{ name: 'fixtures', target: 'wp', schema: {{}}, plugins: {} }});\n",
            serde_json::to_string(&plugins).unwrap()
        );
        std::fs::write(self.root.join("zero.config.ts"), body).unwrap();
    }
    fn run(&self, command: &str, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_zero"))
            .env_remove("ZERO_WP_PLUGIN_CACHE")
            .arg(command)
            .arg(&self.root)
            .args(args)
            .output()
            .unwrap()
    }
    fn build(&self) {
        let out = self.run("build", &[]);
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
    fn rejects(&self, command: &str, message: &str) {
        let out = self.run(command, &[]);
        assert!(!out.status.success());
        assert!(
            String::from_utf8_lossy(&out.stderr).contains(message),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
}

fn declared(server: &Server, slug: &str, version: &str, zip: &[u8], requires: &[&str]) -> Value {
    json!({"slug":slug,"version":version,"pluginData":{"resource":"url","url":format!("{}/{slug}.zip",server.base)},"sha256":sha(zip),"requires":requires})
}

fn platform(server: &Server, routes: &BTreeMap<String, Vec<u8>>) -> Vec<Value> {
    [
        ("secure-custom-fields", "6.9.7"),
        ("action-scheduler", "4.2.0"),
        ("mcp-adapter", "0.7.1"),
    ]
    .into_iter()
    .map(|(s, v)| declared(server, s, v, &routes[&format!("/{s}.zip")], &[]))
    .collect()
}
fn routes() -> BTreeMap<String, Vec<u8>> {
    [
        ("secure-custom-fields", "6.9.7"),
        ("action-scheduler", "4.2.0"),
        ("mcp-adapter", "0.7.1"),
    ]
    .into_iter()
    .map(|(s, v)| (format!("/{s}.zip"), plugin_zip(s, v, "")))
    .collect()
}
fn tree(path: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
    fn read(root: &Path, rel: &Path, out: &mut BTreeMap<PathBuf, Vec<u8>>) {
        for e in std::fs::read_dir(root.join(rel)).unwrap() {
            let e = e.unwrap();
            let child = rel.join(e.file_name());
            if e.file_type().unwrap().is_dir() {
                read(root, &child, out);
            } else {
                out.insert(child, std::fs::read(e.path()).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    read(path, Path::new(""), &mut out);
    out
}

#[test]
fn acquired_plugins_are_built_locked_and_repeatable_without_running_php() {
    let mut routes = routes();
    routes.insert("/feature.zip".into(), plugin_zip("feature", "1.0", "dependency"));
    // Rootless ZIPs follow Playground installAsset's layout convention too.
    let dep = zip(&[
        (
            "dependency.php",
            b"<?php\n/*\n@Plugin Name: dependency\n@Version: 2.1\n*/\n",
        ),
        ("assets/x.txt", b"dependency"),
    ]);
    routes.insert("/dependency.zip".into(), dep);
    let server = Server::new(routes.clone());
    let p = Project::new();
    let mut plugins = platform(&server, &routes);
    plugins.push(declared(
        &server,
        "feature",
        "1.0",
        &routes["/feature.zip"],
        &["dependency"],
    ));
    plugins.push(declared(&server, "dependency", "2.1", &routes["/dependency.zip"], &[]));
    p.config(&plugins);
    std::fs::create_dir_all(p.out.join("plugins/unrelated")).unwrap();
    std::fs::write(p.out.join("plugins/unrelated/keep.php"), b"local plugin").unwrap();
    p.build();
    assert_eq!(
        std::fs::read(p.out.join("plugins/feature/assets/data.txt")).unwrap(),
        b"artifact bytes"
    );
    assert!(p.out.join("plugins/zero-app-fixtures/zero-app-fixtures.php").is_file());
    assert!(p.out.join("plugins/zero-app-fixtures.zip").is_file());
    let lock_path = p.root.join("zero/wp-plugins.lock.json");
    let locked = std::fs::read(&lock_path).unwrap();
    let lock: Value = serde_json::from_slice(&locked).unwrap();
    let entries = lock["plugins"].as_array().unwrap();
    let names: Vec<_> = entries.iter().map(|e| e["slug"].as_str().unwrap()).collect();
    assert!(names.iter().position(|s| *s == "dependency") < names.iter().position(|s| *s == "feature"));
    assert_eq!(
        entries.iter().find(|e| e["slug"] == "feature").unwrap()["sha256"],
        sha(&routes["/feature.zip"])
    );
    assert_eq!(
        std::fs::read(p.out.join("plugins/unrelated/keep.php")).unwrap(),
        b"local plugin"
    );
    let before = tree(&p.out);
    drop(server);
    p.build();
    // The canonical assembler emits deterministic ZIPs as well as stable trees.
    assert_eq!(before, tree(&p.out));
    assert_eq!(locked, std::fs::read(lock_path).unwrap());
    let custom = Command::new(env!("CARGO_BIN_EXE_zero"))
        .args(["build", ".", "--out", ".zero/wp/custom-content"])
        .current_dir(&p.root)
        .env_remove("ZERO_WP_PLUGIN_CACHE")
        .output()
        .unwrap();
    assert!(custom.status.success(), "{}", String::from_utf8_lossy(&custom.stderr));
    assert!(
        p.root
            .join(".zero/wp/custom-content/plugins/feature/feature.php")
            .is_file()
    );

    // Standalone emission never acquires or bundles WordPress plugins, even with a cold cache.
    std::fs::remove_dir_all(p.root.join(".zero/cache")).unwrap();
    let out = p.run("build", &["--target", "standalone"]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(p.root.join(".zero/app/public/index.php").is_file());
    assert!(!p.root.join(".zero/app/plugins").exists());
}

#[test]
fn invalid_download_archive_and_output_collisions_preserve_previous_build() {
    let mut routes = routes();
    routes.insert("/good.zip".into(), plugin_zip("good", "1.0", ""));
    routes.insert("/traversal.zip".into(), zip(&[("../escape.php", b"bad")]));
    routes.insert("/case.zip".into(), zip(&[("case/A.php", b"a"), ("case/a.php", b"b")]));
    routes.insert(
        "/file-parent.zip".into(),
        zip(&[("file-parent/a", b"a"), ("file-parent/a/b", b"b")]),
    );
    routes.insert("/bad-version.zip".into(), plugin_zip("bad-version", "9.0", ""));
    routes.insert("/header-dep.zip".into(), plugin_zip("header-dep", "1.0", "undeclared"));
    let mut symlink = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    symlink
        .add_symlink("link/escape", "../../outside", zip::write::SimpleFileOptions::default())
        .unwrap();
    routes.insert("/link.zip".into(), symlink.finish().unwrap().into_inner());
    let duplicate = zip(&[
        (
            "duplicate/duplicate.php",
            b"<?php\n/*\nPlugin Name: Duplicate\nVersion: 1.0\n*/",
        ),
        ("duplicate/first.txt", b"first"),
        ("duplicate/other.txt", b"last"),
    ]);
    routes.insert(
        "/duplicate.zip".into(),
        replace_zip_names(duplicate, b"duplicate/other.txt", b"duplicate/first.txt", true),
    );
    let inconsistent = plugin_zip("header-mismatch", "1.0", "");
    routes.insert(
        "/header-mismatch.zip".into(),
        replace_zip_names(
            inconsistent,
            b"header-mismatch/header-mismatch.php",
            b"header-mismatch/header-mismatcH.php",
            false,
        ),
    );
    routes.insert(
        "/at-header.zip".into(),
        zip(&[(
            "at-header/at-header.php",
            b"<?php /**\r * @Plugin Name: At Header\r * @Version: 1.0\r * @Requires Plugins: missing\r */",
        )]),
    );
    let mut many = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for i in 0..20_001 {
        many.start_file(format!("limit/{i}.txt"), zip::write::SimpleFileOptions::default())
            .unwrap();
        many.write_all(b"x").unwrap();
    }
    routes.insert("/limit.zip".into(), many.finish().unwrap().into_inner());
    let server = Server::new(routes.clone());
    let p = Project::new();
    let mut plugins = platform(&server, &routes);
    plugins.push(declared(&server, "good", "1.0", &routes["/good.zip"], &[]));
    p.config(&plugins);
    p.build();
    let lock = std::fs::read(p.root.join("zero/wp-plugins.lock.json")).unwrap();
    for (name, error) in [
        ("duplicate", "duplicate archive paths"),
        ("header-mismatch", "header inconsistency"),
        ("at-header", "header dependency"),
        ("limit", "too many entries"),
        ("traversal", "unsafe archive path"),
        ("case", "duplicate/case-colliding"),
        ("file-parent", "file/directory collision"),
        ("bad-version", "Version does not match"),
        ("header-dep", "header dependency"),
        ("link", "symlink or special"),
    ] {
        let before = tree(&p.out);
        let mut invalid = plugins.clone();
        invalid.push(declared(&server, name, "1.0", &routes[&format!("/{name}.zip")], &[]));
        p.config(&invalid);
        p.rejects("build", error);
        assert_eq!(before, tree(&p.out));
        assert_eq!(lock, std::fs::read(p.root.join("zero/wp-plugins.lock.json")).unwrap());
    }
    let before = tree(&p.out);
    let mut missing = plugins.clone();
    missing.push(declared(&server, "missing", "1.0", b"missing", &[]));
    p.config(&missing);
    p.rejects("build", "download failed");
    assert_eq!(before, tree(&p.out));
    let mut wrong = plugins.clone();
    wrong.push(declared(&server, "unknown", "1.0", b"not actual bytes", &[]));
    wrong.last_mut().unwrap()["pluginData"]["url"] = json!(format!("{}/good.zip", server.base));
    p.config(&wrong);
    p.rejects("build", "sha256 mismatch");
    assert_eq!(before, tree(&p.out));
    // An ergonomic repeat of the same platform source/version must retain the required checksum.
    let lock_path = p.root.join("zero/wp-plugins.lock.json");
    let mut substituted: Value = serde_json::from_slice(&lock).unwrap();
    let scf = substituted["plugins"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|v| v["slug"] == "secure-custom-fields")
        .unwrap();
    scf["pluginData"] = json!({"resource":"wordpress.org/plugins","slug":"secure-custom-fields.6.9.7.zip"});
    let altered = serde_json::to_vec_pretty(&substituted).unwrap();
    std::fs::write(&lock_path, &altered).unwrap();
    let mut equivalent = plugins.clone();
    equivalent[0] = json!({"slug":"secure-custom-fields","version":"6.9.7"});
    p.config(&equivalent);
    p.rejects("build", "authored sha256 conflicts with lock");
    assert_eq!(before, tree(&p.out));
    assert_eq!(altered, std::fs::read(&lock_path).unwrap());
    std::fs::write(lock_path, &lock).unwrap();
    // Existing unrelated and modified managed plugins must never be silently overwritten.
    std::fs::create_dir_all(p.out.join("plugins/traversal")).unwrap();
    std::fs::write(p.out.join("plugins/traversal/local.php"), "keep").unwrap();
    let mut collision = plugins.clone();
    let mut extra = declared(&server, "traversal", "1.0", &routes["/good.zip"], &[]);
    extra["pluginData"]["url"] = json!(format!("{}/good.zip", server.base));
    collision.push(extra);
    p.config(&collision);
    let before = tree(&p.out);
    p.rejects("build", "output collision");
    assert_eq!(before, tree(&p.out));
    std::fs::write(p.out.join("plugins/good/local.txt"), "local change").unwrap();
    p.config(&plugins);
    let before = tree(&p.out);
    p.rejects("build", "locally modified");
    assert_eq!(before, tree(&p.out));
    assert!(!p.root.join("escape.php").exists());
}

#[test]
fn check_validates_the_declared_graph_and_subset_without_network() {
    let p = Project::new();
    let org = |slug: &str| json!({"slug":slug,"version":"1.0"});
    let mut a = org("alpha");
    a["requires"] = json!(["beta"]);
    p.config(&[a.clone()]);
    p.rejects("check", "undeclared plugin dependency `beta`");
    let mut b = org("beta");
    b["requires"] = json!(["alpha"]);
    p.config(&[a, b]);
    p.rejects("check", "dependency cycle");
    std::fs::write(
        p.root.join("zero.config.ts"),
        "import {defineConfig} from 'zero'; export default defineConfig({schema:{},plugins:[]});",
    )
    .unwrap();
    p.rejects("check", "plugins must be a package map");

    for declarations in [
        "const plugins = {alpha:'1.0',alpha:'2.0'};",
        "const first = {alpha:'1.0',alpha:'2.0'}; const plugins = {...first};",
        "const plugins = {...{alpha:'1.0'},...{alpha:'2.0'}};",
        "const plugins = {alpha:{version:'1.0',version:'2.0'}};",
        "const plugins = {alpha:'1.0'}; plugins.alpha = '2.0';",
        "const plugins = Object.fromEntries([['alpha','1.0'],['alpha','2.0']]);",
    ] {
        std::fs::write(p.root.join("zero.config.ts"), format!(
            "import {{defineConfig}} from 'zero'; {declarations} export default defineConfig({{schema:{{}},plugins}});"
        )).unwrap();
        p.rejects("check", "duplicate plugin declaration/property");
    }
    std::fs::write(p.root.join("zero.config.ts"),
        "import {defineConfig} from 'zero'; export default defineConfig({schema:{},plugins:{alpha:'1.0'},plugins:{alpha:'2.0'}});"
    ).unwrap();
    p.rejects("check", "duplicate plugins declaration");
    std::fs::write(p.root.join("zero.config.ts"),
        "import {defineConfig} from 'zero'; const plugins = {}; plugins.alpha = plugins; export default defineConfig({schema:{},plugins});"
    ).unwrap();
    p.rejects("check", "acyclic declarative data");
    // Overwrites in other build-time data retain ordinary JavaScript semantics.
    std::fs::write(p.root.join("zero.config.ts"),
        "import {defineConfig} from 'zero'; const other = {value:'old',value:'new'}; export default defineConfig({schema:{},plugins:{alpha:'1.0'}});"
    ).unwrap();
    assert!(p.run("check", &[]).status.success());

    p.config(&[org("zero-runtime")]);
    p.rejects("check", "reserved plugin slug");
    p.config(&[org("../escape")]);
    p.rejects("check", "invalid or reserved");
    let mut a = org("alpha");
    a["version"] = json!("latest");
    p.config(&[a]);
    p.rejects("check", "exact numeric version");
    let mut a = org("alpha");
    a["pluginData"] = json!({"resource":"wordpress.org/plugins","slug":"alpha.latest-stable.zip"});
    p.config(&[a]);
    p.rejects("check", "floating releases are unsupported");
    let mut a = org("alpha");
    a["pluginData"] = json!({"resource":"url","url":"https://example.com/plugin.zip"});
    p.config(&[a]);
    p.rejects("check", "authored sha256");
    let mut a = org("alpha");
    a["step"] = json!("runPHP");
    p.config(&[a]);
    p.rejects("check", "Blueprint steps and activation are unsupported");
    p.config(&[org("secure-custom-fields")]);
    p.rejects("check", "platform plugin secure-custom-fields requires >= 6.9.7");
    p.config(&[org("alpha")]);
    let out = p.run("check", &[]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(!p.root.join(".zero").exists());
}
