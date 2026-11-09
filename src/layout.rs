//! Where a project's files live (docs/spec/spec.md §1). Paths are relative to the directory that
//! holds `zero.config.ts`; every reader and writer takes them from here.
//!
//! - `zero/_generated/` is written by Zero and committed: the migration ledger, the type
//!   declarations, the typed client and the locks.
//! - `zero/dist/` is written by `zero build` and ignored by git: the deployable output.

use std::path::Path;

/// The config at the project root.
pub const CONFIG: &str = "zero.config.ts";
/// The Zero root.
pub const ROOT: &str = "zero";
/// Written by Zero, committed.
pub const GENERATED: &str = "zero/_generated";
/// The migration ledger: numbered SQL files and `snapshot.json`.
pub const MIGRATIONS: &str = "zero/_generated/migrations";
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

/// Where the migration ledger lived before `zero/_generated/` (zero ≤ 0.x builds).
const OLD_MIGRATIONS: &str = "zero/migrations";

/// Committed inputs that moved (into `zero/_generated/`, or app code into `zero/`): (old, new). A source bundle
/// captured before the move names the old paths, and a host recompiles stored bundles, so the
/// hosted compile reads them through [`current`].
const MOVED: &[(&str, &str)] = &[
    ("zero/migrations/", "zero/_generated/migrations/"),
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

/// The ledger's old directory, if a checkout still has it. Building beside it would number a new
/// `0001_init.sql` that a site's migration ledger already recorded under the same id, so callers
/// refuse instead.
pub fn old_migrations(exists: impl Fn(&Path) -> bool, project: &Path) -> Option<String> {
    exists(&project.join(OLD_MIGRATIONS)).then(|| {
        format!("{OLD_MIGRATIONS}/ is from an earlier layout; move it to {MIGRATIONS}/ (mkdir -p {GENERATED} && git mv {OLD_MIGRATIONS} {MIGRATIONS})")
    })
}

#[cfg(test)]
mod tests {
    #[test]
    fn captured_paths_from_before_generated_read_on_this_layout() {
        for (old, new) in [
            (
                "zero/migrations/0001_init.sql",
                "zero/_generated/migrations/0001_init.sql",
            ),
            (
                "zero/migrations/snapshot.json",
                "zero/_generated/migrations/snapshot.json",
            ),
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
