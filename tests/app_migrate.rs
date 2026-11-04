#![cfg(feature = "cli")]
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/app-migrate")
        .join(name)
}
fn migrate(input: &Path, out: &Path, flags: &[&str]) -> (bool, Value) {
    let output = Command::new(env!("CARGO_BIN_EXE_zero"))
        .args(["migrate", "app", "--from", "zero-0.8"])
        .arg(input)
        .arg("--out")
        .arg(out)
        .args(flags)
        .output()
        .unwrap();
    let report = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&output.stderr)));
    (output.status.success(), report)
}
fn build(project: &Path) {
    let output = Command::new(env!("CARGO_BIN_EXE_zero"))
        .arg("build")
        .arg(project)
        .arg("--quiet")
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let types = Path::new(env!("CARGO_MANIFEST_DIR")).join("types/zero/index.d.ts");
    std::fs::write(project.join("tsconfig.json"), serde_json::json!({
        "compilerOptions": {"target":"ES2022", "lib":["ES2022"], "module":"ESNext", "moduleResolution":"bundler", "strict":true,"noEmit":true,"types":[],"paths":{"zero":[types]}},
        "include":["zero.config.ts","zero.gen.ts","server/**/*.ts","shared/**/*.ts"]
    }).to_string()).unwrap();
    let checked = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .arg("-p")
        .arg(project)
        .output()
        .expect("tsc or TSC is required");
    assert!(
        checked.status.success(),
        "{}{}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );
}

#[test]
fn generates_compiled_app_and_adoption_snapshot_without_touching_source() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("board");
    let (ok, dry) = migrate(
        &fixture("board"),
        &out,
        &["--space", "spc_migrate_test", "--dry-run", "--json"],
    );
    assert!(ok, "{dry:#}");
    assert_eq!(dry["status"], "dry-run");
    assert!(!out.exists());
    let (ok, written) = migrate(&fixture("board"), &out, &["--space", "spc_migrate_test"]);
    assert!(ok, "{written:#}");
    assert_eq!(written["status"], "written");
    assert_eq!(dry["adoption_sql"], written["adoption_sql"]);
    let snapshot: Value =
        serde_json::from_slice(&std::fs::read(out.join("zero/migrations/snapshot.json")).unwrap()).unwrap();
    assert_eq!(snapshot["tables"]["tasks"]["columns"]["id"]["autoIncrement"], true);
    assert_eq!(
        snapshot["tables"]["tasks"]["existingTable"],
        "sf_spc_migrate_test_tasks_3c47092ff0"
    );
    build(&out);
    // The committed adoption snapshot is exactly what build accepts, without a second migration.
    assert_eq!(std::fs::read_dir(out.join("zero/migrations")).unwrap().count(), 2);
    let (ok, collision) = migrate(&fixture("board"), &out, &["--space", "spc_migrate_test"]);
    assert!(!ok);
    assert_eq!(collision["status"], "refused");
    assert_eq!(collision["errors"][0]["pointer"], "");
    let mut changed = snapshot;
    changed["tables"]["tasks"]["existingTable"] = "some_other_table".into();
    std::fs::write(out.join("zero/migrations/snapshot.json"), changed.to_string()).unwrap();
    let check = Command::new(env!("CARGO_BIN_EXE_zero"))
        .arg("check")
        .arg(&out)
        .output()
        .unwrap();
    assert!(!check.status.success());
    assert!(String::from_utf8_lossy(&check.stderr).contains("cannot change after the first snapshot"));
}

#[test]
fn reuses_content_importer_and_normalizes_roles_without_claiming_grants() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("content");
    let (ok, report) = migrate(&fixture("content"), &out, &[]);
    assert!(ok, "{report:#}");
    assert_eq!(report["connector_roles"]["calendar"]["as"], "personal");
    assert_eq!(report["connector_roles"]["shared"]["as"], "team");
    assert_eq!(report["connector_roles"]["visitor"]["as"], "visitor");
    build(&out);
}

#[test]
fn reports_all_unsupported_features_and_never_writes_a_refused_app() {
    let temp = tempfile::tempdir().unwrap();
    let out = temp.path().join("refused");
    let (ok, report) = migrate(&fixture("refused"), &out, &["--space", "spc_migrate_test"]);
    assert!(!ok);
    assert_eq!(report["status"], "refused");
    let pointers: Vec<_> = report["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["pointer"].as_str().unwrap())
        .collect();
    assert_eq!(
        pointers,
        [
            "/pages/index.tsx",
            "/auth/onGuestUpgrade",
            "/endpoints/status",
            "/queries/email/ctx/email",
            "/queries/identity/ctx/auth/userId",
            "/queries/pages/ctx/db/tasks"
        ]
    );
    assert!(!out.exists());
    let (ok, compiled_only) = migrate(&fixture("zero-all-features"), &out, &["--dry-run"]);
    assert!(!ok);
    assert!(
        compiled_only["errors"][0]["reason"]
            .as_str()
            .unwrap()
            .contains("compiled finalize payloads are not capsule source")
    );
}
