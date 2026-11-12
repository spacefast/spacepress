//! A kind's `url` pattern (docs/spec/spec.md §2.7): one pattern both parses incoming URLs and
//! builds outgoing links. This module checks a pattern against its kind. It stores the pattern as
//! written; the router, the link filters and the redirects read it from the schema.

use crate::schema::{ColType, Column};
use indexmap::IndexMap;

/// First segments a kind's URL can't start with: WordPress's own entry points and First's.
pub const RESERVED_FIRST_SEGMENTS: &[&str] = &[
    "wp-admin",
    "wp-json",
    "wp-content",
    "wp-includes",
    "wp-login.php",
    "wp-signup.php",
    "wp-cron.php",
    "wp-sitemap.xml",
    "xmlrpc.php",
    "feed",
    "__first",
    "__spacefast",
    "llms.txt",
    "robots.txt",
    "favicon.ico",
    "sitemap.xml",
    // Core rewrite bases: author, term, search, paging, comment and embed archives.
    "author",
    "category",
    "tag",
    "search",
    "page",
    "comments",
    "embed",
];

/// What the pattern may refer to on its kind.
pub struct UrlKind<'a> {
    pub columns: &'a IndexMap<String, Column>,
    /// `:year`, `:month` and `:day` come from `publishedAt`.
    pub dated: bool,
    /// `:path` is the parent chain of a hierarchical kind.
    pub hierarchical: bool,
    /// Whether a referenced kind (by storage name) has items with a slug, for `:field.slug`.
    pub has_slug: &'a dyn Fn(&str) -> bool,
}

/// One segment of a checked pattern.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Segment {
    Literal(String),
    /// Matches one segment.
    Placeholder,
    /// `:path`: matches one or more segments, always last.
    Path,
}

/// Whether two checked patterns can match the same URL: same length and every pair of segments the
/// same literal or a placeholder on either side; `:path` matches any remaining segments.
pub fn overlaps(a: &[Segment], b: &[Segment]) -> bool {
    let tail = |s: &[Segment]| matches!(s.last(), Some(Segment::Path));
    let (fa, fb) = (a.len() - usize::from(tail(a)), b.len() - usize::from(tail(b)));
    let fixed = fa.min(fb);
    let compatible = a[..fixed].iter().zip(&b[..fixed]).all(|pair| match pair {
        (Segment::Literal(x), Segment::Literal(y)) => x == y,
        _ => true,
    });
    if !compatible {
        return false;
    }
    match (tail(a), tail(b)) {
        (false, false) => a.len() == b.len(),
        // `:path` needs at least one segment of its own.
        (true, false) => b.len() > fa,
        (false, true) => a.len() > fb,
        (true, true) => true,
    }
}

/// One problem with a pattern: what is wrong, and how to fix it.
#[derive(Debug, PartialEq, Eq)]
pub struct Invalid {
    pub message: String,
    pub help: String,
}

fn invalid(message: impl Into<String>, help: impl Into<String>) -> Invalid {
    Invalid {
        message: message.into(),
        help: help.into(),
    }
}

