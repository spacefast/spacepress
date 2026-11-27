//! What a request reads from the database and the object cache, held to a budget on three built
//! sites: examples/drive-store, www/ and the shop `spacepress add shop` writes, each served by WordPress-on-SQLite with a
//! warm persistent object cache (tests/php/read_budget.php counts; this file builds and asserts).
//!
//! A budget is the number measured when it was set. A change that makes a route read more fails
//! here with the route, the visitor and both numbers; a change that reads less should lower the
//! budget in the same commit, so the next regression is caught at the new number.
#![cfg(feature = "cli")]
use std::path::{Path, PathBuf};
use std::process::Command;

fn spacepress() -> Command {
    Command::new(env!("CARGO_BIN_EXE_spacepress"))
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
        if matches!(
            name.to_str(),
            Some(".sp" | ".build" | ".showcase" | ".wp-plugins.build.lock" | "node_modules" | "dist")
        ) {
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

/// A copy of `source` (or the added shop, for "shop") built in `work`, and its seed records compiled when `seeded`.
fn build(work: &Path, source: &str, seeded: bool) -> (PathBuf, Option<PathBuf>) {
    let project = work.join("project");
    if source == "shop" {
        // The shop is what `spacepress add shop` writes into an empty project.
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(
            project.join("spacepress.config.ts"),
            "import { defineConfig } from \"spacepress\";\nexport default defineConfig({ name: \"shop\" });\n",
        )
        .unwrap();
        run(spacepress().arg("add").arg("shop").arg(&project));
    } else {
        copy(&root().join(source), &project);
    }
    if source == "www" {
        // www depends on `file:../packages/docs`, which the copy leaves behind with node_modules.
        copy(
            &root().join("packages/docs"),
            &project.join("node_modules/@spacepress/docs"),
        );
        // The guide's pages import the text of www/examples/ from a generated module, and the docs
        // route the Markdown of each doc from another (sp/data/doc-sources.ts), both written by the build.
        run(Command::new("node").arg(project.join("scripts/sources.mjs")));
        run(Command::new("node")
            .args(["--input-type=module", "-e"])
            .arg("import { generateAiAssets } from './scripts/generate-ai-assets.mjs'; generateAiAssets();")
            .current_dir(&project));
    }
    run(spacepress().arg("build").arg(&project).arg("--quiet"));
    let seed = seeded.then(|| {
        let (sources, compiled) = (work.join("sources"), work.join("compiled"));
        run(spacepress().arg("sources").arg(&project).arg("--out").arg(&sources));
        run(spacepress()
            .arg("compile-sources")
            .arg(&sources)
            .arg(&compiled)
            .arg(&project));
        compiled.join("seed")
    });
    (project.join("sp/dist/wp-content"), seed)
}

fn measure(app: &str, content: &Path, seed: Option<&Path>) -> serde_json::Value {
    let mut php = Command::new("php");
    php.args(["-d", "memory_limit=1G"])
        .arg(root().join("tests/php/read_budget.php"))
        .arg(app)
        .arg(content)
        .env("SP_WP_THEMES", "1");
    if let Some(seed) = seed {
        php.arg(seed);
    }
    let out = run(&mut php);
    let report = serde_json::from_slice(&out).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out)));
    if std::env::var_os("SP_READ_BUDGET_REPORT").is_some() {
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
    // The drive store seeds its Markdown drives into WooCommerce on install, so no seed is passed.
    let (content, _) = build(work.path(), "examples/drive-store", false);
    let report = measure("drive-store", &content, None);
    // The drives are native Woo products, so like the shop each request also runs WooCommerce's
    // own statements. Measured anonymously: the catalog is 4 through $wpdb and 1 of SpacePress's
    // own, a product page 4 and 4, an API list of the 4 drives 5 and 4.
    // The API list is a /wp-json/ request since #561, and on one WooCommerce loads its admin
    // features: three more option reads with no persistent cache (Analytics' two refund-data checks
    // and the onboarding task list), 68 then, now 71.
    hold(
        "drive-store",
        &report,
        &[
            ("catalog/anonymous", 5, 68, 83),
            ("catalog/signed-in", 7, 73, 90),
            ("product/anonymous", 8, 66, 67),
            ("product/signed-in", 10, 72, 75),
            ("api-list/anonymous", 9, 71, 73),
            ("api-list/signed-in", 9, 73, 76),
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
    // each of its 14 docs on its own: 44 round trips, now 32, and still 32 with 24 published docs.
    // The API list has 24 published rows and costs what drive-store's 4 do. It was 75.
    // A GET route handler that only reads sends no START TRANSACTION and no COMMIT: 3, now 1.
    hold(
        "www",
        &report,
        &[
            ("doc/anonymous", 2, 29, 32),
            ("doc/signed-in", 2, 30, 36),
            ("route-handler/anonymous", 1, 15, 18),
            ("route-handler/signed-in", 1, 17, 21),
            ("api-list/anonymous", 6, 34, 31),
            ("api-list/signed-in", 6, 37, 34),
        ],
    );
    assert_eq!(report["api-list/anonymous"]["rows"], 24, "{report:#}");
    same_for_everyone("www", &report, "api-list");
    same_for_everyone("www", &report, "route-handler");
}

#[test]
fn shop_reads_stay_within_budget() {
    let work = tempfile::tempdir().unwrap();
    let (content, _) = build(work.path(), "shop", false);
    // Of the catalog's 9 statements, 4 are the page's own (the count, the products, their
    // categories and their tags) and 5 are WooCommerce's on every request: three Action Scheduler
    // lookups for its variation-gallery migration, `ID IN (-1)` from its cache helper, and its
    // download-directory check. The two this budget removed were SpacePress's own order-storage
    // check, which now runs with the install checks.
    // With no persistent cache, Woo's cart, checkout and my-account page ids are read with the other
    // three of its page ids in one statement (Module::shopperPageIds, before Woo's own priming in
    // WC_Cache_Helper::prevent_caching): 3 fewer than when each was read on its own.
    let report = measure("shop", &content, None);
    hold(
        "shop",
        &report,
        &[
            ("catalog/anonymous", 9, 74, 74),
            ("catalog/signed-in", 11, 79, 79),
            ("product/anonymous", 7, 63, 64),
            ("product/signed-in", 9, 66, 69),
        ],
    );
    // A full page of 24 products: with no persistent cache, the posts, terms and meta of the page
    // are read together (100 statements; one product at a time it was 125), and with one, each
    // group is asked for once (171 round trips; it was 236).
    let report = measure("shop-24", &content, None);
    hold(
        "shop (24 products)",
        &report,
        &[
            ("catalog/anonymous", 9, 100, 171),
            ("catalog/signed-in", 11, 105, 176),
            ("product/anonymous", 7, 63, 64),
            ("product/signed-in", 9, 66, 69),
        ],
    );
}
