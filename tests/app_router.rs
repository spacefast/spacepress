//! `first/app/` end to end (docs/spec/rendering.md §1–§3): the route conventions compile, the
//! generated `routes.d.ts` types links and params, and the router serves every page, layout,
//! guard, catch-all, handler and error state on a real WordPress (tests/php/app_router.php).
use std::path::{Path, PathBuf};
use std::process::Command;

fn first() -> Command {
    Command::new(env!("CARGO_BIN_EXE_first"))
}

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn fixture(name: &str, test: &str) -> PathBuf {
    let tmp = std::env::temp_dir().join(format!("first-{name}-{test}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures").join(name), &tmp);
    tmp
}

fn build(project: &Path) {
    let out = first().arg("build").arg(project).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
}

/// The router over HTTP: what each URL answers, as tests/php/app_router.php observes it.
#[test]
fn app_router_serves_pages_on_wordpress() {
    let project = fixture("app-router", "serve");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_router.php"))
        .arg(project.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value =
        serde_json::from_slice(&out.stdout).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out.stdout)));
    let page = |key: &str| -> (u64, String, String) {
        let p = &seen[key];
        (
            p["status"].as_u64().unwrap_or_else(|| panic!("{key}: {p}")),
            p["title"].as_str().unwrap_or_default().to_string(),
            p["body"].as_str().unwrap_or_default().to_string(),
        )
    };
    // The page renders inside its layout, with the layout's title template and its reads.
    let (status, title, body) = page("home");
    assert_eq!((status, title.as_str()), (200, "Home · Field Notes"));
    assert!(
        body.contains("<main><h1>Home</h1><ul><li>Hello</li></ul></main>"),
        "{body}"
    );
    assert_eq!(seen["home description"], true);
    assert_eq!(seen["home cache"][0], "private, no-store, max-age=0");
    // `<Link>` to a path on the site is the router region's navigation, loaded on the page.
    assert!(body.contains(r#"/notes" data-wp-interactive="first/router" data-wp-on--click="actions.navigate" data-wp-on--mouseenter="actions.prefetch">Notes</a>"#), "{body}");
    assert_eq!(seen["router module"], true);
    // Reads run as the visitor: the draft is missing for anonymous visitors, masked fields absent.
    assert_eq!(page("note").0, 200);
    assert!(
        page("note").2.contains("<article><h1>Hello</h1></article>"),
        "{}",
        page("note").2
    );
    assert_eq!(page("note").1, "Note hello · Field Notes");
    assert_eq!(seen["note canonical"], true);
    assert!(
        page("note as editor")
            .2
            .contains(r#"<aside class="secret">desk only</aside>"#)
    );
    // notFound(), an unpublished row and an unrouted URL all render not-found.tsx with a 404.
    for key in ["draft", "missing", "unrouted"] {
        let (status, title, body) = page(key);
        assert_eq!((status, title.as_str()), (404, "Not found · Field Notes"), "{key}");
        assert!(
            body.contains(r#"<h1 class="missing">No such page</h1>"#),
            "{key}: {body}"
        );
    }
    // Typed search params: parsed, defaulted, and a value the field refuses falls back.
    assert!(page("search").2.contains("page 3 q tea"));
    assert!(page("search defaults").2.contains("page 1 q none"));
    assert_eq!(seen["search noindex"], true);
    // A route group adds no segment; an optional catch-all matches its own folder and below.
    assert!(page("group").2.contains("<h1>About</h1>"));
    assert!(page("docs index").2.contains(r#"<p class="docs">index</p>"#));
    assert!(page("docs deep").2.contains(r#"<p class="docs">a &gt; b</p>"#));
    // A layout's guard: anonymous visitors go to the login page, a subscriber sees the page.
    assert_eq!(seen["guard anonymous"], serde_json::json!([302, true]));
    assert!(
        page("guard subscriber")
            .2
            .contains(r#"<section class="account"><h1>Your account</h1></section>"#)
    );
    // A render error: error.tsx with a 500, and the thrown message never reaches the page.
    let (status, _, body) = page("broken");
    assert_eq!(status, 500);
    assert!(body.contains("Something broke.") && !body.contains("hunter2"), "{body}");
    // route.ts, and a page's own POST handler.
    assert_eq!(seen["api"], serde_json::json!([200, "[\"Hello\"]"]));
    assert_eq!(seen["api method"], 405);
    assert_eq!(seen["page POST"], serde_json::json!([303, "/notes/hello?sent=1"]));
    assert_eq!(
        seen["page POST anonymous"], 401,
        "a page's handlers follow its `access`"
    );
    // A signed webhook route: refused without a valid HMAC, run as the system with one (it reads
    // the draft too).
    assert_eq!(
        (&seen["webhook unsigned"], &seen["webhook bad"]),
        (&serde_json::json!(401), &serde_json::json!(401))
    );
    // The system's read sees the draft too: 2 notes, where an anonymous visitor's sees 1.
    assert_eq!(seen["webhook"], serde_json::json!([202, "ping:2"]));
    assert_eq!(seen["HEAD"], serde_json::json!([200, ""]));
    // Markdown twins of app pages: the page's own output as Markdown (no layout navigation),
    // the same for every visitor, a 404 for an unpublished item and none for a guarded page.
    assert_eq!(
        seen["twin home"],
        serde_json::json!([200, "# Home\n\n- Hello\n", "text/markdown; charset=UTF-8"])
    );
    assert_eq!(seen["twin note"], serde_json::json!([200, "# Hello\n"]));
    assert_eq!(
        seen["twin note as editor"], "# Hello\n",
        "a twin never carries what only some viewers may read"
    );
    assert_eq!(
        (&seen["twin draft"], &seen["twin guarded"]),
        (&serde_json::json!(404), &serde_json::json!(404))
    );
    assert_eq!(seen["twin link"][1], true);
    assert!(
        seen["twin link"][0][0]
            .as_str()
            .unwrap()
            .ends_with("/notes/hello.md>; rel=\"alternate\"; type=\"text/markdown\"")
    );
    // /llms.txt lists the app's public static pages that render, titled from their twins.
    let llms = seen["llms"].as_str().unwrap();
    let pages = llms
        .split("## Site pages\n\n")
        .nth(1)
        .expect("a Site pages section")
        .split("\n\n")
        .next()
        .unwrap();
    let titles: Vec<&str> = pages
        .lines()
        .map(|l| l.split(']').next().unwrap().trim_start_matches("- ["))
        .collect();
    assert_eq!(titles, ["About", "Notes", "Home"], "{llms}");
    // WordPress keeps its own URLs.
    assert_eq!(seen["rest"], 200);
    assert_eq!(seen["feed"], 200);
    assert_eq!(seen["reserved"], false);
    let _ = std::fs::remove_dir_all(project);
}

/// `first build` writes `first/_generated/routes.d.ts`; with it, TypeScript checks every `<Link href>`
/// and `PageProps<"route">` against the app's own routes.
#[test]
fn generated_routes_type_links_and_params() {
    let project = fixture("app-router", "types");
    build(&project);
    let routes = std::fs::read_to_string(project.join("first/_generated/routes.d.ts")).unwrap();
    assert!(
        routes.contains(r#""notes/[slug]": { path: `/notes/${string}`; params: { slug: string } };"#),
        "{routes}"
    );
    let types = root().join("types/first");
    std::fs::write(
        project.join("tsconfig.json"),
        serde_json::json!({
            "compilerOptions": {
                "target": "ES2022", "lib": ["ES2022", "DOM"], "module": "ESNext", "moduleResolution": "bundler",
                "strict": true, "noEmit": true, "types": [], "jsx": "react-jsx", "jsxImportSource": "first",
                "allowImportingTsExtensions": true,
                "paths": {
                    "first": [types.join("index.d.ts")],
                    "first/*": [types.join("*.d.ts")],
                },
            },
            "include": ["first.config.ts", "first"],
        })
        .to_string(),
    )
    .unwrap();
    std::fs::write(
        project.join("first/app/_lib/links.tsx"),
        r#"import { Link, type PageProps } from "first/app";
export const ok = [<Link href="/notes/anything">x</Link>, <Link href="/docs">x</Link>, <Link href="/docs/a/b">x</Link>, <Link href="https://example.com">x</Link>];
// @ts-expect-error: no route serves /nowhere
export const missing = <Link href="/nowhere">x</Link>;
export function slug({ params }: PageProps<"notes/[slug]">): string {
  // @ts-expect-error: notes/[slug] binds `slug`, not `id`
  return params.id;
}
"#,
    )
    .unwrap();
    let tsc = Command::new("tsc")
        .arg("-p")
        .arg(&project)
        .output()
        .expect("tsc is required");
    assert!(tsc.status.success(), "{}", String::from_utf8_lossy(&tsc.stdout));
    let _ = std::fs::remove_dir_all(project);
}

fn rejects(dir: &Path, files: &[(&str, &str)], message: &str, at: &str) {
    let _ = std::fs::remove_dir_all(dir);
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(
        dir.join("first.config.ts"),
        "import { defineConfig } from \"first\";\nexport default defineConfig({});\n",
    )
    .unwrap();
    for (path, source) in files {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, source).unwrap();
    }
    let out = first().arg("check").arg(dir).output().unwrap();
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "{message}: should fail:\n{stderr}");
    assert!(stderr.contains(message), "expected {message:?} in:\n{stderr}");
    assert!(
        stderr.contains(&format!("--> {at}")),
        "expected location {at} in:\n{stderr}"
    );
}

/// Shapes the router can't serve, and route files that would silently do nothing, are build
/// errors at the file, with the fix.
#[test]
fn refuses_route_shapes_and_exports_with_a_fix() {
    let dir = std::env::temp_dir().join(format!("first-app-reject-{}", std::process::id()));
    let page = "export default function P() { return <p/>; }\n";
    rejects(
        &dir,
        &[("first/app/(a)/x/page.tsx", page), ("first/app/(b)/x/page.tsx", page)],
        "app/(b)/x/page.tsx and app/(a)/x/page.tsx both serve /x",
        "first/app/(b)/x/page.tsx",
    );
    rejects(
        &dir,
        &[
            ("first/app/blog/[id]/page.tsx", page),
            ("first/app/blog/[slug]/page.tsx", page),
        ],
        "both serve /blog/:",
        "first/app/blog/",
    );
    rejects(
        &dir,
        &[("first/app/post-[slug]/page.tsx", page)],
        "`post-[slug]` mixes text and a parameter",
        "first/app/post-[slug]",
    );
    rejects(
        &dir,
        &[("first/app/@modal/page.tsx", page)],
        "parallel route slot",
        "first/app/@modal",
    );
    rejects(
        &dir,
        &[("first/app/docs/[...rest]/more/page.tsx", page)],
        "more/ is below a catch-all segment",
        "first/app/docs/[...rest]/more",
    );
    rejects(
        &dir,
        &[("first/app/wp-admin/page.tsx", page)],
        "would shadow /wp-admin",
        "first/app/wp-admin",
    );
    rejects(
        &dir,
        &[("first/app/about/page.ts", "export default 1;\n")],
        "page.ts isn't a route file",
        "first/app/about/page.ts",
    );
    rejects(
        &dir,
        &[("first/app/about/loading.tsx", page)],
        "loading.tsx isn't a route file",
        "first/app/about/loading.tsx",
    );
    rejects(
        &dir,
        &[
            ("first/app/x/page.tsx", page),
            ("first/app/x/route.ts", "export async function GET() { return {}; }\n"),
        ],
        "has both page.tsx and route.ts",
        "first/app/x/route.ts",
    );
    rejects(
        &dir,
        &[("first/app/x/not-found.tsx", page)],
        "not-found.tsx works only at the root of first/app/",
        "first/app/x/not-found.tsx",
    );
    rejects(
        &dir,
        &[(
            "first/app/page.tsx",
            "export const metdata = { title: \"x\" };\nexport default function P() { return <p/>; }\n",
        )],
        "app/page.tsx can't export `metdata`",
        "first/app/page.tsx",
    );
    rejects(
        &dir,
        &[(
            "first/app/page.tsx",
            "export function Card() { return <p/>; }\nexport default function P() { return <Card/>; }\n",
        )],
        "move components into first/components/",
        "first/app/page.tsx",
    );
    rejects(
        &dir,
        &[("first/app/page.tsx", "export const metadata = { title: \"x\" };\n")],
        "needs a default-exported component",
        "first/app/page.tsx",
    );
    rejects(
        &dir,
        &[("first/app/blog/layout.tsx", page)],
        "app/blog/layout.tsx wraps no page",
        "first/app/blog/layout.tsx",
    );
    rejects(
        &dir,
        &[("first/app/api/route.ts", "export const x = 1;\n")],
        "can't export `x`",
        "first/app/api/route.ts",
    );
    rejects(
        &dir,
        &[(
            "first/app/api/route.ts",
            "export const access = \"anyone\";\nexport async function GET() { return { status: \"ok\" }; }\n",
        )],
        "GET in app/api/route.ts returns",
        "first/app/api/route.ts",
    );
    rejects(
        &dir,
        &[("first/app/api/route.ts", "export async function GET() { return {}; }\n")],
        "app/api/route.ts has HTTP handlers but no `access`",
        "first/app/api/route.ts",
    );
    rejects(
        &dir,
        &[(
            "first/app/api/route.ts",
            "import { env } from \"first\";\nexport const access = \"anyone\";\nexport const signature = { secret: env(\"S\"), header: \"x-sig\", scheme: \"hmac-sha256\" };\nexport async function POST() { return {}; }\n",
        )],
        "exports both `access` and `signature`",
        "first/app/api/route.ts",
    );
    rejects(
        &dir,
        &[(
            "first/app/page.tsx",
            "export const access = \"anyone\";\nexport default function P() { return <p/>; }\n",
        )],
        "exports `access` or `signature` but no HTTP handler",
        "first/app/page.tsx",
    );
    rejects(
        &dir,
        &[
            (
                "first/app/layout.tsx",
                "export const guard = \"members\";\nexport default function L({ children }: { children: JSX.Element }) { return <main>{children}</main>; }\n",
            ),
            ("first/app/page.tsx", page),
        ],
        "`guard` is",
        "first/app/layout.tsx",
    );
    rejects(
        &dir,
        &[(
            "first/app/page.tsx",
            "export const metadata = { title: 1 };\nexport default function P() { return <p/>; }\n",
        )],
        "`metadata.title` must be",
        "first/app/page.tsx",
    );
    rejects(
        &dir,
        &[(
            "first/app/page.tsx",
            "import { redirect } from \"first/app\";\nexport default function P() { redirect(\"javascript:alert(1)\"); }\n",
        )],
        "isn't a URL a page can redirect to",
        "first/app/page.tsx:2:",
    );
    rejects(
        &dir,
        &[(
            "first/app/page.tsx",
            "import { Link } from \"first/app\";\nexport default function P() { return <Link href=\"//evil.example\">x</Link>; }\n",
        )],
        "isn't a URL a link can point to",
        "first/app/page.tsx:2:",
    );
    let _ = std::fs::remove_dir_all(dir);
}

/// One variant of tests/fixtures/frontend-modes, built and served: what each URL answers.
fn modes(variant: &str, frontend: Option<&str>, app: bool) -> serde_json::Value {
    let project = fixture("frontend-modes", variant);
    if app {
        copy(&project.join("app/first/app"), &project.join("first/app"));
    }
    let _ = std::fs::remove_dir_all(project.join("app"));
    if let Some(frontend) = frontend {
        let config = project.join("first.config.ts");
        let text = std::fs::read_to_string(&config).unwrap();
        std::fs::write(
            &config,
            text.replace(
                r#"{ name: "modes" }"#,
                &format!(r#"{{ name: "modes", frontend: {frontend} }}"#),
            ),
        )
        .unwrap();
    }
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/frontend_modes.php"))
        .arg(project.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{variant}: {}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let _ = std::fs::remove_dir_all(project);
    serde_json::from_slice(&out.stdout)
        .unwrap_or_else(|_| panic!("{variant}: {}", String::from_utf8_lossy(&out.stdout)))
}

/// spec §2.7 and §5 on WordPress: a kind's `url` is how WordPress resolves and links its items in
/// every mode; with no first/app/ the theme renders them, a first/app/ page that matches the
/// pattern takes the URL over, `frontend: false` serves no public HTML, and an external frontend
/// gets every front-end URL. wp-admin's REST and feeds keep working throughout, and a slug change
/// (or a stale placeholder like a wrong year) 301s to the item's own URL.
#[test]
fn frontend_modes_on_wordpress() {
    let theme = modes("theme", None, false);
    assert_eq!(theme["note status"], 200, "{theme}");
    assert_eq!(
        (&theme["note by theme"], &theme["note by app"]),
        (&serde_json::json!(true), &serde_json::json!(false))
    );
    assert_eq!(theme["note body"], true);
    assert_eq!(theme["permalink"], "/notes/hello-note/");
    assert_eq!(theme["draft"], 404);
    assert_eq!(theme["missing note"], 404);
    assert_eq!(theme["journal"], 200);
    assert_eq!(
        theme["journal wrong year"],
        serde_json::json!([301, "/journal/2026/day-one/"])
    );
    assert_eq!(theme["renamed"], serde_json::json!([301, "/notes/renamed-note/"]));
    assert_eq!(theme["new url"], 200);
    assert_eq!(theme["about"][0], 404);
    assert_eq!(theme["home"], 200);

    let app = modes("app", None, true);
    assert_eq!(
        (&app["note status"], &app["note by app"], &app["note body"]),
        (
            &serde_json::json!(200),
            &serde_json::json!(true),
            &serde_json::json!(true)
        ),
        "{app}"
    );
    assert_eq!(app["draft"], 404);
    assert_eq!(app["missing note"], 404);
    assert_eq!(app["about"], serde_json::json!([200, true]));
    // A kind URL with no page of its own still renders with the theme.
    assert_eq!(app["journal"], 200);
    assert_eq!(app["renamed"], serde_json::json!([301, "/notes/renamed-note/"]));
    // WordPress's own post URLs keep working.
    assert_eq!(app["post"], serde_json::json!([301, "/hello-world/"]));

    let off = modes("off", Some("false"), false);
    for key in ["note status", "journal", "home", "draft"] {
        assert_eq!(off[key], 404, "{key}: {off}");
    }
    assert_eq!(off["permalink"], "/notes/hello-note/");

    let external = modes("external", Some(r#""https://front.example""#), false);
    assert_eq!(
        external["permalink"], "https://front.example/notes/hello-note/",
        "{external}"
    );
    assert_eq!(external["note status"], 308);
    assert_eq!(external["post"][0], 308);

    for (name, mode) in [("theme", &theme), ("app", &app), ("off", &off), ("external", &external)] {
        assert_eq!(
            (&mode["rest"], &mode["rest note"], &mode["feed"]),
            (
                &serde_json::json!(200),
                &serde_json::json!(200),
                &serde_json::json!(200)
            ),
            "{name}: {mode}"
        );
    }
}
