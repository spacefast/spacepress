//! Where a project's files live (docs/spec/spec.md §1). Paths are relative to the directory that
//! holds `zero.config.ts`; every reader and writer takes them from here.
//!
//! - `zero/_generated/` is written by Zero and committed: the migration ledger, the type
//!   declarations, the typed client and the locks.
//! - `zero/dist/` is written by `zero build` and ignored by git: the deployable output.

/// The config at the project root.
pub const CONFIG: &str = "zero.config.ts";
/// The Zero root.
pub const ROOT: &str = "zero";
/// Written by Zero, committed.
pub const GENERATED: &str = "zero/_generated";
/// The migration ledger lives at [`crate::pipeline::LEDGER`], beside these.
/// The type declarations that register the app's schema with `"zero"`.
pub const DB_TYPES: &str = "zero/_generated/db.d.ts";
/// The typed client.
pub const CLIENT: &str = "zero/_generated/client";
/// The pinned WordPress plugin dependencies `zero build` installs.
pub const WP_PLUGINS_LOCK: &str = "zero/_generated/wp-plugins.lock.json";
/// Written by `zero build`, ignored by git.
pub const DIST: &str = "zero/dist";
/// `zero build`'s default output: a `wp-content` directory.
pub const WP_CONTENT: &str = "zero/dist/wp-content";

/// Committed inputs that moved (into `zero/_generated/`, or app code into `zero/`): (old, new). A source bundle
/// captured before the move names the old paths, and a host recompiles stored bundles, so the
/// hosted compile reads them through [`current`]. (The hosted compile reads the ledger's old path
/// itself; see `bundle::compile_tree`.)
const MOVED: &[(&str, &str)] = &[
    ("zero/abilities.json", "zero/_generated/abilities.json"),
    ("zero/plugins.lock.json", "zero/_generated/plugins.lock.json"),
    ("wp-hooks/", "zero/wp-hooks/"),
];

/// A captured project path on this layout: an input that moved into `zero/_generated/` is renamed,
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
            ("zero/abilities.json", "zero/_generated/abilities.json"),
            ("zero/plugins.lock.json", "zero/_generated/plugins.lock.json"),
            ("wp-hooks/save_post.ts", "zero/wp-hooks/save_post.ts"),
            ("wp-hooks/the_content/a.ts", "zero/wp-hooks/the_content/a.ts"),
            // Already current, and unrelated paths, are unchanged.
            ("zero/_generated/abilities.json", "zero/_generated/abilities.json"),
            ("zero/lib/fields.ts", "zero/lib/fields.ts"),
            ("zero/migrations-notes.md", "zero/migrations-notes.md"),
            ("zero.config.ts", "zero.config.ts"),
        ] {
            assert_eq!(super::current(old), new, "{old}");
        }
    }
}
