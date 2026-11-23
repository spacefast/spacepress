//! `tp/app/` end to end (docs/spec/rendering.md §1–§3): the route conventions compile, the
//! generated `routes.d.ts` types links and params, and the router serves every page, layout,
//! guard, catch-all, handler and error state on a real WordPress (tests/php/app_router.php).
use std::path::{Path, PathBuf};
use std::process::Command;

fn first() -> Command {
    Command::new(env!("CARGO_BIN_EXE_typedpress"))
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
    let tmp = std::env::temp_dir().join(format!("typedpress-{name}-{test}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures").join(name), &tmp);
    tmp
}

fn build(project: &Path) {
    let out = first().arg("build").arg(project).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
}

#[test]
fn guarded_home_links_and_item_moves_respect_wordpress_boundaries() {
    let project = tempfile::tempdir().unwrap();
    let project = project.path();
    for (file, source) in [
        (
            "typedpress.config.ts",
            r#"import { collection, defineConfig, slug, text } from "typedpress";
export const notes = collection({ title: text(), slug: slug({ source: "title" }).optional() }, {
  title: "title", url: "/notes/:slug",
});
export default defineConfig({ name: "guardboundaries", admin: false });"#,
        ),
        (
            "tp/app/page.tsx",
            r#"export const guard = "subscriber";
export default function Home() { return <p>Signed-in home</p>; }"#,
        ),
        (
            "tp/app/links/page.tsx",
            r#"import { Link } from "typedpress/app";
export default function Links() {
  return <main>
    <Link href="/?s=drives" prefetch={undefined} requireAuth={undefined}>Search</Link>
    <Link href="/?p=1#article" prefetch>Post</Link>
    <Link href="/?feed=rss2" prefetch>Feed</Link>
    <Link href="/?view=compact#section" prefetch>App</Link>
  </main>;
}"#,
        ),
        (
            "tp/app/notes/[slug]/page.tsx",
            r#"export const guard = ({ user }) => user === null;
export default function Note() { return <p>Guarded public preview</p>; }"#,
        ),
    ] {
        let path = project.join(file);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, source).unwrap();
    }
    build(project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/guarded_links_and_moves.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
}

