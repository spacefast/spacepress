//! Accepted JavaScript built-in overloads. Arity and phase support live here;
//! type/coercion checks stay at the implementation boundary. `None` means refused.

use crate::diag::Diag;
use crate::diag::Span;

#[derive(Clone, Copy)]
pub enum Phase {
    Evaluator,
    Emitter,
    Runtime,
}

#[derive(Clone, Copy)]
pub struct Arity {
    pub min: usize,
    pub max: usize,
}

#[derive(Clone, Copy)]
pub struct Contract {
    pub overload: &'static str,
    pub evaluator: Option<Arity>,
    pub emitter: Option<Arity>,
    pub runtime: Option<Arity>,
}

const fn arity(min: usize, max: usize) -> Option<Arity> {
    Some(Arity { min, max })
}
const VARIADIC: usize = usize::MAX;

/// Surface is `global`, a namespace, or an instance family (`string`, `array`, ...).
/// The runtime column describes checked JavaScript dispatch as well as typed helpers.
const fn overload(
    overload: &'static str,
    evaluator: Option<Arity>,
    emitter: Option<Arity>,
    runtime: Option<Arity>,
) -> Contract {
    Contract {
        overload,
        evaluator,
        emitter,
        runtime,
    }
}

// Columns: surface, names, overload, evaluator arity, emitter arity, runtime arity.
#[rustfmt::skip]
pub const CONTRACTS: &[(&str, &[&str], Contract)] = &[
    ("zero", &["collection", "table", "userProjection"], overload("fields: object, options?: object", arity(1, 2), None, None)),
    ("zero", &["global"], overload("name: string, fields: object, options?: object", arity(2, 3), None, None)),
    ("zero", &["defineRelations"], overload("schema: object, relations: function", arity(2, 2), None, None)),
    ("zero", &["defineConfig", "action", "job", "env"], overload("one configuration or environment name", arity(1, 1), None, None)),
    ("zero", &["files"], overload("name: string, options: object", arity(2, 2), None, None)),
    ("zero", &["id"], overload("no arguments", arity(0, 0), None, None)),
    ("zero", &["relation"], overload("options?: object", arity(0, 1), None, None)),
    ("field", &["integer", "real", "text", "boolean", "date", "timestamp", "json", "email", "url", "slug", "richText", "media"], overload("options?: object", arity(0, 1), None, None)),
    ("field", &["file", "select", "group", "repeater", "blocks"], overload("options: object", arity(1, 1), None, None)),
    ("column", &["localized", "notNull", "unique", "primaryKey", "defaultNow", "$type"], overload("no runtime arguments", arity(0, 0), None, None)),
    ("column", &["access", "showIf", "ui", "min", "max", "pattern", "validate", "default", "$default", "$defaultFn", "$onUpdate", "$onUpdateFn"], overload("one value or callback", arity(1, 1), None, None)),
    ("column", &["references"], overload("target: function, options?: object", arity(1, 2), None, None)),
    ("constructor", &["HttpError"], overload("runtime-only status: number, code: string, message: string, details?: object", None, arity(3, 4), None)),
    ("db", &["insert", "update", "delete"], overload("collection: Collection", None, arity(1, 1), None)),
    ("db.builder", &["values", "set", "where"], overload("one values, changes or filter object", None, arity(1, 1), None)),
    ("db.builder", &["returning"], overload("no arguments", None, arity(0, 0), None)),
    ("global", &["String", "Number", "Boolean"], overload("value?: unknown", arity(0, 1), arity(0, 1), arity(0, 1))),
    ("global", &["parseInt"], overload("text: string, radix?: number; other than base 10/powers of two: safe integers only", arity(1, 2), arity(1, 2), arity(0, 2))),
    ("global", &["parseFloat"], overload("text: string", arity(1, 1), arity(1, 1), arity(0, 1))),
    ("global", &["isFinite", "isNaN"], overload("value?: unknown", arity(0, 1), arity(0, 1), arity(0, 1))),
    ("global", &["encodeURI", "encodeURIComponent"], overload("text: string", arity(1, 1), arity(1, 1), arity(1, 1))),
    ("global", &["structuredClone"], overload("value: data", None, arity(1, 1), arity(1, 1))),
    ("global", &["Error", "TypeError", "RangeError"], overload("runtime-only message?: string; JavaScript: options without cause", None, arity(0, 1), arity(0, 2))),
    ("Math", &["min", "max"], overload("...values: number[]", arity(0, VARIADIC), arity(0, VARIADIC), arity(0, VARIADIC))),
    ("Math", &["floor", "ceil", "abs", "sqrt", "trunc", "round"], overload("value: number", arity(0, 1), arity(1, 1), arity(0, 1))),
    ("Math", &["sign", "log", "exp"], overload("value: number", None, arity(1, 1), arity(0, 1))),
    ("Math", &["pow"], overload("base: number, exponent: number", arity(0, 2), arity(2, 2), arity(0, 2))),
    ("Math", &["random"], overload("no arguments", None, arity(0, 0), arity(0, 0))),
    ("Date", &["now"], overload("no arguments", None, arity(0, 0), arity(0, 0))),
    ("Object", &["keys", "values", "entries"], overload("value: object", arity(1, 1), arity(1, 1), arity(1, 1))),
    ("Object", &["fromEntries"], overload("entries: [key, value][]", arity(1, 1), arity(1, 1), arity(1, 1))),
    ("Object", &["hasOwn"], overload("receiver: data, key: propertyKey (evaluator: primitive)", arity(2, 2), arity(2, 2), arity(2, 2))),
    ("Object", &["freeze"], overload("value: data", arity(1, 1), None, None)),
    ("Array", &["isArray"], overload("value?: unknown", arity(0, 1), arity(1, 1), arity(0, 1))),
    ("Array", &["from"], overload("source: iterable | {length: number}, mapper?: function", arity(1, 2), arity(1, 2), arity(1, 2))),
    ("Array", &["of"], overload("...values: unknown[]", None, None, arity(0, VARIADIC))),
    ("Number", &["isInteger", "isFinite"], overload("value?: unknown", arity(0, 1), arity(0, 1), arity(0, 1))),
    ("Number", &["isNaN"], overload("value?: unknown", None, None, arity(0, 1))),
    ("Number", &["parseInt"], overload("text: string, radix?: number; other than base 10/powers of two: safe integers only", None, arity(1, 2), arity(0, 2))),
    ("Number", &["parseFloat"], overload("text: string", None, arity(1, 1), arity(0, 1))),
    ("JSON", &["stringify"], overload("runtime-only value: data, null|undefined, space?: number|string", None, arity(1, 3), arity(0, 3))),
    ("JSON", &["parse"], overload("text: string, reviver?: null|undefined", None, arity(1, 2), arity(1, 2))),
    ("console", &["log", "info", "warn", "error", "debug"], overload("...values: unknown[]", None, arity(0, VARIADIC), arity(0, VARIADIC))),
    ("string", &["toLowerCase", "toUpperCase", "trim", "trimStart", "trimEnd", "toString"], overload("no arguments", arity(0, 0), arity(0, 0), arity(0, 0))),
    ("string", &["includes", "startsWith", "endsWith"], overload("search: string; runtime: search, position?: number", arity(1, 1), arity(1, 1), arity(0, 2))),
    ("string", &["slice"], overload("start?: number, end?: number", arity(0, 2), arity(0, 2), arity(0, 2))),
    ("string", &["split"], overload("separator: string, limit?: number", arity(1, 2), arity(0, 2), arity(0, 2))),
    ("string", &["repeat"], overload("count: number", arity(1, 1), arity(1, 1), arity(0, 1))),
    ("string", &["replace", "replaceAll"], overload("pattern: string|RegExp, replacement: string|function (evaluator: string)", arity(2, 2), arity(2, 2), arity(2, 2))),
    ("string", &["concat"], overload("...values: string[]", None, arity(0, VARIADIC), arity(0, VARIADIC))),
    ("string", &["indexOf", "lastIndexOf"], overload("search: string, position?: number", None, arity(1, 2), arity(0, 2))),
    ("string", &["substring"], overload("start?: number, end?: number", None, arity(0, 2), arity(0, 2))),
    ("string", &["padStart", "padEnd"], overload("target: number, fill?: string", None, arity(1, 2), arity(1, 2))),
    ("string", &["charAt"], overload("index?: number", None, arity(0, 1), arity(0, 1))),
    ("string", &["at"], overload("index: number", None, arity(1, 1), arity(0, 1))),
    ("string", &["charCodeAt"], overload("index?: number", None, None, arity(0, 1))),
    ("string", &["match"], overload("pattern: RegExp", None, arity(1, 1), arity(0, 1))),
    ("string", &["localeCompare"], overload("refused: locale collation depends on the host", None, None, None)),
    ("number", &["toFixed"], overload("digits?: number (0..100)", None, arity(0, 1), arity(0, 1))),
    ("global", &["RegExp"], overload("pattern?: string|RegExp, flags?: string", None, arity(0, 2), arity(0, 2))),
    ("constructor", &["RegExp"], overload("pattern?: string|RegExp, flags?: string", None, arity(0, 2), arity(0, 2))),
    ("constructor", &["Date"], overload("value?: string|number", None, arity(0, 1), arity(0, 1))),
    ("constructor", &["Error", "TypeError", "RangeError"], overload("runtime-only message?: string; options without cause", None, arity(0, 2), arity(0, 2))),
    ("constructor", &["Map", "Set"], overload("entries?: iterable", None, None, arity(0, 1))),
    ("number", &["toString"], overload("decimal only", arity(0, 0), arity(0, 0), arity(0, 0))),
    ("array", &["map", "filter", "find", "findIndex", "some", "every", "flatMap", "forEach"], overload("callback: function (thisArg refused)", arity(1, 1), arity(1, 1), arity(1, 1))),
    ("array", &["findLast", "findLastIndex"], overload("callback: function (thisArg refused)", None, arity(1, 1), arity(1, 1))),
    ("array", &["reduce"], overload("callback: function, initial?: unknown", arity(1, 2), arity(1, 2), arity(1, 2))),
    ("array", &["includes", "indexOf"], overload("value: unknown, from?: number", arity(1, 2), arity(1, 2), arity(0, 2))),
    ("array", &["lastIndexOf"], overload("value: unknown, from?: number", None, arity(1, 2), arity(0, 2))),
    ("array", &["join"], overload("separator?: string", arity(0, 1), arity(0, 1), arity(0, 1))),
    ("array", &["slice"], overload("start?: number, end?: number", arity(0, 2), arity(0, 2), arity(0, 2))),
    ("array", &["concat", "push"], overload("...values: unknown[]", arity(0, VARIADIC), arity(0, VARIADIC), arity(0, VARIADIC))),
    ("array", &["unshift"], overload("...values: unknown[]", None, arity(0, VARIADIC), arity(0, VARIADIC))),
    ("array", &["pop", "shift", "reverse", "toReversed"], overload("no arguments; JavaScript dispatch ignores extra arguments", None, arity(0, 0), arity(0, VARIADIC))),
    ("array", &["sort", "toSorted"], overload("compare?: function", None, arity(0, 1), arity(0, 1))),
    ("array", &["flat"], overload("depth?: number", None, arity(0, 1), arity(0, 1))),
    ("array", &["fill"], overload("value: unknown, start?: number, end?: number", None, arity(1, 3), arity(1, 3))),
    ("array", &["splice"], overload("start: number, deleteCount?: number, ...values: unknown[]", None, arity(1, VARIADIC), arity(0, VARIADIC))),
    ("array", &["at"], overload("index: number", None, arity(1, 1), arity(0, 1))),
    ("date", &["toISOString", "toJSON", "getTime", "valueOf"], overload("no arguments", None, arity(0, 0), arity(0, 0))),
    ("regex", &["test"], overload("text: string", None, arity(1, 1), arity(0, 1))),
    ("regex", &["exec"], overload("text: string", None, None, arity(0, 1))),
    ("set", &["add", "has"], overload("value: unknown", None, None, arity(0, 1))),
    ("map", &["get", "has"], overload("key: unknown", None, None, arity(0, 1))),
    ("map", &["set"], overload("key: unknown, value: unknown", None, None, arity(0, 2))),
    ("string", &["valueOf"], overload("no semantic arguments", None, None, arity(0, VARIADIC))),
    ("number", &["valueOf"], overload("no semantic arguments", None, None, arity(0, VARIADIC))),
    ("array", &["toString", "valueOf"], overload("no semantic arguments", None, None, arity(0, VARIADIC))),
    ("regex", &["toString", "valueOf"], overload("no semantic arguments", None, None, arity(0, VARIADIC))),
    ("set", &["toString", "valueOf"], overload("no semantic arguments", None, None, arity(0, VARIADIC))),
    ("map", &["toString", "valueOf"], overload("no semantic arguments", None, None, arity(0, VARIADIC))),
    ("object", &["toString", "valueOf"], overload("no semantic arguments", None, None, arity(0, VARIADIC))),
    ("boolean", &["toString", "valueOf"], overload("no semantic arguments", None, None, arity(0, VARIADIC))),
    ("function", &["call"], overload("thisArg?: unknown, ...arguments: unknown[]", None, None, arity(0, VARIADIC))),
    ("function", &["apply"], overload("thisArg?: unknown, arguments?: array-like", None, None, arity(0, 2))),
    ("function", &["valueOf"], overload("no semantic arguments", None, None, arity(0, VARIADIC))),
];