/// Checks `pattern` against `kind`, and returns its segments for [`overlaps`].
pub fn check(pattern: &str, kind: &UrlKind<'_>) -> Result<Vec<Segment>, Invalid> {
    let example = "write it like \"/blog/:slug\"";
    let Some(rest) = pattern.strip_prefix('/') else {
        return Err(invalid(
            format!("the url pattern \"{pattern}\" must start with `/`"),
            example,
        ));
    };
    if pattern.contains(['?', '#']) {
        return Err(invalid(
            format!("the url pattern \"{pattern}\" can't have a query string or fragment"),
            "a pattern matches the path only; remove everything from `?` or `#`",
        ));
    }
    if rest.is_empty() {
        return Err(invalid(
            "the url pattern \"/\" is the home page, not a kind's items",
            example,
        ));
    }
    if rest.ends_with('/') {
        return Err(invalid(
            format!("the url pattern \"{pattern}\" ends with `/`"),
            "remove the trailing slash; WordPress adds it to links when the site uses one",
        ));
    }
    let segments: Vec<&str> = rest.split('/').collect();
    if segments.contains(&"") {
        return Err(invalid(
            format!("the url pattern \"{pattern}\" has an empty segment (`//`)"),
            "remove the extra `/`",
        ));
    }
    if let Some(reserved) = RESERVED_FIRST_SEGMENTS
        .iter()
        .find(|r| r.eq_ignore_ascii_case(segments[0]))
    {
        return Err(invalid(
            format!("the url pattern \"{pattern}\" starts with `/{reserved}`, which WordPress or First already serves"),
            "start the pattern with your own segment, e.g. \"/blog/:slug\"",
        ));
    }
    let mut shape = Vec::new();
    let mut identifies = false;
    let mut seen: Vec<&str> = Vec::new();
    for (i, segment) in segments.iter().enumerate() {
        let Some(name) = segment.strip_prefix(':') else {
            if matches!(*segment, "." | "..")
                || !segment
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'~' | b'-'))
            {
                return Err(invalid(
                    format!(
                        "the url segment \"{segment}\" in \"{pattern}\" has a character a URL path can't keep as written"
                    ),
                    "use lowercase letters, digits, `.`, `_`, `~` and `-` (not `.` or `..` alone), or make the whole segment a placeholder like `:slug`",
                ));
            }
            shape.push(Segment::Literal(segment.to_string()));
            continue;
        };
        if seen.contains(&name) {
            return Err(invalid(
                format!("`:{name}` appears twice in \"{pattern}\""),
                "use each placeholder once",
            ));
        }
        seen.push(name);
        shape.push(Segment::Placeholder);
        match name {
            "slug" | "id" => identifies = true,
            "path" => {
                if !kind.hierarchical {
                    return Err(invalid(
                        format!("`:path` in \"{pattern}\" needs a hierarchical kind"),
                        "use `:slug`, or declare the kind with `hierarchical: true`",
                    ));
                }
                if i + 1 != segments.len() {
                    return Err(invalid(
                        format!("`:path` in \"{pattern}\" must be the last segment"),
                        "`:path` covers the parents and the item itself, so nothing can follow it",
                    ));
                }
                *shape.last_mut().unwrap() = Segment::Path;
                identifies = true;
            }
            "year" | "month" | "day" | "publishedAt" => {
                if !kind.dated {
                    return Err(invalid(
                        format!("`:{name}` in \"{pattern}\" comes from `publishedAt`, which this kind doesn't have"),
                        "use `:slug` or `:id`, or a date field of this kind by name",
                    ));
                }
            }
            _ => placeholder(name, pattern, kind)?,
        }
    }
    if !identifies {
        return Err(invalid(
            format!("the url pattern \"{pattern}\" doesn't identify an item"),
            "include `:slug`, `:id` or (on hierarchical kinds) `:path`",
        ));
    }
    Ok(shape)
}

/// A placeholder naming a field: a scalar field, or `<field>.slug` through a reference.
fn placeholder(name: &str, pattern: &str, kind: &UrlKind<'_>) -> Result<(), Invalid> {
    let (field, through) = match name.split_once('.') {
        Some((field, rest)) => (field, Some(rest)),
        None => (name, None),
    };
    let valid = |s: &str| {
        s.bytes().next().is_some_and(|b| b.is_ascii_alphabetic())
            && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    };
    if !valid(field) || through.is_some_and(|t| !valid(t)) {
        return Err(invalid(
            format!("`:{name}` in \"{pattern}\" isn't a placeholder"),
            "a placeholder is `:` and a field name, e.g. `:slug`, `:id`, `:year` or `:category.slug`",
        ));
    }
    let Some(col) = kind.columns.get(field).filter(|c| !c.hidden && !c.derived) else {
        let names: Vec<&str> = kind.columns.keys().map(String::as_str).collect();
        let help = match crate::diag::suggest(field, names.iter().copied()) {
            Some(s) => format!("did you mean `:{s}`?"),
            None => "use `:slug`, `:id`, `:year`/`:month`/`:day`, or a field of this kind".into(),
        };
        return Err(invalid(
            format!("`:{name}` in \"{pattern}\" names no field of this kind"),
            help,
        ));
    };
    if col.access.contains_key("read") {
        return Err(invalid(
            format!("`:{name}` in \"{pattern}\" names `{field}`, which has a read rule"),
            "a URL is public, so it can't hold a field some viewers can't read; use `:slug` or another field",
        ));
    }
    if !col.not_null && col.default.is_none() {
        return Err(invalid(
            format!("`:{name}` in \"{pattern}\" names `{field}`, which can be empty"),
            format!("make `{field}` required, or leave it out of the URL"),
        ));
    }
    match through {
        Some(through) if col.references.is_none() => Err(invalid(
            format!("`:{name}` in \"{pattern}\" reads `{through}` through `{field}`, which isn't a reference"),
            format!("use `:{field}` itself, or reference another kind from `{field}`"),
        )),
        Some("slug") => match &col.references {
            Some(r) if (kind.has_slug)(&r.collection) => Ok(()),
            _ => Err(invalid(
                format!(
                    "`:{name}` in \"{pattern}\" reads the slug of a referenced row, but `{field}` refers to a table, whose rows have no slug"
                ),
                format!("use `:{field}` (the row's id), or refer to a collection"),
            )),
        },
        Some(through) => Err(invalid(
            format!(
                "`:{name}` in \"{pattern}\" reads `{through}` of a referenced item; only its `slug` can be in a URL"
            ),
            format!("write `:{field}.slug`"),
        )),
        None if !scalar(col) => Err(invalid(
            format!(
                "`:{name}` in \"{pattern}\" is {}, which can't be a URL segment",
                crate::eval::kind_phrase(col.ty)
            ),
            "use a text, number, date or select field",
        )),
        None => Ok(()),
    }
}

