//! Where a project's files live (docs/spec/spec.md §1). Paths are relative to the directory that
//! holds `first.config.ts`; every reader and writer takes them from here.
//!
//! - `first/_generated/` is written by First and committed: the migration ledger, the type
//!   declarations, the typed client and the locks.
//! - `first/dist/` is written by `first build` and ignored by git: the deployable output.

/// The config at the project root.
pub const CONFIG: &str = "first.config.ts";
/// The First root.
pub const ROOT: &str = "first";
/// Written by First, committed.
pub const GENERATED: &str = "first/_generated";
/// The migration ledger lives at [`crate::pipeline::LEDGER`], beside these.
/// The type declarations that register the app's schema with `"first"`.
pub const DB_TYPES: &str = "first/_generated/db.d.ts";
/// The typed client.
pub const CLIENT: &str = "first/_generated/client";
/// The pinned WordPress plugin dependencies `first build` installs.
pub const WP_PLUGINS_LOCK: &str = "first/_generated/wp-plugins.lock.json";
/// Written by `first build`, ignored by git.
pub const DIST: &str = "first/dist";
/// `first build`'s default output: a `wp-content` directory.
pub const WP_CONTENT: &str = "first/dist/wp-content";

/// Committed inputs that moved into `first/_generated/`: (old project path, new). A source bundle
/// captured before the move names the old paths, and a host recompiles stored bundles, so the
/// hosted compile reads them through [`current`]. (The hosted compile reads the ledger's old path
/// itself; see `bundle::compile_tree`.)
const MOVED: &[(&str, &str)] = &[
    ("first/abilities.json", "first/_generated/abilities.json"),
    ("first/plugins.lock.json", "first/_generated/plugins.lock.json"),
];

/// Committed files a live checkout may still have at their place before `first/_generated/`: (old,
/// new, what goes wrong if it is left there). A stored source bundle is frozen data and reads its
/// old paths through [`current`]; a checkout is refused, so nothing is silently ignored or loaded.
const OLD_IN_CHECKOUT: &[(&str, &str, &str)] = &[
    (
        "first/plugins.lock.json",
        "first/_generated/plugins.lock.json",
        "its grants would be ignored and a new lock written that grants everything the plugins use",
    ),
    (
        "first/wp-plugins.lock.json",
        "first/_generated/wp-plugins.lock.json",
        "the plugins it pins would be resolved again",
    ),
    (
        "first/abilities.json",
        "first/_generated/abilities.json",
        "the abilities it locks would be unknown",
    ),
    (
        "first/client",
        "first/_generated/client",
        "its files would load as app code from first/",
    ),
    (
        "first.gen.ts",
        "first/_generated/db.d.ts",
        "editors would read the old registration",
    ),
];

/// The first committed file a checkout still keeps at its place from before `first/_generated/`, as
/// (message, help). Callers refuse to build: see [`OLD_IN_CHECKOUT`] for why each one matters.
pub fn old_in_checkout(
    exists: impl Fn(&std::path::Path) -> bool,
    project: &std::path::Path,
) -> Option<(String, String)> {
    OLD_IN_CHECKOUT
        .iter()
        .find(|(old, ..)| exists(&project.join(old)))
        .map(|(old, new, why)| {
            let parent = std::path::Path::new(new)
                .parent()
                .expect("under first/_generated")
                .display();
            (
                format!("{old} moved to {new}; left where it is, {why}"),
                format!("move it with `mkdir -p {parent} && git mv {old} {new}`, then build again"),
            )
        })
}

/// A captured project path on this layout: an input that moved into `first/_generated/` is renamed,
/// everything else is unchanged.
pub fn current(path: &str) -> String {
    for (old, new) in MOVED {
        if let Some(rest) = path.strip_prefix(old) {
            return format!("{new}{rest}");
        }
    }
    path.to_string()
}

#[cfg(test)]
mod tests {
    #[test]
    fn captured_paths_from_before_generated_read_on_this_layout() {
        for (old, new) in [
            ("first/abilities.json", "first/_generated/abilities.json"),
            ("first/plugins.lock.json", "first/_generated/plugins.lock.json"),
            // Already current, and unrelated paths, are unchanged.
            ("first/_generated/abilities.json", "first/_generated/abilities.json"),
            ("first/lib/fields.ts", "first/lib/fields.ts"),
            ("first/migrations-notes.md", "first/migrations-notes.md"),
            ("first.config.ts", "first.config.ts"),
        ] {
            assert_eq!(super::current(old), new, "{old}");
        }
    }
}