pub const UNSAFE_RADIX: &str = "parseInt with this radix requires a safe integer result";

pub fn check_parse_int_literals(args: &[crate::ir::ArrEl], span: Span) -> Result<(), Diag> {
    use crate::ir::{ArrEl, ExprKind, UnOp};
    let Some(ArrEl::Item(text)) = args.first() else {
        return Ok(());
    };
    let ExprKind::Str(text) = &text.kind else {
        return Ok(());
    };
    let radix = match args.get(1) {
        None => 0,
        Some(ArrEl::Item(expr)) => match &expr.kind {
            ExprKind::Undefined | ExprKind::Null => 0,
            ExprKind::Num(n) => crate::num::to_int32(*n),
            ExprKind::Unary(UnOp::Neg, expr) => match expr.kind {
                ExprKind::Num(n) => crate::num::to_int32(-n),
                _ => return Ok(()),
            },
            _ => return Ok(()),
        },
        _ => return Ok(()),
    };
    if crate::num::parse_int(text, radix).is_none() {
        return Err(Diag::new(span, UNSAFE_RADIX).help("use base 10, a power-of-two base, or a safe integer result"));
    }
    Ok(())
}

pub fn contract(surface: &str, name: &str) -> Option<Contract> {
    CONTRACTS
        .iter()
        .find(|(s, names, _)| *s == surface && names.contains(&name))
        .map(|(_, _, c)| *c)
}

