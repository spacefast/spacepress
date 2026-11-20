//! What a request reads from the database and the object cache, held to a budget on three built
//! sites: examples/drive-store, www/ and examples/shop, each served by WordPress-on-SQLite with a
//! warm persistent object cache (tests/php/read_budget.php counts; this file builds and asserts).
//!
//! A budget is the number measured when it was set. A change that makes a route read more fails
//! here with the route, the visitor and both numbers; a change that reads less should lower the
//! budget in the same commit, so the next regression is caught at the new number.
#![cfg(feature = "cli")]
use std::path::{Path, PathBuf};
use std::process::Command;

fn typedpress() -> Command {
    Command::new(env!("CARGO_BIN_EXE_typedpress"))
}

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        // Another build's output and downloads: never part of the source.
        if matches!(name.to_str(), Some(".tp" | "node_modules" | "dist")) {
            continue;
        }
        let target = to.join(&name);
        if entry.file_type().unwrap().is_dir() {
            copy(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn run(command: &mut Command) -> Vec<u8> {
    let out = command.output().unwrap();
    assert!(
        out.status.success(),
        "{command:?}\n{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    out.stdout
}

/// A copy of `source` built in `work`, and its seed records compiled when `seeded`.
fn build(work: &Path, source: &str, seeded: bool) -> (PathBuf, Option<PathBuf>) {
    let project = work.join("project");
    copy(&root().join(source), &project);
    if source == "www" {
        // The guide's pages import the text of www/examples/ from a generated module.
        run(Command::new("node").arg(project.join("scripts/sources.mjs")));
    }
    run(typedpress().arg("build").arg(&project).arg("--quiet"));
    let seed = seeded.then(|| {
        let (sources, compiled) = (work.join("sources"), work.join("compiled"));
        run(typedpress().arg("sources").arg(&project).arg("--out").arg(&sources));
        run(typedpress()
            .arg("compile-sources")
            .arg(&sources)
            .arg(&compiled)
            .arg(&project));
        compiled.join("seed")
    });
    (project.join("tp/dist/wp-content"), seed)
}

fn measure(app: &str, content: &Path, seed: Option<&Path>) -> serde_json::Value {
    let mut php = Command::new("php");
    php.args(["-d", "memory_limit=1G"])
        .arg(root().join("tests/php/read_budget.php"))
        .arg(app)
        .arg(content)
        .env("TP_WP_THEMES", "1");
    if let Some(seed) = seed {
        php.arg(seed);
    }
    let out = run(&mut php);
    let report = serde_json::from_slice(&out).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out)));
    if std::env::var_os("TP_READ_BUDGET_REPORT").is_some() {
        println!("{app} {report}");
    }
    report
}

