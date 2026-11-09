//! The compiler in memory: a loaded program and the previous snapshot in, every generated text out.
//! Nothing here reads or writes a project; `commands::build` does that around it for the CLI and
//! `wasm` hands it sources from a browser.

use crate::diag::{Diag, Span};
use crate::extract::Slot;
use crate::schema::{Access, DefaultKind, Owner};
use crate::{client, compile, diag, eval, extract, loader, migrate, schema, schema_php, wp_plugins};
use std::path::Path;

type HookFunctions = indexmap::IndexMap<(String, schema::HookKind), Vec<(Option<usize>, String)>>;

pub struct Built {
    pub plugins: Option<wp_plugins::Config>,
    /// Every file under `zero/_generated/client/`.
    pub client_files: Vec<(String, Vec<u8>)>,
    pub schema: schema::Schema,
    pub functions_php: String,
    pub snapshot: serde_json::Value,
    /// New migration files, `(name, SQL)`; empty when the schema did not change.
    pub migrations: Vec<(String, String)>,
    pub gen_ts: String,
    /// Destructive steps in the new migrations.
    pub warnings: Vec<String>,
    /// Declared WordPress plugins outside `wp_plugins/supported.json`; they still install.
    pub unsupported_plugins: Vec<String>,
    pub hints: Vec<String>,
    /// `zero/_generated/plugins.lock.json` as this build settled it (None without plugins or a lock).
    pub plugin_lock: Option<serde_json::Value>,
    /// What changed in the lock, one line each, for the command line.
    pub plugin_changes: Vec<String>,
    /// Each plugin's locked and inferred grant and read→send flows, for `zero check --json`.
    pub plugin_report: serde_json::Value,
    /// Abilities (and later hooks and functions) the compiled code uses from WordPress.
    pub wordpress_uses: Vec<compile::WordPressUse>,
}

/// The schema ledger, committed with the project: `snapshot.json` and the numbered SQL that
/// `Wp\Migrator` applies. Lives with the other generated files (spec §1).
pub const LEDGER: &str = "zero/_generated/migrations";
/// Where the ledger lived before `_generated/`. A project that still has it is refused (see
/// [`moved_ledger`]) rather than built as a first build, which would plan every table again.
pub const OLD_LEDGER: &str = "zero/migrations";

/// The refusal for a project whose ledger is still at [`OLD_LEDGER`].
pub fn moved_ledger() -> Diag {
    Diag::new(Span::NONE, format!("{OLD_LEDGER}/ moved to {LEDGER}/")).help(format!(
        "move it with `mkdir -p zero/_generated && rmdir {LEDGER} 2>/dev/null; git mv {OLD_LEDGER} {LEDGER}`, then build again"
    ))
}

/// The last build, as the next one needs it: its snapshot and the number the next migration file gets.
#[derive(Debug)]
pub struct Previous {
    pub snapshot: serde_json::Value,
    pub next_migration: u32,
    /// Refuse any plugin grant `zero/_generated/plugins.lock.json` doesn't already hold (CI, `--frozen`).
    pub frozen: bool,
}

impl Previous {
    /// A first build: nothing to diff against, `0001_init.sql`.
    pub fn none() -> Self {
        Self::from_project(None, []).expect("an absent snapshot is valid")
    }