fn scalar(col: &Column) -> bool {
    matches!(
        col.ty,
        ColType::Integer
            | ColType::Real
            | ColType::Text
            | ColType::Boolean
            | ColType::Date
            | ColType::Timestamp
            | ColType::Email
            | ColType::Url
            | ColType::Slug
    )
}

/// `frontend` in `defineConfig` (docs/spec/spec.md §5): who renders the public site.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frontend {
    /// `frontend: false`: backend only, no public HTML.
    Off,
    /// `frontend: "https://…"`: an external site renders; links point there.
    External(String),
}

/// Checks a `frontend` URL: absolute `https://`, or `http://` on localhost.
pub fn frontend_url(value: &str) -> Result<String, Invalid> {
    let help = "use the site's absolute address, e.g. \"https://www.example.com\" (http:// only for localhost)";
    let Ok(url) = url::Url::parse(value) else {
        return Err(invalid(format!("`frontend` \"{value}\" isn't an absolute URL"), help));
    };
    let local = matches!(
        url.host(),
        Some(url::Host::Domain("localhost")) | Some(url::Host::Ipv4(std::net::Ipv4Addr::LOCALHOST))
    ) || url.host() == Some(url::Host::Ipv6(std::net::Ipv6Addr::LOCALHOST));
    match url.scheme() {
        "https" => {}
        "http" if local => {}
        "http" => {
            return Err(invalid(
                format!("`frontend` \"{value}\" uses http://; only localhost may"),
                "use https://",
            ));
        }
        other => {
            return Err(invalid(
                format!("`frontend` \"{value}\" uses {other}:, not https://"),
                help,
            ));
        }
    }
    if url.host().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err(invalid(
            format!("`frontend` \"{value}\" needs a host and no credentials"),
            help,
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(invalid(
            format!("`frontend` \"{value}\" can't have a query string or fragment"),
            "remove everything from `?` or `#`",
        ));
    }
    // Store exactly what was checked: the parser drops whitespace and rewrites `\\`, case and dots.
    let normalized = url.as_str().trim_end_matches('/');
    if normalized != value.trim_end_matches('/') {
        return Err(invalid(
            format!("`frontend` \"{value}\" isn't written in its plain form"),
            format!("write \"{normalized}\""),
        ));
    }
    Ok(normalized.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use Segment::{Literal as L, Path, Placeholder as P};

    fn required(name: &str, ty: ColType) -> Column {
        let mut col = Column::new(name, ty);
        col.not_null = true;
        col
    }

    fn reference(name: &str, target: &str) -> Column {
        let mut col = required(name, ColType::Integer);
        col.references = Some(crate::schema::Reference {
            collection: target.into(),
            column: "id".into(),
            on_delete: None,
            on_update: None,
        });
        col
    }

    fn columns() -> IndexMap<String, Column> {
        let mut cols = IndexMap::new();
        for col in [
            required("title", ColType::Text),
            required("rank", ColType::Integer),
            required("body", ColType::RichText),
            Column::new("subtitle", ColType::Text),
            reference("author", "authors"),
            reference("tally", "tallies"),
        ] {
            cols.insert(col.name.clone(), col);
        }
        let mut secret = required("secret", ColType::Text);
        secret
            .access
            .insert("read".into(), crate::schema::Access::Role("admin".into()));
        cols.insert("secret".into(), secret);
        cols
    }

    fn collection_named(table: &str) -> bool {
        table == "authors"
    }

    fn checked(pattern: &str, dated: bool, hierarchical: bool) -> Result<Vec<Segment>, Invalid> {
        let cols = columns();
        check(
            pattern,
            &UrlKind {
                columns: &cols,
                dated,
                hierarchical,
                has_slug: &collection_named,
            },
        )
    }

    fn post(pattern: &str) -> Result<Vec<Segment>, Invalid> {
        checked(pattern, true, false)
    }

    fn message(pattern: &str) -> String {
        post(pattern).expect_err(pattern).message
    }

    #[test]
    fn patterns_return_their_segments() {
        assert_eq!(post("/blog/:slug").unwrap(), [L("blog".into()), P]);
        assert_eq!(post("/:year/:month/:slug").unwrap(), [P, P, P]);
        assert_eq!(post("/by/:author.slug/:slug").unwrap(), [L("by".into()), P, P]);
        assert_eq!(post("/top/:rank/:id").unwrap(), [L("top".into()), P, P]);
        assert_eq!(
            post("/v1.0/~a_b-c/:slug").unwrap(),
            [L("v1.0".into()), L("~a_b-c".into()), P]
        );
        assert_eq!(post("/d/:publishedAt/:slug").unwrap(), [L("d".into()), P, P]);
        assert_eq!(checked("/docs/:path", false, true).unwrap(), [L("docs".into()), Path]);
    }

    #[test]
    fn malformed_patterns_are_refused_with_a_fix() {
        assert!(message("blog/:slug").contains("must start with `/`"));
        assert!(message("/blog/:slug/").contains("ends with `/`"));
        assert!(message("/blog//:slug").contains("empty segment"));
        assert!(message("/blog/:slug?x=1").contains("query string"));
        assert!(message("/").contains("home page"));
        assert!(message("/Blog/:slug").contains("can't keep as written"));
        assert!(message("/blog/post-:slug").contains("can't keep as written"));
        assert!(message("/../:slug").contains("can't keep as written"));
        assert!(message("/x/./:slug").contains("can't keep as written"));
        assert!(message("/wp-json/:slug").contains("already serves"));
        assert!(message("/__first/:slug").contains("already serves"));
        assert!(message("/category/:slug").contains("already serves"));
        assert!(message("/blog/:title").contains("doesn't identify an item"));
        assert!(message("/:slug/:slug").contains("appears twice"));
        assert!(message("/x/:year/:year/:slug").contains("appears twice"));
    }

    #[test]
    fn placeholders_must_name_what_the_kind_has() {
        assert!(message("/:path").contains("needs a hierarchical kind"));
        assert!(message("/:titel/:slug").contains("names no field"));
        assert_eq!(post("/:titel/:slug").unwrap_err().help, "did you mean `:title`?");
        assert!(message("/:body/:slug").contains("can't be a URL segment"));
        assert!(message("/:title.slug/:slug").contains("isn't a reference"));
        assert!(message("/:author.name/:slug").contains("only its `slug`"));
        assert!(message("/:tally.slug/:slug").contains("refers to a table"));
        assert!(message("/s/:secret/:slug").contains("has a read rule"));
        assert!(message("/s/:subtitle/:slug").contains("can be empty"));
        assert!(
            checked("/:year/:slug", false, false)
                .unwrap_err()
                .message
                .contains("publishedAt")
        );
        assert!(
            checked("/:path/x", false, true)
                .unwrap_err()
                .message
                .contains("last segment")
        );
    }

    #[test]
    fn overlapping_patterns_are_found_whatever_their_placeholders() {
        let seg = |p: &str| checked(p, true, true).unwrap();
        let overlap = |a: &str, b: &str| overlaps(&seg(a), &seg(b)) && overlaps(&seg(b), &seg(a));
        assert!(overlap("/blog/:slug", "/blog/:id"));
        assert!(overlap("/blog/:slug", "/:rank/:slug"));
        assert!(overlap("/docs/:path", "/docs/:slug"));
        assert!(overlap("/docs/:path", "/docs/a/:slug"));
        assert!(overlap("/:path", "/blog/:slug"));
        assert!(!overlap("/blog/:slug", "/docs/:slug"));
        assert!(!overlap("/blog/:slug", "/blog/:year/:slug"));
        assert!(!overlaps(&seg("/docs/:path"), &[L("docs".into())]));
        assert!(!overlap("/docs/:path", "/guide/:path"));
    }

    #[test]
    fn frontend_is_https_or_local_http() {
        assert_eq!(
            frontend_url("https://www.example.com/").unwrap(),
            "https://www.example.com"
        );
        assert_eq!(
            frontend_url("https://www.example.com/app").unwrap(),
            "https://www.example.com/app"
        );
        assert_eq!(frontend_url("http://localhost:3000").unwrap(), "http://localhost:3000");
        assert_eq!(frontend_url("http://127.0.0.1:4321").unwrap(), "http://127.0.0.1:4321");
        assert!(
            frontend_url("http://example.com")
                .unwrap_err()
                .message
                .contains("only localhost")
        );
        assert!(
            frontend_url("/relative")
                .unwrap_err()
                .message
                .contains("isn't an absolute URL")
        );
        assert!(frontend_url("ftp://example.com").is_err());
        assert!(frontend_url("https://u:p@example.com").is_err());
        assert!(frontend_url("https://example.com/?a=1").is_err());
        let messy = frontend_url("  https://Example.com\\x\t").unwrap_err();
        assert!(messy.message.contains("plain form"), "{}", messy.message);
        assert_eq!(messy.help, "write \"https://example.com/x\"");
    }
}
