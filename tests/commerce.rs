//! The declared commerce surface, scaffold and native Woo runtime on WordPress/SQLite.
#![cfg(feature = "cli")]
use std::path::Path;
use std::process::{Command, Output};

fn cli(command: &str, project: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_typedpress"))
        .arg(command)
        .arg(project)
        .output()
        .unwrap()
}
fn success(out: Output) -> Output {
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    out
}
#[test]
fn commerce_is_declared_by_exports_and_rejects_unsupported_settings() {
    let project = tempfile::tempdir().unwrap();
    for (exports, error) in [
        (
            "export const shop = store({currency:'EUR',country:'PL',shipping:[{name:' Poland ',countries:['PL'],methods:[]}]});",
            "shipping zone names cannot start or end with whitespace",
        ),
        (
            "export const shop = store({currency:'EUR',country:'PL',shipping:[{name:'0',countries:['PL'],methods:[]}]});",
            "a named shipping zone cannot be called 0",
        ),
        (
            "export const shop = store({currency:'EUR',country:'PL',shipping:[{name:'North  America',countries:['US'],methods:[]}]});",
            "shipping zone name contains formatting",
        ),
        (
            r"export const shop = store({currency:'EUR',country:'PL',shipping:[{name:'\u0000Europe',countries:['PL'],methods:[]}]});",
            "shipping zone name contains formatting",
        ),
        (
            r"export const shop = store({currency:'EUR',country:'PL',shipping:[{name:'Europe\u0000',countries:['PL'],methods:[]}]});",
            "shipping zone name contains formatting",
        ),
        ("export const products = product();", "require an exported store()"),
        (
            "export const a = store({currency:'EUR',country:'PL'}); export const b = store({currency:'EUR',country:'PL'});",
            "at most one store()",
        ),
        (
            "export const shop = store({currency:'XYZ',country:'PL'});",
            "unknown currency",
        ),
        (
            "export const shop = store({currency:'EUR',country:'XX'});",
            "unknown country",
        ),
        (
            "export const shop = store({currency:'EUR',country:'PL',taxes:true});",
            "no option `taxes`",
        ),
        (
            "export const shop = store({currency:'EUR',country:'PL',shipping:[{name:'PL',countries:['PL'],methods:[{type:'flatRate',title:'Post',cost:15}]}]});",
            "exact decimal string",
        ),
        (
            "export const shop = store({currency:'EUR',country:'PL'}); export const products=product({access:{read:'anyone'}});",
            "no option `access`",
        ),
        (
            "export const shop = store({currency:'EUR',country:'PL'}); export const a=product(); export const b=product();",
            "at most one product()",
        ),
        (
            "export const shop = store({currency:'EUR',country:'PL'}); export const orders=order({api:{create:true}});",
            "read-only",
        ),
        (
            "export const shop = store({currency:'EUR',country:'PL'}); export const inventory=table({name:text()},{storageName:'store'});",
            "store is reserved",
        ),
        (
            "export const shop = store({currency:'EUR',country:'PL'}); export const products=product({sync:'content/products/**/*.md'});",
            "needs a hierarchical kind",
        ),
        (
            "export const shop = store({currency:'EUR',country:'PL'}); export const tags=productTag({sync:'content/tags/**/*.md'});",
            "needs a hierarchical kind",
        ),
    ] {
        std::fs::write(project.path().join("typedpress.config.ts"), format!("import {{defineConfig,store,product,productTag,order,table,text}} from 'typedpress'; {exports} export default defineConfig({{name:'commerce'}});")).unwrap();
        let out = cli("check", project.path());
        assert!(!out.status.success(), "accepted {exports}");
        assert!(
            String::from_utf8_lossy(&out.stderr).contains(error),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
}
#[test]
fn a_sql_table_cannot_become_a_commerce_kind_of_the_same_name() {
    let project = tempfile::tempdir().unwrap();
    let config = |exports: &str| {
        std::fs::write(project.path().join("typedpress.config.ts"), format!("import {{defineConfig,store,product,table,text}} from 'typedpress'; {exports} export default defineConfig({{name:'commerce'}});")).unwrap();
    };
    config("export const products = table({name:text()});");
    success(cli("build", project.path()));
    let ledger = project.path().join("tp/_generated/migrations");
    let deployed = std::fs::read_dir(&ledger).unwrap().count();
    config("export const shop = store({currency:'EUR',country:'PL'}); export const products = product();");
    for command in ["check", "build"] {
        let out = cli(command, project.path());
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(!out.status.success(), "{command} accepted the replacement");
        assert!(
            stderr.contains("`products` is stored as a SQL table, and product() is always WooCommerce storage"),
            "{stderr}"
        );
        assert_eq!(
            std::fs::read_dir(&ledger).unwrap().count(),
            deployed,
            "{command} wrote a migration"
        );
    }
}
#[test]
fn commerce_references_names_and_existing_store_scaffolding() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(
        project.path().join("typedpress.config.ts"),
        r#"
import {defineConfig,store,product,productCategory,order,table,ref,text,query,db} from 'typedpress';
export const shop=store({currency:'USD',country:'PL',shipping:[{name:'Rest  of world',countries:'rest',methods:[]}]});
export const catalogItems=product();
export const categories=productCategory();
export const orders=order();
export const wooCarts=table({name:text()});
export const links=table({product:ref(catalogItems),order:ref(()=>orders)});
export const catalog=query({access:'anyone'},async()=>await db.query.categories.findMany({with:{catalogItems:true}}));
export default defineConfig({name:'commerce'});
"#,
    )
    .unwrap();
    success(cli("build", project.path()));
    let types = std::fs::read_to_string(project.path().join("tp/_generated/client/types.ts")).unwrap();
    assert!(
        types.contains("interface WooCartRow"),
        "commerce runtime names must not merge with collection types"
    );
    for file in std::fs::read_dir(project.path().join("tp/_generated/migrations")).unwrap() {
        let file = file.unwrap().path();
        if file.extension().is_some_and(|x| x == "sql") {
            let sql = std::fs::read_to_string(file).unwrap();
            assert!(!sql.contains("REFERENCES `{prefix}tp_catalog_items`"));
            assert!(!sql.contains("REFERENCES `{prefix}tp_orders`"));
        }
    }
    // An existing store outside tp/shop.ts must not acquire imports to that absent module.
    let config = project.path().join("typedpress.config.ts");
    let source = std::fs::read_to_string(&config)
        .unwrap()
        .replace("catalogItems", "products");
    std::fs::write(&config, source).unwrap();
    success(
        Command::new(env!("CARGO_BIN_EXE_typedpress"))
            .args(["add", "shop"])
            .arg(project.path())
            .output()
            .unwrap(),
    );
    assert!(!project.path().join("tp/shop.ts").exists());
    assert!(!project.path().join("tp/app/(shop)/shop/page.tsx").exists());
    for sync in ["true", "{dir:'content/topics'}"] {
        std::fs::write(&config,format!("import {{defineConfig,taxonomy}} from 'typedpress';export const topics=taxonomy({{}},{{sync:{sync}}});export default defineConfig({{name:'commerce'}});")).unwrap();
        let out = cli("check", project.path());
        assert!(!out.status.success());
        assert!(
            String::from_utf8_lossy(&out.stderr).contains("sync must be"),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
}
#[test]
fn added_shop_compiles_and_runs_on_native_woo_without_a_second_commerce_database() {
    let project = tempfile::tempdir().unwrap();
    std::fs::write(
        project.path().join("typedpress.config.ts"),
        "import {defineConfig} from 'typedpress'; export default defineConfig({name:'shop'});",
    )
    .unwrap();
    std::fs::create_dir_all(project.path().join("tp/app")).unwrap();
    let layout =
        "export default function Layout({children}) { return <section data-existing=\"yes\">{children}</section>; }";
    std::fs::write(project.path().join("tp/app/layout.tsx"), layout).unwrap();
    std::fs::write(
        project.path().join("tp/app/page.tsx"),
        "export default function Home() { return <main>Existing app</main>; }",
    )
    .unwrap();
    let add = || {
        Command::new(env!("CARGO_BIN_EXE_typedpress"))
            .args(["add", "shop"])
            .arg(project.path())
            .output()
            .unwrap()
    };
    success(add());
    let checkout = project.path().join("tp/app/(shop)/checkout/page.md");
    let checkout_body = std::fs::read_to_string(&checkout).unwrap();
    std::fs::write(
        &checkout,
        checkout_body.replace("woocommerce/checkout", "woocommerce/checkout-fields"),
    )
    .unwrap();
    let refused = cli("check", project.path());
    assert!(!refused.status.success());
    assert!(String::from_utf8_lossy(&refused.stderr).contains("native Checkout Block"));
    std::fs::write(checkout, checkout_body).unwrap();
    assert_eq!(
        std::fs::read_to_string(project.path().join("tp/app/layout.tsx")).unwrap(),
        layout
    );
    assert!(project.path().join("tp/app/(shop)/layout.tsx").is_file());
    let product = project.path().join("content/products/ceramic-mug.md");
    let original = std::fs::read(&product).unwrap();
    success(add());
    assert_eq!(std::fs::read(&product).unwrap(), original);
    let shop = project.path().join("tp/shop.ts");
    let source = std::fs::read_to_string(&shop).unwrap();
    let duplicate = source.replace(r#"countries: ["PL"]"#, r#"countries: ["PL", "PL"]"#);
    assert_ne!(source, duplicate);
    std::fs::write(shop, duplicate).unwrap();
    success(cli("build", project.path()));
    let mig_dir = project.path().join("tp/_generated/migrations");
    assert!(
        !mig_dir.exists() || std::fs::read_dir(&mig_dir).unwrap().next().is_none(),
        "Woo owns all commerce storage: no SQL migrations should be emitted"
    );
    let manifest: serde_json::Value = serde_json::from_slice(
        &std::fs::read(project.path().join("tp/dist/wp-content/typedpress-manifest.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(manifest["requires"]["woocommerce"], ">=11.3.0");
    std::fs::write(project.path().join("insert.ts"), "import type {RegisteredKinds} from 'typedpress'; const input:RegisteredKinds['products']['$inferInsert']={name:'New product'}; const name:string=input.name;").unwrap();
    std::fs::write(project.path().join("tsconfig.json"), serde_json::to_vec(&serde_json::json!({"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"bundler","strict":true,"noEmit":true,"types":[],"paths":{"typedpress":[Path::new(env!("CARGO_MANIFEST_DIR")).join("types/typedpress/index.d.ts")]}},"include":["insert.ts","tp/_generated/db.d.ts"]})).unwrap()).unwrap();
    success(
        Command::new(std::env::var("TSC").unwrap_or_else(|_| "tsc".into()))
            .arg("-p")
            .arg(project.path())
            .output()
            .expect("tsc must be installed for generated insert contracts"),
    );
    let out = Command::new("php")
        .args(["-d", "memory_limit=1G"])
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/php/commerce_test.php"))
        .arg(project.path().join("tp/dist/wp-content"))
        .output()
        .unwrap();
    success(out);
}
