//! HTTP validators on what TypedPress serves as is: a prebuilt page and the OpenAPI document answer
//! `If-None-Match` with an empty 304 (as public files do), and the facade's API reads stay
//! `private, no-store` with no validator (tests/php/validators.php).
use serde_json::json;
use std::path::{Path, PathBuf};
use std::process::Command;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

#[test]
fn prebuilt_pages_and_the_openapi_document_answer_if_none_match() {
    let project = std::env::temp_dir().join(format!("typedpress-validators-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&project);
    copy(&root().join("tests/fixtures/app-prebuilt"), &project);
    let built = Command::new(env!("CARGO_BIN_EXE_typedpress"))
        .arg("build")
        .arg(&project)
        .output()
        .unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/validators.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value =
        serde_json::from_slice(&out.stdout).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out.stdout)));
    let validated = json!([
        true,
        [
            [304, true, true],
            [304, true, true],
            [304, true, true],
            [304, true, true]
        ],
        200
    ]);
    assert_eq!(seen["prebuilt"], json!([200, true, true]));
    assert_eq!(seen["prebuilt validators"], validated);
    assert_eq!(seen["prebuilt twin has its own"], true);
    assert_eq!(seen["prebuilt 304 keeps the cache policy"], true);
    // Signed in: the page renders per request, whatever the client cached.
    assert_eq!(seen["prebuilt signed in"], json!([200, false]));
    assert_eq!(seen["prebuilt head"], true);
    // One read: the tag names the body sent even when the file changes between opens; an unreadable
    // file renders as usual for `*` and `""`, never a 304.
    assert_eq!(
        seen["prebuilt replaced between reads"],
        json!([200, true, "OLD-BODY", true])
    );
    assert_eq!(seen["prebuilt unreadable"], json!([[200, false], [200, false]]));
    // Fewer bytes than the reported size, or empty reads that never end: rendered as usual.
    for mode in ["prebuilt short", "prebuilt empty-read"] {
        assert_eq!(
            seen[mode],
            json!([[200, false, null], [200, false, null]]),
            "{mode}"
        );
    }
    // 8 MiB with 2 MiB of memory left: streamed, not buffered.
    assert_eq!(
        seen["prebuilt larger than memory_limit"],
        json!([200, true, true, true, true])
    );
    // Same size and modification time, other bytes: the old tag no longer matches.
    assert_eq!(
        seen["prebuilt same size and mtime"],
        json!([true, true, 200, true, true])
    );
    assert_eq!(seen["openapi"][0], 200);
    assert_eq!(seen["openapi"][2], "public, max-age=300");
    assert_eq!(seen["openapi"][4], true);
    assert_eq!(seen["openapi"][5], "3.1.0");
    assert_eq!(seen["openapi validators"], validated);
    assert_eq!(seen["openapi follows the site"], json!([true, "Renamed"]));
    assert_eq!(seen["openapi bytes"], true);
    assert_eq!(seen["openapi unreadable"], json!([404, 404]));
    // Only the bytes decide the tag: a new mtime keeps it, an equal-length edit changes it.
    assert_eq!(seen["openapi tag follows the bytes"], json!([true, 200, "3.1.1", true]));
    // The facade's reads depend on who asks: never shareable, never answered from a validator.
    assert_eq!(seen["facade"], json!([200, "private, no-store", null, 200]));
}
