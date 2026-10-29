//! TEMPORARY: phase-2 declarations the runtime does not enforce yet.
//!
//! schema.php v3 carries these keys, but until the owning lane lands nothing reads them: a column
//! `.access()` would hide nothing, and an `auth: true` collection would serve its password hashes.
//! A config that relies on one must not build "ok". When a lane lands its feature, it deletes its
//! row in `UNLANDED` and its fixture row in `tests/compiler.rs`. The last lane deletes this file,
//! its call in `commands::build` and the `ZERO_ALLOW_UNLANDED_FEATURES` opt-in in `tests/compiler.rs`.
//!
//! Runs after extraction and compilation, so every static rejection of these declarations keeps
//! its own message.

use crate::diag::{Diag, Result, Span};
use crate::eval::Evaluator;
use crate::schema::ColType;
use crate::value::{ColBuilder, Value};
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Feature {
    FieldAccess,
    Sync,
    Webhooks,
    Auth,
    Files,
    Localized,
}

/// (feature, owning lane, what, fix until then). One row per lane; delete yours when it lands.
#[rustfmt::skip]
const UNLANDED: &[(Feature, char, &str, &str)] = &[
    (Feature::FieldAccess, 'B', "field access (`.access()` on a column)", "remove .access(); gate the whole collection with its access rule, or move the field to a stricter collection"),
    (Feature::Sync, 'C', "content sync (`sync`)", "remove sync"),
    (Feature::Webhooks, 'D', "`webhooks`", "remove webhooks"),
    (Feature::Auth, 'E', "`auth: true` collections", "remove auth: true and keep members in a regular collection"),
    (Feature::Files, 'G', "private files (`files` and `file()`)", "remove the file bucket; use media() for public uploads"),
    (Feature::Localized, 'H', "localization (`locales` and `.localized()`)", "remove locales and .localized()"),
];

/// Set to 1 to build these declarations anyway, in debug builds only: the schema.php v3 golden test
/// (`phase2_schema_and_closures_match_the_contract`) still renders every key.
const ALLOW: &str = "ZERO_ALLOW_UNLANDED_FEATURES";

pub fn reject(config: &Value, ev: &Evaluator<'_>, fallback: Span) -> Result<()> {
    if cfg!(debug_assertions) && std::env::var(ALLOW).as_deref() == Ok("1") {
        return Ok(());
    }
    let mut walk = Walk {
        ev,
        fallback,
        seen: HashSet::new(),
        found: Vec::new(),
    };
    for (key, feature) in [
        ("webhooks", Feature::Webhooks),
        ("locales", Feature::Localized),
        ("files", Feature::Files),
    ] {
        walk.option(config, key, feature);
    }
    walk.value(config);
    for (feature, span) in walk.found {
        if let Some((_, lane, what, help)) = UNLANDED.iter().find(|(f, ..)| *f == feature) {
            return Err(Diag::new(span, format!("{what}: not implemented until lane {lane}"))
                .help(format!("it would build but not be enforced yet; {help}")));
        }
    }
    Ok(())
}

/// Every collection option and column builder reachable from the config (collections, globals,
/// action and job inputs, nested fields).
struct Walk<'a, 'p> {
    ev: &'a Evaluator<'p>,
    fallback: Span,
    seen: HashSet<usize>,
    found: Vec<(Feature, Span)>,
}

impl Walk<'_, '_> {
    /// `key` is set on `obj` to something other than undefined/null/false.
    fn option(&mut self, obj: &Value, key: &str, feature: Feature) {
        let Value::Object(o) = obj else { return };
        if o.borrow()
            .get(key)
            .is_some_and(|v| !matches!(v, Value::Undef | Value::Null | Value::Bool(false)))
        {
            let span = self.ev.key_span(obj, key).unwrap_or(self.fallback);
            self.found.push((feature, span));
        }
    }

    fn first_visit<T>(&mut self, rc: &Rc<T>) -> bool {
        self.seen.insert(Rc::as_ptr(rc) as *const () as usize)
    }

    fn value(&mut self, v: &Value) {
        match v {
            Value::Object(o) if self.first_visit(o) => {
                for v in o.borrow().values() {
                    self.value(v);
                }
            }
            Value::Array(a) if self.first_visit(a) => {
                for v in a.borrow().iter() {
                    self.value(v);
                }
            }
            Value::Collection(c) if self.first_visit(c) => {
                if let Some(options) = &c.options {
                    self.option(options, "auth", Feature::Auth);
                    self.option(options, "sync", Feature::Sync);
                }
                for b in c.columns.values() {
                    self.column(b);
                }
            }
            Value::Global(g) if self.first_visit(g) => {
                for b in g.fields.values() {
                    self.column(b);
                }
            }
            Value::Action(a) | Value::Job(a) if self.first_visit(a) => self.value(&a.config),
            Value::Column(b) => self.column(b),
            _ => {}
        }
    }

    fn column(&mut self, b: &Rc<ColBuilder>) {
        if !self.first_visit(b) {
            return;
        }
        if b.access.is_some() {
            self.found.push((Feature::FieldAccess, b.span_of("access")));
        }
        if b.localized {
            self.found.push((Feature::Localized, b.span_of("localized")));
        }
        if b.ty == ColType::File {
            self.found.push((Feature::Files, b.span));
        }
        for sub in b.fields.iter().flat_map(|f| f.values()) {
            self.column(sub);
        }
        for sub in b.layouts.iter().flat_map(|l| l.values()).flat_map(|f| f.values()) {
            self.column(sub);
        }
    }
}
