//! TEMPORARY: phase-2 declarations the runtime does not enforce yet.
//!
//! schema.php v3 carries these keys, but until the owning lane lands nothing reads them: an
//! `auth: true` collection, for instance, would serve its password hashes.
//! A config that relies on one must not build "ok". When a lane lands its feature, it deletes its
//! `Feature` variant (the compiler then points at every line that names it, including its row in
//! `UNLANDED`) and its fixture row in `tests/compiler.rs`. The last lane deletes this file,
//! its call in `commands::build` and the `ZERO_ALLOW_UNLANDED_FEATURES` opt-in in `tests/compiler.rs`.
//!
//! The decision is made on the extracted schema, which is exactly what schema.php will carry, so
//! config code can't hide a declaration from it. The config values only locate the error. Runs
//! after extraction and compilation, so every static rejection keeps its own message.

use crate::diag::{Diag, Result, Span};
use crate::eval::Evaluator;
use crate::schema::Schema;
use crate::value::{ColBuilder, Value};
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Feature {
    Auth,
}

/// (feature, owning lane, what, fix until then). One row per lane; delete yours when it lands.
#[rustfmt::skip]
const UNLANDED: &[(Feature, char, &str, &str)] = &[
    (Feature::Auth, 'E', "`auth: true` collections", "remove auth: true and keep members in a regular collection"),
];

/// Set to 1 to build these declarations anyway, in debug builds only: the schema.php v3 golden test
/// (`phase2_schema_and_closures_match_the_contract`) still renders every key.
const ALLOW: &str = "ZERO_ALLOW_UNLANDED_FEATURES";

pub fn reject(schema: &Schema, config: &Value, ev: &Evaluator<'_>, fallback: Span) -> Result<()> {
    if cfg!(debug_assertions) && std::env::var(ALLOW).as_deref() == Ok("1") {
        return Ok(());
    }
    for feature in declared(schema) {
        if let Some((_, lane, what, help)) = UNLANDED.iter().find(|(f, ..)| *f == feature) {
            let span = locate(feature, config, ev).unwrap_or(fallback);
            return Err(Diag::new(span, format!("{what}: not implemented until lane {lane}"))
                .help(format!("it would build but not be enforced yet; {help}")));
        }
    }
    Ok(())
}

/// Unlanded features the emitted schema declares, in a fixed order.
fn declared(schema: &Schema) -> Vec<Feature> {
    [(schema.collections.values().any(|c| c.auth), Feature::Auth)]
        .into_iter()
        .filter_map(|(on, feature)| on.then_some(feature))
        .collect()
}

/// Where the config declares `feature`, for the error location.
fn locate(feature: Feature, config: &Value, ev: &Evaluator<'_>) -> Option<Span> {
    let mut walk = Walk {
        ev,
        seen: HashSet::new(),
        found: Vec::new(),
    };
    walk.value(config);
    walk.found
        .into_iter()
        .find(|(f, _)| *f == feature)
        .map(|(_, span)| span)
}

/// Every collection option, action option and column builder reachable from the config.
struct Walk<'a, 'p> {
    ev: &'a Evaluator<'p>,
    seen: HashSet<usize>,
    found: Vec<(Feature, Span)>,
}

impl Walk<'_, '_> {
    fn option(&mut self, obj: &Value, key: &str, feature: Feature) {
        // Only declarations that are on: `auth: false` or `webhooks: []` never carry the error.
        let on = |v: &Value| match v {
            Value::Undef | Value::Null | Value::Bool(false) => false,
            Value::Array(a) => !a.borrow().is_empty(),
            Value::Object(o) => !o.borrow().is_empty(),
            _ => true,
        };
        if let Value::Object(o) = obj
            && o.borrow().get(key).is_some_and(on)
            && let Some(span) = self.ev.key_span(obj, key)
        {
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
            Value::Action(a) | Value::Job(a) if self.first_visit(a) => {
                self.value(&a.config);
            }
            Value::Column(b) => self.column(b),
            _ => {}
        }
    }

    fn column(&mut self, b: &Rc<ColBuilder>) {
        if !self.first_visit(b) {
            return;
        }
        for sub in b.fields.iter().flat_map(|f| f.values()) {
            self.column(sub);
        }
        for sub in b.layouts.iter().flat_map(|l| l.values()).flat_map(|f| f.values()) {
            self.column(sub);
        }
    }
}
