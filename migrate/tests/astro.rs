use serde_json::Value;
use std::fs;
use std::path::Path;
use std::process::Command;

fn migrate(source: &Path, output: &Path, switches: &[&str]) -> (bool, Value) {
    let run = Command::new(env!("CARGO_BIN_EXE_spacepress-migrate"))
        .args(["--from", "astro", "app"])
        .arg(source)
        .arg("--out")
        .arg(output)
        .args(switches)
        .output()
        .unwrap();
    let report =
        serde_json::from_slice(&run.stdout).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&run.stderr)));
    (run.status.success(), report)
}

#[test]
fn imports_markdown_and_assets_and_reports_templates_for_review() {
    let fixture = tempfile::tempdir().unwrap();
    let source = fixture.path().join("source");
    let output = fixture.path().join("candidate");
    fs::create_dir_all(source.join("src/pages")).unwrap();
    fs::create_dir_all(source.join("public")).unwrap();
    let page = "---\nlayout: ../layouts/Base.astro\ntitle: About\n---\n\nThis is the journal.\n";
    fs::write(source.join("src/pages/about.md"), page).unwrap();
    fs::write(source.join("src/pages/index.astro"), "<h1>Journal</h1>").unwrap();
    fs::write(source.join("public/icon.bin"), [0, 255]).unwrap();

    let (ok, plan) = migrate(&source, &output, &["--dry-run"]);
    assert!(ok, "{plan}");
    assert_eq!(plan["source"], "astro");
    assert_eq!(plan["status"], "dry-run");
    assert!(!output.exists());
    let (ok, report) = migrate(&source, &output, &[]);
    assert!(ok, "{report}");
    assert_eq!(report["status"], "written");
    assert_eq!(report["entries"], plan["entries"]);
    assert!(
        report["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| { entry["pointer"] == "/src/pages/index.astro" && entry["outcome"] == "review" })
    );
    assert_eq!(fs::read(output.join("public/icon.bin")).unwrap(), [0, 255]);
    let converted = fs::read_to_string(output.join("sp/app/about/page.md")).unwrap();
    assert!(converted.contains("This is the journal."));
    assert!(!converted.contains("layout:"));
    assert_eq!(fs::read_to_string(source.join("src/pages/about.md")).unwrap(), page);

    let (ok, refusal) = migrate(&source, &output, &[]);
    assert!(!ok, "{refusal}");
    assert_eq!(
        fs::read_to_string(output.join("sp/app/about/page.md")).unwrap(),
        converted
    );
}