pub fn check(surface: &str, name: &str, count: usize, phase: Phase, span: Span) -> Result<(), Diag> {
    let Some(c) = contract(surface, name) else {
        return Ok(());
    };
    if matches!(phase, Phase::Evaluator) && surface == "Date" && name == "now" {
        return Err(Diag::new(
            span,
            "`Date.now()` isn't available while the config is evaluated (builds must be repeatable)",
        )
        .code(crate::diag::Code::BuildTimeClock)
        .help("compute the time in a hook or use timestamp().defaultNow()"));
    }
    let accepted = match phase {
        Phase::Evaluator => c.evaluator,
        Phase::Emitter => c.emitter,
        Phase::Runtime => c.runtime,
    };
    if accepted.is_some_and(|a| (a.min..=a.max).contains(&count)) {
        return Ok(());
    }
    let message = if surface == "string" && matches!(name, "includes" | "startsWith" | "endsWith") && count > 1 {
        format!("`{name}()` with a position isn't supported")
    } else if name == "localeCompare" {
        "localeCompare() isn't supported: locale collation depends on the host".into()
    } else {
        format!("unsupported overload of `{surface}.{name}` ({count} arguments)")
    };
    Err(Diag::new(span, message).help(format!("accepted contract: {}", c.overload)))
}

