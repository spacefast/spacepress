#![cfg(feature = "cli")]
//! Kept First sources (tests/fixtures/first-sources/README.md): every captured source bundle compiles
//! with this compiler, recompiling it against its own stored baseline plans exactly the committed
//! plan (normally none) with no step that loses data, and it stores what it stored when it was
//! captured.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/first-sources");

/// Every `<label>/<app>/` with a `sources/` capture.
fn fixtures() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for label in fs::read_dir(FIXTURES).unwrap() {
        let label = label.unwrap().path();
        if !label.is_dir() {
            continue;
        }
        for app in fs::read_dir(&label).unwrap() {
            let app = app.unwrap().path();
            if app.join("sources/manifest.json").is_file() {
                out.push(app);
            }
        }
    }
    out.sort();
    assert!(!out.is_empty(), "no kept sources under {FIXTURES}");
    out
}

fn name(fixture: &Path) -> String {
    fixture.strip_prefix(FIXTURES).unwrap().display().to_string()
}

fn json(path: &Path) -> serde_json::Value {
    serde_json::from_slice(&fs::read(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))).unwrap()
}

/// File name → contents of a migrations directory.
fn migrations(dir: &Path) -> BTreeMap<String, String> {
    fs::read_dir(dir)
        .unwrap()
        .map(|e| {
            let e = e.unwrap();
            (
                e.file_name().to_string_lossy().into_owned(),
                fs::read_to_string(e.path()).unwrap(),
            )
        })
        .collect()
}

#[test]
fn every_kept_source_compiles_against_its_baseline_with_its_committed_plan() {
    for fixture in fixtures() {
        let name = name(&fixture);
        let work = tempfile::tempdir().unwrap();
        let sources = fixture.join("sources");
        let baseline = fixture.join("baseline");
        let output = work.path().join("compiled");
        if let Err(error) = first::bundle::compile(&sources, &output, &sources, Some(&baseline)) {
            panic!("{name}: a source an earlier compiler accepted is refused: {error:?}");
        }
        // The plan: the migration files the recompile adds to the baseline's.
        let before = migrations(&baseline.join("migrations"));
        let after = migrations(&output.join("migrations"));
        for (file, sql) in &before {
            assert_eq!(
                after.get(file),
                Some(sql),
                "{name}: the baseline's {file} is carried as it is"
            );
        }
        let planned: Vec<serde_json::Value> = after
            .iter()
            .filter(|(file, _)| !before.contains_key(*file))
            .map(|(file, sql)| serde_json::json!({ "file": file, "sql": sql }))
            .collect();
        assert_eq!(
            serde_json::Value::Array(planned.clone()),
            json(&fixture.join("plan.json")),
            "{name}: the plan changed; if that is meant, recapture (README.md) and say why in the PR"
        );
        // Whatever the plan holds loses nothing: the compiler's own destructive check passes it.
        if !planned.is_empty() {
            let lost = first::migrate::destructive(
                &json(&baseline.join("snapshot.json")),
                &json(&output.join("snapshot.json")),
            );
            assert!(lost.is_empty(), "{name}: the plan would lose data: {lost:?}");
        }
        assert_eq!(
            json(&output.join("storage.json")),
            json(&baseline.join("storage.json")),
            "{name}: what the build stores changed since it was captured"
        );
    }
}

/// The capture is the one its manifest describes: a fixture edited by hand is caught here, not
/// mistaken for a compiler change.
#[test]
fn every_kept_source_matches_its_manifest() {
    for fixture in fixtures() {
        let manifest = json(&fixture.join("sources/manifest.json"));
        assert_eq!(manifest["format"], "first.source-bundle.v1", "{}", name(&fixture));
        for (file, key) in [("app.first.json", "app_sha256"), ("vendor.first.json", "vendor_sha256")] {
            use sha2::{Digest, Sha256};
            let digest: String = Sha256::digest(fs::read(fixture.join("sources").join(file)).unwrap())
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            assert_eq!(
                manifest[key].as_str(),
                Some(digest.as_str()),
                "{}: {file}",
                name(&fixture)
            );
        }
    }
}

/// Indexes the compiler infers from queries are not storage (they follow the code): a build whose only
/// change is a new filter plans an index, and stores the same as the build before it.
#[test]
fn a_new_filter_plans_an_inferred_index_and_stores_the_same() {
    let fixture = Path::new(FIXTURES).join("head/pantry");
    let work = tempfile::tempdir().unwrap();
    // The captured pantry, with one action that also filters on `opened` (which has no index).
    let sources = work.path().join("sources");
    fs::create_dir_all(&sources).unwrap();
    let mut app = json(&fixture.join("sources/app.first.json"));
    let config = app["files"]["first.config.ts"].as_str().unwrap();
    let filtered = config.replace(
        "findFirst({ where: { id: itemId } })",
        "findFirst({ where: { id: itemId, opened: false } })",
    );
    assert_ne!(config, filtered, "the fixture edit applies");
    app["files"]["first.config.ts"] = filtered.into();
    let bytes = serde_json::to_vec(&app).unwrap();
    let mut manifest = json(&fixture.join("sources/manifest.json"));
    use sha2::{Digest, Sha256};
    manifest["app_sha256"] = Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>()
        .into();
    fs::write(sources.join("app.first.json"), bytes).unwrap();
    fs::write(sources.join("manifest.json"), serde_json::to_vec(&manifest).unwrap()).unwrap();
    fs::copy(
        fixture.join("sources/vendor.first.json"),
        sources.join("vendor.first.json"),
    )
    .unwrap();
    let output = work.path().join("compiled");
    first::bundle::compile(&sources, &output, &sources, Some(&fixture.join("baseline"))).unwrap();
    let added: Vec<String> = migrations(&output.join("migrations"))
        .into_iter()
        .filter(|(file, _)| !fixture.join("baseline/migrations").join(file).exists())
        .map(|(_, sql)| sql)
        .collect();
    assert_eq!(
        added,
        ["ALTER TABLE `{prefix}first_items` ADD INDEX `opened_queried` (`opened`);\n"]
    );
    assert_eq!(
        json(&output.join("storage.json")),
        json(&fixture.join("baseline/storage.json"))
    );
}
