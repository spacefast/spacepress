//! The compiler in memory: a loaded program and the previous snapshot in, every generated text out.
//! Nothing here reads or writes a project; `commands::build` does that around it for the CLI and
//! `wasm` hands it sources from a browser.

use crate::diag::{Diag, Span};
use crate::extract::Slot;
use crate::schema::{Access, DefaultKind, Owner};
use crate::{client, compile, diag, eval, extract, loader, migrate, schema, schema_php, wp_plugins};
use std::path::Path;

pub struct Built {
    pub plugins: Option<wp_plugins::Config>,
    /// Every file under `zero/client/`.
    pub client_files: Vec<(String, Vec<u8>)>,
    pub schema: schema::Schema,
    pub functions_php: String,
    pub snapshot: serde_json::Value,
    /// New migration files, `(name, SQL)`; empty when the schema did not change.
    pub migrations: Vec<(String, String)>,
    pub gen_ts: String,
    /// Destructive steps in the new migrations.
    pub warnings: Vec<String>,
    pub hints: Vec<String>,
    /// Abilities (and later hooks and functions) the compiled code uses from WordPress.
    pub wordpress_uses: Vec<compile::WordPressUse>,
}

/// The last build, as the next one needs it: its snapshot and the number the next migration file gets.
#[derive(Debug)]
pub struct Previous {
    pub snapshot: serde_json::Value,
    pub next_migration: u32,
}

impl Previous {
    /// A first build: nothing to diff against, `0001_init.sql`.
    pub fn none() -> Self {
        Self::from_project(None, []).expect("an absent snapshot is valid")
    }

    /// From a committed `zero/migrations/snapshot.json` (absent on a first build) and the names of
    /// everything beside it in `zero/migrations/`. The numbering follows the files whether or not the
    /// snapshot is there, so a deleted snapshot never produces a second `0001_init.sql` over the first.
    /// An older snapshot or layout is refused rather than diffed: its shape would plan the wrong
    /// migration.
    pub fn from_project<'a>(
        snapshot: Option<serde_json::Value>,
        migration_files: impl IntoIterator<Item = &'a str>,
    ) -> Result<Self, Diag> {
        let migration_files: Vec<&str> = migration_files.into_iter().collect();
        // A checkout from before the flat layout (`wp/` and `sqlite/` subdirectories) is refused rather
        // than read as "no migrations yet", which would restart the numbering at 0001 and ship an app
        // plugin without its earlier files.
        for legacy in ["wp", "sqlite"] {
            if migration_files.contains(&legacy) {
                return Err(Diag::new(
                    Span::NONE,
                    format!(
                        "zero/migrations/{legacy}/ is from an earlier layout; move zero/migrations/wp/*.sql into zero/migrations/, then delete the zero/migrations/wp/ and zero/migrations/sqlite/ directories (or delete zero/migrations/ to start over)"
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
                        "zero/migrations/snapshot.json is a version {} snapshot; this compiler writes version 2 (delete zero/migrations/ to start over)",
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
    let mut schema = ext.schema.clone();
    let roots = std::mem::take(&mut ext.roots);
    let action_results;
    let wordpress_uses;
    let catalog = crate::wordpress::abilities::Catalog::new(&schema, &read_lock(program)?);
    let (functions, slots) = {
        let mut c = compile::Compiler::new(&schema, &mut ev, &ext, program);
        c.abilities = catalog.clone();
        c.resolve_json_types().map_err(|d| d.phase(diag::Code::Compile))?;
        let slots = c.compile_roots(&roots).map_err(|d| d.phase(diag::Code::Compile))?;
        action_results = std::mem::take(&mut c.action_results);
        wordpress_uses = std::mem::take(&mut c.wordpress_uses);
        (std::mem::take(&mut c.output), slots)
    };
    for (slot, name) in slots {
        match slot {
            Slot::Hook { table, kind } => {
                schema
                    .collections
                    .get_mut(&table)
                    .expect("collection")
                    .hooks
                    .insert(kind, name);
            }
            Slot::Default { at } => schema.column_mut(&at).default = Some(DefaultKind::Fn(name)),
            Slot::OnUpdate { at } => schema.column_mut(&at).on_update = Some(DefaultKind::Fn(name)),
            Slot::Validate { at } => schema.column_mut(&at).rules.validate = Some(name),
            Slot::FieldAccess { at, op } => {
                schema.column_mut(&at).access.insert(op, Access::Fn(name));
            }
            Slot::JobHandler { job } => schema.jobs.get_mut(&job).expect("job").handler = name,
            Slot::RouteHandler { route } => schema.routes.get_mut(&route).expect("route").handler = name,
            Slot::WpHook { index } => schema.wp_hooks[index].handler = name,
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
    let previous = previous()?;
    if let Some(tables) = previous.snapshot.get("tables").and_then(serde_json::Value::as_object) {
        for stored in tables.keys() {
            if let Some(next) = snapshot["tables"].get(stored)
                && tables[stored]["existingTable"] != next["existingTable"]
            {
                return Err(Diag::new(config_span, format!("existingTable binding for `{stored}` cannot change after the first snapshot; move data explicitly before changing storage")).phase(diag::Code::Schema));
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
            if !schema.collections.contains_key(stored)
                && let Some(added) = schema.collections.keys().find(|name| !tables.contains_key(*name))
            {
                return Err(Diag::new(config_span, format!(
                    "stored resource `{stored}` disappears while new resource `{added}` is added; an authoring change cannot rename persisted storage"
                )).help("keep existing physical names registered; resolve intentional storage removals separately after reviewing the data migration")
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
        client_files,
        schema,
        functions_php,
        snapshot,
        migrations,
        gen_ts,
        warnings,
        hints: ext.hints,
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
        });
    }
    Ok(())
}

/// `zero/abilities.json` beside the program's `zero.config.ts`, through the program's file system,
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
    fn the_earlier_migration_layout_is_refused_before_the_snapshot_is_read() {
        let error =
            Previous::from_project(Some(serde_json::json!({ "version": 1 })), ["wp", "snapshot.json"]).unwrap_err();
        assert!(
            error
                .message
                .starts_with("zero/migrations/wp/ is from an earlier layout"),
            "{}",
            error.message
        );
        let error = Previous::from_project(None, ["sqlite"]).unwrap_err();
        assert!(
            error
                .message
                .starts_with("zero/migrations/sqlite/ is from an earlier layout"),
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