/// Refuse engine-specific capture retention rather than emulate a regex engine.
pub fn check_regex(pattern: &str, span: Span) -> Result<(), Diag> {
    let bytes = pattern.as_bytes();
    let mut stack = Vec::new();
    let mut captures = 0;
    let mut in_class = false;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 1,
            b'[' => in_class = true,
            b']' => in_class = false,
            b'(' if !in_class => {
                let tail = &pattern[i + 1..];
                let special = tail.starts_with('?');
                let named = tail.starts_with("?<") && !tail.starts_with("?<=") && !tail.starts_with("?<!");
                if special && !named && !["?:", "?=", "?!", "?<=", "?<!"].iter().any(|p| tail.starts_with(p)) {
                    return Err(Diag::new(span, "this regex group syntax isn't supported")
                        .help("use JavaScript capture, noncapturing or lookaround groups"));
                }
                stack.push(captures);
                if !special || named {
                    captures += 1;
                }
            }
            b')' if !in_class => {
                if let Some(before) = stack.pop()
                    && captures > before
                    && bytes.get(i + 1).is_some_and(|b| matches!(b, b'*' | b'+' | b'{'))
                {
                    return Err(
                        Diag::new(span, "repeated regex groups containing captures aren't supported")
                            .help("remove the capture or repeat the captured text outside the group"),
                    );
                }
            }
            _ => {}
        }
        i += 1;
    }
    Ok(())
}