    /// From a committed `snapshot.json` in [`LEDGER`] (absent on a first build) and the names of
    /// everything beside it. The numbering follows the files whether or not the snapshot is there, so
    /// a deleted snapshot never produces a second `0001_init.sql` over the first. An older snapshot is
    /// refused rather than diffed: its shape would plan the wrong migration.
    pub fn from_project<'a>(
        snapshot: Option<serde_json::Value>,
        migration_files: impl IntoIterator<Item = &'a str>,
    ) -> Result<Self, Diag> {
        let migration_files: Vec<&str> = migration_files.into_iter().collect();
        // A ledger from before the flat layout (`wp/` and `sqlite/` subdirectories, moved here as-is
        // by `git mv`), or the old ledger moved inside this one (`git mv` into an existing
        // directory), is refused rather than read as "no migrations yet", which would restart the
        // numbering at 0001 and ship an app plugin without its earlier files.
        if migration_files.contains(&"migrations") {
            return Err(Diag::new(
                Span::NONE,
                format!("{LEDGER}/migrations/ is the old ledger moved one level too deep"),
            )
            .help(format!(
                "move its contents up with `git mv {LEDGER}/migrations/* {LEDGER}/ && rmdir {LEDGER}/migrations`, then build again"
            )));
        }
        for nested in ["wp", "sqlite"] {
            if migration_files.contains(&nested) {
                return Err(Diag::new(
                    Span::NONE,
                    format!(
                        "{LEDGER}/{nested}/ is from an earlier layout; move {LEDGER}/wp/*.sql and {LEDGER}/wp/snapshot.json into {LEDGER}/, then delete the {LEDGER}/wp/ and {LEDGER}/sqlite/ directories"
                    ),
                ));
            }
        }
        let snapshot = match snapshot {
            None => serde_json::json!({ "version": 2, "tables": {} }),
            Some(snapshot) if snapshot["version"] == 2 => snapshot,
            Some(snapshot) => {
                return Err(Diag::new(
                    Span::NONE,
                    format!(
                        "{LEDGER}/snapshot.json is a version {} snapshot; this compiler writes version 2 (delete {LEDGER}/ to start over)",
                        snapshot["version"]
                    ),
                ));
            }
        };
        let next_migration = migration_files
            .into_iter()
            .filter_map(|name| name.get(..4)?.parse::<u32>().ok())
            .max()
            .unwrap_or(0)
            + 1;
        Ok(Previous {
            snapshot,
            next_migration,
            frozen: false,
        })
    }
}

