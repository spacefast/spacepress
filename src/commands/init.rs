//! `first init [dir] [--check]`: what a coding agent needs to work in a project, written into it.
//!
//! - A section of `AGENTS.md` between two markers. Everything outside the markers is the author's
//!   and is never touched; a rerun replaces the section only.
//! - A `first` server in `.mcp.json` that starts `first mcp`. An entry already named `first` is
//!   the author's and is left as it is.
//! - The skills this binary carries (`skills/` in the repository), under each directory in
//!   [`SKILL_DIRS`].
//! - With `--github`, `.github/workflows/first-sync.yml` at the repository's root: the workflow
//!   that runs `first sync --pr` ([`super::init_github`]). Once written, reruns keep it in step.
//!
//! The section is generated from the compiled project (its kinds, actions, jobs, routes and
//! endpoints, as `first mcp`'s `schema` tool describes them) and from the command table, so it goes
//! out of date when the config or the compiler changes. `first check` and `first build` say so in one
//! line, and `first init --check` exits 1 for CI.

use super::{build, describe};
use crate::docs_files::SKILLS;
use serde_json::{Value, json};
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const BEGIN: &str = "<!-- first:begin -->";
const END: &str = "<!-- first:end -->";
/// Where agents look for a project's skills: `.agents/skills` (Codex and the shared convention)
/// and `.claude/skills` (Claude Code).
const SKILL_DIRS: [&str; 2] = [".agents/skills", ".claude/skills"];
const USAGE: &str = "usage: first init [dir] [--check] [--github]";

/// The `first` entry `.mcp.json` gets. `--no-install` runs the project's own `first` and never
/// downloads a package by that name.
fn mcp_server() -> Value {
    json!({ "command": "npx", "args": ["--no-install", "first", "mcp"] })
}

/// A skill's `name` and `description` from its front matter.
fn front_matter(text: &str) -> (Option<&str>, Option<&str>) {
    let Some(end) = text.strip_prefix("---\n").and_then(|rest| rest.find("\n---\n")) else {
        return (None, None);
    };
    let value = |key: &str| {
        text[4..4 + end]
            .lines()
            .find_map(|line| line.strip_prefix(key)?.strip_prefix(':'))
            .map(|v| v.trim().trim_matches('"'))
    };
    (value("name"), value("description"))
}

fn rule(value: &Value) -> String {
    match value {
        Value::String(rule) => rule.clone(),
        Value::Null => "-".into(),
        other => other.to_string(),
    }
}

