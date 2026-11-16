//! The services authoring boundary owns rejection diagnostics and one compiled WordPress journey.
#![cfg(feature = "cli")]

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn success(output: Output) -> Output {
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

#[test]
fn invalid_service_definitions_report_the_authored_property() {
    let project = tempfile::Builder::new()
        .prefix("typedpress-services-errors-")
        .tempdir()
        .unwrap();
    let cases = [
        (
            "forms: { contact: { fields: { email: { type: 'email' } }, recipient: 'literal@example.test', sender: env('SENDER') } }",
            "services.forms.contact.recipient: must be env",
            "recipient",
        ),
        (
            "forms: { contact: { fields: { email: { type: 'url' } }, recipient: env('TO'), sender: env('FROM') } }",
            "supported form types",
            "type",
        ),
        (
            "forms: { contact: { fields: { message: { type: 'text', rules: { min: -1 } } }, recipient: env('TO'), sender: env('FROM') } }",
            "rules.min: must be an integer from 0",
            "min",
        ),
        (
            "forms: { contact: { fields: { message: { type: 'integer', rules: { min: 5, max: 2 } } }, recipient: env('TO'), sender: env('FROM') } }",
            "min must be less than or equal to max",
            "rules",
        ),
        (
            "forms: { contact: { fields: { ok: { type: 'boolean', rules: { max: 1 } } }, recipient: env('TO'), sender: env('FROM') } }",
            "boolean fields have no min/max",
            "rules",
        ),
        (
            "forms: { contact: { fields: {}, recipient: env('TO'), sender: env('FROM') } }",
            "fields: must contain at least one entry",
            "fields",
        ),
        (
            "forms: { contact: { fields: { email: { type: 'email' } }, recipient: env('TO'), sender: env('FROM'), limit: 101 } }",
            "limit: must be an integer from 1 to 100",
            "limit",
        ),
        (
            "products: { workshop: { name: 'Workshop', amount: 19.5, currency: 'usd' } }, checkoutReturnUrl: 'https://example.test'",
            "amount: must be an integer",
            "amount",
        ),
        (
            "products: { workshop: { name: 'Workshop', amount: 1900, currency: 'USD' } }, checkoutReturnUrl: 'https://example.test'",
            "currency: must be three lowercase",
            "currency",
        ),
        (
            "products: { workshop: { name: 'Workshop', amount: 1900, currency: 'usd' } }, checkoutReturnUrl: 'javascript:alert(1)'",
            "checkoutReturnUrl: must be an absolute HTTP(S)",
            "checkoutReturnUrl",
        ),
        (
            "products: { workshop: { name: 'Workshop', amount: 1900, currency: 'usd' } }",
            "configure products and checkoutReturnUrl together",
            "services",
        ),
        (
            "search: { missing: ['title'] }",
            "search.missing: unknown collection key",
            "missing",
        ),
        (
            "search: { unpublished: ['title'] }",
            "search requires a publication-enabled collection",
            "unpublished",
        ),
        (
            "search: { articles: ['missing'] }",
            "`missing` must name a searchable text column",
            "articles",
        ),
        (
            "search: { articles: ['status'] }",
            "`status` must name a searchable text column",
            "articles",
        ),
        (
            "search: { articles: ['title', 'title'] }",
            "duplicate search field `title`",
            "articles",
        ),
        ("forms: {}, forms: {}", "services.forms: duplicate declaration", "forms"),
        (
            "stripeSecret: env('STRIPE_SECRET')",
            "services.stripeSecret: unknown option",
            "stripeSecret",
        ),
    ];
    for (services, message, property) in cases {
        let source = format!(
            "import {{ collection, defineConfig, env, table, text, ServicesConfig }} from 'typedpress';\nconst articles = collection({{ title: text() }}, {{ title: 'title', drafts: true }});\nconst unpublished = table({{ title: text() }});\nexport {{ articles }}; export {{ unpublished }}; export default defineConfig({{ services: {{ {services} }} satisfies ServicesConfig }});\n"
        );
        let entry = project.path().join("typedpress.config.ts");
        std::fs::write(&entry, &source).unwrap();
        let program = typedpress::loader::load(&entry).unwrap();
        let error = match typedpress::pipeline::build(
            project.path(),
            &program,
            || Ok(typedpress::pipeline::Previous::none()),
            |_| None,
        ) {
            Err(error) => error,
            Ok(_) => panic!("accepted invalid services: {services}"),
        };
        assert!(error.message.contains(message), "{services}: {error:?}");
        assert_eq!(error.span.file, program.modules[program.entry].file);
        assert!(
            error.message.contains(property),
            "expected the diagnostic to name {property}: {error:?}"
        );
        assert_eq!(source[..error.span.start as usize].lines().count(), 4, "{error:?}");
    }
}

fn write_types_project(project: &Path) {
    std::fs::write(
        project.join("tsconfig.json"),
        serde_json::json!({
            "compilerOptions": {
                "strict": true, "noEmit": true, "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
                "paths": { "typedpress": [root().join("types/typedpress/index.d.ts")] }
            },
            "files": ["typedpress.config.ts", "types-test.ts"]
        })
        .to_string(),
    )
    .unwrap();
    std::fs::write(project.join("types-test.ts"), r#"
import { env, type ServicesConfig, type ServiceFormField } from "typedpress";
const field: ServiceFormField = { type: "integer", rules: { min: -10, max: 10 } };
const config: ServicesConfig = { forms: { contact: { fields: { age: field }, recipient: env("TO"), sender: env("FROM") } } };
// @ts-expect-error addresses must be runtime env references
const literal: ServicesConfig = { forms: { contact: { fields: { age: field }, recipient: "private@example.test", sender: env("FROM") } } };
// @ts-expect-error boolean fields do not have numeric rules
const boolean: ServiceFormField = { type: "boolean", rules: { max: 1 } };
// @ts-expect-error checkout requires an application-owned return URL
const checkout: ServicesConfig = { products: { workshop: { name: "Workshop", amount: 1900, currency: "usd" } } };
void config; void literal; void boolean; void checkout;
"#).unwrap();
}

#[test]
fn ts_config_emits_a_private_plugin_that_uses_the_native_services_runtime() {
    let project = tempfile::Builder::new()
        .prefix("typedpress-ts-services-app-")
        .tempdir()
        .unwrap();
    std::fs::write(
        project.path().join("typedpress.config.ts"),
        include_str!("../examples/app-services-ts/typedpress.config.ts"),
    )
    .unwrap();
    write_types_project(project.path());
    success(
        Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
            .args(["--project"])
            .arg(project.path().join("tsconfig.json"))
            .output()
            .unwrap(),
    );
    success(
        Command::new(env!("CARGO_BIN_EXE_typedpress"))
            .arg("build")
            .arg(project.path())
            .env("APP_SERVICES_RECIPIENT", "build-only-value@example.test")
            .env("APP_SERVICES_SENDER", "build-only-sender@example.test")
            .output()
            .unwrap(),
    );
    let client = success(
        Command::new("node")
            .args([
                "--experimental-strip-types",
                "--input-type=module",
                "--eval",
                "import { SCHEMA } from './tp/_generated/client/schema.ts'; console.log(JSON.stringify(SCHEMA));",
            ])
            .current_dir(project.path())
            .output()
            .unwrap(),
    );
    let client: serde_json::Value = serde_json::from_slice(&client.stdout).unwrap();
    assert_eq!(
        client.get("services"),
        None,
        "private services must not become client descriptors"
    );
    let evidence = std::env::var_os("TP_SERVICES_TS_EVIDENCE")
        .map(PathBuf::from)
        .unwrap_or_else(|| project.path().join("evidence"));
    let output = success(
        Command::new("php")
            .arg(root().join("examples/app-services-ts/journey.php"))
            .arg(project.path().join("tp/dist/wp-content"))
            .arg(&evidence)
            .env(
                "TP_WP_CACHE",
                std::env::var_os("TP_WP_CACHE").unwrap_or_else(|| project.path().join("wp-cache").into_os_string()),
            )
            .env_remove("TP_WP_KEEP")
            .output()
            .unwrap(),
    );
    println!("{}", String::from_utf8_lossy(&output.stdout));
    let result: serde_json::Value =
        serde_json::from_slice(&std::fs::read(evidence.join("result.json")).unwrap()).unwrap();
    assert_eq!(result["cleanup"]["siteRemoved"], true);
    assert_eq!(result["cleanup"]["smtpStopped"], true);
}