/// Compiles a loaded program. `project` names the app (its directory name becomes the plugin's);
/// `previous` is asked for the last build once the config has compiled, so a config error is reported
/// before a snapshot problem; `runtime` looks up embedded `runtime/` files for the client (none: the
/// generated `types.ts` and `schema.ts` only).
pub fn build(
    project: &Path,
    program: &loader::Program,
    previous: impl FnOnce() -> Result<Previous, Diag>,
    runtime: impl Fn(&str) -> Option<&'static [u8]>,
) -> Result<Built, Diag> {
    // A checkout from before `zero/_generated/` would have its locks ignored (and replaced) and an old
    // client loaded as app code. A stored source bundle maps those paths instead (`layout::current`).
    let root = program.modules[program.entry]
        .path
        .parent()
        .expect("the entry has a directory");
    if let Some((message, help)) = crate::layout::old_in_checkout(|p| program.fs.exists(p), root) {
        return Err(Diag::new(Span::NONE, message).help(help).phase(diag::Code::Schema));
    }
    let mut ev = eval::Evaluator::new(program);
    let config = ev.run().map_err(|d| d.phase(diag::Code::Evaluation))?;
    let config_span = Span {
        file: program.modules[program.entry].file,
        start: 0,
        end: 0,
    };
    let dir_name = project
        .file_name()
        .map(|n| extract::slugify_name(&n.to_string_lossy()))
        .unwrap_or_else(|| "app".into());
    let mut ext =
        extract::extract(&config, &mut ev, config_span, &dir_name).map_err(|d| d.phase(diag::Code::Schema))?;
    wp_hooks(program, &mut ev, &mut ext).map_err(|d| d.phase(diag::Code::Schema))?;
    components(program, &mut ev, &mut ext).map_err(|d| d.phase(diag::Code::Schema))?;
    let mut schema = ext.schema.clone();
    let roots = std::mem::take(&mut ext.roots);
    let action_results;
    let wordpress_uses;
    let catalog = crate::wordpress::abilities::Catalog::new(&schema, &read_lock(program)?);
    // Each collection hook kind: its compiled functions, by owning plugin (None: the app).
    let mut hooks: HookFunctions = indexmap::IndexMap::new();
    let plugin_lock = read_plugin_lock(program, &project.join(crate::plugins::LOCK_PATH))?;
    let previous_value;
    let (functions, slots, settled) = {
        let mut c = compile::Compiler::new(&schema, &mut ev, &ext, program);
        c.abilities = catalog.clone();
        c.resolve_json_types().map_err(|d| d.phase(diag::Code::Compile))?;
        let slots = c.compile_roots(&roots).map_err(|d| d.phase(diag::Code::Compile))?;
        action_results = std::mem::take(&mut c.action_results);
        wordpress_uses = std::mem::take(&mut c.wordpress_uses);
        for ((slot, name), root) in slots.iter().zip(&roots) {
            if let Slot::Hook { table, kind } = slot {
                hooks
                    .entry((table.clone(), *kind))
                    .or_default()
                    .push((root.plugin, name.clone()));
            }
        }
        // Plugins first, in `use` order, then the app's own hook.
        for ((table, kind), list) in &mut hooks {
            list.sort_by_key(|(plugin, _)| plugin.unwrap_or(usize::MAX));
            if list.len() > 1 {
                let names: Vec<String> = list.iter().map(|(_, n)| n.clone()).collect();
                let chain = c.chain(table, *kind, &names);
                *list = vec![(None, chain)];
            }
        }
        // The lock settles before anything is emitted, so a refused plugin generates nothing.
        let mut handlers = Vec::new();
        for ((_, name), root) in slots.iter().zip(&roots) {
            if let Some(plugin) = root.plugin {
                let mut reached = std::collections::BTreeSet::from([name.clone()]);
                let mut stack = vec![name.clone()];
                while let Some(f) = stack.pop() {
                    for callee in c.calls.get(&f).into_iter().flatten() {
                        if reached.insert(callee.clone()) {
                            stack.push(callee.clone());
                        }
                    }
                }
                handlers.push((plugin, name.clone(), reached));
            }
        }
        let prev = previous()?;
        let settled = crate::plugins::settle(&ext.uses, &c.uses, &handlers, plugin_lock.as_ref(), prev.frozen)
            .map_err(|d| d.phase(diag::Code::Compile))?;
        previous_value = prev;
        for ((_, hosts), function) in settled.hosts.iter().zip(&c.host_functions) {
            let value = match hosts {
                None => "null".to_string(),
                Some(hosts) => format!(
                    "[{}]",
                    hosts.iter().map(|h| compile::php_str(h)).collect::<Vec<_>>().join(", ")
                ),
            };
            c.output.push_str(&format!(
                "function {function}(): ?array\n{{\n    return {value};\n}}\n\n"
            ));
        }
        (std::mem::take(&mut c.output), slots, settled)
    };
    for ((table, kind), list) in hooks {
        let (_, name) = list.into_iter().next().expect("one hook per kind");
        schema
            .collections
            .get_mut(&table)
            .expect("collection")
            .hooks
            .insert(kind, name);
    }
    for (slot, name) in slots {
        match slot {
            Slot::Hook { .. } => {}
            Slot::Default { at } => schema.column_mut(&at).default = Some(DefaultKind::Fn(name)),
            Slot::OnUpdate { at } => schema.column_mut(&at).on_update = Some(DefaultKind::Fn(name)),
            Slot::Validate { at } => schema.column_mut(&at).rules.validate = Some(name),
            Slot::FieldAccess { at, op } => {
                schema.column_mut(&at).access.insert(op, Access::Fn(name));
            }
            Slot::JobHandler { job } => schema.jobs.get_mut(&job).expect("job").handler = name,
            Slot::RouteHandler { route } => schema.routes.get_mut(&route).expect("route").handler = name,
            Slot::WpHook { index } => schema.wp_hooks[index].handler = name,
            Slot::Component { name: component } => {
                schema.components.insert(component, name);
            }
            Slot::ActionHandler { action } => schema.actions.get_mut(&action).expect("action").handler = name,
            Slot::Access { owner, op } => {
                let rule = Access::Fn(name);
                match owner {
                    Owner::Collection(t) => {
                        schema
                            .collections
                            .get_mut(&t)
                            .expect("collection")
                            .access
                            .insert(op, rule);
                    }
                    Owner::Global(g) => {
                        schema.globals.get_mut(&g).expect("global").access.insert(op, rule);
                    }
                    Owner::Action(a) => schema.actions.get_mut(&a).expect("action").access = rule,
                    Owner::FileBucket(f) => {
                        schema.files.get_mut(&f).expect("bucket").access.insert(op, rule);
                    }
                    Owner::Route(r) => schema.routes.get_mut(&r).expect("route").access = rule,
                    Owner::Job(_) => unreachable!("jobs have no access rules"),
                }
            }
        }
    }
    schema.wp_views =
        !wordpress_uses.is_empty() && wordpress_uses.iter().any(|u| u.kind != compile::WordPressKind::Ability);
    // Hooks run in a fixed order per collection; sort for stable output.
    for c in schema.collections.values_mut() {
        c.hooks
            .sort_by_key(|k, _| schema::HookKind::ALL.iter().position(|h| h == k));
    }

    let services_php =
        crate::services_config::render(&config, &ev, &schema, config_span).map_err(|d| d.phase(diag::Code::Schema))?;
    let functions_php = format!(
        "<?php\n\n// Generated by `zero build` from zero.config.ts. Do not edit.\n\ndeclare(strict_types=1);\n\nnamespace ZeroApp;\n\n{}",
        functions + &services_php
    );
    let snapshot = migrate::snapshot(&schema);
    let previous = previous_value;
    if let Some(tables) = previous.snapshot.get("tables").and_then(serde_json::Value::as_object) {
        for stored in tables.keys() {
            // The table that keeps `stored`'s rows: the same name, or the one that declares `was: stored`.
            let successor = snapshot["tables"].get(stored).or_else(|| {
                snapshot["tables"]
                    .as_object()?
                    .values()
                    .find(|t| t["was"].as_str() == Some(stored.as_str()))
            });
            if let Some(next) = successor
                && tables[stored]["existingTable"] != next["existingTable"]
            {
                return Err(Diag::new(config_span, format!("existingTable binding for `{stored}` cannot change after the first snapshot, including through a `was` rename; move data explicitly before changing storage")).phase(diag::Code::Schema));
            }
            let canonical = crate::schema::physical_name(stored);
            if &canonical != stored
                && !schema.collections.contains_key(stored)
                && schema.collections.contains_key(&canonical)
            {
                return Err(Diag::new(config_span, format!(
                    "stored resource `{stored}` conflicts with canonical physical name `{canonical}`; an authoring change cannot rename persisted storage"
                )).help(format!("keep the migration ledger and bind the existing resource with `storageName: \"{stored}\"`"))
                    .phase(diag::Code::Schema));
            }
            // Old snapshots record physical names only. A removed and a new resource
            // could be an authored alias becoming its storage name, even when both
            // names are already snake_case. Never guess a destructive replacement.
            // A table that declares `was: "<stored>"` renames it (spec §2.6); the planner moves it.
            let renamed = snapshot["tables"]
                .as_object()
                .is_some_and(|next| next.values().any(|t| t["was"].as_str() == Some(stored.as_str())));
            if !schema.collections.contains_key(stored)
                && !renamed
                && let Some(added) = schema.collections.keys().find(|name| !tables.contains_key(*name))
            {
                return Err(Diag::new(config_span, format!(
                    "stored resource `{stored}` disappears while new resource `{added}` is added; an authoring change cannot rename persisted storage"
                )).help(format!("to rename it, declare `was: \"{stored}\"` on the table; to drop it, remove it in one deploy and add the new one in the next"))
                    .phase(diag::Code::Schema));
            }
        }
    }
    let mut migrations = Vec::new();
    let warnings = migrate::destructive(&previous.snapshot, &snapshot);
    let statements = migrate::plan(&previous.snapshot, &snapshot);
    if !statements.is_empty() {
        let n = previous.next_migration;
        let name = if n == 1 { "init" } else { "update" };
        migrations.push((format!("{n:04}_{name}.sql"), migrate::render(&statements)));
    }
    let client_files = client::files(&schema, &action_results, runtime);
    let unsupported_plugins = ext.plugins.as_ref().map(wp_plugins::unsupported).unwrap_or_default();
    // Only a project that imports "php/wordpress" maps it in tsconfig, so only then is it augmented.
    let uses_wordpress = program.modules.iter().any(|m| {
        m.body
            .iter()
            .any(|s| matches!(s, crate::ir::Stmt::Import { source, .. } if source == loader::WORDPRESS_MODULE))
    });
    let mut gen_ts = schema_php::gen_ts(&schema);
    if uses_wordpress {
        gen_ts += &crate::wordpress::abilities::gen_ts(&catalog);
    }
    Ok(Built {
        plugins: ext.plugins,
        unsupported_plugins,
        client_files,
        schema,
        functions_php,
        snapshot,
        migrations,
        gen_ts,
        warnings,
        hints: ext.hints,
        plugin_lock: settled.lock,
        plugin_changes: settled.changes,
        plugin_report: settled.report,
        wordpress_uses,
    })
}