/// `title: text, body?: richText, author: ref → authors`: the fields an author declared.
fn field_list(fields: &Value) -> String {
    fields
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(_, field)| field["generated"] != true)
        .map(|(name, field)| {
            let optional = field["required"] != true;
            let target = field["to"].as_str().map(|to| format!(" → {to}")).unwrap_or_default();
            format!(
                "`{name}{}`: {}{target}",
                if optional { "?" } else { "" },
                field["type"].as_str().unwrap_or("unknown")
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}

/// The managed section of `AGENTS.md`, markers included, for a described project.
fn section(project: &Value) -> String {
    let api = describe::API;
    let name = project["name"].as_str().unwrap_or_default();
    let mut s = format!(
        "{BEGIN}\n## First\n\n\
         Written by `first init` from this project's config; edit outside this section, and run `first init` again \
         after the config changes.\n\n\
         This project is the First app `{name}`. First compiles `first.config.ts` and the `first/` folder into WordPress \
         plugins. Server code is TypeScript compiled to PHP: a documented subset, not Node.js.\n\n\
         ### Rules\n\n\
         - Run `first check` after every edit to `first.config.ts` or `first/`. It compiles and writes nothing.\n\
         - Never edit `first/_generated/` or `first/dist/`: `first build` writes them. Commit `first/_generated/`.\n\
         - Look an API up before using it: the `docs_search` and `docs_read` tools of the `first` MCP server \
         (`.mcp.json`) answer from the documentation this compiler was built with.\n\
         - `first dev` runs the project on a local WordPress site; site commands such as `first find <kind>` read it.\n\n\
         ### Layout\n\n\
         - `first.config.ts`: `defineConfig`, the app's name and options.\n\
         - `first/`: kinds, actions and jobs, in any file; each registers under its export name.\n\
         - `first/app/`: pages (`page.tsx`, `layout.tsx`) and HTTP routes (`route.ts`), by folder.\n\
         - `first/_generated/`: migrations, types and the typed client. Written by `first build`.\n\
         - `first/dist/` and `.first/`: build output and the local dev site. Not committed.\n\n"
    );
    let kinds = project["kinds"].as_object().filter(|kinds| !kinds.is_empty());
    s.push_str("### Kinds\n\n");
    match kinds {
        None => s.push_str("None yet.\n\n"),
        Some(kinds) => {
            s.push_str("| Kind | Stored as | Read | Create | Update | Delete | API |\n|---|---|---|---|---|---|---|\n");
            for (kind, k) in kinds {
                let access = &k["access"];
                let _ = writeln!(
                    s,
                    "| `{kind}` | {} | {} | {} | {} | {} | `{api}/{}` |",
                    k["type"].as_str().unwrap_or_default(),
                    rule(&access["read"]),
                    rule(&access["create"]),
                    rule(&access["update"]),
                    rule(&access["delete"]),
                    k["path"].as_str().unwrap_or_default(),
                );
            }
            s.push('\n');
            for (kind, k) in kinds {
                let _ = writeln!(s, "- `{kind}`: {}", field_list(&k["fields"]));
            }
            s.push_str("\nA `?` marks an optional field. Every kind also has `id`.\n\n");
        }
    }
    if let Some(globals) = project["globals"].as_object().filter(|g| !g.is_empty()) {
        s.push_str("### Globals\n\n");
        for (global, g) in globals {
            let _ = writeln!(s, "- `{global}`: {}", field_list(&g["fields"]));
        }
        s.push('\n');
    }
    if let Some(actions) = project["actions"].as_object().filter(|a| !a.is_empty()) {
        s.push_str("### Actions\n\n| Action | Input | Access | Endpoint |\n|---|---|---|---|\n");
        for (action, a) in actions {
            let input = field_list(&a["input"]);
            let _ = writeln!(
                s,
                "| `{action}` | {} | {} | `{}` |",
                if input.is_empty() { "none" } else { &input },
                rule(&a["access"]),
                a["endpoint"].as_str().unwrap_or_default(),
            );
        }
        s.push('\n');
    }
    if let Some(jobs) = project["jobs"].as_object().filter(|j| !j.is_empty()) {
        s.push_str("### Jobs\n\n");
        for (job, j) in jobs {
            let input = field_list(&j["input"]);
            let _ = writeln!(
                s,
                "- `{job}`: input {}; retried up to {} times",
                if input.is_empty() { "none" } else { &input },
                j["retries"]
            );
        }
        s.push('\n');
    }
    if let Some(routes) = project["routes"].as_array().filter(|r| !r.is_empty()) {
        s.push_str("### Pages and routes\n\n| URL | Kind | File |\n|---|---|---|\n");
        for route in routes {
            let methods: Vec<&str> = route["methods"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .collect();
            let _ = writeln!(
                s,
                "| `{}` | {}{} | `{}` |",
                route["pattern"].as_str().unwrap_or_default(),
                route["type"].as_str().unwrap_or_default(),
                if methods.is_empty() {
                    String::new()
                } else {
                    format!(" ({})", methods.join(", "))
                },
                route["file"].as_str().unwrap_or_default(),
            );
        }
        s.push('\n');
    }
    let roles: Vec<&str> = project["roles"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let _ = write!(
        s,
        "### Roles\n\n{}. An access rule that names a role admits that role and every higher one; `anyone` needs no \
         sign-in.\n\n\
         ### Endpoints on a running site\n\n\
         - API: `{api}` (`GET {api}` describes the app).\n\
         - MCP, one tool per kind operation and action: `{}`.\n\
         - Abilities: `{}`.\n\n",
        roles.join(" < "),
        project["endpoints"]["mcp"].as_str().unwrap_or_default(),
        project["endpoints"]["abilities"].as_str().unwrap_or_default(),
    );
    let table: Value = serde_json::from_str(crate::cli::COMMANDS).expect("runtime/First/Cli/commands.json is JSON");
    for (group, title) in [
        ("build", "### Commands on the project's files"),
        (
            "site",
            "### Commands on a site\n\nThese run inside WordPress, on the local dev site unless `--site <dir | workspace | @alias>` names another.",
        ),
    ] {
        let _ = writeln!(s, "{title}\n");
        for row in table[group].as_array().into_iter().flatten() {
            let usage = format!(
                "first {} {}",
                row["name"].as_str().unwrap_or_default(),
                row["args"].as_str().unwrap_or_default()
            );
            let _ = writeln!(
                s,
                "- `{}`: {}",
                usage.trim_end(),
                row["summary"].as_str().unwrap_or_default()
            );
        }
        s.push('\n');
    }
    s.push_str("### Skills\n\n");
    for (path, text) in SKILLS.iter().filter(|(path, _)| path.ends_with("/SKILL.md")) {
        if let (Some(name), Some(description)) = front_matter(text) {
            let _ = writeln!(s, "- `{name}` (`{}/{path}`): {description}", SKILL_DIRS[0]);
        }
    }
    let _ = writeln!(s, "{END}");
    s
}

/// `AGENTS.md` with the section put in: in place of the one it has, or at the end.
fn with_section(current: Option<&str>, section: &str) -> Result<String, String> {
    let Some(current) = current else {
        return Ok(section.to_string());
    };
    match (current.find(BEGIN), current.find(END)) {
        (Some(begin), Some(end)) if begin < end => {
            let after = &current[end + END.len()..];
            Ok(format!(
                "{}{section}{}",
                &current[..begin],
                after.strip_prefix('\n').unwrap_or(after)
            ))
        }
        (None, None) => {
            let gap = if current.is_empty() || current.ends_with("\n\n") {
                ""
            } else if current.ends_with('\n') {
                "\n"
            } else {
                "\n\n"
            };
            Ok(format!("{current}{gap}{section}"))
        }
        _ => Err(format!(
            "AGENTS.md has one of the markers {BEGIN} and {END} without the other, or in the wrong order; restore the pair or delete both, then run first init again"
        )),
    }
}

/// `.mcp.json` with a `first` server, or `None` when it already has one.
fn with_server(current: Option<&str>) -> Result<Option<String>, String> {
    let mut config: Value = match current {
        None => json!({}),
        Some(text) => serde_json::from_str(text)
            .map_err(|e| format!(".mcp.json is not valid JSON ({e}); fix it, then run first init again"))?,
    };
    let servers = config
        .as_object_mut()
        .ok_or(".mcp.json is not a JSON object")?
        .entry("mcpServers")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or(".mcp.json: mcpServers is not an object")?;
    if servers.contains_key("first") {
        return Ok(None);
    }
    servers.insert("first".into(), mcp_server());
    Ok(Some(serde_json::to_string_pretty(&config).expect("json") + "\n"))
}

/// Every file `first init` would write that differs from what is there: (path relative to the
/// project, its new contents).
fn pending(project: &Path, described: &Value, github: bool) -> Result<Vec<(PathBuf, String)>, String> {
    let read = |rel: &Path| match std::fs::read_to_string(project.join(rel)) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", rel.display())),
    };
    let mut out = Vec::new();
    let agents = PathBuf::from("AGENTS.md");
    let current = read(&agents)?;
    let next = with_section(current.as_deref(), &section(described))?;
    if current.as_deref() != Some(next.as_str()) {
        out.push((agents, next));
    }
    let mcp = PathBuf::from(".mcp.json");
    if let Some(next) = with_server(read(&mcp)?.as_deref())? {
        out.push((mcp, next));
    }
    for dir in SKILL_DIRS {
        for (path, text) in SKILLS {
            let rel = Path::new(dir).join(path);
            if read(&rel)?.as_deref() != Some(*text) {
                out.push((rel, text.to_string()));
            }
        }
    }
    let dirs: Vec<String> = described["kinds"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(_, kind)| kind["sync"]["dir"].as_str().map(String::from))
        .collect();
    let (rel, text) = super::init_github::workflow(project, &dirs);
    let current = read(&rel)?;
    if super::init_github::managed(current.as_deref(), github) && current.as_deref() != Some(text.as_str()) {
        out.push((rel, text));
    }
    Ok(out)
}

/// A project that ran `first init` before: its `AGENTS.md` has the section, or its sync workflow
/// is the one `first init --github` wrote.
fn installed(project: &Path) -> bool {
    std::fs::read_to_string(project.join("AGENTS.md")).is_ok_and(|text| text.contains(BEGIN))
        || super::init_github::written(project)
}

/// The one line `first check` and `first build` print when a project's agent files no longer match
/// its config or this compiler. Nothing for a project that never ran `first init`.
pub(super) fn stale_hint(project: &Path, schema: &crate::schema::Schema) -> Option<String> {
    if !installed(project) {
        return None;
    }
    let pending = pending(project, &describe::project(schema), false).ok()?;
    let workflow = |(path, _): &(PathBuf, String)| path.ends_with(".github/workflows/first-sync.yml");
    let agents = std::fs::read_to_string(project.join("AGENTS.md")).is_ok_and(|text| text.contains(BEGIN));
    let mut stale = Vec::new();
    if agents && pending.iter().any(|p| !workflow(p)) {
        stale.push("AGENTS.md and the agent skills no longer match this project or this compiler");
    }
    if pending.iter().any(workflow) {
        stale.push(".github/workflows/first-sync.yml no longer matches this project's synced folders");
    }
    (!stale.is_empty()).then(|| format!("{}; run first init to update them", stale.join(", and ")))
}

pub(crate) fn cli(args: &[String]) -> ExitCode {
    let (mut project, mut check, mut github) = (PathBuf::from("."), false, false);
    for arg in args {
        match arg.as_str() {
            "--check" => check = true,
            "--github" => github = true,
            other if other.starts_with('-') => {
                eprintln!("unknown option {other} for first init\n{USAGE}");
                return ExitCode::from(2);
            }
            other => project = PathBuf::from(other),
        }
    }
    let project = match project.canonicalize() {
        Ok(project) => project,
        Err(error) => {
            eprintln!("{}: {error}\n{USAGE}", project.display());
            return ExitCode::from(2);
        }
    };
    if !project.join("first.config.ts").is_file() {
        eprintln!(
            "no first.config.ts in {}; first init adds the agent files to an existing project (npm create @spacefast/first <dir> creates one)",
            project.display()
        );
        return ExitCode::from(1);
    }
    // The section describes the compiled project, so a project that does not compile has none.
    let built = match build::build(&project, build::frozen(false)) {
        Ok(built) => built,
        Err(diagnostic) => {
            eprint!("{}", crate::diag::render(&diagnostic, &project));
            eprintln!("first init describes the compiled project; fix this, then run it again");
            return ExitCode::from(1);
        }
    };
    let pending = match pending(&project, &describe::project(&built.schema), github) {
        Ok(pending) => pending,
        Err(error) => {
            eprintln!("error: {error}");
            return ExitCode::from(1);
        }
    };
    if check {
        if pending.is_empty() {
            println!("ok: AGENTS.md, .mcp.json and the agent skills match this project");
            return ExitCode::SUCCESS;
        }
        for (path, _) in &pending {
            eprintln!("out of date: {}", path.display());
        }
        eprintln!("run first init to update them");
        return ExitCode::from(1);
    }
    for (path, text) in &pending {
        if let Err(error) = crate::sync::write_atomic(&project.join(path), text.as_bytes()) {
            eprintln!("error: {error}");
            return ExitCode::from(1);
        }
        println!("wrote {}", path.display());
    }
    if pending.is_empty() {
        println!("AGENTS.md, .mcp.json and the agent skills are up to date");
    }
    // Claude Code reads AGENTS.md only when the project has no CLAUDE.md of its own.
    if std::fs::read_to_string(project.join("CLAUDE.md")).is_ok_and(|text| !text.contains("AGENTS.md")) {
        println!("note: CLAUDE.md does not mention AGENTS.md; add the line @AGENTS.md to it so Claude Code reads both");
    }
    ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::{BEGIN, END, with_section, with_server};

    #[test]
    fn the_section_replaces_only_itself_and_is_appended_once() {
        let section = format!("{BEGIN}\nnew\n{END}\n");
        assert_eq!(with_section(None, &section).unwrap(), section);
        let appended = with_section(Some("# Mine\n\nKeep this."), &section).unwrap();
        assert_eq!(appended, format!("# Mine\n\nKeep this.\n\n{section}"));
        let replaced = with_section(Some(&format!("# Mine\n\n{BEGIN}\nold\n{END}\n\nAfter.\n")), &section).unwrap();
        assert_eq!(replaced, format!("# Mine\n\n{section}\nAfter.\n"));
        // Applying it again changes nothing.
        assert_eq!(with_section(Some(&replaced), &section).unwrap(), replaced);
        assert!(with_section(Some(&format!("{BEGIN}\nno end\n")), &section).is_err());
        assert!(with_section(Some(&format!("{END}\n{BEGIN}\n")), &section).is_err());
    }

    #[test]
    fn an_existing_first_server_and_every_other_server_are_kept() {
        let added = with_server(Some(r#"{"mcpServers":{"other":{"command":"x"}},"extra":1}"#))
            .unwrap()
            .unwrap();
        let config: serde_json::Value = serde_json::from_str(&added).unwrap();
        assert_eq!(config["mcpServers"]["other"]["command"], "x");
        assert_eq!(config["extra"], 1);
        assert_eq!(config["mcpServers"]["first"]["args"][2], "mcp");
        assert_eq!(
            with_server(Some(r#"{"mcpServers":{"first":{"command":"mine"}}}"#)).unwrap(),
            None
        );
        assert!(with_server(Some("{ not json")).is_err());
        assert!(with_server(Some("[]")).is_err());
    }
}
