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
/// Typed links and params for `first/app/` routes.
pub const ROUTES_TYPES: &str = "first/_generated/routes.d.ts";
/// The typed client.
pub const CLIENT: &str = "first/_generated/client";
/// The pinned WordPress plugin dependencies `first build` installs.
pub const WP_PLUGINS_LOCK: &str = "first/_generated/wp-plugins.lock.json";
/// Written by `first build`, ignored by git.
pub const DIST: &str = "first/dist";
/// `first build`'s default output: a `wp-content` directory.
pub const WP_CONTENT: &str = "first/dist/wp-content";

/// Committed inputs that moved (into `first/_generated/`, or app code into `first/`): (old, new). A source bundle
/// captured before the move names the old paths, and a host recompiles stored bundles, so the
/// hosted compile reads them through [`current`]. (The hosted compile reads the ledger's old path
/// itself; see `bundle::compile_tree`.)
const MOVED: &[(&str, &str)] = &[
    ("first/abilities.json", "first/_generated/abilities.json"),
    ("first/plugins.lock.json", "first/_generated/plugins.lock.json"),
    ("wp-hooks/", "first/wp-hooks/"),
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

/// Every committed file a checkout still keeps at its place from before `first/_generated/`, in one
/// (message, help): the message names each file and what goes wrong if it stays, and the help is
/// one command that moves them all. Callers refuse to build: see [`OLD_IN_CHECKOUT`].
pub fn old_in_checkout(
    exists: impl Fn(&std::path::Path) -> bool,
    project: &std::path::Path,
) -> Option<(String, String)> {
    let found: Vec<_> = OLD_IN_CHECKOUT
        .iter()
        .filter(|(old, ..)| exists(&project.join(old)))
        .collect();
    if found.is_empty() {
        return None;
    }
    let lines: Vec<String> = found
        .iter()
        .map(|(old, new, why)| format!("{old} moved to {new}; left where it is, {why}"))
        .collect();
    let message = match lines.as_slice() {
        [one] => one.clone(),
        many => format!(
            "{} files are from before first/_generated/:\n  - {}",
            many.len(),
            many.join("\n  - ")
        ),
    };
    let mut parents: Vec<String> = found
        .iter()
        .map(|(_, new, _)| {
            std::path::Path::new(new)
                .parent()
                .expect("under first/_generated")
                .display()
                .to_string()
        })
        .collect();
    parents.dedup();
    let moves: Vec<String> = found
        .iter()
        .map(|(old, new, _)| format!("git mv {old} {new}"))
        .collect();
    let help = format!(
        "move {} with `mkdir -p {} && {}`, then build again",
        if found.len() == 1 { "it" } else { "them" },
        parents.join(" "),
        moves.join(" && ")
    );
    Some((message, help))
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
            ("wp-hooks/save_post.ts", "first/wp-hooks/save_post.ts"),
            ("wp-hooks/the_content/a.ts", "first/wp-hooks/the_content/a.ts"),
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
