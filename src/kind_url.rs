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
];

/// What the pattern may refer to on its kind.
pub struct UrlKind<'a> {
    pub columns: &'a IndexMap<String, Column>,
    /// `:year`, `:month` and `:day` come from `publishedAt`.
    pub dated: bool,
    /// `:path` is the parent chain of a hierarchical kind.
    pub hierarchical: bool,
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

/// Checks `pattern` against `kind`, and returns its shape: literal segments as written and every
/// placeholder as `:`, so `/blog/:slug` and `/blog/:id` share the shape `/blog/:`. Two kinds with
/// one shape would claim the same URLs.
pub fn check(pattern: &str, kind: &UrlKind<'_>) -> Result<String, Invalid> {
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
    let mut shape = String::new();
    let mut identifies = false;
    for (i, segment) in segments.iter().enumerate() {
        shape.push('/');
        let Some(name) = segment.strip_prefix(':') else {
            if !segment
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'_' | b'~' | b'-'))
            {
                return Err(invalid(
                    format!(
                        "the url segment \"{segment}\" in \"{pattern}\" has a character a URL path can't keep as written"
                    ),
                    "use lowercase letters, digits, `.`, `_`, `~` and `-`, or make the whole segment a placeholder like `:slug`",
                ));
            }
            shape.push_str(segment);
            continue;
        };
        shape.push(':');
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
                identifies = true;
            }
            "year" | "month" | "day" => {
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
    match through {
        Some(through) if col.references.is_none() => Err(invalid(
            format!("`:{name}` in \"{pattern}\" reads `{through}` through `{field}`, which isn't a reference"),
            format!("use `:{field}` itself, or reference another kind from `{field}`"),
        )),
        Some("slug") => Ok(()),
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
    Ok(value.trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn columns() -> IndexMap<String, Column> {
        let mut cols = IndexMap::new();
        cols.insert("title".into(), Column::new("title", ColType::Text));
        cols.insert("rank".into(), Column::new("rank", ColType::Integer));
        cols.insert("body".into(), Column::new("body", ColType::RichText));
        let mut author = Column::new("author", ColType::Integer);
        author.references = Some(crate::schema::Reference {
            collection: "authors".into(),
            column: "id".into(),
            on_delete: None,
            on_update: None,
        });
        cols.insert("author".into(), author);
        cols
    }

    fn post(pattern: &str) -> Result<String, Invalid> {
        let cols = columns();
        check(
            pattern,
            &UrlKind {
                columns: &cols,
                dated: true,
                hierarchical: false,
            },
        )
    }

    fn message(pattern: &str) -> String {
        post(pattern).expect_err(pattern).message
    }

    #[test]
    fn patterns_return_their_shape() {
        assert_eq!(post("/blog/:slug").unwrap(), "/blog/:");
        assert_eq!(post("/blog/:id").unwrap(), "/blog/:");
        assert_eq!(post("/:year/:month/:slug").unwrap(), "/:/:/:");
        assert_eq!(post("/by/:author.slug/:slug").unwrap(), "/by/:/:");
        assert_eq!(post("/top/:rank/:id").unwrap(), "/top/:/:");
        assert_eq!(post("/v1.0/~a_b-c/:slug").unwrap(), "/v1.0/~a_b-c/:");
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
        assert!(message("/wp-json/:slug").contains("already serves"));
        assert!(message("/__first/:slug").contains("already serves"));
        assert!(message("/blog/:title").contains("doesn't identify an item"));
    }

    #[test]
    fn placeholders_must_name_what_the_kind_has() {
        assert!(message("/:path").contains("needs a hierarchical kind"));
        assert!(message("/:titel/:slug").contains("names no field"));
        assert_eq!(post("/:titel/:slug").unwrap_err().help, "did you mean `:title`?");
        assert!(message("/:body/:slug").contains("can't be a URL segment"));
        assert!(message("/:title.slug/:slug").contains("isn't a reference"));
        assert!(message("/:author.name/:slug").contains("only its `slug`"));
        let cols = columns();
        let undated = UrlKind {
            columns: &cols,
            dated: false,
            hierarchical: true,
        };
        assert!(
            check("/:year/:slug", &undated)
                .unwrap_err()
                .message
                .contains("publishedAt")
        );
        assert_eq!(check("/docs/:path", &undated).unwrap(), "/docs/:");
        assert!(
            check("/:path/x", &undated)
                .unwrap_err()
                .message
                .contains("last segment")
        );
    }

    #[test]
    fn frontend_is_https_or_local_http() {
        assert_eq!(
            frontend_url("https://www.example.com/").unwrap(),
            "https://www.example.com"
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
    }
}
