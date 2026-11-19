//! The runnable public API and every registered route of examples/kitchen-sink.
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Command;

use oxc_allocator::Allocator;
use oxc_ast::ast::{ImportDeclarationSpecifier, Statement};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use regex::Regex;

const ROOT: &str = env!("CARGO_MANIFEST_DIR");

fn files(dir: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        if matches!(entry.file_name().to_str(), Some("dist" | ".tp" | "node_modules")) {
            continue;
        }
        if entry.file_type().unwrap().is_dir() {
            paths.extend(files(&entry.path()));
        } else {
            paths.push(entry.path());
        }
    }
    paths
}

#[test]
fn kitchen_sink_exercises_public_api() {
    let root = Path::new(ROOT);
    let app = root.join("examples/kitchen-sink");
    let mut used = BTreeMap::<String, BTreeSet<String>>::new();
    let mut authored = String::new();
    let files = files(&app);
    for path in &files {
        if path.components().any(|part| part.as_os_str() == "_generated") {
            continue;
        }
        if !matches!(path.extension().and_then(|e| e.to_str()), Some("ts" | "tsx")) {
            continue;
        }
        let source = std::fs::read_to_string(path).unwrap();
        authored.push_str(&source);
        authored.push('\n');
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &source, SourceType::from_path(path).unwrap()).parse();
        assert!(parsed.diagnostics.is_empty(), "{}", path.display());
        let semantic = SemanticBuilder::new().build(&parsed.program).semantic;
        for stmt in &parsed.program.body {
            let Statement::ImportDeclaration(import) = stmt else {
                continue;
            };
            for specifier in import.specifiers.iter().flatten() {
                let ImportDeclarationSpecifier::ImportSpecifier(specifier) = specifier else {
                    continue;
                };
                let symbol = specifier.local.symbol_id.get().unwrap();
                if semantic
                    .scoping()
                    .get_resolved_reference_ids(symbol)
                    .iter()
                    .any(|id| semantic.scoping().get_reference(*id).flags().is_value())
                {
                    used.entry(import.source.value.as_str().unwrap().to_owned())
                        .or_default()
                        .insert(specifier.imported.name().to_string());
                }
            }
        }
    }

    // Type declarations are erased. JSX runtime exports are called by the JSX transform.
    let value_export = Regex::new(r"(?m)^export (?:declare )?(?:function|class|const|let|var|enum) (\w+)").unwrap();
    let mut missing = Vec::new();
    for (module, declaration) in [
        ("typedpress", "index.d.ts"),
        ("typedpress/app", "app.d.ts"),
        ("typedpress/client", "client.d.ts"),
        ("typedpress/content", "content.d.ts"),
    ] {
        let source = std::fs::read_to_string(root.join("types/typedpress").join(declaration)).unwrap();
        for name in value_export.captures_iter(&source).map(|cap| cap[1].to_owned()) {
            if !used.get(module).is_some_and(|names| names.contains(&name)) {
                missing.push(format!("{module}::{name}"));
            }
        }
    }
    for name in typedpress::app::EXPORTS {
        if !used["typedpress/app"].contains(*name) {
            missing.push(format!("typedpress/app::{name}"));
        }
    }

    let declaration = include_str!("../types/typedpress/index.d.ts");
    let builders = declaration
        .split_once("export interface ColumnBuilder<")
        .unwrap()
        .1
        .split_once("export type AnyColumnBuilder")
        .unwrap()
        .0;
    let method = Regex::new(r"(?m)^  (\$?\w+)\(").unwrap();
    for method in method.captures_iter(builders).map(|cap| cap[1].to_owned()) {
        // Locales are disabled in normal builds.
        if method == "localized" {
            continue;
        }
        let call = format!(r"\.{}\s*\(", regex::escape(&method));
        if !Regex::new(&call).unwrap().is_match(&authored) {
            missing.push(format!("ColumnBuilder::{method}"));
        }
    }

    for file in ["layout.tsx", "login.tsx", "not-found.tsx", "error.tsx"] {
        if !app.join("tp/app").join(file).is_file() {
            missing.push(format!("tp/app/{file}"));
        }
    }
    let app_root = app.join("tp/app");
    for file in ["page.md", "route.ts"] {
        if !files
            .iter()
            .any(|p| p.starts_with(&app_root) && p.file_name().is_some_and(|name| name == file))
        {
            missing.push(format!("tp/app/**/{file}"));
        }
    }
    for feature in typedpress::app::allowed_exports("page.tsx") {
        match *feature {
            "default" => continue, // The route build and HTTP checks exercise every default export.
            "PUT" | "PATCH" | "DELETE" => continue, // GET and POST already exercise the HTTP handler compiler.
            _ => {}
        }
        let feature_export = Regex::new(&format!(r"(?m)^export (?:const |(?:async )?function ){feature}\b")).unwrap();
        if !feature_export.is_match(&authored) {
            missing.push(format!("page export {feature}"));
        }
    }
    // Global static output cannot contain protected or request-time pages. The visit page uses
    // staticParams and prerender so the same app still exercises static rendering on WordPress.
    assert!(missing.is_empty(), "kitchen sink is missing {}", missing.join(", "));
}

#[test]
fn kitchen_sink_renders_every_route_on_wordpress() {
    let root = Path::new(ROOT);
    let example = root.join("examples/kitchen-sink");
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("kitchen-sink");
    for path in files(&example) {
        let target = project.join(path.strip_prefix(&example).unwrap());
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::copy(path, target).unwrap();
    }
    let out = temp.path().join("wp-content");
    let build = Command::new(env!("CARGO_BIN_EXE_typedpress"))
        .arg("build")
        .arg(&project)
        .arg("--out")
        .arg(&out)
        .env_remove("TYPEDPRESS_LOCALES")
        .output()
        .unwrap();
    assert!(build.status.success(), "{}", String::from_utf8_lossy(&build.stderr));

    let runtime = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root.join("tests/php/kitchen_sink.php"))
        .arg(&out)
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    println!("{}", String::from_utf8_lossy(&runtime.stdout));
    assert!(runtime.status.success(), "{}", String::from_utf8_lossy(&runtime.stderr));
}