/// Each `wp-hooks/` file becomes a root: its default export is the handler, an optional
/// `export const priority = <integer>` its priority (default 10, so a hook's files run in file order).
/// The hook must be in the catalog; the handler is typed from it when it compiles.
fn wp_hooks(program: &loader::Program, ev: &mut eval::Evaluator, ext: &mut extract::Extracted) -> Result<(), Diag> {
    use crate::value::Value;
    for file in &program.wp_hooks {
        let module = &program.modules[file.module];
        let span = Span {
            file: module.file,
            start: 0,
            end: 0,
        };
        let Some(hook) = crate::wordpress::hook(&file.hook) else {
            let mut d = Diag::new(span, format!("`{}` is not a WordPress hook Zero types", file.hook));
            d = match diag::suggest(&file.hook, crate::wordpress::hook_names()) {
                Some(s) => d.help(format!(
                    "did you mean `{s}`? Rename the file or directory under wp-hooks/"
                )),
                None => d.help(format!(
                    "wp-hooks/ supports: {}",
                    crate::wordpress::hook_names().collect::<Vec<_>>().join(", ")
                )),
            };
            return Err(d);
        };
        let exports = ev.run_module(file.module)?;
        let Some(Value::Closure(closure)) = exports.get("default") else {
            return Err(
                Diag::new(span, "a wp-hooks/ file needs a default-exported handler function").help(format!(
                    "write `export default function ({}) {{ ... }}`",
                    hook.params
                        .iter()
                        .map(|(n, _)| n.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                )),
            );
        };
        let priority = match exports.get("priority") {
            None => 10,
            Some(Value::Num(n)) if n.fract() == 0.0 && n.abs() < 1e9 => *n as i64,
            Some(_) => {
                return Err(Diag::new(span, "`priority` must be an integer")
                    .help("WordPress runs lower priorities first; the default is 10"));
            }
        };
        for name in exports.keys() {
            if name != "default" && name != "priority" {
                return Err(Diag::new(
                    span,
                    format!("a wp-hooks/ file exports only `default` and `priority`, not `{name}`"),
                )
                .help("move shared code into a module both files import"));
            }
        }
        let index = ext.schema.wp_hooks.len();
        ext.schema.wp_hooks.push(crate::schema::WpHook {
            hook: file.hook.clone(),
            filter: hook.filter,
            priority,
            args: hook.params.len(),
            handler: String::new(),
        });
        ext.roots.push(extract::Root {
            closure: closure.clone(),
            slot: Slot::WpHook { index },
            name: format!("wp_hook__{}_{}", file.hook, file.order),
            plugin: None,
        });
    }
    Ok(())
}

/// Every function exported from a `zero/components/` file under a capitalized name becomes a
/// compiled component, called with one props object (docs/decisions/2026-11-08-tsx-to-php.md).
/// The capital is React's own rule for what a JSX tag can name; other exports are helpers and are
/// ignored, as in any module.
fn components(program: &loader::Program, ev: &mut eval::Evaluator, ext: &mut extract::Extracted) -> Result<(), Diag> {
    use crate::value::Value;
    for (path, module) in &program.components {
        let exports = ev.run_module(*module)?;
        for (export, value) in &exports {
            let Value::Closure(closure) = value else { continue };
            if !export.starts_with(|c: char| c.is_ascii_uppercase()) {
                continue;
            }
            let stem = path.trim_end_matches(".tsx");
            ext.roots.push(extract::Root {
                closure: closure.clone(),
                slot: Slot::Component {
                    name: format!("{path}#{export}"),
                },
                name: format!("component__{}__{export}", extract::slugify_name(stem).replace('-', "_")),
                plugin: None,
            });
        }
    }
    Ok(())
}

/// The committed plugin grant, read like the other compiler inputs; absent until the first build.
fn read_plugin_lock(program: &loader::Program, path: &Path) -> Result<Option<serde_json::Value>, Diag> {
    if !program.fs.exists(path) {
        return Ok(None);
    }
    let bad = |e: String| {
        Diag::new(Span::NONE, format!("{}: {e}", crate::plugins::LOCK_PATH)).code(diag::Code::PluginCapability)
    };
    let text = program.fs.read_to_string(path).map_err(|e| bad(e.to_string()))?;
    serde_json::from_str(&text).map(Some).map_err(|e| bad(e.to_string()))
}

/// `zero/_generated/abilities.json` beside the program's `zero.config.ts`, through the program's file system,
/// so a hosted source bundle (rooted at its own module directory, whatever `project` names) and the
/// browser read the same lock the command line does. Absent means no locked abilities.
fn read_lock(program: &loader::Program) -> Result<Vec<crate::wordpress::abilities::Locked>, Diag> {
    let entry = &program.modules[program.entry].path;
    let path = entry
        .parent()
        .expect("the entry has a directory")
        .join(crate::wordpress::abilities::LOCK);
    let path = path.as_path();
    if !program.fs.exists(path) {
        return Ok(Vec::new());
    }
    let text = program.fs.read_to_string(path).map_err(|e| {
        Diag::new(
            Span::NONE,
            format!("can't read {}: {e}", crate::wordpress::abilities::LOCK),
        )
    })?;
    crate::wordpress::abilities::parse_lock(&text).map_err(|m| Diag::new(Span::NONE, m).phase(diag::Code::Import))
}

impl Built {
    /// One line for the command line: what was built.
    pub fn summary(&self) -> String {
        let s = &self.schema;
        format!(
            "{} collections, {} tables, {} user projections, {} globals, {} hooks, {} actions",
            s.collections.values().filter(|c| c.editor).count(),
            s.collections.values().filter(|c| !c.editor && !c.auth).count(),
            s.collections.values().filter(|c| c.auth).count(),
            s.globals.len(),
            s.collections.values().map(|c| c.hooks.len()).sum::<usize>(),
            s.actions.len()
        )
    }
}

#[cfg(test)]
mod tests {
    use super::Previous;

    #[test]
    fn the_next_migration_number_follows_the_highest_file_with_or_without_a_snapshot() {
        let snapshot = serde_json::json!({ "version": 2, "tables": {} });
        let files = ["0001_init.sql", "0003_update.sql", "snapshot.json"];
        assert_eq!(
            Previous::from_project(Some(snapshot.clone()), files)
                .unwrap()
                .next_migration,
            4
        );
        assert_eq!(Previous::from_project(None, files).unwrap().next_migration, 4);
        assert_eq!(Previous::from_project(Some(snapshot), []).unwrap().next_migration, 1);
    }

    #[test]
    fn the_earlier_nested_layout_is_refused_before_the_snapshot_is_read() {
        for nested in ["wp", "sqlite"] {
            let error = Previous::from_project(None, [nested, "0001_init.sql"]).unwrap_err();
            assert!(
                error.message.starts_with(&format!(
                    "zero/_generated/migrations/{nested}/ is from an earlier layout"
                )),
                "{}",
                error.message
            );
        }
    }

    #[test]
    fn the_old_ledger_moved_one_level_too_deep_is_refused() {
        let error = Previous::from_project(None, ["migrations"]).unwrap_err();
        assert!(
            error
                .message
                .ends_with("migrations/ is the old ledger moved one level too deep"),
            "{}",
            error.message
        );
    }

    #[test]
    fn a_snapshot_from_another_version_is_refused_not_diffed() {
        let error = Previous::from_project(Some(serde_json::json!({ "version": 1, "tables": {} })), []).unwrap_err();
        assert!(error.message.contains("version 1 snapshot"), "{}", error.message);
        let error = Previous::from_project(Some(serde_json::json!({ "tables": {} })), []).unwrap_err();
        assert!(error.message.contains("version null snapshot"), "{}", error.message);
    }
}