#[derive(Clone, Copy)]
pub struct ArrayMutation {
    /// Arguments whose values become receiver elements (excluding index/count arguments).
    inserted_start: usize,
    inserted_limit: Option<usize>,
}

impl ArrayMutation {
    pub fn inserted<T>(self, args: &[T]) -> &[T] {
        let start = self.inserted_start.min(args.len());
        let end = self
            .inserted_limit
            .map_or(args.len(), |n| start.saturating_add(n).min(args.len()));
        &args[start..end]
    }
}

pub fn array_mutation(name: &str) -> Option<ArrayMutation> {
    let (inserted_start, inserted_limit) = match name {
        "push" | "unshift" => (0, None),
        "splice" => (2, None),
        "fill" => (0, Some(1)),
        "pop" | "shift" | "sort" | "reverse" => (0, Some(0)),
        _ => return None,
    };
    Some(ArrayMutation {
        inserted_start,
        inserted_limit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fmt::Write;

    #[test]
    fn runtime_contract_is_current() {
        let mut php = String::from(
            "<?php\n\ndeclare(strict_types=1);\n\nnamespace Zero;\n\n// Generated from src/builtins.rs; UPDATE_BUILTINS=1 cargo test --lib builtins::tests\nfinal class Builtins\n{\n    private const ARITIES = [\n",
        );
        let mut keys = std::collections::HashSet::new();
        for (surface, names, c) in CONTRACTS {
            assert!(!c.overload.is_empty());
            for name in *names {
                let key = format!("{surface}.{name}");
                assert!(keys.insert(key.clone()), "duplicate {key}");
                let bounds = c.runtime.map_or("null".into(), |a| {
                    format!(
                        "[{}, {}]",
                        a.min,
                        if a.max == VARIADIC {
                            "PHP_INT_MAX".into()
                        } else {
                            a.max.to_string()
                        }
                    )
                });
                writeln!(php, "        '{key}' => {bounds},").unwrap();
            }
        }
        php.push_str("    ];\n\n    public static function check(string $surface, string $name, int $count): void\n    {\n        $key = $surface . '.' . $name;\n        if (!array_key_exists($key, self::ARITIES)) { return; }\n        $arity = self::ARITIES[$key];\n        if ($arity === null || $count < $arity[0] || $count > $arity[1]) {\n            throw new JsError('Unsupported overload of ' . $key . ' (' . $count . ' arguments)', 'TypeError');\n        }\n    }\n}\n");
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("runtime/Zero/Builtins.php");
        if std::env::var_os("UPDATE_BUILTINS").is_some() {
            std::fs::write(&path, &php).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(path).unwrap(),
            php,
            "regenerate the runtime contract"
        );
    }
}
