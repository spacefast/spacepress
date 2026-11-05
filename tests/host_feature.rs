#![cfg(feature = "host")]
use std::{fs, path::Path};

#[test]
fn host_capture_matches_native_bundle_bytes_and_compiles() {
    let work = tempfile::tempdir().unwrap();
    let host = work.path().join("host");
    let native = work.path().join("native");
    zero::host::sources(Path::new("examples/pantry"), &host).unwrap();
    zero::bundle::sources(Path::new("examples/pantry"), &native).unwrap();
    for name in ["app.zero.json", "vendor.zero.json", "manifest.json"] {
        assert_eq!(fs::read(host.join(name)).unwrap(), fs::read(native.join(name)).unwrap());
    }
    let result = zero::host::compile_sources(&host, &work.path().join("compiled"), &host, None).unwrap();
    assert_eq!(result["format"], "zero.hosted.v1");
    assert!(
        work.path()
            .join("compiled/plugins/zero-runtime/zero-runtime.php")
            .is_file()
    );
}

#[test]
fn host_capture_refuses_npm_before_resolution() {
    let work = tempfile::tempdir().unwrap();
    fs::write(
        work.path().join("zero.config.ts"),
        "import value from 'package-not-installed'; export default value;",
    )
    .unwrap();
    let error = zero::host::sources(work.path(), &work.path().join("source"))
        .err()
        .unwrap();
    assert_eq!(error.code, zero::diag::Code::SourceNeedsLocalCapture);
    assert!(!work.path().join("source").exists());
}