/// The router over HTTP: what each URL answers, as tests/php/app_router.php observes it.
#[test]
fn app_router_serves_pages_on_wordpress() {
    let project = fixture("app-router", "serve");
    copy(
        &root().join("tests/fixtures/page-access/tp/app"),
        &project.join("tp/app"),
    );
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_router.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
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
    let access = &seen["page access"];
    for (link, path) in [
        ("Office", "/office/?view=todo#queue"),
        ("Archive", "/members/archive/2026/"),
        ("Tools", "/members/tools/"),
    ] {
        assert_eq!(
            access["links"]["guest"][link],
            serde_json::json!([access["login"][link], false, false])
        );
        for viewer in ["reader", "admin"] {
            assert_eq!(
                access["links"][viewer][link],
                serde_json::json!([format!("{}{path}", seen["base"].as_str().unwrap()), true, true])
            );
        }
    }
    for viewer in ["guest", "reader", "admin"] {
        for (link, path) in [
            ("Guests", "/guest/"),
            ("Notes list", "/notes/"),
            ("Onboarding", "/onboarding/"),
        ] {
            assert_eq!(
                access["links"][viewer][link],
                serde_json::json!([format!("{}{path}", seen["base"].as_str().unwrap()), true, true])
            );
        }
    }
    for (page, statuses) in [
        ("Office records", [302, 403, 200]),
        ("Member archive", [302, 200, 200]),
        ("Admin tools", [302, 403, 200]),
        ("Admin onboarding", [302, 403, 200]),
        ("Guest preview", [200, 403, 403]),
        ("Checkout", [302, 403, 200]),
        ("Signed desk", [302, 403, 200]),
    ] {
        for (viewer, status) in ["guest", "reader", "admin"].into_iter().zip(statuses) {
            assert_eq!(
                access["pages"][viewer][page],
                serde_json::json!([status, status == 200]),
                "{viewer} {page}"
            );
        }
    }
    assert_eq!(access["direct login"][0], access["direct login"][1]);
    assert_eq!(
        access["guard redirect"],
        format!("{}/guest/", seen["base"].as_str().unwrap())
    );
    assert_eq!(access["private pages"], serde_json::json!(["private", "private"]));
    for (viewer, status, post_status) in [("guest", 401, 401), ("reader", 403, 201), ("admin", 200, 201)] {
        assert_eq!(
            access["queue"][viewer],
            serde_json::json!([status, status == 200]),
            "{viewer}"
        );
        assert_eq!(
            access["checkout POST"][viewer],
            serde_json::json!([post_status, post_status == 201]),
            "{viewer}"
        );
    }
    assert_eq!(
        access["signed POST"],
        serde_json::json!({
            "unsigned": [401, false], "unsigned admin": [401, false], "wrong": [401, false], "signed": [202, true]
        })
    );
    assert_eq!(access["checkout without nonce"], 401);
    assert_eq!(access["private twin"], 404);
    assert_eq!(access["live"]["guest"], serde_json::json!([401, false]));
    assert_eq!(access["live"]["reader"], serde_json::json!([403, false]));
    assert_eq!(access["live"]["admin"], serde_json::json!([200, true]));
    assert_eq!(access["tools POST"]["guest"], serde_json::json!([401, false]));
    assert_eq!(access["tools POST"]["reader"], serde_json::json!([200, true]));
    assert_eq!(access["tools POST"]["admin"], serde_json::json!([200, true]));
    assert_eq!(access["guest cache"], "private, no-store, max-age=0");
    // The page renders inside its layout, with the layout's title template and its reads.
    let (status, title, body) = page("home");
    assert_eq!((status, title.as_str()), (200, "Home · Field Notes"));
    assert!(
        body.contains("<main><h1>Home</h1><ul><li>Hello</li></ul></main>"),
        "{body}"
    );
    assert_eq!(seen["home description"], true);
    // An anonymous visitor's page is cacheable (rendering.md §6.1; app_pages_cache_and_purge_by_what_they_read).
    assert_eq!(
        seen["home cache"][0],
        "public, max-age=0, s-maxage=300, must-revalidate"
    );
    // `<Link>` to a path on the site is the router region's navigation, loaded on the page, names
    // the template its target renders in (this layout's `template = "blank"`), and is written at the
    // page's one address (`/notes/` under `/%postname%/`), never a redirect.
    assert!(body.contains(r#"/notes/" data-wp-interactive="tp/router" data-wp-on--click="actions.navigate" data-tp-template="tp-blank" data-wp-init---tp-prefetch="callbacks.preparePrefetch" data-wp-on--mouseenter="actions.prefetch">Notes</a>"#), "{body}");
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
    // Open Graph and the Twitter card from the layout, the page's image over them; the
    // layout's link and the page's (`metadata.links`).
    let social = &seen["note social"];
    let base = seen["base"].as_str().unwrap_or_default();
    assert_eq!(
        social["meta"],
        serde_json::json!([
            ["og:title", "Note hello · Field Notes"],
            ["og:description", "Notes."],
            ["og:type", "article"],
            // The page's `canonical: "/notes/hello"`, at the page's one address.
            ["og:url", format!("{base}/notes/hello/")],
            ["og:image", format!("{base}/og/hello.png")],
            ["twitter:card", "summary_large_image"]
        ]),
        "{social}"
    );
    // The page repeats the layout's link with its keys in another order: it is in the head once.
    assert_eq!(
        social["links"],
        serde_json::json!([
            ["describedby", format!("{base}/llms.txt"), "text/plain"],
            ["alternate", format!("{base}/notes/hello.md"), "text/markdown"]
        ]),
        "{social}"
    );
    // `metadata.scripts`: script modules, a path made absolute.
    assert_eq!(
        social["scripts"],
        serde_json::json!([format!("{base}/note.js"), "https://cdn.example/a.js"]),
        "{social}"
    );
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
    // `<Pagination>`: numbered links that keep the page's other arguments (never a flash marker),
    // page 1 without the argument, the current page marked and not a link, Previous and Next at
    // the ends only, and long runs collapsed around the current page.
    assert_eq!(
        seen["pagination"],
        serde_json::json!({
            "label": "Pagination",
            "items": [
                "Previous /notes/?q=tea&page=5 rel=prev",
                "1 /notes/?q=tea",
                "…",
                "4 /notes/?q=tea&page=4",
                "5 /notes/?q=tea&page=5",
                "6 current",
                "7 /notes/?q=tea&page=7",
                "8 /notes/?q=tea&page=8",
                "…",
                "12 /notes/?q=tea&page=12",
                "Next /notes/?q=tea&page=7 rel=next",
            ],
        }),
        "{seen}"
    );
    assert_eq!(
        seen["pagination first"],
        serde_json::json!(["1", "2", "3", "…", "12", "Next"]),
        "{seen}"
    );
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
    assert_eq!(seen["page POST anonymous"], 401, "a page's handlers follow their guard");
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
    assert_eq!(titles, ["About", "Field guide", "Colophon", "Notes", "Home"], "{llms}");
    // WordPress keeps its own URLs.
    assert_eq!(seen["rest"], 200);
    assert_eq!(seen["feed"], 200);
    assert_eq!(seen["reserved"], false);
    // A page's head carries WordPress's styles: the theme's presets as `--wp--preset--*` variables,
    // the owner's Global Styles over them, Additional CSS and the site icon (docs/pages.md, "Styles").
    assert_eq!(
        seen["styles"],
        serde_json::json!({ "theme preset": true, "core preset": true, "project preset": true, "global styles": true, "additional css": true, "site icon": true })
    );
    // What `typedpress styles pull` writes: the project's palette with the owner's color for `brand`.
    assert_eq!(
        seen["styles export"],
        serde_json::json!([["version", "settings"], ["brand #123456", "code #0000aa"]])
    );
    let _ = std::fs::remove_dir_all(project);
}

/// WordPress in a subdirectory (tests/php/app_router_subdirectory.php): examples/full-site served under
/// `/blog`, as WordPress Playground serves every site under `/scope:<id>/`. A note's page (`url:
/// "/notes/:slug"`) answers at its own URL; the request path starts with the home path and the
/// item's path does not, so the two are compared without it.
#[test]
fn app_router_serves_item_pages_under_a_subdirectory() {
    let project = std::env::temp_dir().join(format!("typedpress-full-site-subdir-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&project);
    copy(&root().join("examples/full-site"), &project);
    // A page folder with a dot in its name is a page like any other, with one address.
    std::fs::create_dir_all(project.join("tp/app/release.v1")).unwrap();
    std::fs::write(
        project.join("tp/app/release.v1/page.tsx"),
        "export default function Release() { return <h1>Release v1</h1>; }\n",
    )
    .unwrap();
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_router_subdirectory.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
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
    let url = seen["url"].as_str().unwrap();
    assert!(url.ends_with("/blog"), "{url}");
    assert_eq!(seen["link"], format!("{url}/notes/dawn-on-the-ridge/"));
    assert_eq!(seen["notes"], serde_json::json!([200, "Notes"]));
    assert_eq!(seen["note"], serde_json::json!([200, "Dawn on the ridge"]));
    // One address per page (#462): the bare spelling 301s to it, below the subdirectory.
    assert_eq!(
        seen["note bare"],
        serde_json::json!([301, format!("{url}/notes/dawn-on-the-ridge/")])
    );
    assert_eq!(seen["dotted"], serde_json::json!([200, "Release v1"]));
    assert_eq!(
        seen["dotted bare"],
        serde_json::json!([301, format!("{url}/release.v1/")])
    );
    // Still a 404: a draft for a signed-out visitor, and a slug no note has.
    assert_eq!(seen["draft"], serde_json::json!([404, "Not found"]));
    assert_eq!(seen["missing"], serde_json::json!([404, "Not found"]));
    assert_eq!(seen["about"], serde_json::json!([200, "About"]));
    for name in ["path", "absolute"] {
        assert_eq!(
            seen["links"][name],
            serde_json::json!({
                "href": format!("{url}/notes/dawn-on-the-ridge/?q=tea%20time#body"),
                "template": "tp-blank", "prefetch": "actions.prefetch"
            }),
            "{name}: {seen}"
        );
    }
    let protected = &seen["auth links"];
    let direct = serde_json::json!([
        format!("{url}/notes/dawn-on-the-ridge/?q=tea%20time&sort=new#body"),
        "actions.navigate",
        "actions.prefetch",
        false
    ]);
    let login = serde_json::json!([seen["login for target"], "", "", false]);
    for name in ["protected path", "protected absolute"] {
        assert_eq!(protected["guest"][name], login, "{name}: {seen}");
        assert_eq!(protected["member"][name], direct, "{name}: {seen}");
    }
    for role in ["guest", "member"] {
        assert_eq!(protected[role]["public path"], direct, "{role}: {seen}");
        assert_eq!(
            protected[role]["external"],
            serde_json::json!(["https://example.test/notes?q=tea#body", "", "", false]),
            "{role}: {seen}"
        );
    }
    assert_eq!(seen["links"]["home"]["href"], format!("{url}/"));
    assert_eq!(
        seen["links"]["without slash"],
        format!("{url}/notes/dawn-on-the-ridge?q=tea#body")
    );
    for (name, expected) in [
        ("file", format!("{url}/logo.svg?size=2#image")),
        ("reserved", format!("{url}/wp-login.php?redirect_to=%2Fnotes#login")),
        ("external", "https://example.test/notes?q=tea#body".to_string()),
        ("protocol relative", "".to_string()),
        (
            "outside home",
            format!("{}/blogger/notes", url.trim_end_matches("/blog")),
        ),
        ("fragment", "#body".to_string()),
        ("query", "?q=tea#body".to_string()),
    ] {
        assert_eq!(seen["links"][name]["href"], expected, "{name}: {seen}");
        assert_eq!(seen["links"][name]["template"], "", "{name}: {seen}");
    }
    let _ = std::fs::remove_dir_all(project);
}

/// `typedpress build` writes `tp/_generated/routes.d.ts`; with it, TypeScript checks every `<Link href>`
/// and `PageProps<"route">` against the app's own routes.
#[test]
fn generated_routes_type_links_and_params() {
    let project = fixture("app-router", "types");
    build(&project);
    let routes = std::fs::read_to_string(project.join("tp/_generated/routes.d.ts")).unwrap();
    assert!(
        routes.contains(r#""notes/[slug]": { path: `/notes/${string}`; params: { slug: string } };"#),
        "{routes}"
    );
    let types = root().join("types/typedpress");
    std::fs::write(
        project.join("tsconfig.json"),
        serde_json::json!({
            "compilerOptions": {
                "target": "ES2022", "lib": ["ES2022", "DOM"], "module": "ESNext", "moduleResolution": "bundler",
                "strict": true, "noEmit": true, "types": [], "jsx": "react-jsx", "jsxImportSource": "typedpress",
                "allowImportingTsExtensions": true,
                "paths": {
                    "typedpress": [types.join("index.d.ts")],
                    "typedpress/*": [types.join("*.d.ts")],
                },
            },
            "include": ["typedpress.config.ts", "tp"],
        })
        .to_string(),
    )
    .unwrap();
    std::fs::write(
        project.join("tp/app/_lib/links.tsx"),
        r#"import { Link, type PageProps } from "typedpress/app";
export const ok = [<Link href="/notes/anything">x</Link>, <Link href="/docs">x</Link>, <Link href="/docs/a/b">x</Link>, <Link href="https://example.com">x</Link>];
// @ts-expect-error: no route serves /nowhere
export const missing = <Link href="/nowhere">x</Link>;
export const returnTo = <Link href="/docs?mode=read#intro" requireAuth prefetch>Docs</Link>;
// @ts-expect-error: requireAuth takes a boolean
export const invalidAuth = <Link href="/docs" requireAuth="yes">Docs</Link>;
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

/// `page.md` is a real WordPress Page (rendering.md §2): the file is its first version, the route
/// renders it inside its layouts, an editor changes it in wp-admin, and nothing of a draft or a
/// guarded page reaches an anonymous visitor (tests/php/app_content.php).
#[test]
fn page_md_is_a_wordpress_page() {
    let project = fixture("app-router", "content");
    build(&project);
    // A later build of the same app: one file changed in each of three ways, one removed, one added.
    let second = fixture("app-router", "content-second");
    copy(
        &project.join("tp/_generated/migrations"),
        &second.join("tp/_generated/migrations"),
    );
    let app = second.join("tp/app");
    std::fs::remove_dir_all(app.join("hidden")).unwrap();
    std::fs::create_dir_all(app.join("news")).unwrap();
    std::fs::write(app.join("news/page.md"), "# News\n\nNothing yet.\n").unwrap();
    std::fs::write(app.join("colophon/page.md"), "# Colophon\n\nSet in a serif.\n").unwrap();
    let guide = app.join("(site)/guide/page.md");
    std::fs::write(
        &guide,
        std::fs::read_to_string(&guide)
            .unwrap()
            .replace("one per walk", "one per outing"),
    )
    .unwrap();
    build(&second);
    // A third build takes two pages away from visitors: one becomes a draft, one moves under a guard.
    let third = fixture("app-router", "content-third");
    copy(
        &second.join("tp/_generated/migrations"),
        &third.join("tp/_generated/migrations"),
    );
    let app = third.join("tp/app");
    std::fs::remove_dir_all(app.join("hidden")).unwrap();
    std::fs::remove_dir_all(app.join("colophon")).unwrap();
    std::fs::create_dir_all(app.join("account/colophon")).unwrap();
    std::fs::write(
        app.join("account/colophon/page.md"),
        "# Members only colophon\n\nFor members.\n",
    )
    .unwrap();
    let guide = app.join("(site)/guide/page.md");
    std::fs::write(
        &guide,
        std::fs::read_to_string(&guide)
            .unwrap()
            .replace("title: Field guide", "title: Field guide\nstatus: draft"),
    )
    .unwrap();
    build(&third);
    // A fourth: the guide, still `status: draft`, moves to another route group (same URL) and
    // gets a typo fixed; /colophon is now a page.tsx route.
    let fourth = fixture("app-router", "content-fourth");
    copy(
        &third.join("tp/_generated/migrations"),
        &fourth.join("tp/_generated/migrations"),
    );
    std::fs::remove_dir_all(fourth.join("tp/app")).unwrap();
    copy(&third.join("tp/app"), &fourth.join("tp/app"));
    let app = fourth.join("tp/app");
    std::fs::create_dir_all(app.join("(docs)")).unwrap();
    std::fs::rename(app.join("(site)/guide"), app.join("(docs)/guide")).unwrap();
    let guide = app.join("(docs)/guide/page.md");
    std::fs::write(
        &guide,
        std::fs::read_to_string(&guide)
            .unwrap()
            .replace("one per walk", "one per walk, again"),
    )
    .unwrap();
    std::fs::create_dir_all(app.join("colophon")).unwrap();
    std::fs::write(
        app.join("colophon/page.tsx"),
        "export default function Colophon() { return <h1>Colophon, now code</h1>; }\n",
    )
    .unwrap();
    assert!(
        std::fs::read_to_string(&guide).unwrap().contains("one per walk, again"),
        "the fourth build changes the guide"
    );
    build(&fourth);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_content.php"))
        .arg(project.join("tp/dist/wp-content"))
        .arg(second.join("tp/dist/wp-content"))
        .arg(third.join("tp/dist/wp-content"))
        .arg(fourth.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    for dir in [&project, &second, &third, &fourth] {
        let _ = std::fs::remove_dir_all(dir);
    }
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value =
        serde_json::from_slice(&out.stdout).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out.stdout)));
    let text = |v: &serde_json::Value| v.as_str().unwrap_or_default().to_string();
    let shared = "public, max-age=0, s-maxage=300, must-revalidate";
    let private = "private, no-store, max-age=0";

    // The file's Markdown is stored as blocks in a Page, and the route renders that Page inside
    // its layout, with the front matter as its metadata and the anonymous cache policy.
    let guide = &seen["guide"];
    assert_eq!(guide["status"], 200);
    assert_eq!(guide["title"], "Field guide · Field Notes");
    assert_eq!(guide["description"], "How the notes are kept.");
    assert!(text(&guide["canonical"]).ends_with("/guide/"), "{guide}");
    assert_eq!(guide["cache"], shared);
    let body = text(&guide["body"]);
    assert!(body.starts_with(r#"<div class="site"><nav>"#), "{body}");
    assert!(
        body.contains(
            r#"<main><h1 class="wp-block-post-title">Field guide</h1><div class="entry-content wp-block-post-content">"#
        ),
        "{body}"
    );
    assert!(
        body.contains("Notes are kept in <b>plain text</b>, one per walk."),
        "{body}"
    );
    assert!(
        body.contains(r#"<h2 class="wp-block-heading">What to carry</h2>"#),
        "{body}"
    );
    assert!(body.contains(r#"<a href="https://example.com/map">map</a>"#), "{body}");
    assert!(
        // Rendered as TypedPress renders every code block (TypedPress\Content\Code).
        body.contains(r#"<pre class="typedpress-code language-sh"><code><span class="typedpress-code-line">typedpress build</span>"#),
        "{body}"
    );
    let stored = &seen["guide stored"];
    assert_eq!(
        (
            &stored["type"],
            &stored["status"],
            &stored["title"],
            &stored["slug"],
            &stored["excerpt"]
        ),
        (
            &serde_json::json!("page"),
            &serde_json::json!("publish"),
            &serde_json::json!("Field guide"),
            &serde_json::json!("guide"),
            &serde_json::json!("How the notes are kept.")
        )
    );
    assert!(
        text(&stored["content"]).starts_with("<!-- wp:paragraph -->"),
        "{stored}"
    );
    // The route's path is the Page's permalink, and WordPress's own address for it redirects there.
    assert!(text(&stored["link"]).ends_with("/guide/"), "{stored}");
    assert_eq!(seen["by id"][0], 301);
    assert!(text(&seen["by id"][1]).ends_with("/guide/"), "{}", seen["by id"]);
    // Its Markdown twin, advertised by the HTML page.
    assert_eq!(
        seen["guide twin"],
        serde_json::json!([
            200,
            "# Field guide\n\nNotes are kept in **plain text**, one per walk.\n\n## What to carry\n\n- A pencil\n- A [map](https://example.com/map)\n\n```sh\ntypedpress build\n```\n",
            "text/markdown; charset=UTF-8"
        ])
    );
    assert!(text(&seen["guide twin link"][0]).contains("/guide.md>; rel=\"alternate\""));
    // Without front matter the first heading is the title, shown once; HTML in the file is text.
    let colophon = text(&seen["colophon"]["body"]);
    assert_eq!(seen["colophon"]["title"], "Colophon · Field Notes");
    assert_eq!(colophon.matches("Colophon").count(), 1, "{colophon}");
    assert!(
        colophon.contains("&lt;script&gt;alert(1)&lt;/script&gt;") && !colophon.contains("<script>alert"),
        "{colophon}"
    );
    assert!(text(&seen["colophon"]["canonical"]).ends_with("/colophon/"));

    // A draft: stored for its editors, a 404 for everyone else, HTML and twin alike, and uncached.
    assert_eq!(seen["hidden stored"]["status"], "draft");
    assert_eq!(seen["hidden"]["status"], 404);
    assert_eq!(seen["hidden"]["cache"], private);
    assert!(!text(&seen["hidden"]["body"]).contains("ninth"));
    assert_ne!(seen["hidden"]["description"], "Not for visitors yet.");
    assert_eq!(seen["hidden as subscriber"], 404);
    assert_eq!(seen["hidden bare"], 404, "a draft's bare spelling is no redirect");
    assert_eq!(seen["hidden as editor"]["status"], 200);
    assert_eq!(seen["hidden as editor"]["cache"], private);
    assert!(text(&seen["hidden as editor"]["body"]).contains("The launch is on the ninth."));
    assert_eq!(
        (&seen["hidden twin"], &seen["hidden twin as editor"]),
        (&serde_json::json!(404), &serde_json::json!(404)),
        "a twin is the same for everyone"
    );
    // Under a layout guard the Page is stored private: the guard decides who reads it, and it
    // has no twin.
    assert_eq!(seen["terms anonymous"], serde_json::json!([302, true]));
    assert_eq!(seen["terms stored"]["status"], "private");
    assert_eq!(seen["terms subscriber"]["status"], 200);
    assert_eq!(seen["terms subscriber"]["cache"], private);
    assert!(
        text(&seen["terms subscriber"]["body"])
            .contains(r#"<section class="account"><h1 class="wp-block-post-title">Member terms</h1>"#)
    );
    assert_eq!(seen["terms twin"], 404);
    // WordPress's own public surfaces (REST, search, sitemap, feed, llms.txt) show neither.
    assert_eq!(seen["leaks"], serde_json::json!([]));
    // A public page is listed once in llms.txt, under the app's pages, linking the route's twin.
    let llms = text(&seen["llms"]);
    assert_eq!(llms.matches("[Field guide](").count(), 1, "{llms}");
    assert!(llms.contains("/guide.md)"), "{llms}");

    // An editor's change in wp-admin is what the route and its twin show, and it purges the URL.
    let edited = &seen["guide edited"];
    assert_eq!(edited["title"], "Field guide, revised · Field Notes");
    assert_eq!(edited["description"], "Edited on the site.");
    assert!(text(&edited["body"]).contains("<p class=\"wp-block-paragraph\">Edited in the block editor.</p>"));
    assert_eq!(
        seen["guide edited twin"],
        "# Field guide, revised\n\nEdited in the block editor.\n"
    );
    let purged: Vec<String> = seen["purged"].as_array().unwrap().iter().map(text).collect();
    for path in ["/guide/", "/guide.md", "/llms.txt"] {
        assert!(purged.contains(&path.to_string()), "{path} in {purged:?}");
    }
    // Only the one address: the bare spelling redirects to it, so no cache holds a copy there.
    assert!(!purged.contains(&"/guide".to_string()), "{purged:?}");
    // Unsaved changes show from the editor's own Preview link only.
    assert!(text(&seen["preview as editor"]["body"]).contains("Not saved yet."));
    assert_eq!(seen["preview as editor"]["cache"], private);
    // WordPress refuses a preview link whose nonce isn't the viewer's own, before any page renders.
    assert_eq!(seen["preview without nonce"], serde_json::json!([403, false]));
    assert_eq!(seen["preview anonymous"], serde_json::json!([403, false]));
    // A password locks the body for every visitor (the page is cached for all of them).
    for key in ["locked", "locked with cookie"] {
        let body = if key == "locked" {
            text(&seen[key]["body"])
        } else {
            text(&seen[key])
        };
        assert!(
            body.contains("This content is password protected.") && !body.contains("Edited in"),
            "{key}: {body}"
        );
    }
    assert_ne!(seen["locked"]["description"], "Edited on the site.");
    assert_eq!(
        seen["locked twin"],
        "# Field guide, revised\n\nThis content is password protected.\n"
    );
    assert_eq!(seen["unpublished"], serde_json::json!([404, 404]));
    assert_eq!(seen["republished"], 200);

    // The next build: a changed file updates a Page nobody edited, a new file makes a Page, the
    // Page an editor changed keeps their version, and a removed file leaves its Page on the site.
    assert!(text(&seen["second colophon"]["body"]).contains("Set in a serif."));
    assert_eq!(seen["second colophon stored"]["id"], seen["colophon stored"]["id"]);
    assert!(text(&seen["second news"]["body"]).contains("Nothing yet."));
    assert!(text(&seen["second guide"]["body"]).contains("Edited in the block editor."));
    assert_eq!(seen["second hidden"], 404);
    assert_eq!(seen["second hidden stored"]["id"], seen["hidden stored"]["id"]);
    // The third build: a file that now says `status: draft` unpublishes its Page even though the
    // site edited it (the editor's text stays), and the site having lost its record of the Pages
    // changes nothing: each is found again, not overwritten and not duplicated.
    assert_eq!(seen["third guide"], serde_json::json!([404, 404]));
    assert_eq!(seen["third guide stored"]["id"], seen["guide stored"]["id"]);
    assert_eq!(seen["third guide stored"]["status"], "draft");
    assert_eq!(seen["third guide stored"]["title"], "Field guide, revised");
    assert!(text(&seen["third guide stored"]["content"]).contains("Edited in the block editor."));
    // A page moved under a guard is private from its first request.
    assert_eq!(seen["third colophon anonymous"], 302);
    assert_eq!(seen["third colophon stored"]["status"], "private");
    assert!(text(&seen["third colophon subscriber"]["body"]).contains("For members."));
    assert!(text(&seen["third old colophon"]["content"]).contains("Kept by the site."));
    assert_eq!(seen["third leaks"], serde_json::json!([]));
    // Storing happens once per build, under a lock. While a second process was in the middle of
    // storing the second build, a request stored nothing: `/news` was not there yet and the
    // colophon was still the first build's. The second process then finished normally.
    assert_eq!(seen["holder"], serde_json::json!(["storing", "stored", 0]));
    assert_eq!(seen["while locked"]["news"], 404, "{}", seen["while locked"]);
    assert_eq!(seen["while locked"]["news stored"], serde_json::json!({ "count": 0 }));
    assert!(text(&seen["while locked"]["colophon stored"]).contains("Set in a system font."));
    // The fourth build: the guide page an editor published by hand stays published though its
    // file still says draft and changed (only a page the file newly takes away is unpublished),
    // and moving its file to another route group keeps the same Page.
    // The record keeps what the last applied file said, so the next file is compared with it.
    assert_eq!(seen["third record"], "draft");
    assert_eq!(seen["fourth guide"], 200);
    assert_eq!(seen["fourth guide stored"]["id"], seen["guide stored"]["id"]);
    assert_eq!(seen["fourth guide stored"]["status"], "publish");
    // WordPress's own address for the old colophon Page (slug `colophon`) never redirects away
    // from the page.tsx route that serves /colophon now.
    assert_eq!(seen["fourth colophon route"]["status"], 200);
    assert!(text(&seen["fourth colophon route"]["body"]).contains("Colophon, now code"));
    // A query string through WordPress's address arrives unslashed.
    assert!(
        text(&seen["fourth by id"]).ends_with("/guide/?q=it%27s"),
        "{}",
        seen["fourth by id"]
    );
    // Six routes over the four builds, one Page each.
    assert_eq!(seen["pages"], serde_json::json!([1, 1, 1, 1, 1, 1]));
}

fn rejects(dir: &Path, files: &[(&str, &str)], message: &str, at: &str) {
    let _ = std::fs::remove_dir_all(dir);
    std::fs::create_dir_all(dir).unwrap();
    std::fs::write(
        dir.join("typedpress.config.ts"),
        "import { defineConfig } from \"typedpress\";\nexport default defineConfig({});\n",
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

/// A stylesheet the compiler can't serve as it is, and an import that isn't code or an asset, are
/// build errors at the line, with the fix.
#[test]
fn refuses_stylesheets_it_cannot_copy_with_a_fix() {
    let dir = std::env::temp_dir().join(format!("typedpress-app-css-{}", std::process::id()));
    let page = |import: &str| format!("{import}\nexport default function P() {{ return <p/>; }}\n");
    let styled = page("import \"./x.css\";");
    let module = page("import s from \"./x.module.css\";");
    rejects(
        &dir,
        &[("tp/app/page.tsx", &styled), ("tp/app/x.ts", "export {};")],
        "can't find \"./x.css\"",
        "tp/app/page.tsx:1:1",
    );
    rejects(
        &dir,
        &[
            ("tp/app/page.tsx", &styled),
            ("tp/app/x.css", "@import \"normalize.css\";\n.a {}\n"),
        ],
        "`@import \"normalize.css\"` isn't a local relative stylesheet",
        "tp/app/x.css:1:1",
    );
    rejects(
        &dir,
        &[
            ("tp/app/page.tsx", &styled),
            ("tp/app/x.css", "@import \"./y.css\";\n"),
            ("tp/app/y.css", "@import \"./x.css\";\n"),
        ],
        "circular CSS `@import` involving tp/app/x.css",
        "tp/app/y.css:1:1",
    );
    rejects(
        &dir,
        &[
            ("tp/app/page.tsx", &styled),
            ("tp/app/x.css", ".a {\n  background: url(./missing.png);\n}\n"),
        ],
        "can't find \"./missing.png\" referenced by `url(./missing.png)`",
        "tp/app/x.css:2:15",
    );
    rejects(
        &dir,
        &[
            ("tp/app/page.tsx", &styled),
            ("tp/app/x.css", ".a {\n  background: url(./secret.php);\n}\n"),
            ("tp/app/secret.php", "<?php echo 1;\n"),
        ],
        "can't bundle \"./secret.php\" from `url(./secret.php)`",
        "tp/app/x.css:2:15",
    );
    rejects(
        &dir,
        &[
            ("tp/app/page.tsx", &module),
            ("tp/app/x.module.css", ":global(.a) {}\n"),
        ],
        "`:global` isn't supported in CSS modules",
        "tp/app/x.module.css:1:1",
    );
    rejects(
        &dir,
        &[
            ("tp/app/page.tsx", &module),
            ("tp/app/x.module.css", ".a { composes: b; }\n"),
        ],
        "`composes` isn't supported in CSS modules",
        "tp/app/x.module.css:1:6",
    );
    rejects(
        &dir,
        &[
            ("tp/app/page.tsx", &page("import data from \"./x.json\";")),
            ("tp/app/x.json", "{}"),
        ],
        "can't import \"./x.json\": expected TypeScript or JavaScript source",
        "tp/app/page.tsx:1:1",
    );
    rejects(
        &dir,
        &[
            ("tp/app/page.tsx", &page("import x from \"./a.svg?bogus\";")),
            ("tp/app/a.svg", "<svg/>"),
        ],
        "unsupported import query \"?bogus\"",
        "tp/app/page.tsx:1:1",
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// A fresh clone of a project that builds its stylesheets with `@typedpress/frontend` has no
/// `tp/_generated/frontend-styles.json` (it stays out of Git). `check` and `check --json` compile it
/// without reading `@import "tailwindcss"` as a copied stylesheet; `build` needs the built file.
#[test]
fn checks_a_fresh_clone_before_its_first_frontend_build() {
    let dir = std::env::temp_dir().join(format!("typedpress-app-fresh-styles-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    for (path, source) in [
        (
            "typedpress.config.ts",
            "import { defineConfig } from \"typedpress\";\nexport default defineConfig({ name: \"fresh\" });\n",
        ),
        (
            "package.json",
            r#"{"devDependencies":{"@typedpress/frontend":"0.1.0"}}"#,
        ),
        (
            "tp/app/page.tsx",
            "import \"./site.css\";\nexport default function P() { return <h1 className=\"text-4xl\">Hi</h1>; }\n",
        ),
        ("tp/app/site.css", "@import \"tailwindcss\" source(\"../\");\n"),
    ] {
        let path = dir.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, source).unwrap();
    }
    let check = first().arg("check").arg(&dir).output().unwrap();
    assert!(check.status.success(), "{}", String::from_utf8_lossy(&check.stderr));
    let json = first().arg("check").arg(&dir).arg("--json").output().unwrap();
    assert!(json.status.success(), "{}", String::from_utf8_lossy(&json.stdout));
    // No frontend build ran: `check` writes nothing.
    assert!(!dir.join("tp/_generated/frontend-styles.json").exists());
    assert!(!dir.join("public/typedpress-styles").exists());
    let _ = std::fs::remove_dir_all(&dir);
}

/// Shapes the router can't serve, and route files that would silently do nothing, are build
/// errors at the file, with the fix.
#[test]
fn refuses_route_shapes_and_exports_with_a_fix() {
    let dir = std::env::temp_dir().join(format!("typedpress-app-reject-{}", std::process::id()));
    let page = "export default function P() { return <p/>; }\n";
    rejects(
        &dir,
        &[("tp/app/(a)/x/page.tsx", page), ("tp/app/(b)/x/page.tsx", page)],
        "app/(b)/x/page.tsx and app/(a)/x/page.tsx both serve /x",
        "tp/app/(b)/x/page.tsx",
    );
    rejects(
        &dir,
        &[
            ("tp/app/blog/[id]/page.tsx", page),
            ("tp/app/blog/[slug]/page.tsx", page),
        ],
        "both serve /blog/:",
        "tp/app/blog/",
    );
    rejects(
        &dir,
        &[("tp/app/post-[slug]/page.tsx", page)],
        "`post-[slug]` mixes text and a parameter",
        "tp/app/post-[slug]",
    );
    rejects(
        &dir,
        &[("tp/app/@modal/page.tsx", page)],
        "parallel route slot",
        "tp/app/@modal",
    );
    // `apiReference()` reads a JSON file of the app's `public/`, named as a literal.
    rejects(
        &dir,
        &[(
            "tp/app/api/page.tsx",
            "import { apiReference } from \"typedpress/content\";\nconst file = \"x.json\";\nexport default function P() { return <p>{apiReference(file).title}</p>; }\n",
        )],
        "`apiReference()` takes the path of a JSON file in `public/`, as a string literal",
        "tp/app/api/page.tsx:3",
    );
    rejects(
        &dir,
        &[(
            "tp/app/api/page.tsx",
            "import { apiReference } from \"typedpress/content\";\nexport default function P() { return <p>{apiReference(\"../secrets.json\").title}</p>; }\n",
        )],
        "`apiReference()` takes the path of a JSON file in `public/`",
        "tp/app/api/page.tsx:2",
    );
    rejects(
        &dir,
        &[("tp/app/docs/[...rest]/more/page.tsx", page)],
        "more/ is below a catch-all segment",
        "tp/app/docs/[...rest]/more",
    );
    rejects(
        &dir,
        &[("tp/app/wp-admin/page.tsx", page)],
        "would shadow /wp-admin",
        "tp/app/wp-admin",
    );
    // page.md: one page with one URL, a title, and only the front matter keys it reads.
    rejects(
        &dir,
        &[("tp/app/docs/[slug]/page.md", "# Doc\n")],
        "app/docs/[slug]/page.md is below `[slug]`: a page.md is one page with one URL",
        "tp/app/docs/[slug]/page.md:1:1",
    );
    rejects(
        &dir,
        &[("tp/app/about/page.md", "---\ntitle: About\ndescripton: Us\n---\n")],
        "page.md has no front matter key `descripton`",
        "tp/app/about/page.md:3:1",
    );
    rejects(
        &dir,
        &[("tp/app/about/page.md", "Just text.\n")],
        "app/about/page.md has no title",
        "tp/app/about/page.md:1:1",
    );
    rejects(
        &dir,
        &[("tp/app/about/page.md", "---\ntitle: About\nstatus: private\n---\n")],
        "`status` must be published or draft",
        "tp/app/about/page.md:3:1",
    );
    rejects(
        &dir,
        &[("tp/app/about/page.md", "# About\n"), ("tp/app/about/page.tsx", page)],
        "app/about has both page.tsx and page.md",
        "tp/app/about/page.md",
    );
    rejects(
        &dir,
        &[("tp/app/about/page.mdx", "# About\n")],
        "page.mdx isn't a route file",
        "tp/app/about/page.mdx",
    );
    rejects(
        &dir,
        &[("tp/app/about/page.ts", "export default 1;\n")],
        "page.ts isn't a route file",
        "tp/app/about/page.ts",
    );
    rejects(
        &dir,
        &[("tp/app/about/loading.tsx", page)],
        "loading.tsx isn't a route file",
        "tp/app/about/loading.tsx",
    );
    rejects(
        &dir,
        &[
            ("tp/app/x/page.tsx", page),
            ("tp/app/x/route.ts", "export async function GET() { return {}; }\n"),
        ],
        "has both page.tsx and route.ts",
        "tp/app/x/route.ts",
    );
    rejects(
        &dir,
        &[("tp/app/x/not-found.tsx", page)],
        "not-found.tsx works only at the root of tp/app/",
        "tp/app/x/not-found.tsx",
    );
    rejects(
        &dir,
        &[(
            "tp/app/page.tsx",
            "export const metdata = { title: \"x\" };\nexport default function P() { return <p/>; }\n",
        )],
        "app/page.tsx can't export `metdata`",
        "tp/app/page.tsx",
    );
    rejects(
        &dir,
        &[(
            "tp/app/page.tsx",
            "export function Card() { return <p/>; }\nexport default function P() { return <Card/>; }\n",
        )],
        "move components into tp/components/",
        "tp/app/page.tsx",
    );
    rejects(
        &dir,
        &[("tp/app/page.tsx", "export const metadata = { title: \"x\" };\n")],
        "needs a default-exported component",
        "tp/app/page.tsx",
    );
    rejects(
        &dir,
        &[("tp/app/blog/layout.tsx", page)],
        "app/blog/layout.tsx wraps no page",
        "tp/app/blog/layout.tsx",
    );
    rejects(
        &dir,
        &[("tp/app/api/route.ts", "export const x = 1;\n")],
        "can't export `x`",
        "tp/app/api/route.ts",
    );
    rejects(
        &dir,
        &[(
            "tp/app/api/route.ts",
            "export const guard = \"anyone\";\nexport async function GET() { return { status: \"ok\" }; }\n",
        )],
        "GET in app/api/route.ts returns",
        "tp/app/api/route.ts",
    );
    rejects(
        &dir,
        &[("tp/app/api/route.ts", "export async function GET() { return {}; }\n")],
        "app/api/route.ts has HTTP handlers but no `guard`",
        "tp/app/api/route.ts",
    );
    rejects(
        &dir,
        &[(
            "tp/app/api/route.ts",
            "import { env } from \"typedpress\";\nexport const guard = \"anyone\";\nexport const signature = { secret: env(\"S\"), header: \"x-sig\", scheme: \"hmac-sha256\" };\nexport async function POST() { return {}; }\n",
        )],
        "exports both `guard` and `signature`",
        "tp/app/api/route.ts",
    );
    rejects(
        &dir,
        &[(
            "tp/app/page.tsx",
            "export const signature = {};\nexport default function P() { return <p/>; }\n",
        )],
        "no HTTP handler",
        "tp/app/page.tsx",
    );
    rejects(
        &dir,
        &[(
            "tp/app/page.tsx",
            "export const access = \"admin\";\nexport default function P() { return <p/>; }\n",
        )],
        "can't export `access`",
        "tp/app/page.tsx",
    );
    rejects(
        &dir,
        &[(
            "tp/app/api/route.ts",
            "export const access = \"admin\";\nexport async function POST() { return {}; }\n",
        )],
        "can't export `access`",
        "tp/app/api/route.ts",
    );
    rejects(
        &dir,
        &[(
            "tp/app/page.tsx",
            "export const guard = { page: \"admin\" };\nexport async function POST() { return {}; }\nexport default function P() { return <p/>; }\n",
        )],
        "needs a `handlers` rule",
        "tp/app/page.tsx",
    );
    rejects(
        &dir,
        &[(
            "tp/app/page.tsx",
            "export const guard = { handlers: \"admin\" };\nexport default function P() { return <p/>; }\n",
        )],
        "requires a page with unsigned HTTP handlers",
        "tp/app/page.tsx",
    );
    rejects(
        &dir,
        &[
            (
                "tp/app/layout.tsx",
                "export const access = \"admin\";\nexport default function L({ children }: { children: JSX.Element }) { return <main>{children}</main>; }\n",
            ),
            ("tp/app/page.tsx", page),
        ],
        "can't export `access`",
        "tp/app/layout.tsx",
    );
    rejects(
        &dir,
        &[
            (
                "tp/app/layout.tsx",
                "export const guard = \"members\";\nexport default function L({ children }: { children: JSX.Element }) { return <main>{children}</main>; }\n",
            ),
            ("tp/app/page.tsx", page),
        ],
        "`guard` is",
        "tp/app/layout.tsx",
    );
    rejects(
        &dir,
        &[(
            "tp/app/page.tsx",
            "export const metadata = { title: 1 };\nexport default function P() { return <p/>; }\n",
        )],
        "`metadata.title` must be",
        "tp/app/page.tsx",
    );
    for (metadata, message) in [
        (
            "{ links: [{ rel: \"alternate\" }] }",
            "`metadata.links` must be a list of { rel: string, href: string, type?: string }",
        ),
        (
            "{ links: { rel: \"a\", href: \"/b\" } }",
            "`metadata.links` must be a list of",
        ),
        (
            "{ openGraph: { image: 1 } }",
            "`metadata.openGraph` must be { title?, description?, image?, type? }",
        ),
        ("{ openGraph: { locale: \"en\" } }", "`metadata.openGraph` must be"),
        ("{ twitter: {} }", "`metadata.twitter` must be { card: string }"),
        (
            "{ scripts: [\"//evil.example/a.js\"] }",
            "`metadata.scripts` must be a list of script module URLs",
        ),
        ("{ scripts: \"/a.js\" }", "`metadata.scripts` must be a list of"),
    ] {
        rejects(
            &dir,
            &[(
                "tp/app/page.tsx",
                &format!("export const metadata = {metadata};\nexport default function P() {{ return <p/>; }}\n"),
            )],
            message,
            "tp/app/page.tsx",
        );
    }
    rejects(
        &dir,
        &[(
            "tp/app/page.tsx",
            "import { redirect } from \"typedpress/app\";\nexport default function P() { redirect(\"javascript:alert(1)\"); }\n",
        )],
        "isn't a URL a page can redirect to",
        "tp/app/page.tsx:2:",
    );
    rejects(
        &dir,
        &[(
            "tp/app/page.tsx",
            "import { Link } from \"typedpress/app\";\nexport default function P() { return <Link href=\"//evil.example\">x</Link>; }\n",
        )],
        "isn't a URL a link can point to",
        "tp/app/page.tsx:2:",
    );
    let _ = std::fs::remove_dir_all(dir);
}

/// A prebuilt page is an anonymous visitor's render with nothing from the request, at URLs the build
/// can list (docs/decisions/2026-11-13-static-output.md). Everything else is a build error at the
/// page, with the fix.
#[test]
fn refuses_prebuilt_pages_that_depend_on_the_request() {
    let dir = std::env::temp_dir().join(format!("typedpress-app-prerender-{}", std::process::id()));
    let page = "export default function P() { return <p/>; }\n";
    let static_config = (
        "typedpress.config.ts",
        "import { defineConfig } from \"typedpress\";\nexport default defineConfig({ output: \"static\" });\n",
    );
    rejects(
        &dir,
        &[(
            "typedpress.config.ts",
            "import { defineConfig } from \"typedpress\";\nexport default defineConfig({ output: \"hybrid\" });\n",
        )],
        "`output` is \"server\" or \"static\", not \"hybrid\"",
        "typedpress.config.ts:2:",
    );
    rejects(
        &dir,
        &[(
            "typedpress.config.ts",
            "import { defineConfig } from \"typedpress\";\nexport default defineConfig({ output: \"static\", frontend: \"https://example.com\" });\n",
        )],
        "`frontend` hands it to another site",
        "typedpress.config.ts:2:",
    );
    rejects(
        &dir,
        &[(
            "tp/app/page.tsx",
            "export const prerender = \"yes\";\nexport default function P() { return <p/>; }\n",
        )],
        "`prerender` is \"yes\", not true or false",
        "tp/app/page.tsx",
    );
    rejects(
        &dir,
        &[
            static_config,
            (
                "tp/app/about/page.tsx",
                "export const prerender = false;\nexport default function P() { return <p/>; }\n",
            ),
        ],
        "app/about/page.tsx says `prerender = false`, and `output: \"static\"` prebuilds every page",
        "tp/app/about/page.tsx",
    );
    rejects(
        &dir,
        &[static_config, ("tp/app/blog/[slug]/page.tsx", page)],
        "app/blog/[slug]/page.tsx is prebuilt (`output: \"static\"` prebuilds every page), and nothing lists its URLs",
        "tp/app/blog/[slug]/page.tsx",
    );
    rejects(
        &dir,
        &[(
            "tp/app/blog/[slug]/page.tsx",
            "export const prerender = true;\nexport default function P() { return <p/>; }\n",
        )],
        "export `async function staticParams() { return [{ slug: \"…\" }]; }`",
        "tp/app/blog/[slug]/page.tsx",
    );
    rejects(
        &dir,
        &[(
            "tp/app/blog/[slug]/page.tsx",
            "export async function staticParams() { return [{ slug: \"a\" }]; }\nexport default function P() { return <p/>; }\n",
        )],
        "exports `staticParams`, but it isn't prebuilt",
        "tp/app/blog/[slug]/page.tsx",
    );
    rejects(
        &dir,
        &[(
            "tp/app/about/page.tsx",
            "export const prerender = true;\nexport async function staticParams() { return []; }\nexport default function P() { return <p/>; }\n",
        )],
        "exports `staticParams`, and its URL has no parameter",
        "tp/app/about/page.tsx",
    );
    rejects(
        &dir,
        &[(
            "tp/app/blog/[slug]/page.tsx",
            "export const prerender = true;\nexport async function staticParams() { return [{ id: \"a\" }]; }\nexport default function P() { return <p/>; }\n",
        )],
        "staticParams in app/blog/[slug]/page.tsx returns",
        "tp/app/blog/[slug]/page.tsx:2:",
    );
    rejects(
        &dir,
        &[(
            "tp/app/find/page.tsx",
            "import { text } from \"typedpress\";\nexport const prerender = true;\nexport const search = { q: text().optional() };\nexport default function P() { return <p/>; }\n",
        )],
        "app/find/page.tsx is prebuilt (it says `prerender = true`), and it reads `search`",
        "tp/app/find/page.tsx",
    );
    rejects(
        &dir,
        &[
            (
                "tp/app/account/layout.tsx",
                "export const guard = \"subscriber\";\nexport default function L({ children }: { children: JSX.Element }) { return <main>{children}</main>; }\n",
            ),
            (
                "tp/app/account/page.tsx",
                "export const prerender = true;\nexport default function P() { return <p/>; }\n",
            ),
        ],
        "app/account/page.tsx is prebuilt (it says `prerender = true`), and app/account/layout.tsx guards it",
        "tp/app/account/page.tsx",
    );
    rejects(
        &dir,
        &[
            static_config,
            (
                "tp/app/form/page.tsx",
                "export const guard = \"anyone\";\nexport async function POST() { return {}; }\nexport default function P() { return <p/>; }\n",
            ),
        ],
        "app/form/page.tsx has HTTP handlers, and a static site has no server to answer them",
        "tp/app/form/page.tsx",
    );
    // Through an imported helper too: the check follows the page's imports.
    rejects(
        &dir,
        &[
            (
                "tp/app/_lib/who.ts",
                "import { is_user_logged_in } from \"php/wordpress\";\nexport function who(): string { return is_user_logged_in() ? \"you\" : \"guest\"; }\n",
            ),
            (
                "tp/app/hello/page.tsx",
                "import { who } from \"../_lib/who\";\nexport const prerender = true;\nexport default function P() { return <p>{who()}</p>; }\n",
            ),
        ],
        "app/hello/page.tsx is prebuilt, and `is_user_logged_in` asks who the visitor is",
        "tp/app/_lib/who.ts:2:",
    );
    let _ = std::fs::remove_dir_all(dir);
}

/// A hybrid app: `prerender` and `staticParams` reach the route table the runtime reads, and a page
/// that serves a kind's `url` is prebuilt with no staticParams (one file per published item).
#[test]
fn prerender_and_static_params_reach_the_route_table() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path();
    let write = |path: &str, source: &str| {
        let path = project.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, source).unwrap();
    };
    write(
        "typedpress.config.ts",
        "import { defineConfig, collection, text, slug } from \"typedpress\";\nexport const notes = collection({ title: text(), slug: slug({ source: \"title\" }) }, { url: \"/notes/:slug\", access: { read: \"anyone\" } });\nexport { notes }; export default defineConfig({ name: \"hybrid\" });\n",
    );
    write("tp/app/page.tsx", "export default function P() { return <p/>; }\n");
    write(
        "tp/app/about/page.tsx",
        "export const prerender = true;\nexport default function P() { return <p/>; }\n",
    );
    write(
        "tp/app/notes/[slug]/page.tsx",
        "export const prerender = true;\nexport default function P() { return <p/>; }\n",
    );
    write(
        "tp/app/tags/[tag]/page.tsx",
        "import type { PageProps, StaticParams } from \"typedpress/app\";\nexport const prerender = true;\nexport async function staticParams(): Promise<StaticParams<\"tags/[tag]\">> { return [\"news\", \"notes\"].map((tag) => ({ tag })); }\nexport default function P({ params }: PageProps<\"tags/[tag]\">) { return <p>{params.tag}</p>; }\n",
    );
    build(project);
    let schema =
        std::fs::read_to_string(project.join("tp/dist/wp-content/plugins/typedpress-app-hybrid/tp/app/schema.php"))
            .unwrap();
    let route = |id: &str| {
        schema
            .lines()
            .find(|l| l.contains(&format!("['id' => '{id}'")))
            .unwrap_or_else(|| panic!("no route {id}:\n{schema}"))
            .to_string()
    };
    assert!(!route("/").contains("'prerender'"), "{}", route("/"));
    assert!(route("about").contains("'prerender' => true"));
    assert!(route("notes/[slug]").contains("'prerender' => true"));
    assert!(route("tags/[tag]").contains("'prerender' => true"));
    assert!(!schema.contains("'output' =>"), "server is the default");
    // staticParams compiles to a function the export calls; its list is the one the page wrote.
    let out = Command::new("php")
        .arg("-r")
        .arg(format!(
            "require '{}/runtime/TypedPress/bootstrap.php'; require '{}'; $s = require '{}'; $fn = '\\\\TypedPressApp\\\\' . $s['app']['files']['app/tags/[tag]/page.tsx']['staticParams']; echo \\TypedPress\\Js::jsonStringify($fn());",
            root().display(),
            project.join("tp/dist/wp-content/plugins/typedpress-app-hybrid/tp/app/functions.php").display(),
            project.join("tp/dist/wp-content/plugins/typedpress-app-hybrid/tp/app/schema.php").display(),
        ))
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        r#"[{"tag":"news"},{"tag":"notes"}]"#,
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// Prebuilt pages next to server-rendered ones (docs/decisions/2026-11-13-static-output.md): an
/// Action Scheduler action renders each prebuilt URL as a signed-out visitor and writes its HTML and
/// Markdown; the app serves them before WordPress parses the request; a write deletes the files of
/// the URLs it changed and schedules their rebuild, so a visitor never gets stale content. The
/// listing `typedpress export` reads is an editor's.
#[test]
fn prebuilt_pages_serve_before_wordpress_and_rebuild_after_writes() {
    let project = fixture("app-prebuilt", "serve");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_prebuilt.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
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
    use serde_json::json;
    // The URLs: the literal route, each published note (the draft is not one), each staticParams entry.
    assert_eq!(
        seen["list"],
        json!([200, ["/notes/hello", "/tags/field", "/tags/lab%20notes", "/about"]])
    );
    assert_eq!(
        (&seen["list anonymous"], &seen["list subscriber"]),
        (&json!(401), &json!(403))
    );
    // Nothing is served from a file before the build action has run; init schedules it once.
    assert_eq!(seen["before"], false);
    assert_eq!((&seen["scheduled"], &seen["ran"]), (&json!(true), &json!(true)));
    assert_eq!(
        seen["files"],
        json!([
            "about.html",
            "about.md",
            "notes/hello.html",
            "notes/hello.md",
            "tags/field.html",
            "tags/field.md",
            "tags/lab%20notes.html",
            "tags/lab%20notes.md"
        ])
    );
    // Served from the file, with the cacheable policy, its title and its Markdown twin.
    assert_eq!(
        seen["about"],
        json!([
            200,
            true,
            "public, max-age=0, s-maxage=300, must-revalidate",
            true,
            true
        ])
    );
    assert_eq!(
        seen["about.md"],
        json!([200, true, "text/markdown; charset=UTF-8", "# About\n\nWritten once.\n"])
    );
    assert_eq!(seen["note"], json!([true, "<h1>Hello"]));
    assert_eq!(seen["tag"], json!([true, "lab notes"]));
    // Pages that don't say prerender render per request; a draft stays a 404.
    assert_eq!((&seen["home"], &seen["live"]), (&json!(false), &json!(false)));
    assert_eq!(seen["draft"], json!([404, false]));
    // A signed-in visitor, a query string or a forged prerender header fall through to WordPress.
    for key in ["signed in", "query", "forged"] {
        assert_eq!(seen[key], false, "{key}");
    }
    // An edit: the note renders per request with the new title at once, other prebuilt pages keep
    // their files, and the action writes the new file.
    assert_eq!(seen["after write"], json!([false, "<h1>Hello again"]));
    assert_eq!(seen["about kept"], true);
    assert_eq!(seen["rebuilt"], json!([true, "<h1>Hello again"]));
    // A note published later is built; unpublished, its files go and it is a 404.
    assert_eq!(seen["published later"], true);
    assert_eq!(seen["unpublished"], json!([404, false]));
    assert_eq!(seen["unpublished after rebuild"], json!([404, false]));
    // A field stored as post meta, which reaches no core post hook: the page read its item, so the
    // write still names the URL.
    assert_eq!(seen["meta field"], json!([false, "Fresh summary"]));
    assert_eq!(seen["meta field rebuilt"], json!([true, "Fresh summary"]));
    // A site-wide setting drops every file; the next build has the new value.
    assert_eq!(seen["renamed"], json!([false, false]));
    assert_eq!(seen["renamed rebuilt"], true);
    // A file is never served past its maximum age; `/index` is not the home page; a gate vetoes.
    for key in ["too old", "index", "gated"] {
        assert_eq!(seen[key], false, "{key}");
    }
    // A prerender token expires: an old one is an ordinary (cacheable) render, a fresh one a prerender
    // no shared cache keeps.
    assert_eq!(
        seen["expired token"],
        "public, max-age=0, s-maxage=300, must-revalidate"
    );
    assert_eq!(seen["fresh token"], "private, no-store, max-age=0");
    // The expired token's own path with an unexpired token is a prerender: expiry refused it.
    assert_eq!(seen["unexpired token"], "private, no-store, max-age=0");
    // A value staticParams stops listing loses its file.
    assert_eq!(seen["dropped value"], json!([false, true]));
    // Another spelling of a path, and a coming-soon site, are never answered from a file.
    assert_eq!(seen["encoded spelling"], false);
    assert_eq!(seen["coming soon"], false);
    assert_eq!(seen["purge all, no files"], true);
    // A render that began before a write named its path is not written.
    assert_eq!(seen["race"], json!([true, false, false]));
    // `Accept: text/markdown` on the HTML URL is never answered with the HTML file: the file lane
    // steps aside for the Markdown negotiation, which a host's engine runs.
    assert_eq!(seen["accept markdown"], json!([false, true]));
    // More spellings of a prebuilt path that aren't its URL: `/notes//hello`, `/./about`, `/.md`,
    // `/about/.md`, `/about//.md`; and `/about` redirects to `/about/` rather than serving the file.
    assert_eq!(seen["spellings"], json!([false, false, false, false, false]));
    assert_eq!(seen["bare about"], json!([301, false]));
    // A render that began before forget() leaves no file behind.
    assert_eq!(seen["forget race"], json!([false, false]));
    // A prebuilt address longer than the read index holds can't be recorded, so no write would
    // rebuild its file: neither the page nor its twin is written, and it renders per request.
    assert_eq!(seen["long address"], json!([false, false, 200, false, 200, false]));
    assert_eq!(
        seen["public script updated"],
        json!([true, true, true, 200, false, true])
    );
}

/// One variant of tests/fixtures/frontend-modes, built and served: what each URL answers.
fn modes(variant: &str, frontend: Option<&str>, app: bool) -> serde_json::Value {
    let project = fixture("frontend-modes", variant);
    if app {
        copy(&project.join("app/tp/app"), &project.join("tp/app"));
    }
    let _ = std::fs::remove_dir_all(project.join("app"));
    if let Some(frontend) = frontend {
        let config = project.join("typedpress.config.ts");
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
    assert!(
        root()
            .join("tests/differential/client/node_modules/playwright-core")
            .is_dir(),
        "run: npm ci --prefix tests/differential/client && npx --prefix tests/differential/client playwright-core install chromium-headless-shell"
    );
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/frontend_modes.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .env("TP_TEST_BROWSER", "1")
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
/// every mode; with no tp/app/ the theme renders them, a first/app/ page that matches the
/// pattern takes the URL over, `frontend: false` serves no public HTML, and an external frontend
/// gets every front-end URL. wp-admin's REST and feeds keep working throughout, and a slug change
/// (or a stale placeholder like a wrong year) 301s to the item's own URL.
#[test]
fn frontend_modes_on_wordpress() {
    let theme = modes("theme", None, false);
    let app = modes("app", None, true);
    let off = modes("off", Some("false"), false);
    let external = modes("external", Some(r#""https://front.example""#), false);
    // In every mode wp-admin and sign-in work in a browser (spec §5): signed out, wp-admin is the
    // login screen; signing in lands on TypedPress Admin, the default admin; classic pages open framed in
    // it until the user turns developer mode on, then classic wp-admin's dashboard and a list screen
    // render beside it; wp-admin's REST nonce works; signing out ends the session.
    for (mode, seen) in [("theme", &theme), ("app", &app), ("off", &off), ("external", &external)] {
        assert_eq!(
            seen["admin"],
            serde_json::json!({
                "signedOut": { "at": "/wp-login.php", "redirectTo": true },
                "loginForm": 1,
                "signedIn": "first admin",
                "withoutDeveloperMode": { "dashboard": "/", "pages": "/classic/edit.php?post_type=page", "framed": "/wp-admin/edit.php?post_type=page", "profileMenuHidden": true, "profileBeforeUnload": true },
                "fastNavigation": "loading",
                "developerMode": true,
                "classic": { "at": "/wp-admin/index.php", "adminBar": 1, "menu": 1, "dashboard": 1 },
                "pages": { "title": "Pages", "table": 1 },
                "rest": { "status": 200, "role": "administrator" },
                "signedOutAgain": "/wp-login.php",
                "errors": [],
            }),
            "{mode}"
        );
    }
    // With no tp/app/, WordPress renders the whole site with its block theme: the home page,
    // core posts, kind URLs and its own 404 template. The app router adds nothing to any of them.
    let by_theme = |status: u64| serde_json::json!({ "status": status, "theme": true, "router": false });
    for (key, status) in [
        ("home rendered", 200),
        ("note rendered", 200),
        ("post rendered", 200),
        ("missing rendered", 404),
    ] {
        assert_eq!(theme[key], by_theme(status), "{key}: {theme}");
    }
    assert_eq!(
        (&theme["post body"], &theme["missing by wordpress"]),
        (&serde_json::json!(true), &serde_json::json!(true))
    );
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
    // A kind URL's item purges like a post: its old and new URLs and their twins.
    assert_eq!(
        theme["renamed purges"],
        serde_json::json!([
            "/notes/hello-note/",
            "/notes/hello-note.md",
            "/notes/renamed-note/",
            "/notes/renamed-note.md"
        ])
    );
    assert_eq!(theme["new url"], 200);
    assert_eq!(theme["about"][0], 404);
    assert_eq!(theme["home"], 200);

    // With tp/app/, its page renders the note through the router; a kind URL without a page and
    // a core post keep the theme. An address nothing serves is the theme's own 404 template, as
    // WordPress renders it: the app has no not-found.tsx to put in it.
    assert_eq!(app["note rendered"]["router"], true, "{app}");
    assert_eq!(app["missing rendered"], by_theme(404), "{app}");
    // A page with parameters and no metadata anywhere is a 200 page titled with the site's name,
    // never WordPress's 404 title or body class.
    assert_eq!(
        app["dynamic"],
        serde_json::json!({ "status": 200, "title": app["site name"], "error404": false, "page": true }),
        "{app}"
    );
    // Its title is WordPress's, as with no app.
    assert_eq!(app["missing title"], theme["missing title"], "{app}");
    assert!(
        app["missing title"]
            .as_str()
            .unwrap_or_default()
            .starts_with("Page not found"),
        "{app}"
    );
    assert_eq!(app["post rendered"], by_theme(200), "{app}");
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

    for key in ["note status", "journal", "home", "draft"] {
        assert_eq!(off[key], 404, "{key}: {off}");
    }
    assert_eq!(off["permalink"], "/notes/hello-note/");

    assert_eq!(
        external["permalink"], "https://front.example/notes/hello-note/",
        "{external}"
    );
    assert_eq!(external["note status"], 308);
    assert_eq!(external["post"][0], 308);

    // Authors: the users kind's read rule gives a visitor the editor's row only. The editor is a
    // public author, as WordPress ships one; the admin, who also has a published post, is closed
    // like a login nobody has. Core's own users route stays closed for both.
    assert_eq!(
        theme["authors"],
        serde_json::json!({
            "listed": 200,
            "unlisted": 404,
            "unknown": 404,
            "listed by id": [301, "/author/editor/"],
            "unlisted by id": 404,
            "both ids": 404,
            "listed embed": [false, "/author/editor/"],
            "unlisted embed": [true, ""],
            "core route": [401, 401],
            "api list": true,
            "api listed": 200,
            "api unlisted": 401,
            "api missing": 401,
            "purged": true,
            "unlisted after": 404,
            "public sitemap": ["/author/admin/", "/author/editor/"]
        }),
        "{theme}"
    );

    // One sitemap, through core's (`wp-sitemap.xml`): core's own files for posts, pages, terms and
    // authors, and TypedPress's provider with a file per kind that has a `url` and readable items. Only
    // what a signed-out visitor may read is in it: no draft, no private or password-protected item,
    // no row a filter rule hides (`briefs`), no kind readers must sign in for (`drafts`), and no
    // kind without a `url` (`memos`).
    let sitemap = &theme["sitemap"];
    assert_eq!(sitemap["status"], 200, "{sitemap}");
    assert_eq!(
        sitemap["files"],
        serde_json::json!([
            "/wp-sitemap-posts-post-1.xml",
            "/wp-sitemap-posts-page-1.xml",
            "/wp-sitemap-taxonomies-category-1.xml",
            "/wp-sitemap-users-1.xml",
            "/wp-sitemap-typedpress-notes-1.xml",
            "/wp-sitemap-typedpress-journal-1.xml",
            "/wp-sitemap-typedpress-briefs-1.xml",
            "/wp-sitemap-typedpress-vault-1.xml"
        ]),
        "{sitemap}"
    );
    assert_eq!(
        sitemap["urls"],
        serde_json::json!({
            "/wp-sitemap-posts-post-1.xml": ["/hello-world/", "/by-the-editor/"],
            "/wp-sitemap-posts-page-1.xml": ["/", "/sample-page/"],
            "/wp-sitemap-taxonomies-category-1.xml": ["/category/uncategorized/"],
            // Both admin and the editor have a published post; the users kind's read rule shows a
            // visitor the editor's row only, so only that author archive is listed.
            "/wp-sitemap-users-1.xml": ["/author/editor/"],
            "/wp-sitemap-typedpress-notes-1.xml": ["/notes/renamed-note/"],
            "/wp-sitemap-typedpress-journal-1.xml": ["/journal/2026/day-one/"],
            "/wp-sitemap-typedpress-briefs-1.xml": ["/briefs/open-brief/"],
            // With no app page in front of it, WordPress renders a vault item for anyone.
            "/wp-sitemap-typedpress-vault-1.xml": ["/members/vault/vault-item/"]
        }),
        "{sitemap}"
    );
    // The sitemap is one document for every caller: an editor, who reads the embargoed brief and
    // the draft, is shown what a visitor is shown.
    assert_eq!(sitemap["as editor"], serde_json::json!(["/briefs/open-brief/"]));
    // Nor does a post password's cookie add the protected note or post: neither is listed at all.
    assert_eq!(
        sitemap["with a post password"],
        serde_json::json!({
            "/wp-sitemap-typedpress-notes-1.xml": ["/notes/renamed-note/"],
            "/wp-sitemap-posts-post-1.xml": ["/hello-world/", "/by-the-editor/"]
        }),
        "{sitemap}"
    );
    assert_eq!(sitemap["robots"], true);
    // A kind with nothing to list has no file, and a page past the end is a 404, as in core.
    assert_eq!(
        (&sitemap["unknown kind"], &sitemap["past the end"]),
        (&serde_json::json!(404), &serde_json::json!(404))
    );
    // A write purges the index and every file of the item's sub-sitemap, one more for a new file:
    // which file lists it depends on rows other readers can't see.
    let briefs_files = serde_json::json!([
        "/wp-sitemap.xml",
        "/wp-sitemap-typedpress-briefs-1.xml",
        "/wp-sitemap-typedpress-briefs-2.xml"
    ]);
    assert_eq!(sitemap["purged"], briefs_files);
    // So does a write that only changes who may read the row, and then the row is gone: the file
    // that held only it is a 404, as core answers an empty one.
    assert_eq!(sitemap["purged by a field"], briefs_files);
    assert_eq!(
        (&sitemap["briefs after"], &sitemap["briefs status after"]),
        (&serde_json::json!([]), &serde_json::json!(404))
    );
    // Core dates the home entry from its own query, which counts protected posts; here it is the
    // newest post the sitemap lists.
    assert_eq!(sitemap["home lastmod"], sitemap["newest public post"], "{sitemap}");
    // A kind whose `url` shows a field visitors may not read (`cases`: a slug only editors read) has no
    // file, nor does one whose URL a guarded app page serves (`vault`, under `members/`).
    assert_eq!(
        app["sitemap"]["files"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|f| {
                let f = f.as_str().unwrap();
                f.contains("-cases-") || f.contains("-vault-")
            })
            .count(),
        0,
        "{}",
        app["sitemap"]
    );
    // With tp/app/, its public pages are listed too: not the guarded one, not the one whose
    // metadata says `robots: { index: false }`, and not a route with parameters.
    assert_eq!(
        app["sitemap"]["urls"]["/wp-sitemap-typedpress-app-pages-1.xml"],
        serde_json::json!(["/about/"]),
        "{}",
        app["sitemap"]
    );
    assert_eq!(
        app["sitemap"]["urls"]["/wp-sitemap-typedpress-notes-1.xml"],
        sitemap["urls"]["/wp-sitemap-typedpress-notes-1.xml"]
    );
    // `frontend: false` has no public pages, so no sitemap; an external frontend's sitemap is
    // answered here, with every entry at that site.
    assert_eq!(off["sitemap"]["status"], 404, "{}", off["sitemap"]);
    assert_eq!(off["sitemap"]["robots"], false);
    assert_eq!(external["sitemap"]["status"], 200, "{}", external["sitemap"]);
    let everywhere: Vec<&str> = external["sitemap"]["urls"]
        .as_object()
        .unwrap()
        .values()
        .flat_map(|urls| urls.as_array().unwrap())
        .map(|url| url.as_str().unwrap())
        .collect();
    assert!(
        everywhere.contains(&"https://front.example/notes/renamed-note/")
            && everywhere.contains(&"https://front.example/hello-world/")
            && everywhere.contains(&"https://front.example/"),
        "{everywhere:?}"
    );
    assert!(
        everywhere.iter().all(|url| url.starts_with("https://front.example/")),
        "{everywhere:?}"
    );

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

/// Generator B (docs/decisions/2026-11-08-tsx-to-php.md): each `"use client"` component compiles
/// to a store module that runs in the browser without a bundler. Driven here under Node against a
/// stand-in `@wordpress/interactivity` (tests/differential/client): state getters recompute from
/// context, an async handler awaits a server action through the typed client (its Ability), setters
/// with an updater, effects, mount, window events, `withSyncEvent` for `preventDefault`, and
/// shared state.
#[test]
fn client_components_compile_to_interactivity_stores() {
    let project = fixture("client-components", "stores");
    build(&project);
    let plugin = project.join("tp/dist/wp-content/plugins/typedpress-app-clients");
    let schema = Command::new("php")
        .args(["-r", "echo json_encode(require $argv[1]);"])
        .arg(plugin.join("tp/app/schema.php"))
        .output()
        .unwrap();
    let schema: serde_json::Value = serde_json::from_slice(&schema.stdout).unwrap();
    let islands = &schema["islands"];
    assert_eq!(
        islands["clients/LikeButton"]["actions"],
        serde_json::json!(["like"]),
        "{islands}"
    );
    assert_eq!(islands["clients/Effects"]["actions"], serde_json::json!([]));
    // `"use client"` after another directive (`"use strict"`) still makes a client component.
    assert!(islands["clients/Toggle"]["file"].is_string(), "{islands}");
    let drive = |namespace: &str, script: &str| -> serde_json::Value {
        let file = islands[namespace]["file"].as_str().unwrap();
        let out = Command::new("node")
            .arg(root().join("tests/differential/client/drive.mjs"))
            .arg(plugin.join("tp/app/client").join(file))
            .arg(root().join("tests/differential/client").join(script))
            .arg(plugin.join("tp/app/client/typedpress-client.js"))
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        serde_json::from_slice(&out.stdout).unwrap()
    };
    let like = drive("clients/LikeButton", "likebutton.mjs");
    assert_eq!(like["label1"], "1 like");
    assert_eq!(like["busyDuring"], serde_json::json!([true]));
    assert_eq!(
        like["after"],
        serde_json::json!({ "count": 142, "busy": false, "postId": 42 })
    );
    assert_eq!(like["label2"], "142 likes");
    assert_eq!(
        like["calls"],
        serde_json::json!([{ "url": "/wp-json/wp-abilities/v1/abilities/clients/like/run", "method": "POST", "body": { "input": { "postId": 42 } } }])
    );
    let effects = drive("clients/Effects", "effects.mjs");
    assert_eq!(
        effects,
        serde_json::json!({ "mounted": -1, "n": 10, "items": 2, "shown": 2, "seen": 100, "width": 777, "submitted": { "n": 0, "prevented": true },
            "ref": { "tag": "OUTPUT", "asked": ["[data-tp-ref=\"box\"]"] }, "detached": "none" })
    );
    // The server HTML carries the directives the store answers to.
    let functions = std::fs::read_to_string(plugin.join("tp/app/functions.php")).unwrap();
    // A server component a client component renders stays a server component: Badge (in a file
    // that sorts before Switch.tsx) binds none of the Switch's state, though both have an `on`.
    let badge_name = schema["components"]["components/Badge.tsx#Badge"].as_str().unwrap();
    let badge = functions
        .split(&format!("function {badge_name}("))
        .nth(1)
        .and_then(|rest| rest.split("\n}\n").next())
        .unwrap_or_else(|| panic!("no Badge in functions.php"));
    assert!(!badge.contains("data-wp-"), "{badge}");
    assert!(islands.get("clients/Badge").is_none(), "{islands}");
    assert!(islands["clients/Switch"]["file"].is_string(), "{islands}");
    let directives = functions.split_whitespace().collect::<Vec<_>>().join(" ");
    for directive in [
        "'data-wp-interactive' => 'clients/LikeButton'",
        "'data-wp-bind--disabled' => 'context.busy'",
        "'data-wp-on--click' => 'actions.click1'",
        "'data-wp-on-window--resize' => 'actions.onResize3'",
        "'data-wp-watch---effect1' => 'callbacks.effect1'",
        "'data-wp-init---mount2' => 'callbacks.mount2'",
        "'data-wp-on--submit' => 'actions.submit'",
        "'data-tp-ref' => 'box'",
    ] {
        assert!(directives.contains(directive), "{directive}");
    }
    let _ = std::fs::remove_dir_all(project);
}

/// What generator B can't compile is a build error at the line, with the subset's alternative.
#[test]
fn refuses_client_code_outside_the_subset() {
    let dir = std::env::temp_dir().join(format!("typedpress-client-reject-{}", std::process::id()));
    let component =
        |body: &str| format!("\"use client\";\nimport {{ useState }} from \"typedpress/client\";\n{body}\n");
    rejects(
        &dir,
        &[(
            "tp/components/A.tsx",
            &component("export function A() { const [n] = useState(0); return <><b>{n}</b></>; }"),
        )],
        "a client component returns one element",
        "tp/components/A.tsx:3:",
    );
    let refs =
        |body: &str| format!("\"use client\";\nimport {{ useRef, useState }} from \"typedpress/client\";\n{body}\n");
    rejects(
        &dir,
        &[(
            "tp/components/A.tsx",
            &refs("export function A() { const box = useRef(); const [n] = useState(0); return <b>{n}</b>; }"),
        )],
        "`box` is a `useRef()` no element has",
        "tp/components/A.tsx:3:",
    );
    rejects(
        &dir,
        &[(
            "tp/components/A.tsx",
            &refs(
                "export function A() { const box = useRef(); const [n] = useState(0); return <b ref={box}><i ref={box}>{n}</i></b>; }",
            ),
        )],
        "`box` is already attached to an element",
        "tp/components/A.tsx:3:",
    );
    rejects(
        &dir,
        &[(
            "tp/components/A.tsx",
            &refs("export function A() { const [n] = useState(0); return <b ref={n}>{n}</b>; }"),
        )],
        "`ref` takes a `useRef()` of this component",
        "tp/components/A.tsx:3:",
    );
    rejects(
        &dir,
        &[(
            "tp/components/A.tsx",
            "export function A() { return <b ref={null}>x</b>; }\n",
        )],
        "`ref` in a server component",
        "tp/components/A.tsx:1:",
    );
    rejects(
        &dir,
        &[(
            "tp/components/A.tsx",
            &component("import dayjs from \"dayjs\";\nexport function A() { return <b/>; }"),
        )],
        "a \"use client\" component can't import \"dayjs\"",
        "tp/components/A.tsx:3:",
    );
    rejects(
        &dir,
        &[(
            "tp/components/A.tsx",
            &component(
                "export function A() { const [n, setN] = useState(0); return <b onClick={() => { n = 2; }}>{n}</b>; }",
            ),
        )],
        "`n` changes through `setN`",
        "tp/components/A.tsx:3:",
    );
    rejects(
        &dir,
        &[(
            "tp/components/A.tsx",
            &component(
                "const secret = 1;\nexport function A() { const [n, setN] = useState(0); return <b onClick={() => setN(secret)}>{n}</b>; }",
            ),
        )],
        "`secret` isn't available in the browser",
        "tp/components/A.tsx:4:",
    );
    rejects(
        &dir,
        &[(
            "tp/components/A.tsx",
            &component("export function A() { const [n, setN] = useState(0); return <b onClick=\"go()\">{n}</b>; }"),
        )],
        "with a string is inline script",
        "tp/components/A.tsx:3:",
    );
    rejects(
        &dir,
        &[
            (
                "tp/components/A.tsx",
                &component("export function Same() { return <b/>; }"),
            ),
            (
                "tp/components/B.tsx",
                &component("export function Same() { return <i/>; }"),
            ),
        ],
        "two \"use client\" components are named `Same`",
        "tp/components/B.tsx:3:",
    );
    rejects(
        &dir,
        &[(
            "tp/components/A.tsx",
            &component("export function A() { const [n, setN] = useState(0); if (n) { setN(1); } return <b>{n}</b>; }"),
        )],
        "returns its element",
        "tp/components/A.tsx:3:",
    );
    // Reactive lists and conditionals: the item is one keyed element, and each branch is one element.
    let shelf = |markup: &str| {
        component(&format!(
            "export function A() {{ const [xs, setXs] = useState([{{ id: 1, t: \"a\" }}]); return <ul onClick={{() => setXs([])}}>{markup}</ul>; }}"
        ))
    };
    for (markup, refusal) in [
        (
            "{xs.map((x) => <li>{x.t}</li>)}",
            "each item of a reactive list needs a `key`",
        ),
        (
            "{xs.map((x) => <><li key={x.id}/><li/></>)}",
            "each item of a reactive list is one element",
        ),
        (
            "{xs.map((x, i) => <li key={i}/>)}",
            "a reactive list's callback takes one item",
        ),
        (
            "{xs.length > 0 && <><li/><li/></>}",
            "a reactive `&&` renders one element",
        ),
    ] {
        rejects(
            &dir,
            &[("tp/components/A.tsx", &shelf(markup))],
            refusal,
            "tp/components/A.tsx:3:",
        );
    }
    // `useLive`: a query the server and the browser both have (props and literals), and no `seed`.
    let live = |body: &str| {
        component(&format!(
            "import {{ useLive }} from \"typedpress/client\";\nexport function A({{ n }}: {{ n: number }}) {{ {body} }}"
        ))
    };
    rejects(
        &dir,
        &[
            (
                "tp/schema.ts",
                "import { table, text } from \"typedpress\";\nexport const notes = table({ title: text() }, { access: { read: \"anyone\", create: \"admin\", update: \"admin\", delete: \"admin\" } });\n",
            ),
            (
                "tp/components/A.tsx",
                &live(
                    "const [k, setK] = useState(5); const xs = useLive(\"notes\", { limit: k }); return <b onClick={() => setK(1)}>{xs.loading ? 1 : 0}</b>;",
                ),
            ),
        ],
        "a `useLive` query reads props and literals only",
        "tp/components/A.tsx:4:",
    );
    rejects(
        &dir,
        &[
            (
                "tp/schema.ts",
                "import { table, text } from \"typedpress\";\nexport const notes = table({ title: text() }, { access: { read: \"anyone\", create: \"admin\", update: \"admin\", delete: \"admin\" } });\n",
            ),
            (
                "tp/components/A.tsx",
                &live("const xs = useLive(\"notes\", { limit: n }, { seed: 1 }); return <b>{xs.loading ? 1 : 0}</b>;"),
            ),
        ],
        "`useLive` options are `{ enabled }`",
        "tp/components/A.tsx:4:",
    );
    let _ = std::fs::remove_dir_all(dir);
}

/// Forms without JavaScript (rendering.md §4.2), as a browser with scripts off submits them: the
/// form posts form-encoded to its action, the facade answers 303 back to the page with a sealed,
/// read-once flash, and `useFormState` shows the result or the error. The page a form comes back
/// to is never shared, a cross-site post is refused, and a signed-in form carries the REST nonce.
#[test]
fn forms_work_without_javascript() {
    let project = fixture("forms", "serve");
    // The same page at `/join` too: a page that isn't the front page has one address (`/join/`).
    std::fs::create_dir_all(project.join("tp/app/join")).unwrap();
    std::fs::write(
        project.join("tp/app/join/page.tsx"),
        std::fs::read_to_string(project.join("tp/app/page.tsx"))
            .unwrap()
            .replace("\"../server\"", "\"../../server\""),
    )
    .unwrap();
    build(&project);
    // `useFormState(action)` is typed with the action's result.
    let types = root().join("types/typedpress");
    std::fs::write(
        project.join("tsconfig.json"),
        serde_json::json!({
            "compilerOptions": {
                "target": "ES2022", "lib": ["ES2022", "DOM"], "module": "ESNext", "moduleResolution": "bundler",
                "strict": true, "noEmit": true, "types": [], "jsx": "react-jsx", "jsxImportSource": "typedpress",
                "allowImportingTsExtensions": true,
                "paths": { "typedpress": [types.join("index.d.ts")], "typedpress/*": [types.join("*.d.ts")] },
            },
            "include": ["typedpress.config.ts", "tp", "typed.ts"],
        })
        .to_string(),
    )
    .unwrap();
    std::fs::write(
        project.join("typed.ts"),
        r#"import { useFormState } from "typedpress/app";
import { subscribe } from "./tp/server";
const state = useFormState(subscribe);
export const seats: number | undefined = state.result?.seats;
// @ts-expect-error: the result has no `nope`
export const nope = state.result?.nope;
export const typed: string | undefined = state.values.email ?? state.error?.fields.seats;
// @ts-expect-error: `emial` isn't an input of `subscribe`
export const typo = state.values.emial;
"#,
    )
    .unwrap();
    let tsc = Command::new("tsc")
        .arg("-p")
        .arg(&project)
        .output()
        .expect("tsc is required");
    assert!(tsc.status.success(), "{}", String::from_utf8_lossy(&tsc.stdout));
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/forms.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    // The same site under `/blog`: the form's return carries the home path, and the post comes back
    // to the page once (`/blog/join/`), not to `/blog/blog/join`.
    let sub = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/forms.php"))
        .arg(project.join("tp/dist/wp-content"))
        .arg("/blog")
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        sub.status.success(),
        "{}{}",
        String::from_utf8_lossy(&sub.stdout),
        String::from_utf8_lossy(&sub.stderr)
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&sub.stdout).unwrap(),
        serde_json::json!({
            "return": "/blog/join/",
            "location": "/blog/join/?_flash=ID",
            "back": [200, "Subscribed sub@example.test for 1 (weekly: false)"]
        })
    );
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        seen["form"],
        serde_json::json!({
            "method": "post",
            "action": "/wp-json/typedpress/v1/actions/subscribe",
            "hidden": [["_tp_return", "hidden", "/?ref=nav"], ["_tp_form", "hidden", "1"]],
            "page cache": "public, max-age=0, s-maxage=300, must-revalidate",
            "undeclared query": "private, no-store, max-age=0",
        }),
        "an anonymous page with a form stays shared and carries no nonce: {seen}"
    );
    assert_eq!(
        seen["success"],
        serde_json::json!({
            "status": 303,
            "location": "/?ref=nav&_flash=ID",
            "cookie flags": ["Max-Age=120", "Path=/", "HttpOnly", "SameSite=Lax"],
            "done": "Subscribed ada@example.test for 3 (weekly: true)",
            "back cache": "private, no-store, max-age=0",
            "cookie cleared": true,
            "again": null,
            "forged": null,
        }),
        "{seen}"
    );
    assert_eq!(
        seen["unchecked"],
        serde_json::json!("Subscribed bo@example.test for 1 (weekly: false)")
    );
    assert_eq!(
        seen["invalid"],
        serde_json::json!({
            "status": 303,
            "error": "email must be an email address",
            "field": "email must be an email address",
            "refilled": "not an email",
            "seats refilled": "2",
        }),
        "{seen}"
    );
    // The fields of `<form action>` carry the state themselves: `aria-invalid` on the field the
    // error names, the typed value back where the page doesn't set one (never a password), a checked
    // box checked again, and the form's `data-tp-form-state`. A success leaves the form empty.
    assert_eq!(
        seen["field state"],
        serde_json::json!({
            "initial": { "form": null, "invalid": [], "note": null, "weekly": false, "password": "" },
            "error": { "form": "error", "invalid": ["email"], "note": "Keep me", "weekly": true, "password": "" },
            "success": { "form": "success", "invalid": [], "note": null, "weekly": false, "password": "" },
        }),
        "{seen}"
    );
    // A form per row for one action: the state comes back on the row that posted (`_tp_form`), with
    // the boxes and the radio choice it sent over the page's default; the other rows keep what is
    // stored. After a success every row shows the stored names.
    let row = |form: &str, name: &str, state: Option<&str>, invalid: Option<&str>, tags: &[&str], size: &[&str]| serde_json::json!({ "state": state, "form": form, "name": name, "invalid": invalid, "tags": tags, "size": size });
    assert_eq!(
        seen["rows"],
        serde_json::json!({
            "initial": [row("1", "Ann", None, None, &[], &["m"]), row("2", "Bo", None, None, &[], &["m"]), row("3", "Cy", None, None, &[], &["m"])],
            "refused": [
                row("1", "Ann", None, None, &[], &["m"]),
                row("2", "x", Some("error"), Some("true"), &["red"], &["s"]),
                row("3", "Cy", None, None, &[], &["m"]),
            ],
            "two boxes": ["red", "blue"],
            "messages": ["name must be two characters or more", null],
            "renamed": [
                "Renamed Bea (blue; m)",
                [row("1", "Ann", None, None, &[], &["m"]), row("2", "Bea", Some("success"), None, &[], &["m"]), row("3", "Cy", None, None, &[], &["m"])],
            ],
        }),
        "{seen}"
    );
    // What was typed into a password field is never sent back to fill the form.
    assert_eq!(
        seen["password"],
        serde_json::json!(["email must be an email address", "", "p-at-example"]),
        "{seen}"
    );
    assert_eq!(seen["handler error"], serde_json::json!("Five seats at most"));
    assert_eq!(seen["not a number"], serde_json::json!("seats must be a finite number"));
    assert_eq!(seen["open redirect"], serde_json::json!(true));
    // A form on a page's other spelling (`/join`) comes back to the page's one address, and the
    // result shows there: the router never moves a request that carries a result.
    assert_eq!(
        seen["other spelling"],
        serde_json::json!(["/join/", "Subscribed b@example.test for 2 (weekly: false)"])
    );
    assert_eq!(seen["flash bare"], serde_json::json!([200, null]));
    assert_eq!(
        seen["cross site"],
        serde_json::json!([303, "A form posts here only from this site's own pages", null])
    );
    assert_eq!(
        seen["json"],
        serde_json::json!([200, 1]),
        "a JSON call to the same URL is unchanged"
    );
    assert_eq!(
        seen["signed out"],
        serde_json::json!(["Sign in to do run members", null])
    );
    let user = seen["signed in"]["user"].as_i64().unwrap();
    assert_eq!(
        seen["signed in"],
        serde_json::json!({
            "nonce": true,
            "page cache": "private, no-store, max-age=0",
            "member": format!("Ann by {user}"),
            "user": user,
        }),
        "{seen}"
    );
    assert_eq!(
        seen["no nonce"],
        serde_json::json!([303, "Sign in to do run members", null]),
        "{seen}"
    );
}

/// The JavaScript submit (rendering.md §4.2), in Chromium on tests/fixtures/forms: a submit swaps
/// the page it comes back to into the router region with no page load, the page with the flash is
/// fetched once, the URL bar ends on the page without `?_flash`, and the form is busy while the post
/// is in flight. A second submit then, a failure after the post was sent, and a `<Link>` click or a
/// `<Live>` update during it never post again or undo each other. Only a router module that can't
/// load falls back to the browser's own post.
#[test]
fn forms_submit_in_place_in_the_browser() {
    assert!(
        root()
            .join("tests/differential/client/node_modules/playwright-core")
            .is_dir(),
        "run: npm ci --prefix tests/differential/client && npx --prefix tests/differential/client playwright-core install chromium-headless-shell"
    );
    let project = fixture("forms", "browser");
    build(&project);
    let mut server = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/serve_built.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .env("TP_WP_SCRIPT_DEBUG", "1")
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    std::io::BufRead::read_line(&mut std::io::BufReader::new(server.stdout.take().unwrap()), &mut line).unwrap();
    let url = serde_json::from_str::<serde_json::Value>(&line).unwrap_or_else(|_| panic!("serve: {line}"))["url"]
        .as_str()
        .unwrap()
        .to_string();
    let out = Command::new("node")
        .arg(root().join("tests/differential/client/forms-submit.mjs"))
        .arg(&url)
        .output()
        .unwrap();
    let _ = Command::new("kill").arg(server.id().to_string()).output();
    let _ = server.wait();
    let _ = std::fs::remove_dir_all(project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(seen["errors"], serde_json::json!([]), "{seen}");
    assert_eq!(
        seen["prefetch"],
        serde_json::json!([["Form", true], ["Bare template", false]]),
        "{seen}"
    );
    assert_eq!(
        seen["directive"],
        serde_json::json!(["tp/router", "actions.submit"]),
        "{seen}"
    );
    assert_eq!(
        seen["pending"],
        serde_json::json!({ "busy": "true", "disabled": [true] }),
        "{seen}"
    );
    let success = &seen["success"];
    assert_eq!(
        success["done"], "Subscribed ada@example.test for 3 (weekly: true)",
        "{seen}"
    );
    // A second submit while the first was in flight sent nothing.
    assert_eq!(
        success["posts"],
        serde_json::json!(["/wp-json/typedpress/v1/actions/subscribe"]),
        "{seen}"
    );
    // The same document: the window marker survives and no navigation entry was added.
    assert_eq!(
        (&success["marker"], &success["navigations"]),
        (&serde_json::json!("same document"), &serde_json::json!(1)),
        "{seen}"
    );
    // The page with the flash is fetched once (fetch following the 303), and the URL bar and the
    // history entry are the page's, replaced, without the marker.
    assert_eq!(success["requests"].as_array().map(Vec::len), Some(1), "{seen}");
    assert!(
        success["requests"][0]
            .as_str()
            .unwrap()
            .starts_with("GET /?ref=nav&_flash="),
        "{seen}"
    );
    assert_eq!(
        (&success["url"], &success["historyAdded"]),
        (&serde_json::json!("/?ref=nav"), &serde_json::json!(0)),
        "{seen}"
    );
    assert_eq!(
        success["afterPending"],
        serde_json::json!({ "busy": null, "disabled": [false] }),
        "{seen}"
    );
    assert_eq!(
        (&success["scrollKept"], &success["focus"]),
        (&serde_json::json!(true), &serde_json::json!("BUTTON")),
        "{seen}"
    );
    // After a success the form is empty again, typed text and the checked box included.
    assert_eq!(
        success["reset"],
        serde_json::json!({ "state": "success", "email": "", "note": "", "weekly": false }),
        "{seen}"
    );
    // A refusal: the error and what was typed, in place, the same way.
    let refused = &seen["refused"];
    assert_eq!(
        (
            &refused["error"],
            &refused["code"],
            &refused["done"],
            &refused["email"],
            &refused["marker"],
            &refused["url"]
        ),
        (
            &serde_json::json!("Five seats at most"),
            &serde_json::json!("too_many"),
            &serde_json::json!(false),
            &serde_json::json!("grace@example.test"),
            &serde_json::json!("same document"),
            &serde_json::json!("/?ref=nav")
        ),
        "{seen}"
    );
    assert_eq!(refused["requests"].as_array().map(Vec::len), Some(1), "{seen}");
    assert_eq!(refused["kept"], serde_json::json!(["error", "Kept note"]), "{seen}");
    // A form per row filled from what is stored: a `<Live>` update keeps a refused row's refill and
    // text typed in another row, and after a success the row shows the stored name.
    assert_eq!(
        seen["rows"],
        serde_json::json!({
            "firstName": "Mine",
            "afterLive": { "name": "x", "red": true, "invalid": "true" },
            "typing": "Typing here",
            "renamed": "Renamed Renamed row (red; m)",
            "after": { "state": "success", "name": "Renamed row", "red": false, "size": "m" },
        }),
        "{seen}"
    );
    // The pressed button's value is the input, from inside the form and from a `form="vote"` button
    // outside it, which is disabled and marked while pending; a button the page disabled stays so.
    assert_eq!(
        seen["buttons"],
        serde_json::json!({ "maybe": "Voted maybe", "no": "Voted no", "outsidePending": [true, true], "yesPending": false, "after": [false, false] }),
        "{seen}"
    );
    // A 500 after the action ran, and a dropped connection: an error in the form, one post each.
    assert_eq!(
        seen["failed"],
        serde_json::json!({
            "posts": ["/wp-json/typedpress/v1/actions/subscribe"],
            "message": ["alert", true],
            "afterPending": { "busy": null, "disabled": [false] },
            "marker": "same document",
        }),
        "{seen}"
    );
    assert_eq!(
        seen["dropped"],
        serde_json::json!({ "posts": ["/wp-json/typedpress/v1/actions/subscribe"], "message": true, "marker": "same document" }),
        "{seen}"
    );
    // A `<Link>` click during a submit: the linked page stays; the late answer isn't rendered.
    assert_eq!(
        seen["link"],
        // `<Link href="/other">` is written at the page's one address.
        serde_json::json!({ "url": "/other/", "other": true, "voted": false, "marker": "same document" }),
        "{seen}"
    );
    // A `<Live>` update during a submit waits for it: the page that comes back has both entries,
    // and no pending marker from the copy the update would have used.
    assert_eq!(
        seen["live"],
        serde_json::json!({
            "write": 201,
            "whileHeld": [],
            "heldBusy": "true",
            "signed": "Signed Mine",
            "entries": ["Theirs", "Mine"],
            "afterPending": { "busy": null, "disabled": [false] },
        }),
        "{seen}"
    );
    assert_eq!(seen["ranOnce"], serde_json::json!({ "posts": 1, "rows": 1 }), "{seen}");
    // A `<Link>` to a page slower than the post: the post's answer isn't rendered while the link's
    // page loads, and the navigation the click started finishes.
    assert_eq!(
        seen["slowLink"],
        serde_json::json!({ "beforeLink": { "url": "/?ref=nav", "voted": false }, "url": "/other/", "other": true, "marker": "same document" }),
        "{seen}"
    );
    // Two forms at once, the older answer last: the newer page stays, and the older form says so.
    assert_eq!(
        seen["overtaken"],
        serde_json::json!({ "done": "Subscribed two@example.test for 2 (weekly: false)", "voted": false, "message": 1 }),
        "{seen}"
    );
    // A FormData that ignores the submitter: the pressed button's value is sent, once.
    assert_eq!(
        seen["oldFormData"],
        serde_json::json!({ "voted": "Voted maybe", "choices": [["maybe"]] }),
        "{seen}"
    );
    // A button the page it comes back to renders disabled stays disabled; the page's status
    // message is announced politely, outside the router region.
    assert_eq!(
        seen["serverDisabled"],
        serde_json::json!({ "disabled": true, "marked": false }),
        "{seen}"
    );
    assert_eq!(
        seen["announced"],
        serde_json::json!(["polite", "The poll is closed.", true]),
        "{seen}"
    );
    // The page the action comes back to is a 404 now: shown in place, with no error message.
    let gone = &seen["gone"];
    assert_eq!(
        (&gone["missing"], &gone["error"], &gone["marker"]),
        (
            &serde_json::json!("No such entry"),
            &serde_json::json!(false),
            &serde_json::json!("same document")
        ),
        "{seen}"
    );
    assert!(gone["url"].as_str().unwrap_or("").starts_with("/entries/"), "{seen}");
    // A `<Live>` update doesn't copy the error message; the next submit removes it.
    assert_eq!(
        seen["errorBox"],
        serde_json::json!({ "afterLive": 1, "afterSubmit": 0 }),
        "{seen}"
    );
    // A region answer newer than the submit's page: after the swap the region still has it.
    assert_eq!(
        seen["newerRegion"],
        serde_json::json!({ "before": true, "newer": true }),
        "{seen}"
    );
    // The router module can't load: the browser posts the form itself, nothing sent before; the
    // address bar loses `?_flash` when the page's module runs.
    assert_eq!(
        seen["fallback"],
        serde_json::json!({ "done": "Subscribed lin@example.test for 2 (weekly: false)", "marker": null, "url": "/?ref=nav" }),
        "{seen}"
    );
    // An answer in another block template becomes the whole document (its flash read once, the
    // marker out of the address), never a region swapped into other chrome.
    assert_eq!(
        seen["otherTemplate"],
        serde_json::json!({ "from": "tp-blank", "to": "tp-page", "voted": "Voted bare", "header": 1, "regions": 1, "url": "/" }),
        "{seen}"
    );
    // A stale answer in another block template is dropped after a `<Link>` navigation or a newer
    // submit (#537).
    assert_eq!(
        seen["otherTemplateStaleLink"],
        serde_json::json!({ "url": "/other/", "other": true, "template": "tp-page", "marker": "same document" }),
        "{seen}"
    );
    assert_eq!(
        seen["otherTemplateOvertaken"],
        serde_json::json!({ "url": "/?ref=nav", "done": "Subscribed three@example.test for 1 (weekly: false)", "template": "tp-page", "marker": "same document", "message": 1 }),
        "{seen}"
    );
}

/// `<Comments for={item} />` and the policy behind it (docs/decisions/2026-11-14-comments.md), with
/// comments arriving all three ways: the component's form with JavaScript off, the facade's
/// `POST /comments`, and core's `wp-comments-post.php`. Each gets the same answer from the one
/// enforcement point on core's hooks, whatever the Discussion settings say.
#[test]
fn comments_follow_the_kind_policy_on_every_path() {
    let project = fixture("comments", "serve");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/comments.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    // Signed out: the approved thread and a sign-in link, no form; the page stays shared.
    assert_eq!(
        seen["signed out"],
        serde_json::json!({
            "status": 200, "thread": ["TypedPress!"], "forms": 0, "sign in": "Sign in to comment",
            "cache": "public, max-age=0, s-maxage=300, must-revalidate",
        }),
        "{seen}"
    );
    // ...and every path refuses a signed-out comment, saving nothing.
    assert_eq!(
        seen["signed out posts"],
        serde_json::json!({ "facade": 401, "form": [303, "Sorry, you must be logged in to comment."], "core": 401, "saved": 0 }),
        "{seen}"
    );
    // A first-time commenter's comment is held and shown only to them, with the form's notice.
    assert_eq!(
        seen["first comment"],
        serde_json::json!({
            "status": 303, "stored": "unapproved", "notice": "Your comment is awaiting moderation.",
            "ann sees": ["TypedPress!", "Hello from Ann (held)"], "others see": ["TypedPress!"], "bo sees": ["TypedPress!"],
            "page cache": "private, no-store, max-age=0", "nonce": true,
        }),
        "{seen}"
    );
    // After one of theirs is approved, the next is approved at once, even with the site's
    // "hold every comment" setting on; a first-timer through core's handler is held.
    assert_eq!(seen["second comment"], serde_json::json!([201, "approved"]), "{seen}");
    assert_eq!(seen["core path"], serde_json::json!([302, "unapproved"]), "{seen}");
    // Threaded to depth 3: a fourth level is refused on every path (never flattened), and the page
    // offers no reply form under a depth-3 comment.
    let depth = &seen["depth"];
    assert_eq!(
        (&depth["form"], &depth["facade"], &depth["core"], &depth["saved"]),
        (
            &serde_json::json!("Replies go 3 levels deep here."),
            &serde_json::json!(400),
            &serde_json::json!(400),
            &serde_json::json!(0)
        ),
        "{seen}"
    );
    assert_eq!(
        depth["thread"],
        serde_json::json!([
            "TypedPress!",
            ">depth two",
            ">>depth three",
            "Hello from Ann",
            "Ann again"
        ])
    );
    assert!(
        !depth["reply forms on"]
            .as_array()
            .unwrap()
            .contains(&depth["depth three id"]),
        "{seen}"
    );
    // A draft's thread isn't readable by a visitor who can't read the draft, nor commentable.
    assert_eq!(
        seen["draft"],
        serde_json::json!({ "page": 404, "page shows": false, "list": 403, "post": 403 }),
        "{seen}"
    );
    // An authored policy (`comments: { guests: true, moderation: "none", threaded: false,
    // closeAfterDays: 30 }`): a signed-out visitor comments through the facade and core's handler,
    // approved at once; a reply on a flat thread is refused; an item published 40 days ago is closed.
    assert_eq!(
        seen["authored policy"],
        serde_json::json!({ "guest facade": [201, "approved"], "guest core": [302, "approved"], "reply": 400, "closed": 403 }),
        "{seen}"
    );
    // A guest without a name or a valid email is refused on every path, with the Discussion
    // setting `require_name_email` off: the policy decides.
    assert_eq!(
        seen["guest identity"],
        serde_json::json!({ "facade": 400, "core": 400, "form": [303, "Please fill the required fields (name, email)."], "saved": 0 }),
        "{seen}"
    );
    assert_eq!(seen["memo"], 403, "a kind without comments takes none: {seen}");
    // A cached page at another address that rendered the note's thread is purged too.
    assert_eq!(
        seen["featured cache"], "public, max-age=0, s-maxage=300, must-revalidate",
        "{seen}"
    );
    assert_eq!(seen["featured purged"], serde_json::json!([true, true]), "{seen}");
    // The page cache: a comment event that changes what visitors see of the thread purges the
    // item's URL (its one address), its twin and its comments feed; a held or spam submission purges
    // nothing.
    let note = serde_json::json!(["/notes/open-note/", "/notes/open-note.md", "/notes/open-note/feed/"]);
    let none = serde_json::json!([]);
    for (event, want) in [
        ("held", &none),
        ("spam", &none),
        ("approved", &note),
        ("edited", &note),
        ("unapproved", &note),
        ("edited while held", &none),
        ("approved again", &note),
        ("deleted", &note),
        ("approved then spammed", &note),
        ("approved then trashed", &note),
        ("edited and approved at once", &note),
        ("approved on insert", &note),
    ] {
        assert_eq!(&seen["purges"][event], want, "{event}: {seen}");
    }
}

/// `<Search>` and `<SearchResults>` (docs/decisions/2026-11-14-search.md) on WordPress, fetched as a
/// browser without JavaScript would: the bare form is cacheable; a page that searched is private,
/// `noindex`, and recorded nowhere; results are what the visitor may read, linked to their kinds'
/// URLs, paged by `<Pagination>`'s parameter, and grouped per kind site-wide.
#[test]
fn search_pages_answer_as_the_visitor() {
    let project = fixture("search", "serve");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/search_pages.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value =
        serde_json::from_slice(&out.stdout).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out.stdout)));
    use serde_json::json;
    let shared = "public, max-age=0, s-maxage=300, must-revalidate";
    let private = "private, no-store, max-age=0";
    // The bare form: a GET to the action, cacheable and indexable.
    assert_eq!(
        seen["form"],
        json!({ "method": "get", "action": "/find", "cache": shared, "robots": null }),
        "{seen}"
    );
    // No query (or only spaces): no read, no "no results", still shared.
    for key in ["empty", "blank q"] {
        assert_eq!(seen[key]["status"], 200, "{key}: {seen}");
        assert_eq!(seen[key]["cache"], shared, "{key}: {seen}");
        assert_eq!(seen[key]["count"], json!(null), "{key}: {seen}");
        assert_eq!(seen[key]["robots meta"], false, "{key}: {seen}");
    }
    assert_eq!(seen["blank q"]["input"], json!(["q", "200", ""]), "{seen}");
    // Site-wide: notes and guides (memos has no URL), two per kind, a link to the rest of notes.
    let site = &seen["site"];
    assert_eq!(
        (
            &site["status"],
            &site["cache"],
            &site["robots header"],
            &site["robots meta"]
        ),
        (&json!(200), &json!(private), &json!("noindex"), &json!(true)),
        "{seen}"
    );
    assert_eq!(site["count"], "4 results", "{seen}");
    assert_eq!(site["groups"], json!(["Notes", "Guides"]), "{seen}");
    assert_eq!(
        site["results"],
        json!([
            "Tea ceremony /notes/tea-ceremony/",
            "Tea gardens /notes/tea-gardens/",
            "Tea guide /guides/tea-guide/"
        ]),
        "{seen}"
    );
    assert_eq!(site["more"], json!(["/find/?q=tea&kind=notes"]), "{seen}");
    assert_eq!(site["input"], json!(["q", "200", "tea"]), "{seen}");
    // One kind, paged by `page`, links keeping `q`; the draft and the hidden-field match never count.
    assert_eq!(seen["one kind"]["count"], "3 results", "{seen}");
    assert_eq!(seen["one kind"]["results"].as_array().unwrap().len(), 2, "{seen}");
    assert_eq!(
        seen["one kind"]["pages"],
        json!(["2 q=tea&page=2", "Next q=tea&page=2"]),
        "{seen}"
    );
    assert_eq!(
        seen["page two"]["results"],
        json!(["Tea history /notes/tea-history/"]),
        "{seen}"
    );
    assert_eq!(
        seen["page two"]["pages"],
        json!(["Previous q=tea", "1 q=tea"]),
        "{seen}"
    );
    assert_eq!(seen["hidden field"]["count"], "No results.", "{seen}");
    assert_eq!(seen["hidden field"]["results"], json!([]), "{seen}");
    // `kind=` narrows the site-wide page; a kind it doesn't cover, or no kind at all, finds nothing.
    assert_eq!(seen["narrowed"]["count"], "3 results", "{seen}");
    assert_eq!(seen["narrowed"]["groups"], json!([]), "{seen}");
    assert_eq!(
        seen["narrowed"]["pages"],
        json!(["2 q=tea&kind=notes&page=2", "Next q=tea&kind=notes&page=2"]),
        "{seen}"
    );
    for key in ["narrowed to memos", "narrowed to nothing"] {
        assert_eq!(
            (&seen[key]["status"], &seen[key]["count"]),
            (&json!(200), &json!("No results.")),
            "{key}: {seen}"
        );
    }
    // Longer than the input allows: a plain message, never an error page.
    assert_eq!(seen["too long"]["status"], 200, "{seen}");
    assert_eq!(
        seen["too long"]["too long"], "Searches are at most 200 characters.",
        "{seen}"
    );
    // Every search above, and three more: nothing in the page cache's read index.
    assert_eq!(seen["recorded"], 0, "{seen}");
    // A signed-in editor finds the draft and the hidden-field match, in a private response.
    assert_eq!(seen["editor"]["cache"], private, "{seen}");
    assert_eq!(seen["editor"]["count"], "4 results", "{seen}");
    assert_eq!(
        seen["editor"]["results"][0], "Draft about tea /notes/draft-about-tea/",
        "{seen}"
    );
    assert_eq!(
        seen["editor hidden"],
        json!(["Plain note /notes/plain-note/"]),
        "{seen}"
    );
}

/// `<SearchResults kind>` names a kind with a url, literally; `<Search action>` is a literal path on
/// this site. Anything else is a build error at the prop, with the fix.
#[test]
fn refuses_search_it_cannot_link() {
    let dir = std::env::temp_dir().join(format!("typedpress-search-reject-{}", std::process::id()));
    let schema = (
        "tp/schema.ts",
        "import { collection, text } from \"typedpress\";\nexport const memos = collection({ title: text() }, { title: \"title\", access: { read: \"anyone\", create: \"editor\", update: \"editor\", delete: \"editor\" } });\n",
    );
    let page = |body: &str| {
        format!(
            "import {{ Search, SearchResults }} from \"typedpress/app\";\nexport default function P() {{\n  return {body};\n}}\n"
        )
    };
    rejects(
        &dir,
        &[
            schema,
            ("tp/app/page.tsx", &page("<SearchResults kind=\"memos\" q=\"x\" />")),
        ],
        "`memos` has no url for a result to link to",
        "tp/app/page.tsx:3:",
    );
    rejects(
        &dir,
        &[
            schema,
            ("tp/app/page.tsx", &page("<SearchResults kind=\"nope\" q=\"x\" />")),
        ],
        "there is no kind `nope` to search",
        "tp/app/page.tsx:3:",
    );
    rejects(
        &dir,
        &[
            schema,
            (
                "tp/app/page.tsx",
                &page("<Search action=\"https://elsewhere.example/\" />"),
            ),
        ],
        "`<Search action>` is a path on this site",
        "tp/app/page.tsx:3:",
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// `<Comments for>` on a kind without `comments`, or on something that isn't an item, is a build
/// error at the prop.
#[test]
fn refuses_comments_without_the_kind_option() {
    let dir = std::env::temp_dir().join(format!("typedpress-comments-reject-{}", std::process::id()));
    let schema = (
        "tp/schema.ts",
        "import { collection, text, slug } from \"typedpress\";\nexport const memos = collection({ title: text(), slug: slug({ source: \"title\" }).optional() }, { title: \"title\", url: \"/memos/:slug\" });\n",
    );
    rejects(
        &dir,
        &[
            schema,
            (
                "tp/app/memos/[slug]/page.tsx",
                "import { Comments, type PageProps } from \"typedpress/app\";\nexport default function Memo({ item }: PageProps<\"memos/[slug]\">) {\n  return <Comments for={item} />;\n}\n",
            ),
        ],
        "`memos` has comments off",
        "tp/app/memos/[slug]/page.tsx:3:",
    );
    rejects(
        &dir,
        &[
            schema,
            (
                "tp/app/page.tsx",
                "import { Comments } from \"typedpress/app\";\nexport default function Home() {\n  return <Comments for={{ id: 1 }} />;\n}\n",
            ),
        ],
        "`<Comments for>` takes a row of a collection",
        "tp/app/page.tsx:3:",
    );
    let _ = std::fs::remove_dir_all(dir);
}

/// What a form with an action can't be is a build error at the line, with the fix.
#[test]
fn refuses_forms_it_cannot_post() {
    let dir = std::env::temp_dir().join(format!("typedpress-forms-reject-{}", std::process::id()));
    let server = (
        "tp/server.ts",
        "import { text, mutation } from \"typedpress\";\nexport const send = mutation({ access: \"anyone\" }, async ({ name }: { name: string }) => { return name; });\n",
    );
    let page = |body: &str| {
        format!("import {{ useFormState }} from \"typedpress/app\";\nimport {{ send }} from \"../server\";\n{body}\n")
    };
    rejects(
        &dir,
        &[
            server,
            (
                "tp/app/page.tsx",
                &page("export default function Page() { return <form action={send} method=\"get\"><button/></form>; }"),
            ),
        ],
        "a form with an action posts it form-encoded",
        "tp/app/page.tsx:3:",
    );
    rejects(
        &dir,
        &[
            server,
            (
                "tp/app/page.tsx",
                &page(
                    "const other = 1;\nexport default function Page() { const s = useFormState(other); return <b>{String(s.pending)}</b>; }",
                ),
            ),
        ],
        "`useFormState()` takes an action imported from your server code",
        "tp/app/page.tsx:4:",
    );
    rejects(
        &dir,
        &[
            server,
            (
                "tp/components/Box.tsx",
                "\"use client\";\nimport { send } from \"../server\";\nexport function Box() { return <form action={send}><button/></form>; }\n",
            ),
        ],
        "a \"use client\" component's form calls its action from a handler",
        "tp/components/Box.tsx:3:",
    );
    // A field the action doesn't take: the action would refuse every submit, so the build does.
    rejects(
        &dir,
        &[
            server,
            (
                "tp/app/page.tsx",
                &page(
                    "export default function Page() { return <form action={send}><input name=\"nmae\" /><button/></form>; }",
                ),
            ),
        ],
        "`nmae` isn't an input of `send`, so the action would refuse this form",
        "tp/app/page.tsx:3:",
    );
    rejects(
        &dir,
        &[
            server,
            (
                "tp/app/page.tsx",
                &page(
                    "export default function Page() { return <form action={send}><p><select name=\"other\"><option>x</option></select></p></form>; }",
                ),
            ),
        ],
        "`other` isn't an input of `send`",
        "tp/app/page.tsx:3:",
    );
    rejects(
        &dir,
        &[
            server,
            (
                "tp/app/page.tsx",
                &page(
                    "export default function Page() { return <form action={send}><input type=\"image\" name=\"go\" src=\"/go.png\" alt=\"Go\" /></form>; }",
                ),
            ),
        ],
        "an image button named `go` sends `go.x` and `go.y`, which `send` would refuse",
        "tp/app/page.tsx:3:",
    );
    // Controls the browser never sends with the form aren't checked: this page builds.
    let ok = std::env::temp_dir().join(format!("typedpress-forms-ok-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&ok);
    std::fs::create_dir_all(ok.join("tp/app")).unwrap();
    std::fs::write(
        ok.join("typedpress.config.ts"),
        "import { defineConfig } from \"typedpress\";\nexport default defineConfig({});\n",
    )
    .unwrap();
    std::fs::write(ok.join(server.0), server.1).unwrap();
    std::fs::write(
        ok.join("tp/app/page.tsx"),
        page("export default function Page() { return <form action={send}><input name=\"name\" /><button type=\"button\" name=\"preview\">Preview</button><input name=\"draft\" disabled /><button name=\"elsewhere\" formAction=\"/other\">Other</button><input name=\"_tp_form\" type=\"hidden\" value=\"1\" /><button>Send</button></form>; }"),
    )
    .unwrap();
    let out = first().arg("check").arg(&ok).output().unwrap();
    let _ = std::fs::remove_dir_all(&ok);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    // `useFormState` knows the action's input fields.
    rejects(
        &dir,
        &[
            server,
            (
                "tp/app/page.tsx",
                &page(
                    "export default function Page() { const s = useFormState(send); return <b>{s.values.nmae}</b>; }",
                ),
            ),
        ],
        "has no field `nmae`",
        "tp/app/page.tsx:3:",
    );
    let _ = std::fs::remove_dir_all(dir);
}

/// The subscription endpoint's `page` read for `<Live>` regions (docs/decisions/2026-11-14-live-regions.md),
/// over HTTP on WordPress: the region's HTML as the visitor sees it, "not modified" by counter only
/// when every kind the page read has one (and then without rendering), render-and-compare when it
/// read nothing, problems (never HTML) for a guard, a missing region and anything not a page path,
/// four page reads per request at most, nothing recorded for the page cache, and a new build is a
/// new question.
#[test]
fn live_regions_answer_page_reads() {
    let project = fixture("live-regions", "serve");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/live_regions.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        seen,
        serde_json::json!({
            // The region's own HTML, not the page's.
            // The kinds the render read come back, by the client's schema key, for its deps.
            "page seed": [0, ["notes"]],
            "page seed other viewer": "changed",
            "first poll": ["unchanged", 1],
            "unsealed page seed": [false, ["notes"], "changed", ["One"]],
            "write before first poll": ["changed", ["One", "Two"]],
            "first": ["changed", ["One"], false, ["notes"]],
            // Asked again, unchanged: answered by counter, with no render.
            "again": { "0": "unchanged", "rendered": 0 },
            // Two renders of the same data hash the same.
            "same hash": true,
            "after write": ["changed", ["One", "Two"]],
            // A draft an anonymous visitor can't read is no change for them.
            "after draft": "unchanged",
            // A page that read nothing has no counters: it renders and compares.
            "no reads": { "0": "changed", "1": "unchanged", "rendered": 1 },
            "guarded anonymous": "error 401 unauthenticated",
            "missing region": "error 404 not_found",
            "not a page": "error 404 not_found",
            "host": "error 422 invalid_input",
            "scheme": "error 422 invalid_input",
            "bad region": "error 422 invalid_input",
            "cap": [["changed", "changed", "changed", "changed", "pending"], "changed"],
            // An editor reads the guarded page and the drafts; their renders record nothing for the
            // shared page cache, while an anonymous GET does.
            "editor": ["changed", 3, ["One", "Two", "Draft"]],
            "records nothing": 0,
            "a GET records": true,
            // `<Live>` around `<Comments>`: core's comment query has no counter, so the page renders
            // on every poll and a new approved comment shows on the next one.
            // Its kinds name `wp:comments`, so a notice for a comment's approval asks again at once.
            "comments": { "0": "changed", "1": false, "2": "changed", "3": true, "rendered": 1, "kinds": ["notes", "wp:comments"] },
            // The visitor key includes the post-password cookie: a protected note shows only with
            // it, and neither visitor's token is "not modified" for the other.
            "password": {
                "without": false,
                "with": true,
                "without token, with cookie": ["changed", true],
                "with token, without cookie": ["changed", false],
            },
            // A seed older than the counters' trust window (a cached page): rendered and compared, unchanged.
            "aged seed": { "0": "unchanged", "rendered": 1 },
            // Same data, new build: the region renders again.
            "new build": ["changed", true],
        })
    );
}

/// `<Live>` regions in Chromium (tests/differential/client/live-regions.mjs): after load exactly
/// one request to the subscription endpoint, carrying the page's region and answered unchanged; another
/// visitor's write shows on the next poll with no reload, and a client component's state, its node and
/// an input's text inside the region survive the update. With a realtime transport live, a comment
/// approved on the server shows at once on the `wp:comments` notice, not after the safety poll.
#[test]
fn live_regions_update_in_the_browser() {
    assert!(
        root()
            .join("tests/differential/client/node_modules/playwright-core")
            .is_dir(),
        "run: npm ci --prefix tests/differential/client && npx --prefix tests/differential/client playwright-core install chromium-headless-shell"
    );
    let project = fixture("live-regions", "browser");
    build(&project);
    let mut server = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/serve_built.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .env("TP_WP_SCRIPT_DEBUG", "1")
        .env(
            "TP_SERVE_MU",
            root().join("tests/differential/client/live-regions-mu.php"),
        )
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    std::io::BufRead::read_line(&mut std::io::BufReader::new(server.stdout.take().unwrap()), &mut line).unwrap();
    let url = serde_json::from_str::<serde_json::Value>(&line).unwrap_or_else(|_| panic!("serve: {line}"))["url"]
        .as_str()
        .unwrap()
        .to_string();
    let out = Command::new("node")
        .arg(root().join("tests/differential/client/live-regions.mjs"))
        .arg(&url)
        .output()
        .unwrap();
    let _ = Command::new("kill").arg(server.id().to_string()).output();
    let _ = server.wait();
    let _ = std::fs::remove_dir_all(project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(seen["errors"], serde_json::json!([]), "{seen}");
    // The GET supplies the HTML. Its first subscription request checks the seed by hash once.
    assert_eq!(
        seen["first"],
        serde_json::json!({ "requests": 1, "regions": ["board"], "answer": ["unchanged"], "beforePoll": true, "rendered": 1 }),
        "{seen}"
    );
    // A cached copy taken before a write: its first request brings the region current, no poll.
    assert_eq!(
        (&seen["stale"]["cachedHasAda"], &seen["stale"]["requests"]),
        (&serde_json::json!(false), &serde_json::json!(1)),
        "{seen}"
    );
    assert_eq!(
        (&seen["write"], &seen["after"]),
        (
            &serde_json::json!(201),
            &serde_json::json!({ "signatures": ["Grace"], "counter": "clicked 1", "sameCounterNode": "same node", "draft": "half a sentence", "reloaded": 1 })
        ),
        "{seen}"
    );
    let answers = seen["answers"].as_array().unwrap();
    assert!(
        answers.len() >= 2
            && answers.last() == Some(&serde_json::json!(["changed"]))
            && answers[..answers.len() - 1]
                .iter()
                .all(|answer| *answer == serde_json::json!(["unchanged"])),
        "unchanged polls swap nothing before the write arrives: {seen}"
    );
    // A background tab costs nothing until it is shown; then one request carries its region and a
    // stale region updates.
    assert_eq!(
        seen["background"],
        serde_json::json!({ "whileHidden": 0, "afterShown": 1, "regions": 1 }),
        "{seen}"
    );
    // A prerendered page asks nothing until activated; a page restored from the back/forward cache
    // (the old HTML, the old seed) asks once on `pageshow` and its stale region updates.
    assert_eq!(
        seen["prerendered"],
        serde_json::json!({ "beforeActivation": 0, "afterActivation": 1, "regions": 1 }),
        "{seen}"
    );
    assert_eq!(seen["restored"], serde_json::json!({ "asked": 1 }), "{seen}");
    // Signing in through WordPress's login: the region is the signed-in visitor's (a draft only an
    // editor reads), and its first ask is answered for that visitor.
    assert_eq!(
        (&seen["draft"], &seen["signIn"]["out"], &seen["signIn"]["in"]),
        (
            &serde_json::json!(204),
            &serde_json::json!(false),
            &serde_json::json!(true)
        ),
        "{seen}"
    );
    let transport = &seen["transport"];
    assert_eq!(
        (&transport["before"], &transport["after"], &transport["asked"]),
        (
            &serde_json::json!([]),
            &serde_json::json!(["Approved live"]),
            &serde_json::json!(1)
        ),
        "{seen}"
    );
    assert!(
        transport["ms"].as_u64().unwrap() < 10_000,
        "on the notice, not the 60 s safety poll: {seen}"
    );
}

/// `<Live>` without a literal id, or inside a client component, is a build error at the element.
#[test]
fn refuses_live_regions_it_cannot_name() {
    let dir = std::env::temp_dir().join(format!("typedpress-live-reject-{}", std::process::id()));
    let page = |body: &str| {
        format!("import {{ Live }} from \"typedpress/app\";\nexport default function Home() {{\n  return {body};\n}}\n")
    };
    rejects(
        &dir,
        &[("tp/app/page.tsx", &page("<Live><p>x</p></Live>"))],
        "`<Live>` needs an `id`",
        "tp/app/page.tsx:3:",
    );
    rejects(
        &dir,
        &[("tp/app/page.tsx", &page("<Live id=\"Not Ok\"><p>x</p></Live>"))],
        "`<Live id>` is a literal id",
        "tp/app/page.tsx:3:",
    );
    let _ = std::fs::remove_dir_all(dir);
}

/// `<Pagination>` without the numbers it needs, or with the wrong types, is a build error at the prop.
#[test]
fn refuses_pagination_without_its_numbers() {
    let dir = std::env::temp_dir().join(format!("typedpress-pagination-reject-{}", std::process::id()));
    let page = |body: &str| {
        format!(
            "import {{ Pagination }} from \"typedpress/app\";\nexport default function Home() {{\n  return {body};\n}}\n"
        )
    };
    rejects(
        &dir,
        &[("tp/app/page.tsx", &page("<Pagination page={1} />"))],
        "`<Pagination>` needs `pages`",
        "tp/app/page.tsx:3:",
    );
    rejects(
        &dir,
        &[("tp/app/page.tsx", &page("<Pagination page={\"2\"} pages={4} />"))],
        "`<Pagination page>` takes a number",
        "tp/app/page.tsx:3:",
    );
    rejects(
        &dir,
        &[(
            "tp/app/page.tsx",
            &page("<Pagination page={1} pages={4} href=\"/x\" />"),
        )],
        "`<Pagination>` has no prop `href`",
        "tp/app/page.tsx:3:",
    );
    let _ = std::fs::remove_dir_all(dir);
}

/// The record's browser check: compiled client components on a real WordPress page, in Chromium
/// with `SCRIPT_DEBUG` (the Interactivity runtime's development build, the one that warns).
/// Hydration changes nothing in the server HTML, the runtime logs no warnings, a click calls the
/// server action and updates the label, effects and shared state follow state changes, a CSS
/// module's class switches with state and styles the element, and a reactive list and
/// conditionals re-render from their templates, keeping the server's elements.
#[test]
fn client_components_hydrate_in_the_browser() {
    assert!(
        root()
            .join("tests/differential/client/node_modules/playwright-core")
            .is_dir(),
        "run: npm ci --prefix tests/differential/client && npx --prefix tests/differential/client playwright-core install chromium-headless-shell"
    );
    let project = fixture("client-components", "browser");
    build(&project);
    let mut server = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/serve_built.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .env("TP_WP_SCRIPT_DEBUG", "1")
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    std::io::BufRead::read_line(&mut std::io::BufReader::new(server.stdout.take().unwrap()), &mut line).unwrap();
    let url = serde_json::from_str::<serde_json::Value>(&line).unwrap_or_else(|_| panic!("serve: {line}"))["url"]
        .as_str()
        .unwrap()
        .to_string();
    let out = Command::new("node")
        .arg(root().join("tests/differential/client/browser.mjs"))
        .arg(format!("{url}/"))
        .output()
        .unwrap();
    let _ = Command::new("kill").arg(server.id().to_string()).output();
    let _ = server.wait();
    let _ = std::fs::remove_dir_all(project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(seen["hydration"], serde_json::json!([]), "{seen}");
    assert_eq!(seen["warnings"], serde_json::json!([]), "{seen}");
    assert_eq!(
        (&seen["before"], &seen["after"]),
        (&serde_json::json!("♥ 1 like"), &serde_json::json!("♥ 141 likes"))
    );
    assert_eq!(
        (&seen["output"], &seen["items"], &seen["seen"]),
        (
            &serde_json::json!("4"),
            &serde_json::json!("2"),
            &serde_json::json!("40")
        )
    );
    // `ref={box}` on the `<output>`: a handler reads that element through `box.current`.
    assert_eq!(seen["ref"], "OUTPUT", "{seen}");
    // The CSS module's class is renamed on both sides, and the stylesheet the page links applies.
    assert_eq!(
        (&seen["toggleBefore"], &seen["toggleAfter"]),
        (
            &serde_json::json!(["toggle_off", "rgb(10, 20, 30)", "off"]),
            &serde_json::json!(["toggle_on", "rgb(200, 40, 40)", "on"])
        ),
        "{seen}"
    );
    // A reactive list adds and drops items by key, and `&&` and `?:` switch their elements.
    let step = |books: &[&str], open: u64, count: Option<&str>, empty: u64| serde_json::json!({ "books": books, "open": open, "count": count, "empty": empty });
    assert_eq!(
        seen["shelfSteps"],
        serde_json::json!([
            step(&["1:Dune", "2:Emma"], 1, Some("2"), 0),
            step(&["1:Dune", "2:Emma", "3:Book 3"], 1, Some("3"), 0),
            step(&["1:Dune", "2:Emma", "3:Book 3"], 0, Some("3"), 0),
            step(&[], 0, None, 1),
            step(&["1:Book 1"], 1, Some("1"), 0),
        ]),
        "{seen}"
    );
    assert_eq!(
        seen["kept"], true,
        "the server-rendered item is kept, not re-created: {seen}"
    );
    // `useLive`: the server's answer is in the first render (not loading), and another visitor's
    // write reaches the page by the typed client's poll, with no reload.
    assert_eq!(
        seen["live"],
        serde_json::json!({ "before": ["Ada"], "loading": "no", "write": 200, "after": ["Ada", "Grace"], "polled": true }),
        "{seen}"
    );
    // A visitor's page runs the component's action as its Ability at core's run route, through
    // the client with no nonce (a signed-out page carries none, and stays cacheable); a
    // schema refusal is the client's typed error.
    assert_eq!(
        seen["abilityRuns"],
        serde_json::json!([
            "POST /wp-abilities/v1/abilities/clients/like/run no nonce",
            "POST /wp-abilities/v1/abilities/clients/like/run no nonce",
        ]),
        "{seen}"
    );
    assert_eq!(
        seen["refused"],
        serde_json::json!({ "typed": true, "status": 422, "code": "invalid_input" }),
        "{seen}"
    );
    // Signed in, the page runs it through `@wordpress/abilities`: core-abilities lists the
    // abilities, then executeAbility's server callback runs it, both with the REST nonce.
    assert_eq!(
        seen["signed"],
        serde_json::json!({
            "before": "♥ 1 like", "after": "♥ 141 likes", "me": "admin",
            "runs": [
                "GET /wp-abilities/v1/abilities nonce",
                "POST /wp-abilities/v1/abilities/clients/like/run nonce",
                "GET /wp-abilities/v1/abilities/clients/me/run nonce",
            ],
        }),
        "{seen}"
    );
    // The typed client is served from the app plugin as a module the browser imports as is.
    assert_eq!(
        seen["client"],
        serde_json::json!([200, "text/javascript; charset=utf-8", "function", "function"]),
        "{seen}"
    );
}

/// The generated client outside WordPress (tests/differential/client/outside.mjs): Node with an
/// application password, and a visitor with no credential, against the site. Listing, paging and
/// creating rows, running an action and reading `me` each go to core's ability run route
/// (`/wp-json/wp-abilities/v1/abilities/<app>/…/run`) with the method the ability takes; a schema
/// refusal and a refused write come back as the client's typed error.
#[test]
fn the_client_outside_wordpress_runs_the_apps_abilities() {
    let project = fixture("client-components", "outside");
    build(&project);
    let mut server = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("serve")
        .arg(project.join("tp/dist/wp-content"))
        .arg("root=admin")
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    std::io::BufRead::read_line(&mut std::io::BufReader::new(server.stdout.take().unwrap()), &mut line).unwrap();
    let served: serde_json::Value = serde_json::from_str(&line).unwrap_or_else(|_| panic!("serve: {line}"));
    let url = served["url"].as_str().unwrap().to_string();
    // `user:password`, as `Authorization: Basic` carries it.
    let password = served["users"]["root"]["appPassword"].as_str().unwrap().to_string();
    let out = Command::new("node")
        .arg(root().join("tests/differential/client/outside.mjs"))
        .arg(&url)
        .arg(&password)
        .arg(project.join("tp/_generated/client"))
        .output()
        .unwrap();
    let _ = Command::new("kill").arg(server.id().to_string()).output();
    let _ = server.wait();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        (&seen["before"], &seen["made"], &seen["after"], &seen["liked"]),
        (
            &serde_json::json!([]),
            &serde_json::json!("From Node"),
            &serde_json::json!(["From Node"]),
            &serde_json::json!(141)
        ),
        "{seen}"
    );
    assert_eq!(
        seen["page"],
        serde_json::json!({ "rows": ["From Node"], "cursor": null }),
        "{seen}"
    );
    assert_eq!(
        seen["me"],
        serde_json::json!({ "name": "root", "role": "admin" }),
        "{seen}"
    );
    assert_eq!(
        seen["refused"],
        serde_json::json!({ "typed": true, "status": 422, "code": "invalid_input" }),
        "{seen}"
    );
    assert_eq!(
        seen["visitor"],
        serde_json::json!({
            "read": ["From Node"], "liked": 101, "me": null,
            "update": { "typed": true, "status": 401, "code": "unauthenticated" },
        }),
        "{seen}"
    );
    assert_eq!(
        seen["wrong"],
        serde_json::json!({ "typed": true, "status": 401, "code": "incorrect_password" }),
        "{seen}"
    );
    // Every request, by path: the abilities' run route, with the method each ability takes.
    let run = "/wp-json/wp-abilities/v1/abilities/clients";
    assert_eq!(
        seen["paths"],
        serde_json::json!([
            format!("GET {run}/guestbook-list/run"),
            format!("GET {run}/guestbook-list/run"),
            format!("POST {run}/guestbook-create/run"),
            format!("GET {run}/guestbook-list/run"),
            format!("GET {run}/guestbook-list/run"),
            format!("POST {run}/like/run"),
            format!("GET {run}/me/run"),
            format!("POST {run}/like/run"),
            format!("GET {run}/guestbook-list/run"),
            format!("POST {run}/like/run"),
            format!("GET {run}/me/run"),
            format!("POST {run}/guestbook-update/run"),
        ]),
        "{seen}"
    );
}

/// rendering.md §6.1 and §6.2 for `tp/app/` pages, on WordPress with a stand-in host listening
/// on `tp_purge_urls`: an anonymous visitor's page is cacheable at the edge, a signed-in,
/// guarded or missing one is private; each cacheable render records what it read; an edit to one
/// row purges exactly the URLs that read it or listed its kind, with their `.md` twins.
#[test]
fn app_pages_cache_and_purge_by_what_they_read() {
    let project = fixture("app-router", "cache");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_cache.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    // Batcache's own regex over every policy: a shareable page is kept for its window, the
    // filtered one too, and a private answer for none (max-age=0 means Batcache skips it).
    assert_eq!(
        seen["batcache"],
        serde_json::json!([
            [200, true, false, true, 300],
            [200, false, false, false, 0],
            [200, true, true, false, 0],
            [404, true, false, false, 0],
            [500, true, false, false, 0],
            ["window 60", 60]
        ])
    );
    assert_eq!(
        seen["batcache served"],
        serde_json::json!({ "home": 300, "as editor": 0, "missing": 0 })
    );
    let shared = "public, max-age=0, s-maxage=300, must-revalidate";
    let private = "private, no-store, max-age=0";
    // WP Cloud's edge stores a PHP response only beside `A8C-Edge-Cache: cache`, and never one
    // marked `no-cache`: the header follows the policy on every answer.
    for key in ["home", "note", "other note", "about"] {
        assert_eq!(
            seen[key],
            serde_json::json!({ "status": 200, "cache": shared, "edge": "cache" }),
            "{key}"
        );
    }
    // A private page also cancels Batcache, which reads only `max-age` and would keep it otherwise.
    // A cookie a render may answer for makes the page private though WordPress signs no one in
    // (a comment author's name and email, an unlocked post, an Identity session), and so does a
    // response that sets a cookie.
    for key in [
        "as editor",
        "guarded",
        "comment author",
        "post password",
        "identity session",
        "sets a cookie",
    ] {
        assert_eq!(
            seen[key],
            serde_json::json!({ "status": 200, "cache": private, "edge": "no-cache", "batcache": "cancel" }),
            "{key}"
        );
    }
    assert_eq!(
        seen["missing"],
        serde_json::json!({ "status": 404, "cache": private, "edge": "no-cache", "batcache": "cancel" })
    );
    // `//notes/other/` renders the note (the router reads the path as WordPress does) but no purge
    // names that URL: private, and filed under no other page (`/other/` on the host `notes`).
    assert_eq!(
        seen["double slash"],
        serde_json::json!({ "status": 200, "cache": private, "edge": "no-cache", "batcache": "cancel" })
    );
    assert_eq!(seen["double slash index"], serde_json::json!([]));
    // TypedPress's API and Identity's answer for whoever asks: Batcache never keeps them, signed in
    // by an application password or not, nor Identity's own API, which finds its session from its
    // cookie without WordPress setting the user.
    for (key, status) in [("api anonymous", 200), ("api app password", 200), ("identity api", 401)] {
        assert_eq!(seen[key]["status"], status, "{key}");
        assert_eq!(seen[key]["batcache"], "cancel", "{key}");
    }
    // The fixed home page is in the purge map. Each note page records its own row.
    let index: Vec<String> = seen["index"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    assert!(!index.iter().any(|row| row.ends_with(" /")), "{index:?}");
    // Recorded under the address WordPress links (`/notes/hello/`), though the visit had no slash.
    assert_eq!(
        index.iter().filter(|r| r.ends_with(" /notes/hello/")).count(),
        1,
        "{index:?}"
    );
    assert!(
        !index.iter().any(|r| r.ends_with(" /about") || r.ends_with(" /about/")),
        "{index:?}"
    );
    // The bare spelling redirects to that address (#462), so the page is purged at it alone.
    assert_eq!(
        seen["count reads"],
        serde_json::json!({ "notes": { "ids": [], "listed": true } }),
        "a count depends on every row of its kind"
    );
    assert_eq!(
        seen["purged"],
        serde_json::json!([["/", "/index.md", "/notes/hello/", "/notes/hello.md"]])
    );
    // The runtime's own listener cleared those paths in Batcache (keyed as `http://`, no query),
    // the VIP edge and Jetpack Boost; `/*` reaches Boost's clear-all.
    let mut cleared: Vec<String> = seen["cleared"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    cleared.sort();
    // Boost clears a URL recursively, so the home page goes to its home action instead.
    let mut want = vec!["boost home".to_string()];
    for cache in ["batcache", "boost", "vip"] {
        for path in ["/", "/index.md", "/notes/hello/", "/notes/hello.md"] {
            if !(cache == "boost" && path == "/") {
                want.push(format!("{cache} {path}"));
            }
        }
    }
    // The WP Cloud edge gets every path in one purge call.
    want.push("edge / /index.md /notes/hello/ /notes/hello.md".to_string());
    want.sort();
    assert_eq!(cleared, want);
    // A twin fetched before its page was ever rendered records what it read under its own URL, so
    // a write to the row it shows purges it (and `/`, which lists notes, with its twin).
    assert_eq!(seen["twin only"]["status"], 200, "{}", seen["twin only"]);
    assert_eq!(seen["twin index"], serde_json::json!(["notes third /notes/third.md"]));
    assert_eq!(
        seen["twin purged"],
        serde_json::json!([["/", "/index.md", "/notes/third.md"]])
    );
    assert_eq!(seen["cleared all"], serde_json::json!(["vip *", "boost *", "edge *"]));
    // Over VIP's 100 URLs a request: one site ban, and every path still for Batcache.
    assert_eq!(seen["cleared many"], serde_json::json!([1, true, 101]));
    assert_eq!(
        seen["without batcache drop-in"],
        serde_json::json!(["vip /about", "boost /about", "edge /about"])
    );
    // A response made as a signed-in user is never Batcache's to keep, however the user signed in.
    assert_eq!(
        seen["batcache cancelled"],
        serde_json::json!({ "anonymous": false, "signed in": true })
    );
}

/// One committed write, one announcement (docs/runtime-contract.md, "Purges"): a kind with a `url` is
/// purged from two sources, the post hooks and the page cache's read index, and a write names the
/// union once on `tp_purge_urls` and once to the prebuilt pages, under the one address WordPress
/// serves the page at (the other spelling redirects there). A row recorded under the old spelling
/// still purges; a rolled-back write announces nothing; over the limit across both is one `/*`.
#[test]
fn one_write_announces_its_purges_once() {
    let project = fixture("app-purges", "once");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_purges.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value =
        serde_json::from_slice(&out.stdout).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out.stdout)));
    use serde_json::json;
    // One address per page (#462): the bare spelling 301s to the one the permalink structure gives,
    // so a host cache holds one copy and a write purges one URL.
    let base = seen["base"].as_str().unwrap();
    assert_eq!(
        seen["spellings"],
        json!({ "slash": [200, null], "bare": [301, format!("{base}/notes/hello/")] }),
        "{seen}"
    );
    // The kind item still registers its reads at its canonical address. The compiler maps the
    // fixed home page directly to notes, so its listing needs no per-render rows.
    assert_eq!(seen["index"], json!(["/notes/hello.md", "/notes/hello/"]), "{seen}");
    assert_eq!(seen["home reads"], json!([]), "{seen}");
    let once = |key: &str| {
        let calls = seen[key]["calls"].as_array().unwrap_or_else(|| panic!("{key}: {seen}"));
        assert_eq!(calls.len(), 1, "{key}: one call per write: {seen}");
        let paths: Vec<&str> = calls[0]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p.as_str().unwrap())
            .collect();
        let mut unique = paths.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), paths.len(), "{key}: each path once: {paths:?}");
        // Sent after the commit, never from inside the write's transaction.
        assert_eq!(seen[key]["in transaction"], serde_json::json!([false]), "{key}: {seen}");
        // Prebuilt::stale ran once, with that list: one rebuild of the note's prebuilt page.
        assert_eq!(seen[key]["rebuilds"], 1, "{key}: {seen}");
        paths
    };
    for key in ["edit", "editor edit", "old row"] {
        let paths = once(key);
        // The item at its one address, its twin, its comments feed (the post hooks' part).
        let mut item: Vec<&str> = paths
            .iter()
            .copied()
            .filter(|p| p.starts_with("/notes/hello"))
            .collect();
        item.sort();
        assert_eq!(
            item,
            ["/notes/hello.md", "/notes/hello/", "/notes/hello/feed/"],
            "{key}: {paths:?}"
        );
        for want in ["/", "/index.md", "/llms.txt"] {
            assert!(paths.contains(&want), "{key}: {want} in {paths:?}");
        }
    }
    assert_eq!(
        seen["rolled back"],
        json!({ "calls": [], "in transaction": [], "rebuilds": 0 }),
        "{seen}"
    );
    assert_eq!(
        seen["limit"],
        json!({ "index alone": true, "union over": true, "calls": [["/*"]], "in transaction": [false], "rebuilds": 0 }),
        "{seen}"
    );
}

#[test]
fn check_reports_page_cache_plans_from_compiled_calls() {
    let project = fixture("page-caching", "check");
    let output = first().args(["check", "--json"]).arg(&project).output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stdout));
    let report: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let routes = report["routePlan"].as_array().expect("routePlan");
    let route = |id: &str| {
        routes
            .iter()
            .find(|route| route["id"] == id)
            .unwrap_or_else(|| panic!("{id}: {report}"))
    };
    use serde_json::json;
    assert_eq!(route("about")["plan"]["class"], "immutable");
    assert_eq!(route("about")["prerender"], true);
    assert_eq!(route("private")["plan"]["class"], "request-private");
    assert_eq!(route("private")["plan"]["window"], 0);
    assert_eq!(route("catalog")["plan"]["class"], "anonymous-public");
    assert_eq!(route("catalog")["plan"]["search"], json!(["media"]));
    assert!(
        route("catalog")["plan"]["dependencies"]
            .as_array()
            .unwrap()
            .contains(&json!({
                "type": "global", "name": "shop", "fields": ["currency"]
            }))
    );
    assert_eq!(route("catalog")["plan"]["window"], 300);
    assert_eq!(
        route("top")["plan"]["dependencies"],
        json!([{"type": "list", "collection": "drives"}])
    );
    assert_eq!(
        route("option")["plan"]["dependencies"],
        json!([{"type": "option", "name": "pagecaching_store_notice"}])
    );
    assert_eq!(route("opaque")["plan"]["class"], "unknown");
    assert_eq!(route("opaque")["plan"]["fixedPurge"], false);
    assert_eq!(
        route("opaque")["plan"]["dependencies"],
        json!([
            {"type": "list", "collection": "drives"}, {"type": "opaque", "call": "Date.now"}
        ])
    );
    let item = routes.iter().find(|route| route["pattern"] == "/drives/:slug").unwrap();
    assert!(item["plan"]["dependencies"].as_array().unwrap().contains(&json!({
        "type": "routeItem", "collection": "drives", "bindings": {"slug": "slug"}
    })));
    std::fs::remove_dir_all(&project).unwrap();
}

/// What a page cache holds and what a write drops from it, on WordPress with a stand-in host
/// listening on `tp_purge_urls` (tests/php/page_caching.php). Each purge is checked beside the page as
/// the origin renders it after the write, so every expected path is one whose content changed.
///
/// - A list read is a list read whatever it returned: a filtered catalog with one row, and a page
///   that shows the top-ranked row, are purged when a new row joins or outranks it.
/// - A global is a dependency: a write to it (the API, or its options page) purges the pages that
///   printed it.
/// - A query string is shared and recorded only when every parameter is one the page declares, and
///   a path keeps a bounded number of recorded variants.
#[test]
fn page_caches_drop_what_a_write_changed() {
    let project = fixture("page-caching", "writes");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/page_caching.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value =
        serde_json::from_slice(&out.stdout).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out.stdout)));
    use serde_json::json;
    let shared = "public, max-age=0, s-maxage=300, must-revalidate";
    let private = "private, no-store, max-age=0";
    // Before any write: one nvme drive, so the filtered catalog and the top page each show one row.
    for key in ["catalog", "nvme", "none", "top", "drive", "about"] {
        assert_eq!(seen["warm"][key]["status"], 200, "{key}: {seen}");
        assert_eq!(seen["warm"][key]["cache"], shared, "{key}: {seen}");
    }
    assert_eq!(seen["warm"]["nvme"]["items"], json!(["Alpha"]), "{seen}");
    assert_eq!(seen["warm"]["top"]["line"], "Gamma", "{seen}");
    for fixed in ["top", "catalog", "about", "option"] {
        assert_eq!(seen["warm"][fixed]["read index SQL"], 0, "{fixed}: {seen}");
    }
    assert!(seen["warm"]["nvme"]["read index SQL"].as_u64().unwrap() > 0, "{seen}");
    assert!(seen["warm"]["opaque"]["read index SQL"].as_u64().unwrap() > 0, "{seen}");
    assert_eq!(
        seen["unknown read hook"],
        json!({"line": "Delta GBP", "recorded global": true}),
        "{seen}"
    );
    assert_eq!(
        seen["menu"],
        json!({"before": false, "announced": ["/*"], "after": true}),
        "{seen}"
    );
    assert_eq!(
        seen["template"],
        json!({"before": false, "announced": ["/*"], "after": true}),
        "{seen}"
    );
    assert_eq!(
        seen["template rollback"],
        json!({"announced": null, "previous": true, "attempted": false}),
        "{seen}"
    );
    assert_eq!(seen["redirect"]["status"], 301, "{seen}");
    assert_eq!(seen["redirect"]["cache"], shared, "{seen}");
    assert_eq!(seen["redirect"]["location"], "/about/", "{seen}");
    assert_eq!(seen["redirect"]["rendered"], false, "{seen}");
    assert_eq!(seen["late cookie"]["cache"], private, "{seen}");
    assert_eq!(seen["late cookie"]["edge"], "no-cache", "{seen}");
    assert_eq!(seen["late cookie"]["cookie"], "fixture_footer=1", "{seen}");
    assert_eq!(seen["late cookie"]["line"], "About this shop", "{seen}");
    assert_eq!(seen["authorization"]["cache"], private, "{seen}");
    assert_eq!(seen["literal prebuild"]["paths"], json!(["/about"]), "{seen}");
    assert_eq!(seen["literal prebuild"]["before"], json!(null), "{seen}");
    assert_eq!(seen["literal prebuild"]["after"]["prebuilt"], "1", "{seen}");
    assert_eq!(seen["literal prebuild"]["after"]["line"], "About this shop", "{seen}");
    assert_eq!(
        seen["literal prebuild"]["authorization"]["prebuilt"],
        json!(null),
        "{seen}"
    );
    assert_eq!(seen["literal prebuild"]["authorization"]["cache"], private, "{seen}");
    assert_eq!(seen["negative"]["before"]["status"], 404, "{seen}");
    assert_eq!(
        seen["negative"]["before"]["cache"], "public, max-age=0, s-maxage=60, must-revalidate",
        "{seen}"
    );
    assert_eq!(seen["negative"]["alternate"]["cache"], private, "{seen}");
    assert_eq!(seen["negative"]["unpublished"]["cache"], private, "{seen}");
    assert_eq!(
        seen["negative"]["announced"],
        json!(["/drives/newly-published/", "/drives/newly-published.md"]),
        "{seen}"
    );
    assert_eq!(seen["negative"]["after"]["status"], 200, "{seen}");
    assert_eq!(
        seen["negative"]["after"]["line"], "Newly-published GBP: 1 GBP, 3 in stock",
        "{seen}"
    );
    assert_eq!(
        seen["option write"],
        json!({"announced": ["/option/", "/option.md"], "line": "Closed now"}),
        "{seen}"
    );
    assert_eq!(
        seen["option rollback"],
        json!({"announced": null, "line": "Closed now"}),
        "{seen}"
    );
    assert_eq!(
        seen["option delete"],
        json!({"announced": ["/option/", "/option.md"], "line": "No notice"}),
        "{seen}"
    );
    let index: Vec<&str> = seen["index"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap())
        .collect();
    // Both one-row reads are recorded as listings (`*`), with the row they showed.
    for row in [
        "drives * /catalog/?media=nvme",
        "drives # /catalog/?media=nvme",
        "drives * /catalog.md?media=nvme",
        "drives * /opaque/",
        // A filter that matched nothing still depends on every write to the kind.
        "drives * /catalog/?media=tape",
        // The parameterized drive page still records its global and its row.
        "global:shop * /drives/alpha/",
    ] {
        assert!(index.contains(&row), "{row} in {index:?}");
    }
    // The exact item keeps runtime tracking. The query-free catalog, ranked list and literal
    // page use the fixed map, even though they still render their content at the origin.
    assert!(!index.contains(&"drives * /drives/alpha/"), "{index:?}");
    for path in [" /about/", " /catalog/", " /top/", " /option/"] {
        assert!(!index.iter().any(|row| row.ends_with(path)), "{path}: {index:?}");
    }

    // A second nvme drive, priced above every other: the filtered list grows from 1 to 2 and the
    // top page shows the new drive. Both URLs, the empty filter and the twin are announced.
    assert_eq!(
        seen["grown"],
        json!({
            "announced": ["/catalog/", "/catalog/?media=nvme", "/catalog/?media=tape", "/catalog.md?media=nvme", "/top/"],
            "nvme": ["Alpha", "Delta"],
            "top": "Delta",
            "twin": "# TypedPress test site\n\n- Alpha\n- Delta",
        }),
        "{seen}"
    );
    // A price and stock change: the item's page and every list of its kind, not another item's page.
    assert_eq!(
        seen["priced"],
        json!({
            "announced": ["/catalog/", "/catalog/?media=nvme", "/top/", "/drives/alpha/"],
            "drive": "Alpha: 12.5 USD, 0 in stock",
        }),
        "{seen}"
    );
    // A rolled-back write announces nothing, and the pages still show what they showed.
    assert_eq!(seen["rolled back"]["announced"], json!(null), "{seen}");
    assert_eq!(seen["rolled back"]["drive"], "Alpha: 12.5 USD, 0 in stock", "{seen}");
    assert_eq!(seen["rolled back"]["top"], "Delta", "{seen}");
    // A write to the global purges the pages that printed it (and no other), from the API…
    assert_eq!(
        seen["global"],
        json!({
            "announced": ["/catalog/", "/catalog/?media=nvme", "/drives/alpha/", "/drives/beta/"],
            "catalog": "EUR",
            "drive": "Alpha: 12.5 EUR, 0 in stock",
        }),
        "{seen}"
    );
    // …and from its options page, which saves the option itself.
    assert_eq!(
        seen["global option"],
        json!({ "announced": ["/catalog/", "/drives/alpha/"], "catalog": "GBP" }),
        "{seen}"
    );

    // A parameter the page doesn't declare: answered, never shared, never recorded, never announced.
    for (path, answer) in seen["junk"]["answers"].as_object().unwrap() {
        assert_eq!(answer, &json!([200, private, "no-cache"]), "{path}: {seen}");
    }
    assert_eq!(seen["junk"]["recorded"], json!([]), "{seen}");
    assert_eq!(seen["junk"]["announced"], json!([]), "{seen}");
    // Declared parameters: 20 recorded variants of one path, the rest private; a write names those
    // 20 (and their twins), not the whole host; a variant unconfirmed for two windows gives way.
    assert_eq!(
        seen["variants"],
        json!({
            "max": 20,
            // `?media=nvme` and `?media=tape` were recorded already: 18 of the 22 new ones fit.
            "shared": 18,
            "private": 4,
            "recorded": 20,
            "announced": 20,
            "whole host": false,
            "recorded one": shared,
            "over the limit": private,
            "after two windows": shared,
            // The 18 stale ones went; `nvme`, `tape` (rendered since) and the new one stay.
            "recorded then": 3,
        }),
        "{seen}"
    );
}

/// Stylesheets and SVGs that pages, layouts and components import (docs/spec/tsx-to-php.md,
/// "Accepted"), on WordPress over HTTP: each page links its layouts' and its own stylesheets once,
/// in import order (the root layout's first), from the app plugin, with content-hashed names; a CSS
/// module's classes are renamed `<stem>_<class>` on the element and in the served file, and an SVG
/// import is its URL.
#[test]
fn imported_stylesheets_and_images_serve_from_the_app_plugin() {
    let project = fixture("app-assets", "serve");
    // An explicit asset import keeps its extension even when a TypeScript module shares its stem.
    for (path, source) in [
        ("tp/app/site.ts", "export {};"),
        (
            "tp/app/about/page.module.ts",
            r#"export default { card: "other-card", title: "other-title" };"#,
        ),
        ("tp/app/about/compass.ts", r#"export default "";"#),
    ] {
        std::fs::write(project.join(path), source).unwrap();
    }
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_assets.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let files = |page: &str| -> Vec<String> {
        seen[page]["links"]
            .as_array()
            .unwrap()
            .iter()
            .map(|l| {
                assert_eq!(l["status"].as_i64(), Some(200), "{l}");
                assert!(l["type"].as_str().unwrap().starts_with("text/css"), "{l}");
                l["file"].as_str().unwrap().split('-').next().unwrap().to_string()
            })
            .collect()
    };
    // The layout's site.css first, then the page's module, then the client component's module.
    assert_eq!(files("about"), ["site", "page", "counter"], "{seen}");
    assert_eq!(files("plain"), ["site"], "{seen}");
    // Theme defaults load before the app's own styles, for TSX and Markdown pages alike.
    for page in ["about", "plain", "colophon"] {
        assert_eq!(
            seen[page]["styleOrder"][0], "global-styles-inline-css",
            "{page}: {seen}"
        );
        assert_eq!(seen[page]["styleOrder"][1], "late-theme-inline-css", "{page}: {seen}");
        assert_eq!(
            seen[page]["styleOrder"].as_array().unwrap().last().unwrap(),
            "owner-override-inline-css",
            "{page}: {seen}"
        );
        assert_eq!(seen[page]["ownerCss"], true, "{page}: {seen}");
        assert_eq!(
            seen[page]["styleOrder"].as_array().unwrap().len(),
            seen[page]["links"].as_array().unwrap().len() + 3,
            "{page}: {seen}"
        );
    }
    // A page.md has no imports of its own: it links what the layouts above it import.
    assert_eq!(seen["colophon"]["status"], 200, "{seen}");
    assert_eq!(files("colophon"), ["site"], "{seen}");
    assert_eq!(seen["colophon"]["classes"]["div"][0], "site", "{seen}");
    let css = |page: &str, i: usize| seen[page]["links"][i]["css"].as_str().unwrap().to_string();
    assert_eq!(
        css("about", 0),
        ":root{--ink:#1d2420}body{margin:0;color:var(--ink)}.site{max-width:48rem}"
    );
    assert_eq!(
        css("about", 1),
        ".page_title{font-size:2rem}.page_card .page_title{color:#1f4d3a}@media (min-width:40rem){.page_card{padding:1rem}}"
    );
    assert_eq!(
        css("about", 2),
        ".counter_button{border:0}.counter_on{background:#1f4d3a}"
    );
    // Small stylesheets (<= 4 KB) are inlined into <head> automatically.
    assert_eq!(seen["about"]["links"][0]["inline"], true);
    // The plain stylesheet's link is the same file on both pages.
    assert_eq!(seen["about"]["links"][0]["file"], seen["plain"]["links"][0]["file"]);
    assert_eq!(
        seen["about"]["classes"],
        serde_json::json!({ "div": ["site"], "section": ["page_card"], "h1": ["page_title"], "button": ["counter_button"] }),
        "{seen}"
    );
    let image = &seen["about"]["images"][0];
    assert_eq!(image["status"].as_i64(), Some(200), "{image}");
    assert!(image["type"].as_str().unwrap().starts_with("image/svg+xml"), "{image}");
    assert!(image["src"].as_str().unwrap().starts_with("compass-"), "{image}");
    assert!(image["body"].as_str().unwrap().contains("<circle"), "{image}");
}

/// Binary static assets (images, fonts, etc.) imported from TSX or referenced by relative `url(...)`
/// in imported stylesheets and CSS modules are copied under content-hashed names in `tp/app/assets/`
/// (served from `wp-content/`), deduplicated by bytes, and round-trip through hosted source bundles.
#[cfg(feature = "host")]
#[test]
fn imported_binary_assets_and_css_urls_bundle_into_app_assets() {
    let project = tempfile::tempdir().unwrap();
    let project = project.path();
    std::fs::create_dir_all(project.join("tp/app/about")).unwrap();
    std::fs::create_dir_all(project.join("tp/app/fonts")).unwrap();
    std::fs::write(
        project.join("typedpress.config.ts"),
        "import { defineConfig } from \"typedpress\";\nexport default defineConfig({ name: \"binassets\", admin: false });\n",
    )
    .unwrap();
    // Non-UTF-8 binary bytes for PNG, WebP, and WOFF2.
    let png_bytes: Vec<u8> = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe];
    let webp_bytes: Vec<u8> = vec![b'R', b'I', b'F', b'F', 0xff, 0x80, 0x01, 0x02, b'W', b'E', b'B', b'P'];
    let font_bytes: Vec<u8> = vec![b'w', b'O', b'F', b'2', 0x00, 0xff, 0xde, 0xad, 0xbe, 0xef];
    std::fs::write(project.join("tp/app/about/hero.png"), &png_bytes).unwrap();
    std::fs::write(project.join("tp/app/about/tile.webp"), &webp_bytes).unwrap();
    std::fs::write(project.join("tp/app/fonts/inter.woff2"), &font_bytes).unwrap();
    std::fs::write(
        project.join("tp/app/about/theme.css"),
        "@font-face { font-family: Inter; src: url(\"../fonts/inter.woff2?v=1#f\") format(\"woff2\"); }\n.banner { background: url(./hero.png); }\n.root { background: url(/public-root.png); }\n",
    )
    .unwrap();
    std::fs::write(
        project.join("tp/app/about/card.module.css"),
        ".card { background-image: url('./tile.webp'); }\n",
    )
    .unwrap();
    std::fs::write(
        project.join("tp/app/about/page.tsx"),
        "import \"./theme.css\";\nimport styles from \"./card.module.css\";\nimport hero from \"./hero.png\";\nimport font from \"../fonts/inter.woff2\";\nexport default function About() {\n  return <div className={styles.card} data-font={font}><img src={hero} alt=\"Hero\" /></div>;\n}\n",
    )
    .unwrap();

    build(project);
    let assets_dir = project.join("tp/dist/wp-content/plugins/typedpress-app-binassets/tp/app/assets");
    let entries: std::collections::BTreeMap<String, Vec<u8>> = std::fs::read_dir(&assets_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name() != ".htaccess")
        .map(|e| {
            (
                e.file_name().to_string_lossy().into_owned(),
                std::fs::read(e.path()).unwrap(),
            )
        })
        .collect();
    let find = |prefix: &str, ext: &str| -> (String, Vec<u8>) {
        entries
            .iter()
            .find(|(name, _)| name.starts_with(prefix) && name.ends_with(ext))
            .map(|(k, v)| (k.clone(), v.clone()))
            .unwrap_or_else(|| panic!("missing {prefix}*{ext} in {:?}", entries.keys().collect::<Vec<_>>()))
    };
    let (hero_file, hero_out) = find("hero-", ".png");
    let (tile_file, tile_out) = find("tile-", ".webp");
    let (font_file, font_out) = find("inter-", ".woff2");
    let (_, theme_out) = find("theme-", ".css");
    let (_, card_out) = find("card-", ".css");
    assert_eq!(hero_out, png_bytes);
    assert_eq!(tile_out, webp_bytes);
    assert_eq!(font_out, font_bytes);
    // Deduplicated: only 5 asset files total (hero, tile, inter, theme, card).
    assert_eq!(entries.len(), 5, "{:?}", entries.keys().collect::<Vec<_>>());
    let theme_css = String::from_utf8(theme_out).unwrap();
    assert!(
        theme_css.contains(&format!("url(\"./{font_file}?v=1#f\")")),
        "{theme_css}"
    );
    assert!(theme_css.contains(&format!("url(./{hero_file})")), "{theme_css}");
    assert!(theme_css.contains("url(/public-root.png)"), "{theme_css}");
    let card_css = String::from_utf8(card_out).unwrap();
    assert_eq!(card_css, format!(".card_card{{background-image:url('./{tile_file}')}}"));
    let functions = std::fs::read_to_string(
        project.join("tp/dist/wp-content/plugins/typedpress-app-binassets/tp/app/functions.php"),
    )
    .unwrap();
    assert!(
        functions.contains(&format!("\\TypedPress\\Assets::url( '{hero_file}' )")),
        "{functions}"
    );
    assert!(
        functions.contains(&format!("\\TypedPress\\Assets::url( '{font_file}' )")),
        "{functions}"
    );

    // Hosted capture + compile round-trips binary assets byte-for-byte identically.
    let work = tempfile::tempdir().unwrap();
    let (sources, store) = (work.path().join("sources"), work.path().join("store"));
    typedpress::host::sources(project, &sources).unwrap();
    let built = typedpress::host::compile_to_store(&sources, &store, project, None).unwrap();
    let manifest: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(store.join(format!("build/{}.json", built.build_id))).unwrap())
            .unwrap();
    let hosted_assets = store.join(format!(
        "app/{}/plugins/typedpress-app-binassets/tp/app/assets",
        manifest["app"].as_str().unwrap()
    ));
    for (name, bytes) in &entries {
        assert_eq!(
            &std::fs::read(hosted_assets.join(name)).unwrap(),
            bytes,
            "hosted asset {name}"
        );
    }
}

/// End-to-end WordPress verification of the full modern asset pipeline:
/// CSS `@import` bundling + minification + small-CSS inlining (<= 4 KB) + large-CSS external linking,
/// `@font-face` + priority `<Image>` preloading, automatic intrinsic image dimensions, Vite query
/// modifiers (`?raw`, `?inline`, `?url`, `?meta`), and `"use client"` component asset imports.
#[test]
fn modern_asset_pipeline_works_end_to_end_on_wordpress() {
    let project = tempfile::tempdir().unwrap();
    let project = project.path();
    std::fs::create_dir_all(project.join("tp/app/fonts")).unwrap();
    std::fs::create_dir_all(project.join("tp/components")).unwrap();
    std::fs::write(
        project.join("typedpress.config.ts"),
        "import { defineConfig } from \"typedpress\";\nexport default defineConfig({ name: \"modernassets\", admin: false });\n",
    )
    .unwrap();
    // Valid 40x20 PNG (IHDR header) + WOFF2/TTF font bytes + SVG.
    let png_bytes: Vec<u8> = vec![
        0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, b'I', b'H', b'D', b'R', 0x00, 0x00,
        0x00, 40, 0x00, 0x00, 0x00, 20, 0x08, 0x02, 0x00, 0x00, 0x00,
    ];
    let woff2_bytes: Vec<u8> = vec![b'w', b'O', b'F', b'2', 0x00, 0xff, 0x01, 0x02];
    let ttf_bytes: Vec<u8> = vec![0x00, 0x01, 0x00, 0x00, 0xaa, 0xbb];
    std::fs::write(project.join("tp/app/hero.png"), &png_bytes).unwrap();
    std::fs::write(project.join("tp/app/fonts/inter.woff2"), &woff2_bytes).unwrap();
    std::fs::write(project.join("tp/app/fonts/inter.ttf"), &ttf_bytes).unwrap();
    std::fs::write(project.join("tp/app/note.txt"), "hello raw text").unwrap();
    std::fs::write(
        project.join("tp/app/tokens.css"),
        "@font-face { font-family: Inter; src: url(\"./fonts/inter.woff2\") format(\"woff2\"), url(\"./fonts/inter.ttf\") format(\"truetype\"); }\n:root { --accent: #ffffff; }\n",
    )
    .unwrap();
    std::fs::write(
        project.join("tp/app/small.css"),
        "@import \"./tokens.css\";\n.hero { background: url(./hero.png); color: var(--accent); }\n",
    )
    .unwrap();
    // > 4 KB stylesheet so it links externally instead of inlining.
    let mut big_css = String::new();
    for i in 0..260 {
        big_css.push_str(&format!(".big-rule-{i}{{padding:{i}px;margin:0}}\n"));
    }
    std::fs::write(project.join("tp/app/large.css"), &big_css).unwrap();
    std::fs::write(project.join("tp/app/standalone.css"), ".only-url { color: #aabbcc; }\n").unwrap();
    std::fs::write(
        project.join("tp/components/icon.svg"),
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><rect width=\"16\" height=\"16\"/></svg>",
    )
    .unwrap();
    std::fs::write(
        project.join("tp/components/Badge.tsx"),
        "\"use client\";\nimport { useState } from \"typedpress/client\";\nimport icon from \"./icon.svg\";\nimport inlineIcon from \"./icon.svg?inline\";\nexport function Badge() {\n  const [alt, setAlt] = useState(false);\n  return <button type=\"button\" onClick={() => setAlt(!alt)}><img className=\"client-img\" src={alt ? inlineIcon : icon} alt=\"Badge\" /></button>;\n}\n",
    )
    .unwrap();
    std::fs::write(
        project.join("tp/app/page.tsx"),
        "import { Image } from \"typedpress/app\";\nimport \"./small.css\";\nimport \"./large.css\";\nimport heroUrl from \"./hero.png\";\nimport heroMeta from \"./hero.png?meta\";\nimport heroInline from \"./hero.png?inline\";\nimport rawNote from \"./note.txt?raw\";\nimport standaloneCssUrl from \"./standalone.css?url\";\nimport { Badge } from \"../components/Badge\";\nexport default function Home() {\n  return (\n    <main data-raw={rawNote} data-css-url={standaloneCssUrl}>\n      <Image className=\"priority-img\" src={heroMeta} alt=\"Hero\" priority />\n      <Image className=\"lazy-img\" src={heroUrl} alt=\"Lazy\" />\n      <img className=\"plain-img\" src={heroUrl} alt=\"Plain\" />\n      <img className=\"inline-img\" src={heroInline} alt=\"Inline\" />\n      <Badge />\n    </main>\n  );\n}\n",
    )
    .unwrap();

    build(project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_assets_modern.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(seen["status"], 200, "{seen}");
    // Small CSS (with bundled @import tokens.css) is minified, inlined, and its relative url(./...) resolved to wp-content/.
    let inlines = seen["inlineStyles"].as_array().unwrap();
    assert_eq!(inlines.len(), 1, "{seen}");
    let inline_css = inlines[0].as_str().unwrap();
    assert!(inline_css.contains("--accent:#fff"), "{inline_css}");
    assert!(
        inline_css.contains("/wp-content/plugins/typedpress-app-modernassets/tp/app/assets/hero-"),
        "{inline_css}"
    );
    assert!(
        inline_css.contains("/wp-content/plugins/typedpress-app-modernassets/tp/app/assets/inter-"),
        "{inline_css}"
    );
    // Large CSS (> 4 KB) is linked externally.
    let externals = seen["externalStyles"].as_array().unwrap();
    assert_eq!(externals.len(), 1, "{seen}");
    assert!(externals[0]["file"].as_str().unwrap().starts_with("large-"), "{seen}");
    assert_eq!(externals[0]["status"], 200);
    // Preloads: woff2 font (NOT ttf) + priority hero image.
    let preloads = seen["preloads"].as_array().unwrap();
    assert_eq!(preloads.len(), 2, "{seen}");
    let font_preload = preloads.iter().find(|p| p["as"] == "font").unwrap();
    assert_eq!(font_preload["type"], "font/woff2");
    assert_eq!(font_preload["crossorigin"], "anonymous");
    assert!(
        font_preload["file"].as_str().unwrap().ends_with(".woff2"),
        "{font_preload}"
    );
    assert_eq!(font_preload["status"], 200);
    let img_preload = preloads.iter().find(|p| p["as"] == "image").unwrap();
    assert_eq!(img_preload["fetchpriority"], "high");
    assert!(
        img_preload["file"].as_str().unwrap().starts_with("hero-"),
        "{img_preload}"
    );
    assert_eq!(img_preload["status"], 200);
    // <Image priority>, <Image lazy>, plain <img> auto-dimensions, ?inline data URI, and client component asset!
    let imgs = &seen["imgs"];
    assert_eq!(imgs["priority-img"]["width"], "40");
    assert_eq!(imgs["priority-img"]["height"], "20");
    assert_eq!(imgs["priority-img"]["loading"], "eager");
    assert_eq!(imgs["priority-img"]["decoding"], "async");
    assert_eq!(imgs["priority-img"]["fetchpriority"], "high");
    assert_eq!(imgs["priority-img"]["status"], 200);
    assert_eq!(imgs["lazy-img"]["width"], "40");
    assert_eq!(imgs["lazy-img"]["height"], "20");
    assert_eq!(imgs["lazy-img"]["loading"], "lazy");
    assert_eq!(imgs["plain-img"]["width"], "40");
    assert_eq!(imgs["plain-img"]["height"], "20");
    assert!(
        imgs["inline-img"]["src"]
            .as_str()
            .unwrap()
            .starts_with("data:image/png;base64,")
    );
    assert_eq!(imgs["client-img"]["width"], "16");
    assert_eq!(imgs["client-img"]["height"], "16");
    assert_eq!(imgs["client-img"]["status"], 200);
    // ?raw and ?url on CSS (without auto-enqueuing standalone.css).
    assert_eq!(seen["raw"], "hello raw text");
    assert_eq!(seen["cssUrlStatus"], 200);
    assert!(seen["cssUrlFile"].as_str().unwrap().starts_with("standalone-"));
    // Client component Interactivity config carries its imported asset URL.
    let client_icon = seen["clientConfigAssets"]["icon"].as_str().unwrap();
    assert!(
        client_icon.contains("/wp-content/plugins/typedpress-app-modernassets/tp/app/assets/icon-"),
        "{client_icon}"
    );
}

/// `typedpress doctor --site <url> --links` on a served TypedPress site: every link and `#anchor` the docs
/// pages make, from Markdown content, TSX and WordPress, is followed; the broken ones are reported
/// with the page they are on.
#[test]
fn doctor_finds_broken_links_and_anchors_on_a_site() {
    let project = fixture("docs-kind", "links");
    // A doc whose links are good, broken, or point at a heading that isn't there.
    std::fs::write(
        project.join("content/docs/links.md"),
        "---\ntitle: Links\norder: 9\n---\n\n\
         - [Install](/docs/guides/install), [its heading](/docs/introduction#small-print) and [this page's](#links-here).\n\
         - [A page that isn't there](/docs/nowhere).\n\
         - [A heading that isn't there](/docs/introduction#no-such-heading).\n\
         - [Another site](https://example.invalid/gone) is not fetched.\n\n\
         ## Links here\n\nText.\n",
    )
    .unwrap();
    build(&project);
    let work = tempfile::tempdir().unwrap();
    let (sources, compiled) = (work.path().join("sources"), work.path().join("compiled"));
    for args in [
        vec![
            "sources".as_ref(),
            project.as_os_str(),
            "--out".as_ref(),
            sources.as_os_str(),
        ],
        vec![
            "compile-sources".as_ref(),
            sources.as_os_str(),
            compiled.as_os_str(),
            project.as_os_str(),
        ],
    ] {
        let out = first().args(&args).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
    let mut server = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/serve_built.php"))
        .arg(project.join("tp/dist/wp-content"))
        .arg(compiled.join("seed"))
        .env("TP_WP_THEMES", "1")
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    std::io::BufRead::read_line(&mut std::io::BufReader::new(server.stdout.take().unwrap()), &mut line).unwrap();
    let url = serde_json::from_str::<serde_json::Value>(&line).unwrap_or_else(|_| panic!("serve: {line}"))["url"]
        .as_str()
        .unwrap()
        .to_string();
    let out = first()
        .args(["doctor", "--json", "--links", "--site"])
        .arg(&url)
        .arg(&project)
        .output()
        .unwrap();
    let _ = Command::new("kill").arg(server.id().to_string()).output();
    let _ = server.wait();
    let _ = std::fs::remove_dir_all(&project);
    let report: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or_else(|_| {
        panic!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        )
    });
    let links = report["data"]["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "links")
        .unwrap()
        .clone();
    assert_eq!(links["ok"], false, "{report}");
    assert!(!out.status.success());
    // Exactly the two broken links, each on the page that makes it, from the doc's Markdown.
    assert_eq!(
        report["data"]["links"],
        serde_json::json!([
            { "on": "/docs/links", "href": "/docs/introduction#no-such-heading", "problem": "/docs/introduction has no element with id \"no-such-heading\"" },
            { "on": "/docs/links", "href": "/docs/nowhere", "problem": "answers 404" },
        ]),
        "{report}"
    );
}

/// `apiReference()` from "typedpress/content": the app's own OpenAPI document, and one in `public/`,
/// rendered by pages as an API reference, on WordPress over HTTP (tests/php/api_reference.php).
#[test]
fn api_reference_renders_openapi_as_pages() {
    let project = fixture("api-reference", "serve");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/api_reference.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    // The index: the document's title, this site as its server, a section per tag in the
    // document's order, and a link per operation named by its operationId.
    let index = &seen["index"];
    assert_eq!(index["status"], 200);
    assert_eq!(index["h1"], serde_json::json!(["Apiref API"]));
    assert!(
        index["server"][0].as_str().unwrap().ends_with("/wp-json/typedpress/v1"),
        "{index}"
    );
    assert_eq!(index["tags"][0], "notes");
    assert_eq!(index["tags"][1], "actions");
    assert_eq!(index["tags"][2], "word-press");
    assert_eq!(index["notes"][0], "/api/notes/notes-list/");
    assert_eq!(index["notes"][4], "/api/notes/notes-delete/");
    // The document's Markdown description, as HTML.
    assert_eq!(index["description"], "apiref");
    // One operation: the endpoint, who may call it, each parameter with where it goes and its
    // constraints, the response's fields nested by depth, and a request sample.
    let list = &seen["list"];
    assert_eq!(list["endpoint"], serde_json::json!(["GET /notes"]));
    assert_eq!(list["access"], serde_json::json!(["anyone"]));
    assert_eq!(
        list["limit"],
        serde_json::json!(["integer", "in query", "min 1 · default: 50"])
    );
    assert_eq!(list["response"][0], "depth-0 data Note[]");
    assert_eq!(list["response"][2], "depth-1 title string");
    assert_eq!(list["response"][3], "depth-1 body string | null");
    assert_eq!(
        list["response"].as_array().unwrap().last().unwrap(),
        "depth-0 cursor string | null"
    );
    assert!(
        list["curl"][0].as_str().unwrap().starts_with("curl -g -X GET 'http://"),
        "{list}"
    );
    // A write: its JSON body's fields, and samples that send the required ones.
    let create = &seen["create"];
    assert_eq!(create["body type"], serde_json::json!(["application/json"]));
    assert_eq!(create["body"][0], "title string");
    assert!(
        create["curl"][0]
            .as_str()
            .unwrap()
            .contains(r#"-d '{"title":"string"}'"#),
        "{create}"
    );
    assert!(
        create["fetch"][0]
            .as_str()
            .unwrap()
            .contains(r#"body: JSON.stringify({"title":"string"})"#),
        "{create}"
    );
    assert_eq!(seen["missing"], 404);
    // A document in public/: path-level parameters, $refs followed, a schema that refers to
    // itself shown once (the cycle stops), and nested fields one level deeper.
    assert_eq!(
        seen["partner"],
        serde_json::json!({
            "status": 200,
            "h1": ["Partner API"],
            "server": ["https://partner.example/v2"],
            "params": ["id path string required"],
            "fields": [
                "200 d0 id: string required",
                "200 d0 lines: Line[]",
                "200 d1 sku: string (matches ^[A-Z]+$)",
                "200 d1 qty: integer (min 1)",
                "200 d0 parent: Order"
            ],
            "id": ["get-order"]
        })
    );
    // What goes wrong in practice: a description's blocks are text, never the site's dynamic
    // blocks; the operation's parameter replaces the path's; allOf and const; JSON over a form
    // body; slugs that collide get -2; and a quote in the server is quoted in the curl sample.
    assert_eq!(
        seen["edge"],
        serde_json::json!({
            "status": 200,
            "description": "Plain text.",
            "renders blocks": false,
            "sections": ["unicode--items-list", "unicode--items-list-2"],
            "params": ["id: integer"],
            "fields": ["count: Count min 1 required", "kind: \"fixed\" always \"fixed\""],
            "body": ["application/json note!"],
            "curl": "curl -g -X GET 'https://h.example/a'\\''b/x/{id}' \\\n  -H 'Accept: application/json'"
        })
    );
}

/// A hierarchical kind at the site root (`url: "/:path"`), rendered by `tp/app/[...path]` beside the
/// app's own pages, on WordPress over HTTP (tests/php/docs_root.php).
#[test]
fn docs_at_the_site_root() {
    let project = fixture("docs-root", "serve");
    build(&project);
    let work = tempfile::tempdir().unwrap();
    let (sources, compiled) = (work.path().join("sources"), work.path().join("compiled"));
    for args in [
        vec![
            "sources".as_ref(),
            project.as_os_str(),
            "--out".as_ref(),
            sources.as_os_str(),
        ],
        vec![
            "compile-sources".as_ref(),
            sources.as_os_str(),
            compiled.as_os_str(),
            project.as_os_str(),
        ],
    ] {
        let out = first().args(&args).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/docs_root.php"))
        .arg(project.join("tp/dist/wp-content"))
        .arg(compiled.join("seed"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let page = |status: u16, h1: &str| serde_json::json!({ "status": status, "h1": h1, "location": null });
    // Each published item at its path, parent by parent; the app's own pages beside them.
    assert_eq!(seen["pages"]["/"], page(200, "Home"));
    assert_eq!(seen["pages"]["/getting-started/"], page(200, "Get started"));
    assert_eq!(seen["pages"]["/reference/"], page(200, "Reference"));
    assert_eq!(seen["pages"]["/reference/config/"], page(200, "Config API"));
    assert_eq!(seen["pages"]["/playground/"], page(200, "Playground"));
    assert_eq!(
        seen["bare"],
        serde_json::json!({ "status": 301, "h1": null, "location": "/reference/config/" })
    );
    // A draft, a path with the wrong parent, the slug alone and an unknown path: the app's 404.
    for path in ["/roadmap/", "/reference/nothing/", "/nothing/", "/config/"] {
        assert_eq!(seen["pages"][path], page(404, "Not here"), "{path}");
    }
    // Links, the tree and the pager all use the root paths, as does WordPress's sitemap.
    assert_eq!(seen["permalink"], "/reference/config/");
    assert_eq!(seen["tree"], serde_json::json!(["/getting-started/", "/reference/"]));
    assert_eq!(seen["next"], "/reference/");
    assert_eq!(
        seen["sitemap"],
        serde_json::json!(["/getting-started/", "/reference/", "/reference/config/"])
    );
    // WordPress's own addresses keep answering, and so do its Pages, posts and their twins: the kind
    // takes a path only when one of its items is there.
    assert_eq!(
        seen["wordpress"],
        serde_json::json!({ "/wp-login.php": 200, "/feed/": 200, "/llms.txt": 200, "/robots.txt": 200, "/getting-started.md": 200, "/reference/config.md": 200 })
    );
    assert_eq!(seen["twin"], true);
    assert_eq!(
        seen["wordpress pages"],
        serde_json::json!({ "/about/": [200, true], "/news/": [200, true], "/about.md": [200, true], "/news.md": [200, true] })
    );
    // Nothing a signed-out visitor may not read reaches them: an item the read rule hides, an item
    // under a draft, a draft, or any of them with its `/` written as %2F, as a page or a twin.
    for (path, answer) in seen["hidden"].as_object().unwrap() {
        assert_eq!(answer, &serde_json::json!([404, false]), "{path}");
    }
    // Neither the bare spelling nor another case of a hidden item's path redirects: a redirect would
    // tell the visitor the item exists.
    assert_eq!(seen["hidden"].as_object().unwrap().len(), 13);
    // An item under a first segment WordPress or TypedPress owns (`/auth`) has no URL of its own.
    assert!(
        seen["reserved permalink"].as_str().unwrap().contains("?post_type="),
        "{seen}"
    );
    // A WordPress Page at an item's path keeps it; a form posting to a Page isn't refused.
    assert_eq!(seen["page wins"], serde_json::json!([200, true, false]));
    assert_eq!(seen["post to a page"], 200);
    // Another case of the path redirects to the item's own.
    assert_eq!(seen["case"], serde_json::json!([301, "/reference/config/"]));
    // A link under the root kind's catch-all carries no template, so a click loads the page.
    assert_eq!(
        seen["link templates"],
        serde_json::json!({ "/about/": null, "/reference/config": null, "/playground": "tp-page" })
    );
}

/// The project's `public/` folder at the site root (spec §1: "static files, served as-is"), on
/// WordPress over HTTP (tests/php/public_root.php): each file at its path with its type; the app's
/// own page over a file of the same name; never a dotfile, PHP, a path out of the folder or one
/// WordPress owns.
#[test]
fn public_files_serve_at_the_site_root() {
    let project = fixture("public-root", "serve");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/public_root.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        seen["packaged"],
        serde_json::json!({
            "env": false,
            "php": false,
            "htaccess": true,
            "indexSymlinked": false,
            "existingPreserved": "real-root-file",
            "logoIsSymlink": true,
            "logoTargetInWpContent": true
        })
    );
    assert_eq!(
        seen["served"],
        serde_json::json!({
            "/compiler.wasm": [200, "application/wasm", 8],
            "/logo.svg": [200, "image/svg+xml", 41],
            "/files/blog.json": [200, "application/json", 11],
            "/files/blobs/0a1b.txt": [200, "text/plain; charset=utf-8", 9],
            "/files/": [200, "text/html; charset=utf-8", 35],
            "/og/index.png": [200, "image/png", 8],
            "/.well-known/ai.json": [200, "application/json", 13],
            "/notes.md": [200, "text/markdown; charset=utf-8", 15],
            "/robots-extra.txt": [200, "text/plain; charset=utf-8", 14],
            "/it's.txt": [200, "text/plain; charset=utf-8", 1],
            "/index.html": [200, "text/html; charset=utf-8", 21]
        })
    );
    assert_eq!(
        seen["wpIndex"],
        serde_json::json!([200, "text/html; charset=utf-8", 21])
    );
    // robots.txt, llms.txt, feeds and TypedPress Identity's discovery document stay WordPress's.
    for (path, kept) in seen["wordpress"].as_object().unwrap() {
        assert_eq!(kept, true, "{path}");
    }
    // A `[slug]` route at the root doesn't take a file's path.
    assert_eq!(seen["beside a dynamic route"], 200);
    assert_eq!(seen["home"], false);
    // `tp/app/about/page.tsx` wins over `public/about`.
    assert_eq!(seen["about"], serde_json::json!([200, true, false]));
    // `<Link>` to a file in `public/` keeps its root path, though the root `[slug]` route also matches it;
    // a link to a page is written at the page's one address.
    assert_eq!(
        seen["about links"],
        serde_json::json!({ "file": "/logo.svg", "nested": "/files/blog.json", "page": "/about/" })
    );
    // Never a file's bytes for a dotfile, PHP (as Windows would read `run.php.`, `run.php `,
    // `run.php::$DATA`, or in capitals), a path out of the folder, or a link that leaves it.
    for (path, answer) in seen["refused"].as_object().unwrap() {
        assert_eq!(answer, &serde_json::json!([true, false]), "{path}");
    }
    assert_eq!(seen["refused"].as_object().unwrap().len(), 15);
    assert_eq!(seen["head"], serde_json::json!([200, "", "11"]));
    // /.well-known/* stays served at the site root through PHP with ETag, 304, cache and CORS headers.
    assert_eq!(
        seen["wellKnown"],
        serde_json::json!({
            "cache": "public, max-age=300",
            "notModified": [304, 304, 304, 304, 200, 200, 200, 200],
            "cors": ["*", "*", null]
        })
    );
    // A POST isn't served a file; the `[slug]` page answers it as pages do (405).
    assert_eq!(seen["post"], 405);
    assert_eq!(
        seen["cleaned"],
        serde_json::json!({
            "logoRemoved": true,
            "filesDirRemoved": true,
            "existingStillThere": "real-root-file"
        })
    );
}

/// A docs section as a kind (docs/decisions/2026-11-13-docs-kind.md): a hierarchical collection
/// seeded from a folder of Markdown by a hosted compile, served by one catch-all page that reads
/// `nav`, `pager` and `headings` from "typedpress/content", on WordPress over HTTP (tests/php/docs_kind.php).
#[test]
fn docs_kind_serves_a_folder_tree_with_navigation() {
    let project = fixture("docs-kind", "serve");
    build(&project);
    let work = tempfile::tempdir().unwrap();
    let (sources, compiled) = (work.path().join("sources"), work.path().join("compiled"));
    let step = |args: &[&std::ffi::OsStr]| {
        let out = first().args(args).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    };
    step(&[
        "sources".as_ref(),
        project.as_os_str(),
        "--out".as_ref(),
        sources.as_os_str(),
    ]);
    step(&[
        "compile-sources".as_ref(),
        sources.as_os_str(),
        compiled.as_os_str(),
        project.as_os_str(),
    ]);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/docs_kind.php"))
        .arg(project.join("tp/dist/wp-content"))
        .arg(compiled.join("seed"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    // The folder tree is stored as WordPress stores Pages: parent and order on the post itself.
    assert_eq!(seen["seed"]["docs"]["created"], 8);
    assert_eq!(seen["type hierarchical"], true);
    assert_eq!(
        seen["stored"],
        serde_json::json!({
            "introduction": [null, 1, "publish"], "guides": [null, 2, "publish"], "reference": [null, 3, "publish"],
            "install": ["guides", 1, "publish"], "setup": ["guides", 1, "publish"], "deploy": ["guides", 3, "publish"],
            "roadmap": ["guides", 2, "draft"], "space": ["deploy", 0, "publish"],
        })
    );
    // What the rest of WordPress is told a doc's URL is (an SEO or breadcrumb plugin, `is_singular()`,
    // `get_queried_object()`): the doc, a singular item of the kind's post type, at the top of the tree
    // or below it. Core prints `single single-<post type> postid-<id>` for it, and sends none of the
    // no-cache headers it sends with a 404.
    let wordpress = &seen["wordpress"];
    assert_eq!(wordpress["type"], "tp_docs");
    let is_doc = |page: &serde_json::Value, what: &str| {
        let id = page["expected id"].as_u64().unwrap();
        assert!(id > 0, "{what}");
        let query = serde_json::json!({ "id": id, "type": "tp_docs", "is_404": false, "is_singular": true });
        assert_eq!(page["status"], 200, "{what}");
        assert_eq!(page["resolved"], query, "{what}: what WordPress resolved the URL to");
        assert_eq!(
            page["query"], query,
            "{what}: what a plugin is told while the page renders"
        );
        assert_eq!(
            page["body"],
            serde_json::json!([
                "wp-singular",
                "tp_docs-template-default",
                "single",
                "single-tp_docs",
                format!("postid-{id}"),
                "wp-embed-responsive",
                "typedpress-app"
            ]),
            "{what}"
        );
        assert_eq!(page["expires"], serde_json::Value::Null, "{what}: no `Expires: … 1984`");
        assert_eq!(
            page["cache"], "public, max-age=0, s-maxage=300, must-revalidate",
            "{what}"
        );
    };
    is_doc(&wordpress["install"], "/docs/guides/install");
    is_doc(&wordpress["introduction"], "/docs/introduction");
    is_doc(&wordpress["space"], "/docs/guides/deploy/space");
    // A page argument that shares core's name (`?page=2`, `<!--nextpage-->` paging) is the page's own:
    // the doc, a 200, no 404 headers (core adds its `paged-2` body classes, as for any paged post).
    let paged = &wordpress["paged"];
    let doc =
        serde_json::json!({ "id": paged["expected id"], "type": "tp_docs", "is_404": false, "is_singular": true });
    assert_eq!(
        (&paged["status"], &paged["resolved"], &paged["query"]),
        (&serde_json::json!(200), &doc, &doc),
        "{paged}"
    );
    // The page declares no `page` parameter, so this URL is the visitor's own answer, not a shared one.
    assert_eq!(paged["cache"], "private, no-store, max-age=0", "{paged}");
    assert!(
        !paged["body"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("error404")),
        "{paged}"
    );
    // A path with no item is the app's 404, and WordPress's.
    let missing = &wordpress["missing"];
    let not_found = serde_json::json!({ "id": 0, "type": null, "is_404": true, "is_singular": false });
    assert_eq!(missing["status"], 404);
    assert_eq!(missing["resolved"], not_found);
    assert_eq!(missing["query"], not_found);
    assert_eq!(
        missing["body"],
        serde_json::json!(["error404", "wp-embed-responsive", "typedpress-app"])
    );
    assert_eq!(missing["cache"], "private, no-store, max-age=0");
    // One address per page (#462), the permalink structure's (`/%postname%/`, a trailing slash): the
    // bare spelling 301s there with its query string. The address itself, a `.md` twin, the REST routes
    // (TypedPress's API among them) and WordPress's own paths answer where they are. A path no doc has, and
    // `/docs` (the catch-all with no item), are a 404 where they were asked, as WordPress answers one.
    assert_eq!(
        seen["spellings"],
        serde_json::json!({
            "bare": [301, "/docs/introduction/"],
            "bare nested": [301, "/docs/guides/deploy/space/"],
            "bare with query": [301, "/docs/introduction/?ref=nav&page=2"],
            "bare section": [404, null],
            "canonical": [200, null],
            "twin": [200, null],
            "api": [200, null],
            "api slash": [200, null],
            "rest": [200, null],
            "sitemap": [200, null],
            "missing": [404, null],
        })
    );
    // Another case of the path is the same item: it redirects to the item's one URL.
    assert_eq!(
        wordpress["case"],
        serde_json::json!({ "status": 301, "location": "/docs/guides/install/" })
    );
    // WordPress's sitemap lists the published docs at the kind's URLs.
    assert!(
        seen["sitemap"][0]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("/wp-sitemap-typedpress-docs-1.xml")),
        "{}",
        seen["sitemap"][0]
    );
    assert_eq!(
        seen["sitemap"][1],
        serde_json::json!([
            "/docs/guides/",
            "/docs/guides/deploy/",
            "/docs/guides/deploy/space/",
            "/docs/guides/install/",
            "/docs/guides/setup/",
            "/docs/introduction/",
            "/docs/reference/"
        ])
    );
    // A site built before the `:path` rule was TypedPress's own holds a rule that hands the path to core's
    // `pagename`, which core skips unless a Page is at that path. It gets the new rule without anyone
    // flushing: a managed build's deploy sees the stored rules are behind and rebuilds them, and a
    // plugin-installed site rebuilds on its next request, which is already answered right.
    let old_rule = "index.php?post_type=tp_docs&tp_kind=docs&pagename=$matches[1]";
    let new_rule = "index.php?post_type=tp_docs&tp_kind=docs&tp_kind_path=$matches[1]";
    let deploy = &seen["stale site"]["deploy"];
    assert_eq!(deploy["rule before"], old_rule);
    assert_eq!(deploy["recorded before"], false);
    assert_eq!(deploy["rebuilt"], true);
    assert_eq!(deploy["rule after"], new_rule);
    assert_eq!(deploy["recorded after"], true);
    let request = &seen["stale site"]["request"];
    assert_eq!(request["rule before"], old_rule);
    is_doc(
        &request["first request"],
        "the first request of a site with the old rule",
    );
    assert_eq!(request["rule after"], new_rule);
    assert_eq!(request["recorded after"], true);
    // nav(): the published tree, siblings by order, the current item and its ancestors marked.
    let tree = |current: &str, open: &[&str]| {
        let mark = |name: &str, path: &str| {
            let label = if name == current {
                format!("{name} [current]")
            } else if open.contains(&name) {
                format!("{name} [open]")
            } else {
                name.to_string()
            };
            (label, serde_json::json!(path))
        };
        let leaf = |name: &str, path: &str| {
            let (k, v) = mark(name, path);
            serde_json::json!({ k: v })
        };
        let branch = |name: &str, path: &str, children: serde_json::Value| {
            let (k, v) = mark(name, path);
            serde_json::json!({ k: v, "children": children })
        };
        serde_json::json!([
            leaf("Introduction", "/docs/introduction/"),
            branch(
                "Guides",
                "/docs/guides/",
                serde_json::json!([
                    // Configure (setup.md, seeded after install.md) and Install share an order: by title.
                    leaf("Configure", "/docs/guides/setup/"),
                    leaf("Install", "/docs/guides/install/"),
                    branch(
                        "Deploy",
                        "/docs/guides/deploy/",
                        serde_json::json!([leaf("To a Space", "/docs/guides/deploy/space/")])
                    ),
                ])
            ),
            leaf("Reference", "/docs/reference/"),
        ])
    };
    assert_eq!(seen["introduction"]["tree"], tree("Introduction", &[]));
    assert_eq!(seen["install"]["tree"], tree("Install", &["Guides"]));
    assert_eq!(seen["space"]["tree"], tree("To a Space", &["Guides", "Deploy"]));
    assert_eq!(seen["guides"]["tree"], tree("Guides", &[]));
    // pager(): reading the tree top to bottom; none before the first or after the last.
    let ends = |key: &str| (seen[key]["prev"].clone(), seen[key]["next"].clone());
    assert_eq!(
        ends("introduction"),
        (serde_json::json!([]), serde_json::json!(["Guides /docs/guides/"]))
    );
    assert_eq!(
        ends("guides"),
        (
            serde_json::json!(["Introduction /docs/introduction/"]),
            serde_json::json!(["Configure /docs/guides/setup/"])
        )
    );
    assert_eq!(
        ends("install"),
        (
            serde_json::json!(["Configure /docs/guides/setup/"]),
            serde_json::json!(["Deploy /docs/guides/deploy/"])
        )
    );
    assert_eq!(
        ends("space"),
        (
            serde_json::json!(["Deploy /docs/guides/deploy/"]),
            serde_json::json!(["Reference /docs/reference/"])
        )
    );
    assert_eq!(
        ends("reference"),
        (
            serde_json::json!(["To a Space /docs/guides/deploy/space/"]),
            serde_json::json!([])
        )
    );
    // headings(): `##` and `###`, with ids unique in the page, and the rendered headings carry them.
    assert_eq!(
        seen["introduction"]["toc"],
        serde_json::json!([
            "#why Why depth-2",
            "#small-print Small print depth-3",
            "#whats-tpapp What's tp/app/? depth-3",
            "#why-1 Why depth-2",
            "#step-1---install Step 1 - Install depth-3",
            "#the---force-flag The --force flag depth-3",
            "#why-1-1 Why 1 depth-2",
            "#two--spaces Two spaces depth-2"
        ])
    );
    // Ids follow GitHub's rule (github-slugger): punctuation goes, a repeat gets `-1`.
    assert_eq!(
        seen["introduction"]["anchors"],
        serde_json::json!([
            "h2#why",
            "h3#small-print",
            "h3#whats-tpapp",
            "h2#why-1",
            "h3#step-1---install",
            "h3#the---force-flag",
            "h2#why-1-1",
            "h2#two--spaces"
        ])
    );
    assert_eq!(seen["introduction"]["title"], "Introduction · Docs");
    assert_eq!(
        seen["introduction"]["cache"],
        "public, max-age=0, s-maxage=300, must-revalidate"
    );
    // The draft: a 404 and no twin for visitors; in nobody's tree or pager, an editor's included.
    assert_eq!(seen["roadmap"], 404);
    assert_eq!(seen["twin draft"], 404);
    assert_eq!(seen["install as editor"]["tree"], tree("Install", &["Guides"]));
    assert_eq!(seen["roadmap as editor"]["status"], 200);
    assert_eq!(seen["roadmap as editor"]["cache"], "private, no-store, max-age=0");
    // Only an item's own path serves it.
    assert_eq!(seen["wrong parent"], 404);
    assert_eq!(
        seen["landing"], 404,
        "`[[...path]]` with nothing after /docs finds no item"
    );
    assert_eq!(seen["missing"], 404);
    assert_eq!(seen["slug alone"][0], 404);
    assert_eq!(seen["permalink"], "/docs/guides/deploy/space/");
    assert_eq!(seen["twin"][0], 200);
    assert!(seen["twin"][1].as_str().unwrap().contains("Run the installer."));
    // An editor moves Reference under Guides in wp-admin: its URL and the tree follow.
    assert_eq!(seen["moved"]["status"], 200);
    assert_eq!(
        seen["moved"]["tree"][1]["children"][0],
        serde_json::json!({ "Reference [current]": "/docs/guides/reference/" })
    );
    assert_eq!(seen["moved old"], serde_json::json!([404]));
    assert_eq!(
        seen["parent rollback"],
        serde_json::json!({
            "purges": [], "status": 200, "reference": true, "new status": 404,
        }),
        "{seen}"
    );
    assert_eq!(
        seen["parent purge"],
        serde_json::json!([
            "/docs/reference/",
            "/docs/reference.md",
            "/docs/guides/reference/",
            "/docs/guides/reference.md",
        ]),
        "{seen}"
    );
    // A published page under a draft is as hidden as the draft: its path names an unpublished page.
    assert_eq!(seen["under a draft"], serde_json::json!([404, 404]));
    assert_eq!(seen["under a draft moved"], serde_json::json!([404, 404, 404]));
    assert_eq!(seen["under a draft resolved"], not_found);
    // A WordPress Page with a doc's slug doesn't take over the doc's URL.
    assert_eq!(seen["page with a doc slug"], serde_json::json!([200, ["Introduction"]]));
    // Nor do Pages at a nested doc's whole path: the doc is served, with no redirect, and is still
    // what WordPress says the URL is. The Pages keep their own addresses.
    let pages = &seen["pages at a doc path"];
    is_doc(&pages["top"], "/docs/introduction beside a Page `introduction`");
    is_doc(
        &pages["nested"],
        "/docs/guides/install beside a Page at `guides/install`",
    );
    assert_eq!(pages["nested"]["h1"], serde_json::json!(["Install"]));
    assert_eq!(pages["nested"]["location"], serde_json::Value::Null);
    assert_eq!(pages["the page itself"], serde_json::json!([200, true]));
    // Slugs are unique among siblings: two pages named `install` under different parents each serve.
    assert_eq!(
        seen["same slug elsewhere"],
        serde_json::json!([["Install again"], ["Install"]])
    );
    // Every id github-slugger gives the fixture's headings (tests/fixtures/docs-kind/heading-ids.json).
    assert_eq!(seen["heading ids"], serde_json::json!([]));
    assert_eq!(seen["heading id cases"], 17);
    // `## Why`, `<h2 id="why">`, `## Why`: the own id stays, and the generated ones step around it.
    assert_eq!(seen["own ids"], serde_json::json!(["why-1", "why", "why-2"]));
    // A block that renders differently each time doesn't cost the headings their anchors.
    assert_eq!(
        seen["headings beside a gallery"],
        serde_json::json!([
            [
                "#why Why depth-2",
                "#small-print Small print depth-3",
                "#whats-tpapp What's tp/app/? depth-3",
                "#why-1 Why depth-2",
                "#step-1---install Step 1 - Install depth-3",
                "#the---force-flag The --force flag depth-3",
                "#why-1-1 Why 1 depth-2",
                "#two--spaces Two spaces depth-2"
            ],
            [
                "h2#why",
                "h3#small-print",
                "h3#whats-tpapp",
                "h2#why-1",
                "h3#step-1---install",
                "h3#the---force-flag",
                "h2#why-1-1",
                "h2#two--spaces"
            ]
        ])
    );
    // Components in Markdown (docs/decisions/2026-11-13-components-in-markdown.md): the file's
    // tags are stored as the app's blocks, their Markdown as inner blocks.
    assert_eq!(
        seen["blocks registered"],
        serde_json::json!(["docskind/callout", "docskind/badge", "docskind/status"])
    );
    assert_eq!(
        seen["blocks stored"],
        serde_json::json!([
            ["core/paragraph", [], []],
            ["docskind/callout", { "type": "warning", "title": "Before you start" }, ["core/paragraph", "core/list"]],
            ["docskind/badge", { "label": "New", "count": 3 }, []],
            ["core/paragraph", [], []],
        ])
    );
    // The route renders each block through its component, the inner content as its children.
    assert_eq!(
        seen["blocks rendered"],
        serde_json::json!([
            200,
            "<aside class=\"callout callout-warning\" role=\"note\"><p class=\"callout-title\">Before you start</p><div class=\"callout-body\"> <p class=\"wp-block-paragraph\">Back up the <b>database</b>.</p> <ul class=\"wp-block-list\"> <li>Export it</li> <li>Keep a copy</li> </ul> </div></aside>",
            "<span class=\"badge\">New<b> 3</b></span>",
        ])
    );
    // Written back, the blocks are the file's tags again, and an editor's change to a prop is too.
    let file = "Run the installer.\n\n<Callout type=\"warning\" title=\"Before you start\">\nBack up the **database**.\n\n- Export it\n- Keep a copy\n</Callout>\n\n<Badge label=\"New\" count={3} />\n\nThen continue.\n";
    assert_eq!(seen["blocks back"], file);
    assert_eq!(
        seen["blocks cleared back"],
        "<Status />\n\n<Badge label=\"x\" count={3} />\n"
    );
    assert_eq!(
        seen["blocks edited back"],
        file.replace("type=\"warning\"", "type=\"note\"")
    );
    // The Markdown twin is what a reader sees: the components' text, never their tags.
    let twin = seen["blocks twin"].as_str().unwrap();
    assert!(
        twin.contains("Before you start\n\nBack up the **database**.") && !twin.contains("<Callout"),
        "{twin}"
    );
    // What a file can't say about a block is refused with the reason; a tag in a code fence is code.
    assert_eq!(
        seen["blocks refused"],
        serde_json::json!({
            "unknown tag": "<Tabs> isn't a block this site has; list it in its component file's `export const blocks`",
            "unknown prop": "<Callout> has no prop `colour`; it takes type, title",
            "enum": "<Callout type> takes \"note\" | \"warning\"",
            "required": "<Callout> needs `type`",
            "number": "<Badge count> takes number",
            "unclosed": "<Callout> is never closed: put </Callout> on a line of its own",
        })
    );
    assert!(seen["blocks fenced"].as_str().unwrap().starts_with("<!-- wp:code"));
    // Code blocks: highlighted on the route, titled, line 2 marked, the `install` pair as tabs,
    // plain text escaped and unhighlighted, one stylesheet with a dark theme, and no script.
    let code = &seen["code"];
    assert_eq!(code["status"], 200);
    assert_eq!(code["titles"], serde_json::json!(["typedpress.config.ts", "pnpm"]));
    assert_eq!(
        code["keywords"],
        serde_json::json!(["import", "from", "export", "default"])
    );
    assert_eq!(
        code["marked"],
        serde_json::json!(["export default defineConfig({ name: \"docs\" });"])
    );
    assert_eq!(code["tabs"], serde_json::json!(["sh", "pnpm"]));
    assert_eq!(code["tab inputs"], 2);
    assert_eq!(
        code["panels"],
        serde_json::json!(["npm install first", "pnpmpnpm add first"])
    );
    assert_eq!(code["plain"], "plain <b>text</b>");
    assert_eq!(code["plain spans"], 0);
    assert_eq!(code["stylesheet"], 1);
    assert_eq!(code["scripts"], serde_json::json!([]));
    assert_eq!(seen["code css"], serde_json::json!([200, true, true, true]));
    // Written back, each fence keeps its title, marked lines and group.
    assert_eq!(
        seen["code back"],
        "Edit the config.\n\n```ts title=\"typedpress.config.ts\" {2}\nimport { defineConfig } from \"typedpress\";\nexport default defineConfig({ name: \"docs\" });\n```\n\n```sh group=\"install\"\nnpm install first\n```\n\n```sh title=\"pnpm\" group=\"install\"\npnpm add first\n```\n\n```text\nplain <b>text</b>\n```\n"
    );
    // The query API reads parent and order like any field.
    assert_eq!(
        seen["api"],
        serde_json::json!([["introduction", null, 1], ["guides", null, 2]])
    );
}

/// A folder-tree sync and a hierarchical kind refuse what they can't serve, at the line.
#[test]
fn docs_kind_refuses_what_a_folder_tree_cannot_hold() {
    let dir = std::env::temp_dir().join(format!("typedpress-docs-reject-{}", std::process::id()));
    let kind = |fields: &str, options: &str| {
        format!(
            "import {{ collection, table, text, slug, richText }} from \"typedpress\";\nexport const docs = collection({{ title: text(), body: richText().optional(), {fields} }}, {{ content: \"body\", {options} }});\n"
        )
    };
    let cases = [
        (kind("slug: slug({ source: \"title\" })", "sync: \"content/docs/**/*.md\""), "a `**` sync pattern needs a hierarchical kind"),
        (kind("summary: text().optional()", "hierarchical: true, sync: \"content/docs/**/*.md\""), "a folder tree of files needs a slug field"),
        (kind("parent: text().optional()", "hierarchical: true"), "`parent` is reserved: hierarchical kinds add `parent` and `order`"),
        (kind("slug: slug({ source: \"title\" })", "url: \"/docs/:path\""), "`:path` in \"/docs/:path\" needs a hierarchical kind"),
        (
            "import { table, text } from \"typedpress\";\nexport const docs = table({ title: text() }, { hierarchical: true });\n".to_string(),
            "only collection() kinds can be hierarchical",
        ),
    ];
    for (schema, message) in cases {
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("tp")).unwrap();
        std::fs::write(
            dir.join("typedpress.config.ts"),
            "import { defineConfig } from \"typedpress\";\nexport default defineConfig({});\n",
        )
        .unwrap();
        std::fs::write(dir.join("tp/schema.ts"), &schema).unwrap();
        let out = first().arg("check").arg(&dir).output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{message}: should fail:\n{stderr}");
        assert!(stderr.contains(message), "expected {message:?} in:\n{stderr}");
        assert!(stderr.contains("--> tp/schema.ts:"), "{stderr}");
    }
    // At capture: two files with one slug, and a folder without its index file.
    for (files, message) in [
        (
            &[
                ("content/docs/a/install.md", "# A"),
                ("content/docs/a/index.md", "# A"),
                ("content/docs/b/install.md", "# B"),
                ("content/docs/b/index.md", "# B"),
            ][..],
            "both have the slug `install`",
        ),
        (
            &[("content/docs/guides/install.md", "Install")][..],
            "its folder has no guides/index.md",
        ),
    ] {
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("tp")).unwrap();
        std::fs::write(
            dir.join("typedpress.config.ts"),
            "import { defineConfig } from \"typedpress\";\nexport default defineConfig({ name: \"docsreject\" });\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("tp/schema.ts"),
            kind(
                "slug: slug({ source: \"title\" })",
                "hierarchical: true, sync: \"content/docs/**/*.md\"",
            ),
        )
        .unwrap();
        for (path, text) in files {
            let path = dir.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, format!("---\ntitle: {text}\n---\n")).unwrap();
        }
        let work = tempfile::tempdir().unwrap();
        let sources = work.path().join("sources");
        let out = first()
            .arg("sources")
            .arg(&dir)
            .arg("--out")
            .arg(&sources)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        let out = first()
            .arg("compile-sources")
            .arg(&sources)
            .arg(work.path().join("out"))
            .arg(&dir)
            .output()
            .unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(
            !out.status.success() && stderr.contains(message),
            "expected {message:?} in:\n{stderr}"
        );
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// A root catch-all answers every path of the app, and never one WordPress, TypedPress or the host
/// owns: on Spacefast `/__spacefast/connectors/*` and `/__spacefast/client.js` are the host's.
#[test]
fn a_root_catch_all_leaves_reserved_paths_alone() {
    let project = fixture("app-router-reserved", "serve");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_router_reserved.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value =
        serde_json::from_slice(&out.stdout).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out.stdout)));
    assert_eq!(seen["app path"], serde_json::json!([200, "app"]), "{seen}");
    assert_eq!(seen["app path POST"], serde_json::json!([200, "app"]), "{seen}");
    for reserved in ["connector GET", "connector POST", "space client", "first", "rest"] {
        assert_eq!(seen[reserved][1], "not the app", "{reserved}: {seen}");
    }
}

/// A component listed as a block must have props a Markdown tag can write, and the list must name
/// the file's own components; each refusal is at the component file.
#[test]
fn content_blocks_refuse_props_a_tag_cannot_write() {
    let dir = std::env::temp_dir().join(format!("typedpress-blocks-reject-{}", std::process::id()));
    for (component, message) in [
        (
            "export const blocks = [\"Card\"];\nexport function Card({ links }: { links: string[] }) { return <div>{links.length}</div>; }\n",
            "<Card>'s prop `links` is string[], which a Markdown tag can't write",
        ),
        (
            "export const blocks = [\"Missing\"];\nexport function Card() { return <div />; }\n",
            "`blocks` names `Missing`, which components/Card.tsx doesn't export as a component",
        ),
        (
            "export const blocks = \"Card\";\nexport function Card() { return <div />; }\n",
            "`blocks` is a list of this file's component names",
        ),
    ] {
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("tp/components")).unwrap();
        std::fs::write(
            dir.join("typedpress.config.ts"),
            "import { defineConfig } from \"typedpress\";\nexport default defineConfig({});\n",
        )
        .unwrap();
        std::fs::write(dir.join("tp/components/Card.tsx"), component).unwrap();
        let out = first().arg("check").arg(&dir).output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{message}: should fail:\n{stderr}");
        assert!(stderr.contains(message), "expected {message:?} in:\n{stderr}");
        assert!(stderr.contains("--> tp/components/Card.tsx"), "{stderr}");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

/// Components in Markdown in the block editor, in Chromium: a component without `children` is
/// registered by core's `autoRegister` support (a server-rendered preview, a sidebar field per
/// prop), one with `children` by the runtime's script (inner blocks edited in place, props in the
/// sidebar); both save as the app's blocks and render through their components
/// (tests/differential/client/editor-blocks.mjs).
#[test]
fn component_blocks_edit_in_the_block_editor() {
    assert!(
        root()
            .join("tests/differential/client/node_modules/playwright-core")
            .is_dir(),
        "run: npm ci --prefix tests/differential/client && npx --prefix tests/differential/client playwright-core install chromium-headless-shell"
    );
    let project = fixture("docs-kind", "editor");
    build(&project);
    let mut server = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/serve_built.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    std::io::BufRead::read_line(&mut std::io::BufReader::new(server.stdout.take().unwrap()), &mut line).unwrap();
    let url = serde_json::from_str::<serde_json::Value>(&line).unwrap_or_else(|_| panic!("serve: {line}"))["url"]
        .as_str()
        .unwrap()
        .to_string();
    let out = Command::new("node")
        .arg(root().join("tests/differential/client/editor-blocks.mjs"))
        .arg(&url)
        .output()
        .unwrap();
    let _ = Command::new("kill").arg(server.id().to_string()).output();
    let _ = server.wait();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(seen["errors"], serde_json::json!([]), "{seen}");
    // Core marks the Badge's props for its own fields; the Callout's are the runtime's.
    assert_eq!(
        seen["types"],
        serde_json::json!({ "docskind/badge": ["count", "label"], "docskind/callout": [] }),
        "{seen}"
    );
    assert_eq!(seen["badgePreview"], "<span class=\"badge\">New<b> 3</b></span>");
    assert_eq!(seen["badgeFields"], serde_json::json!([1, 1]), "{seen}");
    assert_eq!(seen["badgeEdited"], "<span class=\"badge\">Fresh<b> 3</b></span>");
    assert_eq!(seen["calloutInner"], "Mind the gap.");
    assert_eq!(seen["calloutFields"], serde_json::json!([1, 1]), "{seen}");
    // A block that renders nothing still has a box to select; an optional choice starts unset, and
    // can be set and unset again; a cleared text field is empty.
    assert_eq!(seen["statusEmpty"], "<Status />");
    assert_eq!(seen["statusKind"], serde_json::json!(["", "live", ""]));
    assert_eq!(seen["statusCleared"], "");
    let saved = seen["saved"].as_str().unwrap();
    assert!(
        saved.contains("<!-- wp:docskind/badge {\"label\":\"Fresh\",\"count\":3} /-->")
            && saved.contains("<!-- wp:docskind/callout {\"type\":\"warning\"} -->")
            && saved.contains("<p>Mind the gap.</p>"),
        "{saved}"
    );
    assert_eq!(
        seen["rendered"],
        serde_json::json!([
            "<span class=\"badge\">Fresh<b> 3</b></span>",
            "<aside class=\"callout callout-warning\" role=\"note\"><div class=\"callout-body\"> <p class=\"wp-block-paragraph\">Mind the gap.</p> </div></aside>"
        ]),
        "{seen}"
    );
}

/// The docs example (examples/docs), every content feature at once, read in Chromium as an
/// anonymous visitor: the site is the example as built, seeded from the records a hosted compile
/// writes for its content/docs/ folder tree (tests/differential/client/docs.mjs).
#[test]
fn docs_example_reads_in_the_browser() {
    assert!(
        root()
            .join("tests/differential/client/node_modules/playwright-core")
            .is_dir(),
        "run: npm ci --prefix tests/differential/client && npx --prefix tests/differential/client playwright-core install chromium-headless-shell"
    );
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("docs");
    copy(&root().join("examples/docs"), &project);
    build(&project);
    let (sources, compiled) = (work.path().join("sources"), work.path().join("compiled"));
    for args in [
        vec![
            "sources".as_ref(),
            project.as_os_str(),
            "--out".as_ref(),
            sources.as_os_str(),
        ],
        vec![
            "compile-sources".as_ref(),
            sources.as_os_str(),
            compiled.as_os_str(),
            project.as_os_str(),
        ],
    ] {
        let out = first().args(&args).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }
    let mut server = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/serve_built.php"))
        .arg(project.join("tp/dist/wp-content"))
        .arg(compiled.join("seed"))
        .env("TP_WP_THEMES", "1")
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    std::io::BufRead::read_line(&mut std::io::BufReader::new(server.stdout.take().unwrap()), &mut line).unwrap();
    let url = serde_json::from_str::<serde_json::Value>(&line).unwrap_or_else(|_| panic!("serve: {line}"))["url"]
        .as_str()
        .unwrap()
        .to_string();
    let seen = read_docs(&url);
    let _ = Command::new("kill").arg(server.id().to_string()).output();
    let _ = server.wait();
    docs_read_as_published(&seen, &url, &url, "/");
}

/// `typedpress export` (docs/decisions/2026-11-13-static-output.md): examples/docs (`output: "static"`),
/// its content from content/docs/, rendered by a throwaway WordPress on SQLite, written as files and
/// read in Chromium from a plain static server: the same pages a visitor reads on WordPress, with no
/// WordPress at all. The draft is in no file, Markdown twins sit beside their pages, and llms.txt,
/// the sitemap and robots.txt name the address given.
#[test]
fn docs_example_exports_to_a_static_site() {
    assert!(
        root()
            .join("tests/differential/client/node_modules/playwright-core")
            .is_dir(),
        "run: npm ci --prefix tests/differential/client && npx --prefix tests/differential/client playwright-core install chromium-headless-shell"
    );
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("docs");
    copy(&root().join("examples/docs"), &project);
    let out = first()
        .args([
            "export".as_ref(),
            project.as_os_str(),
            "--site-url".as_ref(),
            "https://docs.example.test".as_ref(),
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let dist = project.join("tp/dist/static");
    let mut files: Vec<String> = Vec::new();
    fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(&path, root, out);
            } else {
                out.push(path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"));
            }
        }
    }
    walk(&dist, &dist, &mut files);
    files.sort();
    let pages: Vec<&str> = files
        .iter()
        .map(String::as_str)
        .filter(|f| !f.starts_with("wp-"))
        .collect();
    // `.typedpress-export` marks the folder as an export, the only kind of folder a later export replaces.
    assert_eq!(
        pages,
        [
            ".typedpress-export",
            "404.html",
            "about.html",
            "about.md",
            "docs/guides.html",
            "docs/guides.md",
            "docs/guides/deploy.html",
            "docs/guides/deploy.md",
            "docs/guides/deploy/space.html",
            "docs/guides/deploy/space.md",
            "docs/guides/install.html",
            "docs/guides/install.md",
            "docs/introduction.html",
            "docs/introduction.md",
            "index.html",
            "index.md",
            "llms.txt",
            "robots.txt",
            "sitemap.xml"
        ]
    );
    // The Interactivity API runtime and the router are files of the export, not WordPress's.
    for module in [
        "wp-includes/js/dist/script-modules/interactivity/index.min.js",
        "wp-includes/js/dist/script-modules/interactivity-router/index.min.js",
        "wp-content/plugins/typedpress-runtime/tp/Render/client/router.js",
    ] {
        assert!(files.iter().any(|f| f == module), "{module} in {files:?}");
    }
    let read = |f: &str| std::fs::read_to_string(dist.join(f)).unwrap();
    let sitemap = read("sitemap.xml");
    assert!(
        sitemap.contains("<loc>https://docs.example.test/docs/guides/install</loc>"),
        "{sitemap}"
    );
    assert!(!sitemap.contains("roadmap") && !sitemap.contains("404"), "{sitemap}");
    assert_eq!(
        read("robots.txt"),
        "User-agent: *\nAllow: /\n\nSitemap: https://docs.example.test/sitemap.xml\n"
    );
    let intro = read("docs/introduction.html");
    assert!(
        intro.contains(r#"<link rel="canonical" href="https://docs.example.test/docs/introduction">"#),
        "{intro}"
    );
    // Nothing points back at the WordPress that rendered it: no host, no feed, no REST link, in any
    // file (the export refuses to finish otherwise, so this checks every page and asset).
    for file in files
        .iter()
        .filter(|f| f.ends_with(".html") || f.ends_with(".md") || f.ends_with(".css"))
    {
        let text = read(file);
        assert!(!text.contains("localhost:") && !text.contains("127.0.0.1"), "{file}");
    }
    for page in ["index.html", "docs/introduction.html", "404.html"] {
        let html = read(page);
        assert!(!html.contains("/feed") && !html.contains("wp-json"), "{page}");
    }
    // Every script and module the 404 (the theme's own 404 template) loads is a file of the export:
    // its src attributes and the import map's paths, core's block view modules among them.
    let not_found = read("404.html");
    let urls: Vec<String> = regex::Regex::new(r#"(?:src="|":")(/[^"?]+\.js)"#)
        .unwrap()
        .captures_iter(&not_found)
        .map(|c| c[1].replace("\\/", "/"))
        .collect();
    assert!(urls.iter().any(|u| u.contains("/block-library/")), "{urls:?}");
    for url in &urls {
        assert!(
            files.iter().any(|f| format!("/{f}") == *url),
            "404.html loads {url}, missing from {files:?}"
        );
    }
    // JSON in a script element can never close it: `<` stays escaped as WordPress wrote it.
    for page in ["index.html", "docs/introduction.html"] {
        let html = read(page);
        for block in html.split("type=\"application/json\">").skip(1) {
            let json = block.split("</script>").next().unwrap();
            assert!(!json.contains('<'), "{page}: {json}");
        }
    }
    let mut server = Command::new("node")
        .arg(root().join("tests/differential/client/serve-static.mjs"))
        .arg(&dist)
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    std::io::BufRead::read_line(&mut std::io::BufReader::new(server.stdout.take().unwrap()), &mut line).unwrap();
    let url = serde_json::from_str::<serde_json::Value>(&line).unwrap()["url"]
        .as_str()
        .unwrap()
        .to_string();
    let seen = read_docs(&url);
    let _ = server.kill();
    let _ = server.wait();
    docs_read_as_published(&seen, &url, "https://docs.example.test", "");
    // Below a path, as a GitHub Pages project site serves it: every same-site URL starts with it.
    let base = work.path().join("base");
    let out = first()
        .args([
            "export".as_ref(),
            project.as_os_str(),
            "--base".as_ref(),
            "/docs-site".as_ref(),
            "--out".as_ref(),
            base.as_os_str(),
        ])
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let intro = std::fs::read_to_string(base.join("docs/introduction.html")).unwrap();
    assert!(intro.contains(r#"href="/docs-site/docs/guides""#), "{intro}");
    assert!(
        intro.contains(r#""@wordpress/interactivity":"/docs-site/wp-includes/"#),
        "{intro}"
    );
    assert!(!intro.contains(r#"href="/docs/"#), "a link without the base: {intro}");
    // A second export replaces the first (it carries the export marker).
    let again = first()
        .args([
            "export".as_ref(),
            project.as_os_str(),
            "--base".as_ref(),
            "/docs-site".as_ref(),
            "--out".as_ref(),
            base.as_os_str(),
        ])
        .output()
        .unwrap();
    assert!(again.status.success(), "{}", String::from_utf8_lossy(&again.stderr));
}

/// `typedpress export --site` (docs/decisions/2026-11-13-static-output.md): WordPress as the CMS somewhere
/// else. The hosted site (WordPress on SQLite, `tests/php/wp.php serve`) has a published and a draft
/// note; the export renders its published content with an editor's application password, and the
/// static page's client component calls the hosted site's public action across origins. The sign-in
/// link points at the hosted site. A site running another build of the app is refused.
#[test]
fn static_export_from_a_hosted_site() {
    assert!(
        root()
            .join("tests/differential/client/node_modules/playwright-core")
            .is_dir(),
        "run: npm ci --prefix tests/differential/client && npx --prefix tests/differential/client playwright-core install chromium-headless-shell"
    );
    let project = fixture("app-export-site", "site");
    build(&project);
    let mut cms = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("serve")
        .arg(project.join("tp/dist/wp-content"))
        .arg("chief=editor")
        .env("TP_WP_THEMES", "1")
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    std::io::BufRead::read_line(&mut std::io::BufReader::new(cms.stdout.take().unwrap()), &mut line).unwrap();
    let served: serde_json::Value = serde_json::from_str(&line).unwrap_or_else(|_| panic!("serve: {line}"));
    let site = served["url"].as_str().unwrap().to_string();
    let editor = served["users"]["chief"]["appPassword"].as_str().unwrap().to_string();
    let call = |method: &str, path: &str, body: serde_json::Value| {
        let out = Command::new("curl")
            .args([
                "-s",
                "-X",
                method,
                "-u",
                &editor,
                "-H",
                "content-type: application/json",
                "-d",
            ])
            .arg(body.to_string())
            .arg(format!("{site}/wp-json/typedpress/v1{path}"))
            .output()
            .unwrap();
        String::from_utf8_lossy(&out.stdout).into_owned()
    };
    call(
        "POST",
        "/notes",
        serde_json::json!({ "title": "Hello", "status": "published" }),
    );
    call(
        "POST",
        "/notes",
        serde_json::json!({ "title": "Secret", "status": "draft" }),
    );
    let export = |site_arg: &str| {
        first()
            .arg("export")
            .arg(&project)
            .args(["--site", site_arg])
            .env("TP_APP_PASSWORD", &editor)
            .output()
            .unwrap()
    };
    let out = export(&site);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let dist = project.join("tp/dist/static");
    assert!(dist.join("notes/hello.html").is_file());
    assert!(!dist.join("notes/secret.html").exists(), "the draft is never exported");
    let mut server = Command::new("node")
        .arg(root().join("tests/differential/client/serve-static.mjs"))
        .arg(&dist)
        .stdout(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let mut line = String::new();
    std::io::BufRead::read_line(&mut std::io::BufReader::new(server.stdout.take().unwrap()), &mut line).unwrap();
    let url = serde_json::from_str::<serde_json::Value>(&line).unwrap()["url"]
        .as_str()
        .unwrap()
        .to_string();
    let browsed = Command::new("node")
        .arg(root().join("tests/differential/client/export-site.mjs"))
        .arg(&url)
        .output()
        .unwrap();
    let _ = server.kill();
    let _ = server.wait();
    // The count is stored on the hosted site.
    let counted = call("GET", "/cheers", serde_json::json!({}));
    // A checkout that differs from what the site runs is refused before anything is written, even
    // when only markup changed (the schema is the same; the compiled page is not).
    let page = std::fs::read_to_string(project.join("tp/app/page.tsx")).unwrap();
    std::fs::write(
        project.join("tp/app/page.tsx"),
        page.replace("className=\"notes\"", "className=\"notes changed\""),
    )
    .unwrap();
    let stale = export(&site);
    let _ = Command::new("kill").arg(cms.id().to_string()).output();
    let _ = cms.wait();
    assert!(
        browsed.status.success(),
        "{}{}",
        String::from_utf8_lossy(&browsed.stdout),
        String::from_utf8_lossy(&browsed.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&browsed.stdout).unwrap();
    assert_eq!(seen["errors"], serde_json::json!([]), "{seen}");
    assert_eq!(seen["home"], serde_json::json!([["Hello", "/notes/hello"]]));
    assert_eq!(seen["signIn"], format!("{site}/wp-login.php"));
    assert_eq!(seen["note"], serde_json::json!(["/notes/hello", "Hello", "0 cheers"]));
    assert_eq!(seen["cheered"], "2 cheers");
    assert_eq!(
        seen["actions"],
        serde_json::json!([["POST", site, 200], ["POST", site, 200]])
    );
    assert!(counted.contains("\"count\":2"), "{counted}");
    assert_eq!(stale.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&stale.stderr).contains("runs another build of this app"),
        "{}",
        String::from_utf8_lossy(&stale.stderr)
    );
}

/// A static site has no server: an action call from a client component, a page that asks who the
/// visitor is, and a link to a page the export doesn't contain are each refused with the fix.
#[test]
fn static_export_refuses_what_needs_a_server() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path();
    let write = |path: &str, source: &str| {
        let path = project.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, source).unwrap();
    };
    write(
        "typedpress.config.ts",
        "import { defineConfig } from \"typedpress\";\nexport default defineConfig({ name: \"refused\", output: \"static\" });\n",
    );
    write(
        "tp/actions.ts",
        "import { mutation } from \"typedpress\";\nexport const ping = mutation({ access: \"anyone\" }, async () => { return 1; });\n",
    );
    write(
        "tp/components/Ping.tsx",
        "\"use client\";\nimport { useState } from \"typedpress/client\";\nimport { ping } from \"../actions\";\nexport function Ping() { const [n, setN] = useState(0); return <button type=\"button\" onClick={async () => setN(await ping({}))}>{n}</button>; }\n",
    );
    write(
        "tp/app/page.tsx",
        "import { Ping } from \"../components/Ping\";\nexport default function Home() { return <main><Ping /></main>; }\n",
    );
    let out = first().arg("export").arg(project).output().unwrap();
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "{stderr}");
    assert!(
        stderr.contains("/: the client component refused/Ping calls the action `ping`, and a static site has no server to run it. Export with --site <url> to call it on the hosted site, or remove the call"),
        "{stderr}"
    );
    assert!(
        !project.join("tp/dist/static").exists(),
        "a refused export writes nothing"
    );
    // A link to a page the export doesn't contain.
    write(
        "tp/app/page.tsx",
        "import { Link } from \"typedpress/app\";\nexport default function Home() { return <main><Link href=\"/elsewhere\">x</Link></main>; }\n",
    );
    let out = first().arg("export").arg(project).output().unwrap();
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "{stderr}");
    assert!(
        stderr.contains("/: it links to /elsewhere, which isn't in the export"),
        "{stderr}"
    );
    // A page that asks WordPress who the visitor is: refused at build, at the call.
    write(
        "tp/app/page.tsx",
        "import { is_user_logged_in } from \"php/wordpress\";\nexport default function Home() { return <main>{is_user_logged_in() ? \"you\" : \"guest\"}</main>; }\n",
    );
    let out = first().arg("export").arg(project).output().unwrap();
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "{stderr}");
    assert!(
        stderr.contains("`is_user_logged_in` asks who the visitor is"),
        "{stderr}"
    );
    // A page that redirects.
    write(
        "tp/app/page.tsx",
        "import { redirect } from \"typedpress/app\";\nexport default function Home() { redirect(\"/elsewhere\"); }\n",
    );
    let out = first().arg("export").arg(project).output().unwrap();
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "{stderr}");
    assert!(stderr.contains("/ (app//) redirects to"), "{stderr}");
    // --out never replaces the project, its sources, or a folder that isn't an export.
    for (out_dir, message) in [
        (project.to_path_buf(), "holds the project"),
        (project.join("tp"), "is inside the project"),
        (project.join("tp/dist"), "is where `typedpress build` writes"),
    ] {
        let out = first()
            .arg("export")
            .arg(project)
            .arg("--out")
            .arg(&out_dir)
            .output()
            .unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{stderr}");
        assert!(stderr.contains(message), "{message}: {stderr}");
    }
    let elsewhere = tempfile::tempdir().unwrap();
    std::fs::write(elsewhere.path().join("notes.txt"), "mine").unwrap();
    let out = first()
        .arg("export")
        .arg(project)
        .arg("--out")
        .arg(elsewhere.path())
        .output()
        .unwrap();
    assert!(String::from_utf8_lossy(&out.stderr).contains("already holds files that aren't an export"));
    assert_eq!(
        std::fs::read_to_string(elsewhere.path().join("notes.txt")).unwrap(),
        "mine"
    );
    assert!(project.join("typedpress.config.ts").is_file() && project.join("tp/app").is_dir());
    // `output: "server"` is told what export is for.
    write(
        "typedpress.config.ts",
        "import { defineConfig } from \"typedpress\";\nexport default defineConfig({ name: \"refused\" });\n",
    );
    let out = first().arg("export").arg(project).output().unwrap();
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("set `output: \"static\"` in typedpress.config.ts"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// WordPress renders the checked-in drive store over its native Woo products and orders.
#[test]
fn drive_store_example_sells_on_wordpress() {
    let work = tempfile::tempdir().unwrap();
    let project = work.path().join("drive-store");
    let source = root().join("examples/drive-store");
    std::fs::create_dir_all(project.join("tp")).unwrap();
    std::fs::copy(
        source.join("typedpress.config.ts"),
        project.join("typedpress.config.ts"),
    )
    .unwrap();
    for name in ["content", "public", "tp/app", "tp/lib", "tp/wp-hooks", "tp/_generated"] {
        copy(&source.join(name), &project.join(name));
    }
    for name in ["schema.ts", "server.ts"] {
        std::fs::copy(source.join("tp").join(name), project.join("tp").join(name)).unwrap();
    }
    build(&project);
    let init_dir = std::fs::read_dir(project.join("tp/_generated/migrations"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| p.is_dir())
        .expect("init migration folder");
    let ops: serde_json::Value = serde_json::from_slice(&std::fs::read(init_dir.join("ops.json")).unwrap()).unwrap();
    let tables: Vec<&str> = ops["ops"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|op| op["op"] == "createTable" && op["table"] != "tp__revisions")
        .filter_map(|op| op["table"].as_str())
        .collect();
    assert_eq!(tables, ["stock_movements"]);

    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/drive_store.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    println!("{}", String::from_utf8_lossy(&out.stdout));
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
}

/// examples/docs in Chromium as an anonymous visitor (tests/differential/client/docs.mjs).
fn read_docs(url: &str) -> serde_json::Value {
    let out = Command::new("node")
        .arg(root().join("tests/differential/client/docs.mjs"))
        .arg(url)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap()
}

/// What a visitor reads in examples/docs, wherever it is served: the same on WordPress and in its
/// static export.
/// `url` is where the browser read the site, `canonical` the address the pages name as their own,
/// `slash` what ends a page's address: `/` on WordPress (its permalink structure), nothing in the export.
fn docs_read_as_published(seen: &serde_json::Value, url: &str, canonical: &str, slash: &str) {
    assert_eq!(seen["errors"], serde_json::json!([]), "{seen}");
    // Home → the docs, by the reader's click; the doc has its title and the published tree.
    assert_eq!(seen["home"], "TypedPress docs");
    // The router region is processed as core processes a block theme's: core/router's state.url
    // comes from the server, follows a <Link> click that swapped the region in the same document,
    // and core's loading bar is in the footer with its styles.
    assert_eq!(seen["serverUrl"], format!("{canonical}/"), "{seen}");
    assert_eq!(
        seen["navigation"],
        serde_json::json!({
            "sameDocument": true,
            "url": format!("{url}/docs/introduction{slash}"),
            "loadingBar": [["core/router/private", "fixed"]]
        })
    );
    assert_eq!(
        seen["intro"],
        serde_json::json!({ "path": format!("/docs/introduction{slash}"), "title": "Introduction · TypedPress docs", "h1": "Introduction" })
    );
    assert_eq!(
        seen["tree"],
        serde_json::json!([["Introduction", "current", []], ["Guides", "", ["Install", "Deploy"]]])
    );
    // The table of contents links land on the doc's headings; a component block renders.
    assert_eq!(
        seen["toc"],
        serde_json::json!([
            ["What you get", "#what-you-get", true],
            ["How these docs work", "#how-these-docs-work", true]
        ])
    );
    assert_eq!(seen["badge"], "New");
    // Next, next: the pager walks the tree, and the open section follows the reader.
    assert_eq!(
        seen["install"],
        serde_json::json!({ "path": format!("/docs/guides/install{slash}"), "prev": "← Guides", "next": "Deploy →", "open": "Guides", "current": "Install" })
    );
    assert_eq!(seen["space"], serde_json::json!(["Guides", "Deploy", "To a Space"]));
    assert_eq!(
        seen["callout"],
        serde_json::json!(["callout callout-tip", "Before you start", "Node 22"])
    );
    // A code group's tabs switch with no script; the code is highlighted in light and dark.
    assert_eq!(seen["tabs"], serde_json::json!(["sh", "pnpm"]));
    assert_eq!(
        (&seen["tabsBefore"], &seen["tabsAfter"]),
        (&serde_json::json!([true, false]), &serde_json::json!([false, true]))
    );
    assert_eq!(seen["title"], "pnpm");
    assert_eq!(
        seen["marked"],
        serde_json::json!(["export default defineConfig({ name: \"docs\" });"])
    );
    assert_ne!(
        seen["light"], seen["dark"],
        "the keyword colour follows the colour scheme"
    );
    // The only scripts are the router's (the layout's links); code and components need none. The
    // draft's 404 is the theme's own 404 template (the app has no not-found.tsx; docs/pages.md
    // "Block templates"), whose blocks load core's own view scripts there, as on any theme page.
    for script in seen["scripts"].as_array().unwrap() {
        let script = script.as_str().unwrap();
        assert!(
            script.contains("interactivity")
                || script.contains("router.js")
                || script.contains("a11y")
                || script.ends_with("/block-editor/utils/fit-text-frontend.min.js")
                || script.starts_with("/wp-includes/js/dist/script-modules/block-library/"),
            "{script}"
        );
    }
    // The draft is a 404 and in no tree; the Markdown page is a page.
    assert_eq!(seen["draft"], 404);
    assert_eq!(seen["draftInTree"], false);
    assert_eq!(
        seen["about"],
        serde_json::json!(["About · TypedPress docs", "TypedPress"])
    );
    // Every page's Markdown twin; none for the draft, and it isn't listed.
    assert_eq!(seen["twins"]["install"][0], 200);
    assert!(
        seen["twins"]["install"][2]
            .as_str()
            .unwrap()
            .contains("You need **Node 22** and a WordPress site.")
    );
    assert_eq!(seen["twins"]["about"][0], 200);
    assert_eq!(seen["twins"]["draft"][0], 404);
    let llms = seen["llms"].as_str().unwrap();
    assert!(llms.contains("/about.md") && !llms.contains("Roadmap"), "{llms}");
}

/// Issue #311: every read a `tp/app/` page can make runs as the visitor, on WordPress over
/// HTTP. A collection whose read rule shows drafts to staff only, read through each path a page
/// has (tests/php/page_reads.php): a page's and a layout's `db.query`, the `"typedpress:db"` kind API,
/// the Markdown twin, a `route.ts` handler, and the two kinds of read in an action a `"use client"`
/// component calls. A signed-out visitor never sees the draft; an editor does. An editor's render
/// is never shared, so the anonymous page after it is still the anonymous one.
#[test]
fn page_reads_run_as_the_visitor() {
    let project = fixture("page-reads", "serve");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/page_reads.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let public = serde_json::json!(["Public one"]);
    let both = serde_json::json!(["Public one", "Secret draft"]);
    for surface in ["page", "kind api", "route"] {
        assert_eq!(seen["anonymous"][surface], public, "{surface}: {seen}");
        assert_eq!(seen["editor"][surface], both, "{surface}: {seen}");
    }
    assert_eq!(
        (&seen["anonymous"]["layout"], &seen["editor"]["layout"]),
        (&serde_json::json!(1), &serde_json::json!(2))
    );
    // The twin renders as an anonymous visitor for everyone (rendering.md §5).
    assert_eq!(
        (&seen["anonymous"]["twin"], &seen["editor"]["twin"]),
        (&public, &public)
    );
    // An action reached from a client component: the kind API reads as its caller, `db` is trusted.
    assert_eq!(
        seen["anonymous"]["action kind api"],
        serde_json::json!([200, ["Public one"]])
    );
    assert_eq!(
        seen["editor"]["action kind api"],
        serde_json::json!([200, ["Public one", "Secret draft"]])
    );
    assert_eq!(
        seen["anonymous"]["action db"],
        serde_json::json!([200, ["Public one", "Secret draft"]])
    );
    // Only the anonymous render is shared; an editor's is private, and doesn't replace it.
    assert_eq!(
        seen["anonymous"]["page cache"],
        "public, max-age=0, s-maxage=300, must-revalidate"
    );
    assert_eq!(seen["editor"]["page cache"], "private, no-store, max-age=0");
    assert_eq!(seen["anonymous after editor"], public);
}

/// docs/spec/rendering.md §7, "Kept from today": each static `page.tsx` route has a hidden,
/// code-owned WordPress Page (tests/php/route_pages.php). WordPress, menus and SEO plugins see a
/// normal Page whose link is the route URL; wp-admin, its counts and REST edit lists don't list it;
/// nobody may edit or delete it; WordPress's own addresses for it redirect to the route.
#[test]
fn static_routes_have_code_owned_pages() {
    let project = fixture("app-router", "route-pages");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/route_pages.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    let seen: serde_json::Value = serde_json::from_str(
        stdout
            .lines()
            .skip_while(|l| !l.starts_with('{'))
            .collect::<Vec<_>>()
            .join("\n")
            .as_str(),
    )
    .unwrap_or_else(|_| panic!("{stdout}"));
    let url = |path: &str| -> String {
        let link = seen["pages"]["/"]["link"].as_str().unwrap();
        format!("{}{path}", link.trim_end_matches('/'))
    };
    // One Page per static page.tsx route: `page.md` routes own their own, parameterised routes none.
    let routes: Vec<&String> = seen["pages"].as_object().unwrap().keys().collect();
    assert_eq!(routes, ["(site)/about", "/", "account", "broken", "notes"], "{seen}");
    // Each Page's permalink is its route's one address (`/about/`).
    for (route, path) in [("(site)/about", "/about/"), ("/", "/"), ("notes", "/notes/")] {
        let page = &seen["pages"][route];
        assert_eq!(
            (page["status"].as_str(), page["link"].as_str(), page["meta"].as_str()),
            (Some("publish"), Some(url(path).as_str()), Some(route)),
            "{route}"
        );
    }
    // A route under a guard stores its Page private; the root is the front page.
    assert_eq!(seen["pages"]["account"]["status"], "private");
    assert_eq!(seen["pages"]["/"]["title"], "Home");
    assert_eq!(seen["front"], serde_json::json!(["page", true]));
    assert_eq!(seen["canonical"], url("/notes/"));
    // Hidden from wp-admin, its counts and REST edit lists; a public REST list has them like any page.
    for title in ["Home", "Notes", "About", "Account", "Broken"] {
        assert!(
            !seen["admin list"].as_array().unwrap().iter().any(|t| t == title),
            "{title}: {seen}"
        );
        assert!(
            !seen["rest edit"].as_array().unwrap().iter().any(|t| t == title),
            "{title}: {seen}"
        );
    }
    assert!(
        seen["rest view"].as_array().unwrap().iter().any(|t| t == "About"),
        "{seen}"
    );
    assert_eq!(
        seen["admin count publish"], 4,
        "Native, Colophon, Field guide, Sample Page"
    );
    // Locked: no edit or delete, and a write that skips capability checks changes nothing.
    assert_eq!(seen["can edit"], serde_json::json!([false, false, true]));
    assert_eq!(seen["after bypass"], serde_json::json!(["Notes", "publish"]));
    // Menus link the route; a lost record finds the same Pages again, so menu items keep working.
    assert_eq!(seen["menu"], serde_json::json!([url("/about/")]));
    assert_eq!(seen["adopted"], true);
    // WordPress's own addresses for a code Page go to the route; a site's own Page is untouched.
    assert_eq!(seen["page_id redirect"], serde_json::json!([301, url("/about/")]));
    assert_eq!(seen["slug redirect"], serde_json::json!([301, url("/")]));
    assert_eq!(
        (&seen["about"], &seen["native"]),
        (&serde_json::json!(200), &serde_json::json!(200))
    );
    // The route renders with its Page as the queried object, as the page template would have it.
    assert_eq!(
        (&seen["body class"], &seen["home body class"]),
        (&serde_json::json!(true), &serde_json::json!(true))
    );
    // The sitemap lists the route once, from the app's pages; core's page sitemap leaves code Pages out.
    assert_eq!(
        (&seen["sitemap pages"], &seen["sitemap app"]),
        (&serde_json::json!(4), &serde_json::json!(3))
    );
}

/// An explicit route id (`export const route = { id }` on a page.tsx, `id:` in a page.md's front
/// matter) keeps the page's WordPress Page when its file moves to another URL: the second build
/// moves both files under `company/`, and both Pages keep their IDs with the new URL as their link,
/// while the old URLs redirect there. Without an id the route id is the folder path.
#[test]
fn route_ids_keep_pages_when_files_move() {
    let first = fixture("route-ids", "first");
    build(&first);
    let second = fixture("route-ids", "second");
    let app = second.join("tp/app");
    std::fs::create_dir_all(app.join("company")).unwrap();
    for page in ["about", "colophon"] {
        std::fs::rename(app.join(page), app.join("company").join(page)).unwrap();
    }
    build(&second);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/route_ids.php"))
        .arg(first.join("tp/dist/wp-content"))
        .arg(second.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&first);
    let _ = std::fs::remove_dir_all(&second);
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "{stdout}{}", String::from_utf8_lossy(&out.stderr));
    let json: String = stdout
        .lines()
        .skip_while(|l| !l.starts_with('{'))
        .collect::<Vec<_>>()
        .join("\n");
    let seen: serde_json::Value = serde_json::from_str(&json).unwrap_or_else(|_| panic!("{stdout}"));
    assert_eq!(seen["first served"], serde_json::json!([200, 200]));
    assert_eq!(
        seen["second served"],
        serde_json::json!([200, 200, 301, 301]),
        "the old URLs redirect"
    );
    for (title, before, after) in [
        ("About", "/about/", "/company/about/"),
        ("Colophon", "/colophon/", "/company/colophon/"),
    ] {
        assert_eq!(seen["first"][title]["link"], before, "{title}: {seen}");
        assert_eq!(
            seen["second"][title]["id"], seen["first"][title]["id"],
            "{title} keeps its Page"
        );
        assert_eq!(seen["second"][title]["link"], after, "{title}: {seen}");
        assert_eq!(seen["second"][title]["status"], "publish");
    }
    let titles: Vec<&String> = seen["second"].as_object().unwrap().keys().collect();
    assert_eq!(titles, ["About", "Colophon", "Home"], "one Page each, none duplicated");
}

/// A route id is a literal, and two pages can't share one; the error is at the export.
#[test]
fn refuses_route_ids_it_cannot_keep() {
    let dir = std::env::temp_dir().join(format!("typedpress-route-ids-{}", std::process::id()));
    let page =
        |id: &str| format!("export const route = {{ id: {id} }};\nexport default function P() {{ return <p/>; }}\n");
    rejects(
        &dir,
        &[
            ("tp/app/a/page.tsx", &page("\"site.page\"")),
            ("tp/app/b/page.tsx", &page("\"site.page\"")),
        ],
        "route id `site.page` is already app/a/page.tsx's",
        "tp/app/b/page.tsx:1:14",
    );
    rejects(
        &dir,
        &[("tp/app/a/page.tsx", &page("\"site page\""))],
        "`route` must be `{ id: \"…\" }` with a literal id",
        "tp/app/a/page.tsx:1:14",
    );
    rejects(
        &dir,
        &[
            ("tp/app/a/page.tsx", &page("\"site.page\"")),
            ("tp/app/b/page.md", "---\nid: site.page\ntitle: B\n---\n\nText.\n"),
        ],
        "id `site.page` is already app/a/page.tsx's",
        "tp/app/b/page.md:2:",
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// `tp/app/login.tsx` is wp-login.php's sign-in view (docs/decisions/2026-11-15-one-sign-in-page.md):
/// accepted at the root only, typed with `LoginProps`, compiled into the route table as `login` with
/// the root layout and its stylesheets, and `<LoginForm>` checks its props.
#[test]
fn login_tsx_is_the_sign_in_page() {
    let project = fixture("login-page", "compile");
    build(&project);
    let schema =
        std::fs::read_to_string(project.join("tp/dist/wp-content/plugins/typedpress-app-loginpage/tp/app/schema.php"))
            .unwrap();
    let login = schema
        .lines()
        .find(|l| l.trim_start().starts_with("'login' =>"))
        .unwrap_or_else(|| panic!("no login route in schema.php:\n{schema}"));
    assert!(login.contains("'page' => 'app/login.tsx'"), "{login}");
    assert!(login.contains("'layouts' => ['app/layout.tsx']"), "{login}");
    assert!(login.contains("'styles' => ['site-"), "{login}");
    let functions = std::fs::read_to_string(
        project.join("tp/dist/wp-content/plugins/typedpress-app-loginpage/tp/app/functions.php"),
    )
    .unwrap();
    let form_args = functions
        .split_once("\\TypedPress\\Render\\LoginView::form(")
        .and_then(|(_, call)| call.split_once(')'))
        .map(|(args, _)| args.trim());
    assert_eq!(form_args, Some("'signin-form', 'Sign in', false, null"), "{functions}");
    // login.tsx is not a URL of its own: no route, no Page, nothing in routes.d.ts.
    assert!(!schema.contains("'pattern' => '/login'"), "{schema}");
    let _ = std::fs::remove_dir_all(&project);

    let dir = std::env::temp_dir().join(format!("tp-login-reject-{}", std::process::id()));
    let page = "export default function P() { return <p/>; }\n";
    rejects(
        &dir,
        &[("tp/app/page.tsx", page), ("tp/app/account/login.tsx", page)],
        "login.tsx works only at the root of tp/app/",
        "tp/app/account/login.tsx",
    );
    rejects(
        &dir,
        &[(
            "tp/app/login.tsx",
            "export const guard = \"admin\";\nexport default function P() { return <p/>; }\n",
        )],
        "app/login.tsx can't export `guard`",
        "tp/app/login.tsx",
    );
    rejects(
        &dir,
        &[(
            "tp/app/login.tsx",
            "import { LoginForm } from \"typedpress/app\";\nexport default function P() { return <LoginForm action=\"/x\" />; }\n",
        )],
        "`<LoginForm>` has no prop `action`",
        "tp/app/login.tsx",
    );
    rejects(
        &dir,
        &[(
            "tp/app/login.tsx",
            "import { LoginForm } from \"typedpress/app\";\nexport default function P() { return <LoginForm links={1} />; }\n",
        )],
        "`<LoginForm links>` takes",
        "tp/app/login.tsx",
    );
    let _ = std::fs::remove_dir_all(&dir);
}

/// wp-login.php renders `login.tsx` and still runs WordPress's sign-in; an account with Identity MFA
/// signs in through Two Factor's second step there; `/identity` sends a browser to wp-login.php and
/// treats its WordPress sign-in as signed in (tests/php/login_page.php).
#[test]
fn one_sign_in_page_on_wordpress() {
    let project = fixture("login-page", "serve");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/login_page.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value =
        serde_json::from_slice(&out.stdout).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out.stdout)));
    let generic = "Error: Invalid username, email address or incorrect password.";
    // (a) The app's page, in its root layout and stylesheet, posting to wp-login.php; never cached or indexed.
    let get = &seen["get"];
    assert_eq!(get["status"], 200, "{seen}");
    assert_eq!(get["app"], "Sign in to Field Notes", "{seen}");
    assert_eq!(get["title"], "Sign in · Field Notes", "{seen}");
    assert_eq!(get["wordpress"], false, "{seen}");
    assert!(get["action"].as_str().unwrap().ends_with("/wp-login.php"), "{seen}");
    assert_eq!(
        get["inputs"].as_object().unwrap().keys().collect::<Vec<_>>(),
        ["log", "pwd", "probe", "rememberme", "redirect_to", "testcookie"],
        "{seen}"
    );
    assert_eq!(
        (&get["stylesheet"], &get["robots"]),
        (&json(true), &json(true)),
        "{seen}"
    );
    assert_eq!(get["cache"], "private, no-store, max-age=0", "{seen}");
    // A failed attempt: WordPress's answer (the loginErrors hardening's one message), the login kept
    // after a wrong password, and the same answer for an unknown user.
    assert_eq!(seen["wrong password"]["errors"], json([generic]), "{seen}");
    assert_eq!(seen["wrong password"]["inputs"]["log"], "ana", "{seen}");
    assert!(
        seen["wrong password"]["inputs"]["redirect_to"]
            .as_str()
            .unwrap()
            .ends_with("/account/"),
        "{seen}"
    );
    assert_eq!(seen["unknown user"]["errors"], json([generic]), "{seen}");
    // The right password signs in where it was going.
    assert_eq!(seen["sign in"]["status"], 302, "{seen}");
    assert!(
        seen["sign in"]["location"].as_str().unwrap().ends_with("/account/"),
        "{seen}"
    );
    assert_eq!(seen["sign in"]["signed in"], true, "{seen}");
    assert_eq!(seen["account after sign in"], 200, "{seen}");
    // wp-login.php's own messages reach the page; other actions keep WordPress's screens.
    assert_eq!(seen["logout"]["signed in"], false, "{seen}");
    assert_eq!(seen["loggedout"]["app"], "Sign in to Field Notes", "{seen}");
    assert_eq!(
        seen["loggedout"]["notices"],
        json(["Members only", "You are now logged out."]),
        "{seen}"
    );
    assert!(
        seen["checkemail"]["notices"][1]
            .as_str()
            .unwrap()
            .starts_with("If there is an account"),
        "{seen}"
    );
    assert_eq!(seen["lost password"]["wordpress"], true, "{seen}");
    let elsewhere = &seen["form elsewhere"];
    assert!(
        elsewhere["action"].as_str().unwrap().ends_with("/wp-login.php"),
        "{seen}"
    );
    assert!(
        elsewhere["redirect_to"].as_str().unwrap().ends_with("/?from=home"),
        "{seen}"
    );
    // What plugins add to the form (here a nonce) is per request: that page is never shared. Its
    // form carries no `testcookie`, which only wp-login.php's own page may ask for, so a first-time
    // visitor signs in from it on the first try.
    assert_eq!(elsewhere["cache"], "private, no-store, max-age=0", "{seen}");
    assert_eq!(elsewhere["probe field"], true, "{seen}");
    assert_eq!(elsewhere["testcookie field"], false, "{seen}");
    assert_eq!(seen["get"]["testcookie field"], true, "{seen}");
    assert_eq!(seen["form elsewhere sign in"]["signed in"], true, "{seen}");
    assert!(
        seen["form elsewhere sign in"]["location"]
            .as_str()
            .unwrap()
            .ends_with("/?from=home"),
        "{seen}"
    );
    // Captcha-style plugins work on the app's sign-in page: their field, head and foot scripts, and
    // their `login_message` notice, which the page receives with WordPress's own messages.
    assert_eq!(
        seen["get"]["probes"],
        serde_json::json!({ "field": true, "head": true, "foot": true, "notice": true }),
        "{seen}"
    );
    assert_eq!(
        seen["guard"],
        serde_json::json!({ "status": 302, "to login": true }),
        "{seen}"
    );
    // The bare spelling of a guarded page sends a signed-out visitor to sign in, not to the page's
    // address first.
    assert_eq!(
        seen["guard bare"],
        serde_json::json!({ "status": 302, "to login": true }),
        "{seen}"
    );

    // (b) Identity MFA through Two Factor: the password leads to the second step, never a cookie.
    let step = &seen["mfa password step"];
    assert_eq!(
        (&step["second step"], &step["signed in"]),
        (&json(true), &json(false)),
        "{seen}"
    );
    assert_eq!(step["provider"], "TypedPress_Identity_TwoFactorProvider", "{seen}");
    assert_eq!(
        seen["mfa wrong code"],
        serde_json::json!({ "status": 200, "signed in": false, "asks again": true }),
        "{seen}"
    );
    assert_eq!(seen["mfa recovery code"]["status"], 302, "{seen}");
    assert!(
        seen["mfa recovery code"]["location"]
            .as_str()
            .unwrap()
            .ends_with("/account/"),
        "{seen}"
    );
    assert_eq!(seen["mfa recovery code"]["signed in"], true, "{seen}");
    assert_eq!(seen["mfa recovery code reused"]["signed in"], false, "{seen}");
    assert_eq!(
        seen["mfa identity"], 200,
        "a sign-in that passed Identity's factor opens /identity: {seen}"
    );
    assert_eq!(seen["mfa elsewhere"], "identity_mfa_required", "{seen}");
    assert_eq!(seen["mfa wrong password"]["second step"], false, "{seen}");
    assert_eq!(seen["mfa wrong password"]["errors"], json([generic]), "{seen}");

    // (c) /identity signs in on wp-login.php, and a WordPress sign-in is an identity sign-in.
    assert_eq!(seen["identity signed out"]["status"], 302, "{seen}");
    assert!(
        seen["identity signed out"]["location"]
            .as_str()
            .unwrap()
            .contains("/wp-login.php?redirect_to="),
        "{seen}"
    );
    assert_eq!(
        seen["identity methods"],
        serde_json::json!({ "status": 200, "app": true }),
        "{seen}"
    );
    assert_eq!(seen["authorize signed out"]["status"], 302, "{seen}");
    assert!(
        seen["authorize signed out"]["location"]
            .as_str()
            .unwrap()
            .contains("/wp-login.php?redirect_to="),
        "{seen}"
    );
    let page = &seen["authorize login page"];
    assert_eq!(page["app"], "Sign in to Field Notes", "{seen}");
    assert!(
        page["inputs"]["redirect_to"]
            .as_str()
            .unwrap()
            .contains("/identity/authorize?"),
        "{seen}"
    );
    assert!(
        page["methods link"].as_str().is_some(),
        "Identity's other ways in are offered: {seen}"
    );
    assert_eq!(
        seen["get"]["methods link"],
        json(serde_json::Value::Null),
        "only on a sign-in for Identity: {seen}"
    );
    assert!(
        seen["authorize sign in"]["location"]
            .as_str()
            .unwrap()
            .contains("/identity/authorize?"),
        "{seen}"
    );
    assert_eq!(
        seen["consent"],
        serde_json::json!({ "status": 200, "csrf": true, "identity cookie": true }),
        "{seen}"
    );
    assert_eq!(
        seen["approved"],
        serde_json::json!({ "status": 302, "callback": true, "state": true }),
        "{seen}"
    );
    assert_eq!(seen["token"]["status"], 200, "{seen}");
    assert_eq!(seen["token"]["sub"], seen["token"]["ana"], "{seen}");
    assert_eq!(
        seen["identity signed in"],
        serde_json::json!({ "status": 200, "app": true }),
        "{seen}"
    );
    assert_eq!(seen["identity rest"]["status"], 200, "{seen}");
    assert_eq!(
        seen["identity rest"]["id"].as_str().unwrap(),
        seen["token"]["ana"].as_str().unwrap(),
        "{seen}"
    );
    let fresh = seen["prompt login"]["location"].as_str().unwrap();
    assert!(fresh.contains("/wp-login.php?") && fresh.contains("reauth=1"), "{seen}");
    assert_eq!(seen["prompt login"]["identity cookie"], false, "{seen}");
    assert_eq!(
        seen["identity sign-out"],
        serde_json::json!({ "status": 200, "wordpress signed in": false, "identity cookie": false }),
        "{seen}"
    );
    assert_eq!(
        seen["after sign-out"],
        serde_json::json!({ "status": 302, "to login": true }),
        "{seen}"
    );

    // H1: an account with Identity MFA is asked for Identity's factor only, and a WordPress session
    // that didn't pass it (another Two Factor method, wp_set_auth_cookie alone) is no identity session.
    assert_eq!(
        seen["mfa methods"],
        serde_json::json!({ "provider": "TypedPress_Identity_TwoFactorProvider", "emailed": false }),
        "{seen}"
    );
    assert_eq!(
        seen["bridge"],
        serde_json::json!({
            "other method": 401, "other method page": true, "cookie only": 401,
            "identity factor": 200, "no factor, no password": true
        }),
        "{seen}"
    );
    // H2 and L3: one identity session per WordPress session, linked to it; ending the WordPress session
    // ends the identity session and the application's tokens, and revoking the identity session ends
    // the WordPress session.
    assert_eq!(
        seen["reuse"],
        serde_json::json!({ "rows": 1, "same": true, "linked": true }),
        "{seen}"
    );
    assert_eq!(
        seen["h2 tokens"],
        serde_json::json!({ "access": true, "refresh": true }),
        "{seen}"
    );
    assert_eq!(
        seen["destroy others"],
        serde_json::json!({ "identity rest": 401, "userinfo": 401, "refresh": 400, "session revoked": true }),
        "{seen}"
    );
    assert_eq!(
        seen["revoke identity"],
        serde_json::json!({ "wordpress session": false, "page": true }),
        "{seen}"
    );
    // M5: an identity cookie for another user (a planted guest session) gives way to the WordPress sign-in.
    assert_eq!(seen["mismatch"]["page"], 200, "{seen}");
    assert_eq!(seen["mismatch"]["account"], seen["mismatch"]["wu"], "{seen}");
    // M3: a bare logout link asks; a forged confirmation is refused; a confirmed one ends both sessions.
    assert_eq!(
        seen["logout link"],
        serde_json::json!({ "status": 200, "asks": true, "still signed in": true }),
        "{seen}"
    );
    assert_eq!(
        seen["logout forged"],
        serde_json::json!({ "status": 403, "still signed in": true }),
        "{seen}"
    );
    assert_eq!(
        seen["logout confirmed"],
        serde_json::json!({ "status": 303, "wordpress session": false, "identity revoked": true }),
        "{seen}"
    );
    // N1: an expired hint on a GET (an image on another site) only asks; a current hint naming the
    // browser's user signs out at once.
    assert_eq!(
        seen["expired hint"],
        serde_json::json!({ "status": 200, "asks": true, "wordpress session": true, "identity revoked": false }),
        "{seen}"
    );
    assert_eq!(
        seen["named hint"],
        serde_json::json!({ "status": 303, "wordpress session": false }),
        "{seen}"
    );
    // N2: refresh needs the WordPress session alive, not the identity cookie's 24 hours.
    assert_eq!(
        seen["refresh after 24h"],
        serde_json::json!({ "refresh": 200, "expired secret": true, "browser": 200, "new cookie": true }),
        "{seen}"
    );
    // N3: a second first request rotates the secret, and the earlier cookie keeps working.
    assert_eq!(
        seen["parallel first requests"],
        serde_json::json!({ "rotated": true, "earlier cookie": 200, "later cookie": 200 }),
        "{seen}"
    );
    // M5 on REST: a planted guest cookie gives way to the WordPress sign-in there too.
    assert_eq!(seen["rest mismatch"]["account"], seen["rest mismatch"]["wu"], "{seen}");
    // N4: turning MFA on ends the other WordPress sessions and keeps this browser's.
    assert_eq!(
        seen["mfa enable"],
        serde_json::json!({ "status": 200, "this browser": true, "other session": false, "still signed in": 200 }),
        "{seen}"
    );
    // N1 without cookies: an expired hint ends nothing; a current one ends only the identity session,
    // never the WordPress sign-in it came from.
    assert_eq!(
        seen["cookieless expired hint"],
        serde_json::json!({ "status": 303, "wordpress session": true, "identity revoked": false }),
        "{seen}"
    );
    assert_eq!(
        seen["cookieless current hint"],
        serde_json::json!({ "status": 303, "wordpress session": true, "identity revoked": true }),
        "{seen}"
    );
    // REST opens an identity session from the WordPress cookie for the site's own pages only: an
    // application origin, or a request that says nothing of where it comes from, needs zi_session.
    assert_eq!(
        seen["rest from an app origin"],
        serde_json::json!({ "status": 401, "csrf": false, "identity cookie": false }),
        "{seen}"
    );
    assert_eq!(seen["rest without fetch metadata"], 401, "{seen}");
    assert_eq!(
        seen["rest from the site"],
        serde_json::json!({ "status": 200, "identity cookie": true }),
        "{seen}"
    );
    // Before identity storage reaches schema 4 (a managed build before initialize), a WordPress user
    // gets a 503 with Retry-After, not a round trip through wp-login.php; a signed-out one still signs in.
    assert_eq!(
        seen["before schema 4"],
        serde_json::json!({ "status": 503, "retry after": "30", "to login": false, "authorize": 503, "identity cookie": false, "signed out still to login": true }),
        "{seen}"
    );
}

/// L1: on a site below `/blog`, `/identity` sends a signed-out browser to wp-login.php and back to
/// the page it was on, with the subdirectory in its URL once.
#[test]
fn one_sign_in_page_under_a_subdirectory() {
    let project = fixture("login-page", "subdir");
    // login.tsx redirects when asked (`redirect_to` naming `/go-account`), to check where its own
    // `redirect()` goes.
    let login = project.join("tp/app/login.tsx");
    let source = std::fs::read_to_string(&login).unwrap();
    std::fs::write(
        &login,
        source
            .replace(
                "import { LoginForm, type LoginProps } from \"typedpress/app\";",
                "import { LoginForm, redirect, type LoginProps } from \"typedpress/app\";",
            )
            .replace(
                "export default function Login({ errors, messages, registerUrl }: LoginProps) {",
                "export default function Login({ errors, messages, registerUrl, redirectTo }: LoginProps) {\n  if (redirectTo.includes(\"go-account\")) redirect(\"/account\");",
            ),
    )
    .unwrap();
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/login_page.php"))
        .arg(project.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .env("LOGIN_PAGE_BASE", "/blog")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value =
        serde_json::from_slice(&out.stdout).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out.stdout)));
    let sub = &seen["subdirectory"];
    let url = sub["url"].as_str().unwrap();
    assert_eq!(sub["status"], 302, "{seen}");
    assert_eq!(sub["login"], format!("{url}/wp-login.php"), "{seen}");
    assert_eq!(sub["back"], format!("{url}/identity/account?tab=1"), "{seen}");
    // An app page's guard: back to the page's one address, the subdirectory once, at either spelling.
    for key in ["guard", "guard slash"] {
        assert_eq!(
            seen[key],
            serde_json::json!({ "status": 302, "back": format!("{url}/account/?tab=1") }),
            "{key}: {seen}"
        );
    }
    assert_eq!(seen["login redirect"], format!("{url}/account/"), "{seen}");
}

fn json<T: serde::Serialize>(v: T) -> serde_json::Value {
    serde_json::to_value(v).unwrap()
}

/// `tp/app/` pages inside the active block theme's templates (docs/pages.md "Block templates",
/// tests/php/block_templates.php): the theme's header and footer wrap each page, a layout that
/// places `<TemplatePart>` or a page that picks `"blank"` draws its own, the templates are listed
/// in the Site Editor, and the 404 and sign-in pages are templates the owner edits.
#[test]
fn pages_render_in_block_templates() {
    let project = fixture("block-templates", "serve");
    build(&project);
    // The same app without login.tsx, installed over the first after the owner saved a sign-in
    // template that only holds the Page content block.
    let without_login = fixture("block-templates", "no-login");
    copy(
        &project.join("tp/_generated/migrations"),
        &without_login.join("tp/_generated/migrations"),
    );
    std::fs::remove_file(without_login.join("tp/app/login.tsx")).unwrap();
    build(&without_login);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/block_templates.php"))
        .arg(project.join("tp/dist/wp-content"))
        .arg(without_login.join("tp/dist/wp-content"))
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&project);
    let _ = std::fs::remove_dir_all(&without_login);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value =
        serde_json::from_slice(&out.stdout).unwrap_or_else(|_| panic!("{}", String::from_utf8_lossy(&out.stdout)));
    assert_eq!(seen["block theme"], true, "{seen}");
    assert_eq!(
        seen["compiled templates"],
        serde_json::json!({ "app/bare/page.tsx": "blank", "app/studio/layout.tsx": "blank", "app/layout.tsx": null }),
    );
    // The default: the theme's header and footer parts around the page, one wp-site-blocks, the
    // router region inside it, the root layout's chrome not doubled, WordPress's title and styles.
    let home = &seen["home"];
    for (key, want) in [
        ("status", json(200)),
        ("title", json("Home · Field Notes")),
        ("titles", json(1)),
        ("description", json("Notes.")),
        ("canonicals", json(1)),
        ("theme header", json(1)),
        ("theme footer", json(1)),
        ("site blocks", json(1)),
        ("region in template", json(1)),
        ("page", json("Home")),
        ("root layout", json(0)),
        ("global styles", json(true)),
        ("router module", json(true)),
        ("cache", json("public, max-age=0, s-maxage=300, must-revalidate")),
    ] {
        assert_eq!(home[key], want, "home {key}: {seen}");
    }
    assert_eq!(seen["home list"], true, "{seen}");
    assert_eq!(
        seen["home query"],
        serde_json::json!({
            "fields": "all",
            "cache_results": true,
            "update_post_term_cache": true,
            "update_post_meta_cache": true
        })
    );
    assert_eq!(
        (&seen["notes"]["title"], &seen["notes"]["theme header"]),
        (&json("Notes · Field Notes"), &json(1)),
        "{seen}"
    );
    // A layout that places the theme's header itself: blank template, its own footer, the root layout's chrome.
    let studio = &seen["studio"];
    assert_eq!(
        (
            &studio["theme header"],
            &studio["theme footer"],
            &studio["own footer"],
            &studio["root layout"],
            &studio["region in template"]
        ),
        (&json(1), &json(0), &json(true), &json(1), &json(1)),
        "{seen}"
    );
    // `template = "blank"`: no theme parts; the root layout draws the page.
    let bare = &seen["bare"];
    assert_eq!(
        (
            &bare["theme header"],
            &bare["theme footer"],
            &bare["root layout"],
            &bare["page"]
        ),
        (&json(0), &json(0), &json(1), &json("Bare")),
        "{seen}"
    );
    // A guard still sends a signed-out visitor to sign in.
    assert_eq!(seen["guard"]["status"], 302, "{seen}");
    assert!(
        seen["guard"]["location"]
            .as_str()
            .unwrap_or_default()
            .contains("/wp-login.php?redirect_to="),
        "{seen}"
    );
    // not-found.tsx in the theme's 404 template.
    let missing = &seen["404"];
    assert_eq!(
        (
            &missing["status"],
            &missing["title"],
            &missing["page"],
            &missing["theme header"],
            &missing["theme footer"]
        ),
        (
            &json(404),
            &json("Not found · Field Notes"),
            &json("No such page"),
            &json(1),
            &json(1)
        ),
        "{seen}"
    );
    // The Site Editor lists TypedPress's templates and the theme's 404, each holding the page block.
    assert_eq!(
        seen["templates"],
        serde_json::json!({
            "404": { "source": "theme", "page block": true },
            "tp-page": { "source": "plugin", "page block": true },
            "tp-blank": { "source": "plugin", "page block": true },
            "tp-login": { "source": "plugin", "page block": true },
        }),
        "{seen}"
    );
    // wp-login.php renders login.tsx inside the sign-in template, posting to wp-login.php.
    let login = &seen["login"];
    assert_eq!(
        (
            &login["status"],
            &login["app"],
            &login["wordpress page"],
            &login["theme header"],
            &login["title"]
        ),
        (
            &json(200),
            &json(true),
            &json(false),
            &json(1),
            &json("Sign in · Field Notes")
        ),
        "{seen}"
    );
    assert!(
        login["posts to"]
            .as_str()
            .unwrap_or_default()
            .ends_with("/wp-login.php"),
        "{seen}"
    );
    assert_eq!(
        (
            &seen["login wrong password"]["error"],
            &seen["login wrong password"]["theme header"]
        ),
        (&json(true), &json(1)),
        "{seen}"
    );
    // Saving the template through REST (as the Site Editor does) changes what wp-login.php shows.
    assert_eq!(seen["login saved"], 200, "{seen}");
    let edited = &seen["login edited"];
    assert_eq!(
        (&edited["owner text"], &edited["app"], &edited["theme header"]),
        (&json(true), &json(true), &json(0)),
        "{seen}"
    );
    assert_eq!(
        (
            &seen["login edited wrong password"]["error"],
            &seen["login edited wrong password"]["owner text"]
        ),
        (&json(true), &json(true)),
        "{seen}"
    );
    // The Login form block alone: same form, still posting to wp-login.php, wrong password shown, sign-in works.
    let block = &seen["login block"];
    assert_eq!(
        (&block["owner text"], &block["app"], &block["button"]),
        (&json(true), &json(false), &json(true)),
        "{seen}"
    );
    assert!(
        block["posts to"]
            .as_str()
            .unwrap_or_default()
            .ends_with("/wp-login.php"),
        "{seen}"
    );
    assert_eq!(seen["login block wrong password"]["error"], true, "{seen}");
    assert_eq!(seen["login block sign in"]["status"], 302, "{seen}");
    assert!(
        seen["login block sign in"]["location"]
            .as_str()
            .unwrap_or_default()
            .ends_with("/account/"),
        "{seen}"
    );
    // The owner's 404 template around the app's not-found page.
    assert_eq!(
        seen["404 edited"],
        serde_json::json!({ "status": 404, "owner text": true, "page": "No such page" }),
        "{seen}"
    );
    // The title WordPress prints is the page's metadata as text, never markup.
    let xss = &seen["xss"];
    assert_eq!(
        (&xss["status"], &xss["script"], &xss["titles"]),
        (&json(200), &json(false), &json(1)),
        "{seen}"
    );
    assert_eq!(
        xss["title"], "Notes </title><script>window.pwned=1</script> · Field Notes",
        "{seen}"
    );
    // Each page says its template, and each <Link> its target's: the router swaps the region only
    // within one template, and loads a page in another.
    assert_eq!(
        seen["links"],
        serde_json::json!({ "page": "tp-page", "links": [["/notes/", "tp-page"], ["/bare/", "tp-blank"]] }),
        "{seen}"
    );
    assert_eq!(
        (&seen["studio"]["template"], &seen["bare"]["template"]),
        (&json("tp-blank"), &json("tp-blank")),
        "{seen}"
    );
    // A route group's layout below the root renders, under the theme's parts.
    let group = &seen["group"];
    assert_eq!(
        (&group["page"], &group["group layout"], &group["theme header"]),
        (&json("Cart"), &json(true), &json(1)),
        "{seen}"
    );
    // <TemplatePart> attributes can't open another block.
    assert_eq!(
        seen["template part attrs"],
        serde_json::json!({ "tagline": false, "header": true }),
        "{seen}"
    );
    // A Login form block the owner placed in a public template, with a plugin's per-request field:
    // the page is never shared.
    assert_eq!(
        seen["public login form"],
        serde_json::json!({ "status": 200, "form": true, "cache": "private, no-store, max-age=0" }),
        "{seen}"
    );
    // A trashed saved template doesn't render: the registered one answers again.
    assert_eq!(
        seen["trashed template"],
        serde_json::json!({ "login form": false, "theme header": 1, "page": "All notes" }),
        "{seen}"
    );
    // A template that doesn't place the page falls back to tp-page; the page never goes missing.
    assert_eq!(
        seen["template without page"],
        serde_json::json!({ "status": 200, "page": "Bare", "owner text": false, "theme header": 1 }),
        "{seen}"
    );
    // A template's page render that a plugin drops: tp-page renders it instead, without the
    // dropped render's scripts, each head tag once.
    assert_eq!(
        seen["page render dropped"],
        serde_json::json!({ "status": 200, "page": "Bare", "template": "tp-page", "dropped text": false, "descriptions": 1, "scripts": false }),
        "{seen}"
    );
    // When neither the chosen template nor tp-page places it, the page is TypedPress's own document:
    // one title, one description, none of the failed renders' scripts.
    assert_eq!(
        seen["no template places the page"],
        serde_json::json!({ "status": 200, "page": "Bare", "template": "document", "titles": 1, "descriptions": 1, "scripts": false }),
        "{seen}"
    );
    // Core's lazy default navigation menu, made while a page renders, is no Site Editor edit.
    assert_eq!(seen["render purge"], serde_json::json!([]), "{seen}");
    // A Site Editor save announces one whole-host purge.
    assert_eq!(seen["design purge"], serde_json::json!(["[\"\\/*\"]"]), "{seen}");
    // The owner's sign-in template held only the Page content block, and login.tsx went away:
    // wp-login.php still shows a sign-in form.
    assert_eq!(
        seen["login without login.tsx"],
        serde_json::json!({ "status": 200, "form": true, "app": false, "wordpress page": false }),
        "{seen}"
    );
}

/// A root layout that draws its own chrome and says nothing about its template gets a hint: on a
/// block theme the theme's header and footer replace it. A route group's outermost layout is a
/// root too; a layout that only places `{children}`, or one that picks a template, gets none.
#[test]
fn root_layout_chrome_without_a_template_is_hinted() {
    let dir = std::env::temp_dir().join(format!("tp-root-layout-hint-{}", std::process::id()));
    let check = |files: &[(&str, &str)]| -> String {
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("typedpress.config.ts"),
            "import { defineConfig } from \"typedpress\";\nexport default defineConfig({});\n",
        )
        .unwrap();
        for (path, source) in files {
            let path = dir.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, source).unwrap();
        }
        let out = first().arg("check").arg(&dir).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stderr).to_string()
    };
    let page = (
        "tp/app/page.tsx",
        "export default function Home() { return <h1>Home</h1>; }\n",
    );
    let chrome = "import type { LayoutProps } from \"typedpress/app\";\nexport default function Root({ children }: LayoutProps) { return <div><header>Site</header>{children}</div>; }\n";
    let hint = "renders markup around {children}, which the theme's header and footer replace";
    let out = check(&[("tp/app/layout.tsx", chrome), page]);
    assert!(out.contains(&format!("hint: app/layout.tsx {hint}")), "{out}");
    // The outermost layout of a route group.
    let out = check(&[
        ("tp/app/(site)/layout.tsx", chrome),
        (
            "tp/app/(site)/about/page.tsx",
            "export default function About() { return <h1>About</h1>; }\n",
        ),
    ]);
    assert!(out.contains(&format!("hint: app/(site)/layout.tsx {hint}")), "{out}");
    // Saying which template it renders in, or placing only its children, is no hint.
    let blank = format!("export const template = \"blank\";\n{chrome}");
    assert!(!check(&[("tp/app/layout.tsx", &blank), page]).contains(hint));
    let bare = "import type { LayoutProps } from \"typedpress/app\";\nexport default function Root({ children }: LayoutProps) { return <>{children}</>; }\n";
    assert!(!check(&[("tp/app/layout.tsx", bare), page]).contains(hint));
    let _ = std::fs::remove_dir_all(&dir);
}

#[cfg(feature = "host")]
#[test]
fn public_metadata_scripts_carry_a_content_version() {
    let project = tempfile::tempdir().unwrap();
    let project = project.path();
    std::fs::create_dir_all(project.join("tp/app/plain")).unwrap();
    std::fs::create_dir_all(project.join("public/scripts")).unwrap();
    std::fs::write(
        project.join("typedpress.config.ts"),
        r#"import { defineConfig } from "typedpress";
export default defineConfig({ name: "publicmodules", admin: false });"#,
    )
    .unwrap();
    std::fs::write(
        project.join("tp/app/page.tsx"),
        r#"export const metadata = () => ({ scripts: [
  "/scripts/module%20name.mjs?mode=one&mode=two#ready",
  "https://cdn.example/remote.js?mode=one#ready",
] });
export default function Page() { return <p>With scripts</p>; }"#,
    )
    .unwrap();
    std::fs::write(
        project.join("tp/app/plain/page.tsx"),
        "export default function Plain() { return <p>Without scripts</p>; }",
    )
    .unwrap();

    let content = project.join("tp/dist/wp-content");
    let schema = content.join("plugins/typedpress-app-publicmodules/tp/app/schema.php");
    let scripts = |body: &str, stale: Option<&str>| {
        std::fs::write(project.join("public/scripts/module name.mjs"), body).unwrap();
        std::fs::write(project.join("public/notes.txt"), body).unwrap();
        build(project);
        let package = tempfile::tempdir().unwrap();
        let sources = package.path().join("sources");
        let store = package.path().join("store");
        typedpress::host::sources(project, &sources).unwrap();
        let built = typedpress::host::compile_to_store(&sources, &store, project, None).unwrap();
        let out = Command::new("php")
            .args(["-d", "memory_limit=512M"])
            .arg(root().join("tests/php/public_script_versions.php"))
            .arg(&content)
            .arg(&store)
            .arg(&built.runtime_revision)
            .arg(&built.build_id)
            .arg(stale.unwrap_or_default())
            .env("TP_WP_THEMES", "1")
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
        let base = seen["base"].as_str().unwrap();
        use sha2::Digest;
        let version: String = sha2::Sha256::digest(body)[..6]
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let expected = serde_json::json!([
            format!("{base}/scripts/module%20name.mjs?mode=one&mode=two&tpv={version}#ready"),
            "https://cdn.example/remote.js?mode=one#ready",
        ]);
        assert_eq!(seen["scripts"], expected);
        assert_eq!(seen["managedScripts"], expected);
        assert_eq!(seen["plain"], serde_json::json!([]));
        assert_eq!(seen["body"], body);
        version
    };
    let first = scripts("export const value = 1;\n", None);
    let original_schema = std::fs::read(&schema).unwrap();
    let second = scripts("export const value = 2;\n", Some(&first));
    assert_ne!(first, second);
    assert_eq!(std::fs::read(schema).unwrap(), original_schema);
}

/// The script modules with fixed names (`typedpress-client.js`, the runtime's `live.js` and
/// `router.js`) carry a version that changes with what they are, so a browser never keeps one
/// from an earlier build; the content-hashed client files are served with an immutable cache header
/// (tests/php/script_versions.php).
#[test]
fn fixed_script_modules_carry_a_build_version() {
    let project = fixture("client-components", "versions");
    let page = project.join("tp/app/page.tsx");
    let source = std::fs::read_to_string(&page).unwrap();
    std::fs::write(
        &page,
        source
            .replacen("import ", "import { Link } from \"typedpress/app\";\nimport ", 1)
            .replace("<main>", "<main>\n      <Link href=\"/\">home</Link>"),
    )
    .unwrap();
    build(&project);
    let content = project.join("tp/dist/wp-content");
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/script_versions.php"))
        .arg(&content)
        .env("TP_WP_THEMES", "1")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let seen: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let plugins = content.join("plugins");
    let runtime = std::fs::read_to_string(plugins.join("typedpress-runtime/typedpress-runtime.php")).unwrap();
    let runtime_hash = runtime
        .split("define('TP_RUNTIME_HASH', '")
        .nth(1)
        .unwrap()
        .split('\'')
        .next()
        .unwrap()
        .to_string();
    let client = std::fs::read(plugins.join("typedpress-app-clients/tp/app/client/typedpress-client.js")).unwrap();
    let client_hash: String = {
        use sha2::Digest;
        sha2::Sha256::digest(&client)[..6]
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    };
    assert_eq!(seen["router.js"], runtime_hash.as_str(), "{seen}");
    assert_eq!(seen["live.js"], runtime_hash.as_str(), "{seen}");
    assert_eq!(seen["typedpress-client.js"], client_hash.as_str(), "{seen}");
    // Content-hashed island stores need no version.
    assert!(
        seen.as_object()
            .unwrap()
            .iter()
            .filter(|(name, _)| name.matches('.').count() == 2)
            .all(|(_, ver)| ver.is_null()),
        "{seen}"
    );
    // The shipped modules are minified; the committed client stays as generated.
    let committed = std::fs::read(project.join("tp/_generated/client/client.js")).unwrap();
    assert!(
        client.len() * 2 < committed.len(),
        "{} vs {}",
        client.len(),
        committed.len()
    );
    assert!(
        !String::from_utf8_lossy(&client).contains("\n  "),
        "typedpress-client.js is minified"
    );
    let stores: Vec<&String> = seen
        .as_object()
        .unwrap()
        .keys()
        .filter(|name| name.matches('.').count() == 2)
        .collect();
    assert!(stores.len() >= 6, "{seen}");
    for name in stores {
        let store = std::fs::read(plugins.join("typedpress-app-clients/tp/app/client").join(name)).unwrap();
        assert!(
            !String::from_utf8_lossy(&store).contains("// Generated by"),
            "{name} is minified"
        );
        // The name is immutable: its 12 hex digits are the SHA-256 of exactly the bytes served.
        use sha2::Digest;
        let digest: String = sha2::Sha256::digest(&store)[..6]
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(name.split('.').nth(1), Some(digest.as_str()), "{name}");
    }
    // The hashed client files get the assets' immutable cache header; typedpress-client.js has none.
    let htaccess = std::fs::read_to_string(plugins.join("typedpress-app-clients/tp/app/client/.htaccess")).unwrap();
    assert!(htaccess.contains("immutable"), "{htaccess}");
    assert!(htaccess.contains(r#"<FilesMatch "\.[0-9a-f]{12}\.js$">"#), "{htaccess}");
    let version = std::fs::read_to_string(plugins.join("typedpress-app-clients/tp/app/client-version.php")).unwrap();
    assert!(version.contains(&format!("return '{client_hash}';")), "{version}");
    let _ = std::fs::remove_dir_all(project);
}
