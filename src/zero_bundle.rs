//! Source bundles captured before the rename to First: format `zero.source-bundle.v1`.
//!
//! Released clients that predate the rename (the `spacefast` CLI and `@spacefast/mcp` 0.9.0) still
//! upload what the 0.3.0 compiler captured: `app.zero.json` and `vendor.zero.json` beside the
//! manifest, project paths on the 0.3.0 layout (`zero.config.ts`, `zero/migrations/`, `wp-hooks/`),
//! and sources that import `"zero"`. A host compiles such an upload as the First bundle it stands
//! for: the hashes are checked on the bytes as captured, then the paths move onto the current layout
//! here and the loader reads `"zero"` as `"first"` (see [`MODULE`]). Nothing else in the compiler
//! knows the old names.
//!
//! Delete this module, its call in `bundle::compile_tree` and the `zero` arm of
//! `loader::Fs::renamed_module` once no released client uploads this format.

use crate::{
    bundle::{self, Manifest, SourceBundle},
    diag::Diag,
};
use std::path::Path;

pub const FORMAT: &str = "zero.source-bundle.v1";
const APP_FILE: &str = "app.zero.json";
const VENDOR_FILE: &str = "vendor.zero.json";
/// The module name these sources import, read as `"first"`.
pub const MODULE: &str = "zero";

/// Old path → current path. A path under `zero/` that is not listed is refused: 0.3.0 captured
/// nothing else there, so an unknown one means the bundle is not what this module was written for.
const MOVED: &[(&str, &str)] = &[
    ("zero.config.ts", "first.config.ts"),
    ("zero/migrations/", "first/_generated/migrations/"),
    ("zero/plugins.lock.json", "first/_generated/plugins.lock.json"),
    ("zero/abilities.json", "first/_generated/abilities.json"),
    ("zero/wp-plugins.lock.json", "first/_generated/wp-plugins.lock.json"),
    ("wp-hooks/", "first/wp-hooks/"),
];

fn failure(message: impl Into<String>) -> Diag {
    Diag::new(crate::diag::Span::NONE, message.into())
}

/// The bundle's sources on the current layout, after checking both files against the manifest.
pub(crate) fn read(source: &Path, manifest: &Manifest) -> Result<SourceBundle, Diag> {
    for name in [bundle::APP_FILE, bundle::VENDOR_FILE] {
        if source.join(name).exists() {
            return Err(failure(format!(
                "a {FORMAT} bundle holds {APP_FILE} and {VENDOR_FILE}, but this one also has {name}"
            ))
            .help("upload one capture: either the files `first sources` writes, or the ones the 0.3.0 compiler wrote"));
        }
    }
    let captured = bundle::read_bundles(source, [(APP_FILE, &manifest.app_sha256), (VENDOR_FILE, &manifest.vendor_sha256)])?;
    let mut sources = SourceBundle::default();
    for (path, text) in captured.files {
        sources.files.insert(current(&path)?, text);
    }
    for (path, real) in captured.canonical {
        sources.canonical.insert(current(&path)?, current(&real)?);
    }
    Ok(sources)
}

fn current(path: &str) -> Result<String, Diag> {
    if path == "zero/pages.json" {
        return Err(failure("this bundle has TSX pages rendered by the 0.3.0 compiler, which First can't serve")
            .help("publish again with a client that captures First sources (`first sources`), after `first-pages build`"));
    }
    for (old, new) in MOVED {
        if let Some(rest) = path.strip_prefix(old) {
            return Ok(format!("{new}{rest}"));
        }
    }
    if path.starts_with("zero/") || path.starts_with("first/") || path == "first.config.ts" {
        return Err(failure(format!("{path} has no place in a {FORMAT} bundle"))
            .help("publish again with a client that captures First sources (`first sources`)"));
    }
    Ok(path.to_owned())
}