/// One route for one visitor: (route, the most statements with a warm persistent object cache,
/// the most with none, the most object-cache round trips).
type Budget = (&'static str, u64, u64, u64);

fn hold(app: &str, report: &serde_json::Value, budgets: &[Budget]) {
    let mut over = Vec::new();
    for (route, sql, cold, trips) in budgets {
        let seen = &report[*route];
        assert!(seen.is_object(), "{app}: no measurement for {route}: {report:#}");
        for (what, max) in [("max_sql", sql), ("max_cold", cold), ("max_trips", trips)] {
            let got = seen[what].as_u64().unwrap();
            if got > *max {
                over.push(format!("{app} {route} {what}: {got}, budget {max}"));
            }
        }
    }
    assert!(
        over.is_empty(),
        "over budget (statements = $wpdb->num_queries + Connection::run):\n{}\n{report:#}",
        over.join("\n")
    );
}

/// The same answer for a signed-in subscriber as for a visitor, where the route shows no one's own data.
fn same_for_everyone(app: &str, report: &serde_json::Value, route: &str) {
    assert_eq!(
        report[format!("{route}/anonymous")]["body"],
        report[format!("{route}/signed-in")]["body"],
        "{app} {route}: {report:#}"
    );
}

#[test]
fn drive_store_reads_stay_within_budget() {
    let work = tempfile::tempdir().unwrap();
    let (content, seed) = build(work.path(), "examples/drive-store", true);
    let report = measure("drive-store", &content, seed.as_deref());
    // The catalog and a product page are one statement each: the page's own query. Before this
    // budget a product page ran 3 (5 signed in): two lookups asked the kind's read rule about the
    // item the page then read anyway, and one of them read every post of the type.
    // An API list is 6 for any number of rows: the keys, the rows as the viewer reads them, the
    // stored rows, and the page's revision tokens in three. It was 5 + 5 per row (25 for these 4).
    hold(
        "drive-store",
        &report,
        &[
            ("catalog/anonymous", 1, 23, 30),
            ("catalog/signed-in", 1, 26, 34),
            ("product/anonymous", 1, 25, 33),
            ("product/signed-in", 1, 29, 38),
            ("api-list/anonymous", 6, 32, 29),
            ("api-list/signed-in", 6, 35, 32),
        ],
    );
    assert_eq!(report["api-list/anonymous"]["rows"], 4, "{report:#}");
    same_for_everyone("drive-store", &report, "api-list");
}

#[test]
fn website_reads_stay_within_budget() {
    let work = tempfile::tempdir().unwrap();
    let (content, seed) = build(work.path(), "www", true);
    let report = measure("www", &content, seed.as_deref());
    // A doc page is two statements: the doc, and the navigation tree's rows (one read for the
    // sidebar and the pager). It was 4 (5 signed in), and its sidebar asked the object cache for
    // each of its 14 docs on its own: 44 round trips, now 32.
    // The API list has 14 rows and costs what drive-store's 4 do. It was 75.
    // A GET route handler that only reads sends no START TRANSACTION and no COMMIT: 3, now 1.
    hold(
        "www",
        &report,
        &[
            ("doc/anonymous", 2, 27, 32),
            ("doc/signed-in", 2, 30, 36),
            ("route-handler/anonymous", 1, 15, 18),
            ("route-handler/signed-in", 1, 17, 21),
            ("api-list/anonymous", 6, 32, 29),
            ("api-list/signed-in", 6, 35, 32),
        ],
    );
    assert_eq!(report["api-list/anonymous"]["rows"], 14, "{report:#}");
    same_for_everyone("www", &report, "api-list");
    same_for_everyone("www", &report, "route-handler");
}

#[test]
fn shop_reads_stay_within_budget() {
    let work = tempfile::tempdir().unwrap();
    let (content, _) = build(work.path(), "examples/shop", false);
    // Of the catalog's 9 statements, 4 are the page's own (the count, the products, their
    // categories and their tags) and 5 are WooCommerce's on every request: three Action Scheduler
    // lookups for its variation-gallery migration, `ID IN (-1)` from its cache helper, and its
    // download-directory check. The two this budget removed were TypedPress's own order-storage
    // check, which now runs with the install checks.
    let report = measure("shop", &content, None);
    hold(
        "shop",
        &report,
        &[
            ("catalog/anonymous", 9, 76, 76),
            ("catalog/signed-in", 11, 81, 81),
            ("product/anonymous", 7, 63, 66),
            ("product/signed-in", 9, 68, 71),
        ],
    );
    // A full page of 24 products: with no persistent cache, the posts, terms and meta of the page
    // are read together (102 statements; one product at a time it was 125), and with one, each
    // group is asked for once (173 round trips; it was 236).
    let report = measure("shop-24", &content, None);
    hold(
        "shop (24 products)",
        &report,
        &[
            ("catalog/anonymous", 9, 102, 173),
            ("catalog/signed-in", 11, 107, 178),
            ("product/anonymous", 7, 63, 66),
            ("product/signed-in", 9, 68, 71),
        ],
    );
}
