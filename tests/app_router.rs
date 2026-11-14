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
    // An anonymous visitor's page is cacheable (rendering.md §6.1; app_pages_cache_and_purge_by_what_they_read).
    assert_eq!(
        seen["home cache"][0],
        "public, max-age=0, s-maxage=300, must-revalidate"
    );
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
    assert_eq!(titles, ["About", "Field guide", "Colophon", "Notes", "Home"], "{llms}");
    // WordPress keeps its own URLs.
    assert_eq!(seen["rest"], 200);
    assert_eq!(seen["feed"], 200);
    assert_eq!(seen["reserved"], false);
    let _ = std::fs::remove_dir_all(project);
}

/// WordPress in a subdirectory (tests/php/app_router_subdirectory.php): examples/full-site served under
/// `/blog`, as WordPress Playground serves every site under `/scope:<id>/`. A note's page (`url:
/// "/notes/:slug"`) answers at its own URL; the request path starts with the home path and the
/// item's path does not, so the two are compared without it.
#[test]
fn app_router_serves_item_pages_under_a_subdirectory() {
    let project = std::env::temp_dir().join(format!("first-full-site-subdir-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&project);
    copy(&root().join("examples/full-site"), &project);
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_router_subdirectory.php"))
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
    let url = seen["url"].as_str().unwrap();
    assert!(url.ends_with("/blog"), "{url}");
    assert_eq!(seen["link"], format!("{url}/notes/dawn-on-the-ridge/"));
    assert_eq!(seen["notes"], serde_json::json!([200, "Notes"]));
    assert_eq!(seen["note"], serde_json::json!([200, "Dawn on the ridge"]));
    assert_eq!(seen["note slash"], serde_json::json!([200, "Dawn on the ridge"]));
    // Still a 404: a draft for a signed-out visitor, and a slug no note has.
    assert_eq!(seen["draft"], serde_json::json!([404, "Not found"]));
    assert_eq!(seen["missing"], serde_json::json!([404, "Not found"]));
    assert_eq!(seen["about"], serde_json::json!([200, "About"]));
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

/// `page.md` is a real WordPress Page (rendering.md §2): the file is its first version, the route
/// renders it inside its layouts, an editor changes it in wp-admin, and nothing of a draft or a
/// guarded page reaches an anonymous visitor (tests/php/app_content.php).
#[test]
fn page_md_is_a_wordpress_page() {
    let project = fixture("app-router", "content");
    build(&project);
    // A later build of the same app: one file changed in each of three ways, one removed, one added.
    let second = fixture("app-router", "content-second");
    let app = second.join("first/app");
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
    let app = third.join("first/app");
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
    std::fs::remove_dir_all(fourth.join("first/app")).unwrap();
    copy(&third.join("first/app"), &fourth.join("first/app"));
    let app = fourth.join("first/app");
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
        .arg(project.join("first/dist/wp-content"))
        .arg(second.join("first/dist/wp-content"))
        .arg(third.join("first/dist/wp-content"))
        .arg(fourth.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
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
    assert!(text(&guide["canonical"]).ends_with("/guide"), "{guide}");
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
        // Rendered as First renders every code block (First\Content\Code).
        body.contains(r#"<pre class="first-code language-sh"><code><span class="first-code-line">first build</span>"#),
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
    assert!(text(&stored["link"]).ends_with("/guide"), "{stored}");
    assert_eq!(seen["by id"][0], 301);
    assert!(text(&seen["by id"][1]).ends_with("/guide"), "{}", seen["by id"]);
    // Its Markdown twin, advertised by the HTML page.
    assert_eq!(
        seen["guide twin"],
        serde_json::json!([
            200,
            "# Field guide\n\nNotes are kept in **plain text**, one per walk.\n\n## What to carry\n\n- A pencil\n- A [map](https://example.com/map)\n\n```sh\nfirst build\n```\n",
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
    assert!(text(&seen["colophon"]["canonical"]).ends_with("/colophon"));

    // A draft: stored for its editors, a 404 for everyone else, HTML and twin alike, and uncached.
    assert_eq!(seen["hidden stored"]["status"], "draft");
    assert_eq!(seen["hidden"]["status"], 404);
    assert_eq!(seen["hidden"]["cache"], private);
    assert!(!text(&seen["hidden"]["body"]).contains("ninth"));
    assert_ne!(seen["hidden"]["description"], "Not for visitors yet.");
    assert_eq!(seen["hidden as subscriber"], 404);
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
    for path in ["/guide", "/guide/", "/guide.md", "/llms.txt"] {
        assert!(purged.contains(&path.to_string()), "{path} in {purged:?}");
    }
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
        text(&seen["fourth by id"]).ends_with("/guide?q=it%27s"),
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

/// A stylesheet the compiler can't serve as it is, and an import that isn't code or an asset, are
/// build errors at the line, with the fix.
#[test]
fn refuses_stylesheets_it_cannot_copy_with_a_fix() {
    let dir = std::env::temp_dir().join(format!("first-app-css-{}", std::process::id()));
    let page = |import: &str| format!("{import}\nexport default function P() {{ return <p/>; }}\n");
    let styled = page("import \"./x.css\";");
    let module = page("import s from \"./x.module.css\";");
    rejects(
        &dir,
        &[
            ("first/app/page.tsx", &styled),
            ("first/app/x.css", "@import \"normalize.css\";\n.a {}\n"),
        ],
        "`@import` in an imported stylesheet isn't supported",
        "first/app/x.css:1:1",
    );
    rejects(
        &dir,
        &[
            ("first/app/page.tsx", &styled),
            ("first/app/x.css", ".a {\n  background: url(./bg.png);\n}\n"),
        ],
        "`url(./bg.png)` is relative to the stylesheet",
        "first/app/x.css:2:15",
    );
    rejects(
        &dir,
        &[
            ("first/app/page.tsx", &module),
            ("first/app/x.module.css", ":global(.a) {}\n"),
        ],
        "`:global` isn't supported in CSS modules",
        "first/app/x.module.css:1:1",
    );
    rejects(
        &dir,
        &[
            ("first/app/page.tsx", &module),
            ("first/app/x.module.css", ".a { composes: b; }\n"),
        ],
        "`composes` isn't supported in CSS modules",
        "first/app/x.module.css:1:6",
    );
    rejects(
        &dir,
        &[
            ("first/app/page.tsx", &page("import data from \"./x.json\";")),
            ("first/app/x.json", "{}"),
        ],
        "can't import \"./x.json\": expected TypeScript or JavaScript source",
        "first/app/page.tsx:1:1",
    );
    // A client component renders in the browser too; an image URL comes in as a prop.
    rejects(
        &dir,
        &[
            (
                "first/app/page.tsx",
                "import { C } from \"../components/C\";\nexport default function P() { return <C />; }\n",
            ),
            (
                "first/components/C.tsx",
                "\"use client\";\nimport logo from \"./logo.svg\";\nexport function C() { return <img src={logo} />; }\n",
            ),
            ("first/components/logo.svg", "<svg/>"),
        ],
        "a \"use client\" component can't import first/components/logo.svg",
        "first/components/C.tsx",
    );
    let _ = std::fs::remove_dir_all(&dir);
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
    // `apiReference()` reads a JSON file of the app's `public/`, named as a literal.
    rejects(
        &dir,
        &[(
            "first/app/api/page.tsx",
            "import { apiReference } from \"first/content\";\nconst file = \"x.json\";\nexport default function P() { return <p>{apiReference(file).title}</p>; }\n",
        )],
        "`apiReference()` takes the path of a JSON file in `public/`, as a string literal",
        "first/app/api/page.tsx:3",
    );
    rejects(
        &dir,
        &[(
            "first/app/api/page.tsx",
            "import { apiReference } from \"first/content\";\nexport default function P() { return <p>{apiReference(\"../secrets.json\").title}</p>; }\n",
        )],
        "`apiReference()` takes the path of a JSON file in `public/`",
        "first/app/api/page.tsx:2",
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
    // page.md: one page with one URL, a title, and only the front matter keys it reads.
    rejects(
        &dir,
        &[("first/app/docs/[slug]/page.md", "# Doc\n")],
        "app/docs/[slug]/page.md is below `[slug]`: a page.md is one page with one URL",
        "first/app/docs/[slug]/page.md:1:1",
    );
    rejects(
        &dir,
        &[("first/app/about/page.md", "---\ntitle: About\ndescripton: Us\n---\n")],
        "page.md has no front matter key `descripton`",
        "first/app/about/page.md:3:1",
    );
    rejects(
        &dir,
        &[("first/app/about/page.md", "Just text.\n")],
        "app/about/page.md has no title",
        "first/app/about/page.md:1:1",
    );
    rejects(
        &dir,
        &[("first/app/about/page.md", "---\ntitle: About\nstatus: private\n---\n")],
        "`status` must be published or draft",
        "first/app/about/page.md:3:1",
    );
    rejects(
        &dir,
        &[
            ("first/app/about/page.md", "# About\n"),
            ("first/app/about/page.tsx", page),
        ],
        "app/about has both page.tsx and page.md",
        "first/app/about/page.md",
    );
    rejects(
        &dir,
        &[("first/app/about/page.mdx", "# About\n")],
        "page.mdx isn't a route file",
        "first/app/about/page.mdx",
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

/// A prebuilt page is an anonymous visitor's render with nothing from the request, at URLs the build
/// can list (docs/decisions/2026-11-13-static-output.md). Everything else is a build error at the
/// page, with the fix.
#[test]
fn refuses_prebuilt_pages_that_depend_on_the_request() {
    let dir = std::env::temp_dir().join(format!("first-app-prerender-{}", std::process::id()));
    let page = "export default function P() { return <p/>; }\n";
    let static_config = (
        "first.config.ts",
        "import { defineConfig } from \"first\";\nexport default defineConfig({ output: \"static\" });\n",
    );
    rejects(
        &dir,
        &[(
            "first.config.ts",
            "import { defineConfig } from \"first\";\nexport default defineConfig({ output: \"hybrid\" });\n",
        )],
        "`output` is \"server\" or \"static\", not \"hybrid\"",
        "first.config.ts:2:",
    );
    rejects(
        &dir,
        &[(
            "first.config.ts",
            "import { defineConfig } from \"first\";\nexport default defineConfig({ output: \"static\", frontend: \"https://example.com\" });\n",
        )],
        "`frontend` hands it to another site",
        "first.config.ts:2:",
    );
    rejects(
        &dir,
        &[(
            "first/app/page.tsx",
            "export const prerender = \"yes\";\nexport default function P() { return <p/>; }\n",
        )],
        "`prerender` is \"yes\", not true or false",
        "first/app/page.tsx",
    );
    rejects(
        &dir,
        &[
            static_config,
            (
                "first/app/about/page.tsx",
                "export const prerender = false;\nexport default function P() { return <p/>; }\n",
            ),
        ],
        "app/about/page.tsx says `prerender = false`, and `output: \"static\"` prebuilds every page",
        "first/app/about/page.tsx",
    );
    rejects(
        &dir,
        &[static_config, ("first/app/blog/[slug]/page.tsx", page)],
        "app/blog/[slug]/page.tsx is prebuilt (`output: \"static\"` prebuilds every page), and nothing lists its URLs",
        "first/app/blog/[slug]/page.tsx",
    );
    rejects(
        &dir,
        &[(
            "first/app/blog/[slug]/page.tsx",
            "export const prerender = true;\nexport default function P() { return <p/>; }\n",
        )],
        "export `async function staticParams() { return [{ slug: \"…\" }]; }`",
        "first/app/blog/[slug]/page.tsx",
    );
    rejects(
        &dir,
        &[(
            "first/app/blog/[slug]/page.tsx",
            "export async function staticParams() { return [{ slug: \"a\" }]; }\nexport default function P() { return <p/>; }\n",
        )],
        "exports `staticParams`, but it isn't prebuilt",
        "first/app/blog/[slug]/page.tsx",
    );
    rejects(
        &dir,
        &[(
            "first/app/about/page.tsx",
            "export const prerender = true;\nexport async function staticParams() { return []; }\nexport default function P() { return <p/>; }\n",
        )],
        "exports `staticParams`, and its URL has no parameter",
        "first/app/about/page.tsx",
    );
    rejects(
        &dir,
        &[(
            "first/app/blog/[slug]/page.tsx",
            "export const prerender = true;\nexport async function staticParams() { return [{ id: \"a\" }]; }\nexport default function P() { return <p/>; }\n",
        )],
        "staticParams in app/blog/[slug]/page.tsx returns",
        "first/app/blog/[slug]/page.tsx:2:",
    );
    rejects(
        &dir,
        &[(
            "first/app/find/page.tsx",
            "import { text } from \"first\";\nexport const prerender = true;\nexport const search = { q: text().optional() };\nexport default function P() { return <p/>; }\n",
        )],
        "app/find/page.tsx is prebuilt (it says `prerender = true`), and it reads `search`",
        "first/app/find/page.tsx",
    );
    rejects(
        &dir,
        &[
            (
                "first/app/account/layout.tsx",
                "export const guard = \"subscriber\";\nexport default function L({ children }: { children: JSX.Element }) { return <main>{children}</main>; }\n",
            ),
            (
                "first/app/account/page.tsx",
                "export const prerender = true;\nexport default function P() { return <p/>; }\n",
            ),
        ],
        "app/account/page.tsx is prebuilt (it says `prerender = true`), and app/account/layout.tsx guards it",
        "first/app/account/page.tsx",
    );
    rejects(
        &dir,
        &[
            static_config,
            (
                "first/app/form/page.tsx",
                "export const access = \"anyone\";\nexport async function POST() { return {}; }\nexport default function P() { return <p/>; }\n",
            ),
        ],
        "app/form/page.tsx has HTTP handlers, and a static site has no server to answer them",
        "first/app/form/page.tsx",
    );
    // Through an imported helper too: the check follows the page's imports.
    rejects(
        &dir,
        &[
            (
                "first/app/_lib/who.ts",
                "import { is_user_logged_in } from \"php/wordpress\";\nexport function who(): string { return is_user_logged_in() ? \"you\" : \"guest\"; }\n",
            ),
            (
                "first/app/hello/page.tsx",
                "import { who } from \"../_lib/who\";\nexport const prerender = true;\nexport default function P() { return <p>{who()}</p>; }\n",
            ),
        ],
        "app/hello/page.tsx is prebuilt, and `is_user_logged_in` asks who the visitor is",
        "first/app/_lib/who.ts:2:",
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
        "first.config.ts",
        "import { defineConfig, collection, text, slug } from \"first\";\nexport const notes = collection({ title: text(), slug: slug({ source: \"title\" }) }, { url: \"/notes/:slug\", access: { read: \"anyone\" } });\nexport default defineConfig({ name: \"hybrid\", collections: { notes } });\n",
    );
    write("first/app/page.tsx", "export default function P() { return <p/>; }\n");
    write(
        "first/app/about/page.tsx",
        "export const prerender = true;\nexport default function P() { return <p/>; }\n",
    );
    write(
        "first/app/notes/[slug]/page.tsx",
        "export const prerender = true;\nexport default function P() { return <p/>; }\n",
    );
    write(
        "first/app/tags/[tag]/page.tsx",
        "import type { PageProps, StaticParams } from \"first/app\";\nexport const prerender = true;\nexport async function staticParams(): Promise<StaticParams<\"tags/[tag]\">> { return [\"news\", \"notes\"].map((tag) => ({ tag })); }\nexport default function P({ params }: PageProps<\"tags/[tag]\">) { return <p>{params.tag}</p>; }\n",
    );
    build(project);
    let schema =
        std::fs::read_to_string(project.join("first/dist/wp-content/plugins/first-app-hybrid/first/app/schema.php"))
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
            "require '{}/runtime/First/bootstrap.php'; require '{}'; $s = require '{}'; $fn = '\\\\FirstApp\\\\' . $s['app']['files']['app/tags/[tag]/page.tsx']['staticParams']; echo \\First\\Js::jsonStringify($fn());",
            root().display(),
            project.join("first/dist/wp-content/plugins/first-app-hybrid/first/app/functions.php").display(),
            project.join("first/dist/wp-content/plugins/first-app-hybrid/first/app/schema.php").display(),
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
/// listing `first export` reads is an editor's.
#[test]
fn prebuilt_pages_serve_before_wordpress_and_rebuild_after_writes() {
    let project = fixture("app-prebuilt", "serve");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_prebuilt.php"))
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
    // A value staticParams stops listing loses its file.
    assert_eq!(seen["dropped value"], json!([false, true]));
    // Another spelling of a path, and a coming-soon site, are never answered from a file.
    assert_eq!(seen["encoded spelling"], false);
    assert_eq!(seen["coming soon"], false);
    assert_eq!(seen["purge all, no files"], true);
    // A render that began before a write named its path is not written.
    assert_eq!(seen["race"], json!([true, false, false]));
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
    // With no first/app/, WordPress renders the whole site with its block theme: the home page,
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

    let app = modes("app", None, true);
    // With first/app/, its page renders the note through the router; a kind URL without a page and
    // a core post keep the theme.
    assert_eq!(app["note rendered"]["router"], true, "{app}");
    assert_eq!(
        app["missing rendered"],
        serde_json::json!({ "status": 404, "theme": false, "router": true })
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
    // authors, and First's provider with a file per kind that has a `url` and readable items. Only
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
            "/wp-sitemap-first-notes-1.xml",
            "/wp-sitemap-first-journal-1.xml",
            "/wp-sitemap-first-briefs-1.xml",
            "/wp-sitemap-first-vault-1.xml"
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
            "/wp-sitemap-first-notes-1.xml": ["/notes/renamed-note/"],
            "/wp-sitemap-first-journal-1.xml": ["/journal/2026/day-one/"],
            "/wp-sitemap-first-briefs-1.xml": ["/briefs/open-brief/"],
            // With no app page in front of it, WordPress renders a vault item for anyone.
            "/wp-sitemap-first-vault-1.xml": ["/members/vault/vault-item/"]
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
            "/wp-sitemap-first-notes-1.xml": ["/notes/renamed-note/"],
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
        "/wp-sitemap-first-briefs-1.xml",
        "/wp-sitemap-first-briefs-2.xml"
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
    // With first/app/, its public pages are listed too: not the guarded one, not the one whose
    // metadata says `robots: { index: false }`, and not a route with parameters.
    assert_eq!(
        app["sitemap"]["urls"]["/wp-sitemap-first-app-pages-1.xml"],
        serde_json::json!(["/about/"]),
        "{}",
        app["sitemap"]
    );
    assert_eq!(
        app["sitemap"]["urls"]["/wp-sitemap-first-notes-1.xml"],
        sitemap["urls"]["/wp-sitemap-first-notes-1.xml"]
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
/// context, an async handler awaits a server action through `fetch` with the REST nonce, setters
/// with an updater, effects, mount, window events, `withSyncEvent` for `preventDefault`, and
/// shared state.
#[test]
fn client_components_compile_to_interactivity_stores() {
    let project = fixture("client-components", "stores");
    build(&project);
    let plugin = project.join("first/dist/wp-content/plugins/first-app-clients");
    let schema = Command::new("php")
        .args(["-r", "echo json_encode((require $argv[1])['islands']);"])
        .arg(plugin.join("first/app/schema.php"))
        .output()
        .unwrap();
    let islands: serde_json::Value = serde_json::from_slice(&schema.stdout).unwrap();
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
            .arg(plugin.join("first/app/client").join(file))
            .arg(root().join("tests/differential/client").join(script))
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
        serde_json::json!([{ "url": "/__first/api/v1/actions/like", "method": "POST", "nonce": "n0nce", "body": { "postId": 42 } }])
    );
    let effects = drive("clients/Effects", "effects.mjs");
    assert_eq!(
        effects,
        serde_json::json!({ "mounted": -1, "n": 10, "items": 2, "shown": 2, "seen": 100, "width": 777, "submitted": { "n": 0, "prevented": true } })
    );
    // The server HTML carries the directives the store answers to.
    let functions = std::fs::read_to_string(plugin.join("first/app/functions.php")).unwrap();
    for directive in [
        "'data-wp-interactive' => 'clients/LikeButton'",
        "'data-wp-bind--disabled' => 'context.busy'",
        "'data-wp-on--click' => 'actions.click1'",
        "'data-wp-on-window--resize' => 'actions.onResize3'",
        "'data-wp-watch---effect1' => 'callbacks.effect1'",
        "'data-wp-init---mount2' => 'callbacks.mount2'",
        "'data-wp-on--submit' => 'actions.submit'",
    ] {
        assert!(functions.contains(directive), "{directive}");
    }
    let _ = std::fs::remove_dir_all(project);
}

/// What generator B can't compile is a build error at the line, with the subset's alternative.
#[test]
fn refuses_client_code_outside_the_subset() {
    let dir = std::env::temp_dir().join(format!("first-client-reject-{}", std::process::id()));
    let component = |body: &str| format!("\"use client\";\nimport {{ useState }} from \"first/client\";\n{body}\n");
    rejects(
        &dir,
        &[(
            "first/components/A.tsx",
            &component("export function A() { const [n] = useState(0); return <><b>{n}</b></>; }"),
        )],
        "a client component returns one element",
        "first/components/A.tsx:3:",
    );
    rejects(
        &dir,
        &[(
            "first/components/A.tsx",
            &component("import dayjs from \"dayjs\";\nexport function A() { return <b/>; }"),
        )],
        "a \"use client\" component can't import \"dayjs\"",
        "first/components/A.tsx:3:",
    );
    rejects(
        &dir,
        &[(
            "first/components/A.tsx",
            &component(
                "export function A() { const [n, setN] = useState(0); return <b onClick={() => { n = 2; }}>{n}</b>; }",
            ),
        )],
        "`n` changes through `setN`",
        "first/components/A.tsx:3:",
    );
    rejects(
        &dir,
        &[(
            "first/components/A.tsx",
            &component(
                "const secret = 1;\nexport function A() { const [n, setN] = useState(0); return <b onClick={() => setN(secret)}>{n}</b>; }",
            ),
        )],
        "`secret` isn't available in the browser",
        "first/components/A.tsx:4:",
    );
    rejects(
        &dir,
        &[(
            "first/components/A.tsx",
            &component("export function A() { const [n, setN] = useState(0); return <b onClick=\"go()\">{n}</b>; }"),
        )],
        "with a string is inline script",
        "first/components/A.tsx:3:",
    );
    rejects(
        &dir,
        &[
            (
                "first/components/A.tsx",
                &component("export function Same() { return <b/>; }"),
            ),
            (
                "first/components/B.tsx",
                &component("export function Same() { return <i/>; }"),
            ),
        ],
        "two \"use client\" components are named `Same`",
        "first/components/B.tsx:3:",
    );
    rejects(
        &dir,
        &[(
            "first/components/A.tsx",
            &component("export function A() { const [n, setN] = useState(0); if (n) { setN(1); } return <b>{n}</b>; }"),
        )],
        "returns its element",
        "first/components/A.tsx:3:",
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
            &[("first/components/A.tsx", &shelf(markup))],
            refusal,
            "first/components/A.tsx:3:",
        );
    }
    let _ = std::fs::remove_dir_all(dir);
}

/// Forms without JavaScript (rendering.md §4.2), as a browser with scripts off submits them: the
/// form posts form-encoded to its action, the facade answers 303 back to the page with a sealed,
/// read-once flash, and `useFormState` shows the result or the error. The page a form comes back
/// to is never shared, a cross-site post is refused, and a signed-in form carries the REST nonce.
#[test]
fn forms_work_without_javascript() {
    let project = fixture("forms", "serve");
    build(&project);
    // `useFormState(action)` is typed with the action's result.
    let types = root().join("types/first");
    std::fs::write(
        project.join("tsconfig.json"),
        serde_json::json!({
            "compilerOptions": {
                "target": "ES2022", "lib": ["ES2022", "DOM"], "module": "ESNext", "moduleResolution": "bundler",
                "strict": true, "noEmit": true, "types": [], "jsx": "react-jsx", "jsxImportSource": "first",
                "allowImportingTsExtensions": true,
                "paths": { "first": [types.join("index.d.ts")], "first/*": [types.join("*.d.ts")] },
            },
            "include": ["first.config.ts", "first", "typed.ts"],
        })
        .to_string(),
    )
    .unwrap();
    std::fs::write(
        project.join("typed.ts"),
        r#"import { useFormState } from "first/app";
import { subscribe } from "./first/server";
const state = useFormState(subscribe);
export const seats: number | undefined = state.result?.seats;
// @ts-expect-error: the result has no `nope`
export const nope = state.result?.nope;
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
        .arg(project.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
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
        seen["form"],
        serde_json::json!({
            "method": "post",
            "action": "/__first/api/v1/actions/subscribe",
            "hidden": [["_first_return", "hidden", "/?ref=nav"]],
            "page cache": "public, max-age=0, s-maxage=300, must-revalidate",
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
    assert_eq!(
        seen["password"],
        serde_json::json!(["Unknown field 'password'", "", "p@example.test"]),
        "{seen}"
    );
    assert_eq!(seen["handler error"], serde_json::json!("Five seats at most"));
    assert_eq!(seen["not a number"], serde_json::json!("seats must be an integer"));
    assert_eq!(seen["open redirect"], serde_json::json!(true));
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
        .arg(project.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
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
            "status": 200, "thread": ["First!"], "forms": 0, "sign in": "Sign in to comment",
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
            "ann sees": ["First!", "Hello from Ann (held)"], "others see": ["First!"], "bo sees": ["First!"],
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
        serde_json::json!(["First!", ">depth two", ">>depth three", "Hello from Ann", "Ann again"])
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
    assert_eq!(seen["memo"], 403, "a kind without comments takes none: {seen}");
}

/// `<Comments for>` on a kind without `comments`, or on something that isn't an item, is a build
/// error at the prop.
#[test]
fn refuses_comments_without_the_kind_option() {
    let dir = std::env::temp_dir().join(format!("first-comments-reject-{}", std::process::id()));
    let schema = (
        "first/schema.ts",
        "import { collection, text, slug } from \"first\";\nexport const memos = collection({ title: text(), slug: slug({ source: \"title\" }).optional() }, { title: \"title\", url: \"/memos/:slug\" });\n",
    );
    rejects(
        &dir,
        &[
            schema,
            (
                "first/app/memos/[slug]/page.tsx",
                "import { Comments, type PageProps } from \"first/app\";\nexport default function Memo({ item }: PageProps<\"memos/[slug]\">) {\n  return <Comments for={item} />;\n}\n",
            ),
        ],
        "`memos` has comments off",
        "first/app/memos/[slug]/page.tsx:3:",
    );
    rejects(
        &dir,
        &[
            schema,
            (
                "first/app/page.tsx",
                "import { Comments } from \"first/app\";\nexport default function Home() {\n  return <Comments for={{ id: 1 }} />;\n}\n",
            ),
        ],
        "`<Comments for>` takes a row of a collection",
        "first/app/page.tsx:3:",
    );
    let _ = std::fs::remove_dir_all(dir);
}

/// What a form with an action can't be is a build error at the line, with the fix.
#[test]
fn refuses_forms_it_cannot_post() {
    let dir = std::env::temp_dir().join(format!("first-forms-reject-{}", std::process::id()));
    let server = (
        "first/server.ts",
        "import { action, text } from \"first\";\nexport const send = action({ input: { name: text() }, access: \"anyone\", async handler({ name }) { return name; } });\n",
    );
    let page = |body: &str| {
        format!("import {{ useFormState }} from \"first/app\";\nimport {{ send }} from \"../server\";\n{body}\n")
    };
    rejects(
        &dir,
        &[
            server,
            (
                "first/app/page.tsx",
                &page("export default function Page() { return <form action={send} method=\"get\"><button/></form>; }"),
            ),
        ],
        "a form with an action posts it form-encoded",
        "first/app/page.tsx:3:",
    );
    rejects(
        &dir,
        &[
            server,
            (
                "first/app/page.tsx",
                &page(
                    "const other = 1;\nexport default function Page() { const s = useFormState(other); return <b>{String(s.pending)}</b>; }",
                ),
            ),
        ],
        "`useFormState()` takes an action imported from your server code",
        "first/app/page.tsx:4:",
    );
    rejects(
        &dir,
        &[
            server,
            (
                "first/components/Box.tsx",
                "\"use client\";\nimport { send } from \"../server\";\nexport function Box() { return <form action={send}><button/></form>; }\n",
            ),
        ],
        "a \"use client\" component's form calls its action from a handler",
        "first/components/Box.tsx:3:",
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
        .arg(project.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
        .env("FIRST_WP_SCRIPT_DEBUG", "1")
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
}

/// rendering.md §6.1 and §6.2 for `first/app/` pages, on WordPress with a stand-in host listening
/// on `first_purge_urls`: an anonymous visitor's page is cacheable at the edge, a signed-in,
/// guarded or missing one is private; each cacheable render records what it read; an edit to one
/// row purges exactly the URLs that read it or listed its kind, with their `.md` twins.
#[test]
fn app_pages_cache_and_purge_by_what_they_read() {
    let project = fixture("app-router", "cache");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_cache.php"))
        .arg(project.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
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
    for key in ["home", "note", "other note", "about"] {
        assert_eq!(
            seen[key],
            serde_json::json!({ "status": 200, "cache": shared }),
            "{key}"
        );
    }
    assert_eq!(seen["as editor"]["cache"], private);
    assert_eq!(seen["guarded"]["cache"], private);
    assert_eq!(seen["missing"], serde_json::json!({ "status": 404, "cache": private }));
    // The index: `/` listed notes (and read both), each note page read its own row, /about nothing.
    let index: Vec<String> = seen["index"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    assert!(index.contains(&"notes * /".to_string()), "{index:?}");
    assert_eq!(
        index.iter().filter(|r| r.ends_with(" /notes/hello")).count(),
        1,
        "{index:?}"
    );
    assert!(!index.iter().any(|r| r.ends_with(" /about")), "{index:?}");
    assert_eq!(
        seen["purged"],
        serde_json::json!([["/", "/index.md", "/notes/hello", "/notes/hello.md"]])
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
        for path in ["/", "/index.md", "/notes/hello", "/notes/hello.md"] {
            if !(cache == "boost" && path == "/") {
                want.push(format!("{cache} {path}"));
            }
        }
    }
    want.sort();
    assert_eq!(cleared, want);
    assert_eq!(seen["cleared all"], serde_json::json!(["vip *", "boost *"]));
    // Over VIP's 100 URLs a request: one site ban, and every path still for Batcache.
    assert_eq!(seen["cleared many"], serde_json::json!([1, true, 101]));
    assert_eq!(
        seen["without batcache drop-in"],
        serde_json::json!(["vip /about", "boost /about"])
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
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_assets.php"))
        .arg(project.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
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
    // A page.md has no imports of its own: it links what the layouts above it import.
    assert_eq!(seen["colophon"]["status"], 200, "{seen}");
    assert_eq!(files("colophon"), ["site"], "{seen}");
    assert_eq!(seen["colophon"]["classes"]["div"][0], "site", "{seen}");
    let css = |page: &str, i: usize| seen[page]["links"][i]["css"].as_str().unwrap().to_string();
    assert_eq!(
        css("about", 0),
        ":root { --ink: #1d2420; }\nbody { margin: 0; color: var(--ink); }\n.site { max-width: 48rem; }\n"
    );
    assert_eq!(
        css("about", 1),
        ".page_title { font-size: 2rem; }\n.page_card .page_title { color: #1f4d3a; }\n@media (min-width: 40rem) { .page_card { padding: 1rem; } }\n"
    );
    assert_eq!(
        css("about", 2),
        ".counter_button { border: 0; }\n.counter_on { background: #1f4d3a; }\n"
    );
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

/// `first doctor --site <url> --links` on a served First site: every link and `#anchor` the docs
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
        .arg(project.join("first/dist/wp-content"))
        .arg(compiled.join("seed"))
        .env("FIRST_WP_THEMES", "1")
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

/// `apiReference()` from "first/content": the app's own OpenAPI document, and one in `public/`,
/// rendered by pages as an API reference, on WordPress over HTTP (tests/php/api_reference.php).
#[test]
fn api_reference_renders_openapi_as_pages() {
    let project = fixture("api-reference", "serve");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/api_reference.php"))
        .arg(project.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
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
        index["server"][0].as_str().unwrap().ends_with("/__first/api/v1"),
        "{index}"
    );
    assert_eq!(index["tags"][0], "notes");
    assert_eq!(index["tags"][1], "actions");
    assert_eq!(index["tags"][2], "word-press");
    assert_eq!(index["notes"][0], "/api/notes/notes-list");
    assert_eq!(index["notes"][4], "/api/notes/notes-delete");
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
        .arg(project.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
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
            "/index.html": [200, "text/html; charset=utf-8", 21],
            "/it's.txt": [200, "text/plain; charset=utf-8", 1]
        })
    );
    // robots.txt, llms.txt, feeds and First Identity's discovery document stay WordPress's.
    for (path, kept) in seen["wordpress"].as_object().unwrap() {
        assert_eq!(kept, true, "{path}");
    }
    // A `[slug]` route at the root doesn't take a file's path.
    assert_eq!(seen["beside a dynamic route"], 200);
    assert_eq!(seen["home"], false);
    // `first/app/about/page.tsx` wins over `public/about`.
    assert_eq!(seen["about"], serde_json::json!([200, true, false]));
    // Never a file's bytes for a dotfile, PHP (as Windows would read `run.php.`, `run.php `,
    // `run.php::$DATA`, or in capitals), a path out of the folder, or a link that leaves it.
    for (path, answer) in seen["refused"].as_object().unwrap() {
        assert_eq!(answer, &serde_json::json!([true, false]), "{path}");
    }
    assert_eq!(seen["refused"].as_object().unwrap().len(), 15);
    assert_eq!(seen["head"], serde_json::json!([200, "", "11"]));
    // A matching ETag, its weak form, or one of a list: 304; another: 200.
    assert_eq!(seen["not modified"], serde_json::json!([304, 304, 304, 200]));
    assert_eq!(seen["svg policy"], true);
    assert_eq!(seen["cache"], "public, max-age=300");
    // A POST isn't served a file; the `[slug]` page answers it as pages do (405).
    assert_eq!(seen["post"], 405);
}

/// A docs section as a kind (docs/decisions/2026-11-13-docs-kind.md): a hierarchical collection
/// seeded from a folder of Markdown by a hosted compile, served by one catch-all page that reads
/// `nav`, `pager` and `headings` from "first/content", on WordPress over HTTP (tests/php/docs_kind.php).
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
        .arg(project.join("first/dist/wp-content"))
        .arg(compiled.join("seed"))
        .env("FIRST_WP_THEMES", "1")
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
            leaf("Introduction", "/docs/introduction"),
            branch(
                "Guides",
                "/docs/guides",
                serde_json::json!([
                    // Configure (setup.md, seeded after install.md) and Install share an order: by title.
                    leaf("Configure", "/docs/guides/setup"),
                    leaf("Install", "/docs/guides/install"),
                    branch(
                        "Deploy",
                        "/docs/guides/deploy",
                        serde_json::json!([leaf("To a Space", "/docs/guides/deploy/space")])
                    ),
                ])
            ),
            leaf("Reference", "/docs/reference"),
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
        (serde_json::json!([]), serde_json::json!(["Guides /docs/guides"]))
    );
    assert_eq!(
        ends("guides"),
        (
            serde_json::json!(["Introduction /docs/introduction"]),
            serde_json::json!(["Configure /docs/guides/setup"])
        )
    );
    assert_eq!(
        ends("install"),
        (
            serde_json::json!(["Configure /docs/guides/setup"]),
            serde_json::json!(["Deploy /docs/guides/deploy"])
        )
    );
    assert_eq!(
        ends("space"),
        (
            serde_json::json!(["Deploy /docs/guides/deploy"]),
            serde_json::json!(["Reference /docs/reference"])
        )
    );
    assert_eq!(
        ends("reference"),
        (
            serde_json::json!(["To a Space /docs/guides/deploy/space"]),
            serde_json::json!([])
        )
    );
    // headings(): `##` and `###`, with ids unique in the page, and the rendered headings carry them.
    assert_eq!(
        seen["introduction"]["toc"],
        serde_json::json!([
            "#why Why depth-2",
            "#small-print Small print depth-3",
            "#whats-firstapp What's first/app/? depth-3",
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
            "h3#whats-firstapp",
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
        serde_json::json!({ "Reference [current]": "/docs/guides/reference" })
    );
    assert_eq!(seen["moved old"], serde_json::json!([404]));
    // A published page under a draft is as hidden as the draft: its path names an unpublished page.
    assert_eq!(seen["under a draft"], serde_json::json!([404, 404]));
    // A WordPress Page with a doc's slug doesn't take over the doc's URL.
    assert_eq!(seen["page with a doc slug"], serde_json::json!([200, ["Introduction"]]));
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
                "#whats-firstapp What's first/app/? depth-3",
                "#why-1 Why depth-2",
                "#step-1---install Step 1 - Install depth-3",
                "#the---force-flag The --force flag depth-3",
                "#why-1-1 Why 1 depth-2",
                "#two--spaces Two spaces depth-2"
            ],
            [
                "h2#why",
                "h3#small-print",
                "h3#whats-firstapp",
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
    assert_eq!(code["titles"], serde_json::json!(["first.config.ts", "pnpm"]));
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
    assert_eq!(seen["code css"], serde_json::json!([200, true, true]));
    // Written back, each fence keeps its title, marked lines and group.
    assert_eq!(
        seen["code back"],
        "Edit the config.\n\n```ts title=\"first.config.ts\" {2}\nimport { defineConfig } from \"first\";\nexport default defineConfig({ name: \"docs\" });\n```\n\n```sh group=\"install\"\nnpm install first\n```\n\n```sh title=\"pnpm\" group=\"install\"\npnpm add first\n```\n\n```text\nplain <b>text</b>\n```\n"
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
    let dir = std::env::temp_dir().join(format!("first-docs-reject-{}", std::process::id()));
    let kind = |fields: &str, options: &str| {
        format!(
            "import {{ collection, table, text, slug, richText }} from \"first\";\nexport const docs = collection({{ title: text(), body: richText().optional(), {fields} }}, {{ content: \"body\", {options} }});\n"
        )
    };
    let cases = [
        (kind("slug: slug({ source: \"title\" })", "sync: \"content/docs/**/*.md\""), "a `**` sync pattern needs a hierarchical kind"),
        (kind("summary: text().optional()", "hierarchical: true, sync: \"content/docs/**/*.md\""), "a folder tree of files needs a slug field"),
        (kind("parent: text().optional()", "hierarchical: true"), "`parent` is reserved: hierarchical kinds add `parent` and `order`"),
        (kind("slug: slug({ source: \"title\" })", "url: \"/docs/:path\""), "`:path` in \"/docs/:path\" needs a hierarchical kind"),
        (
            "import { table, text } from \"first\";\nexport const docs = table({ title: text() }, { hierarchical: true });\n".to_string(),
            "only collection() kinds can be hierarchical",
        ),
    ];
    for (schema, message) in cases {
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("first")).unwrap();
        std::fs::write(
            dir.join("first.config.ts"),
            "import { defineConfig } from \"first\";\nexport default defineConfig({});\n",
        )
        .unwrap();
        std::fs::write(dir.join("first/schema.ts"), &schema).unwrap();
        let out = first().arg("check").arg(&dir).output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{message}: should fail:\n{stderr}");
        assert!(stderr.contains(message), "expected {message:?} in:\n{stderr}");
        assert!(stderr.contains("--> first/schema.ts:"), "{stderr}");
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
        std::fs::create_dir_all(dir.join("first")).unwrap();
        std::fs::write(
            dir.join("first.config.ts"),
            "import { defineConfig } from \"first\";\nexport default defineConfig({ name: \"docsreject\" });\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("first/schema.ts"),
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

/// A root catch-all answers every path of the app, and never one WordPress, First or the host
/// owns: on Spacefast `/__spacefast/connectors/*` and `/__spacefast/client.js` are the host's.
#[test]
fn a_root_catch_all_leaves_reserved_paths_alone() {
    let project = fixture("app-router-reserved", "serve");
    build(&project);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/app_router_reserved.php"))
        .arg(project.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
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
    for reserved in [
        "connector GET",
        "connector POST",
        "space client",
        "first",
        "zero",
        "rest",
    ] {
        assert_eq!(seen[reserved][1], "not the app", "{reserved}: {seen}");
    }
}

/// A component listed as a block must have props a Markdown tag can write, and the list must name
/// the file's own components; each refusal is at the component file.
#[test]
fn content_blocks_refuse_props_a_tag_cannot_write() {
    let dir = std::env::temp_dir().join(format!("first-blocks-reject-{}", std::process::id()));
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
        std::fs::create_dir_all(dir.join("first/components")).unwrap();
        std::fs::write(
            dir.join("first.config.ts"),
            "import { defineConfig } from \"first\";\nexport default defineConfig({});\n",
        )
        .unwrap();
        std::fs::write(dir.join("first/components/Card.tsx"), component).unwrap();
        let out = first().arg("check").arg(&dir).output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{message}: should fail:\n{stderr}");
        assert!(stderr.contains(message), "expected {message:?} in:\n{stderr}");
        assert!(stderr.contains("--> first/components/Card.tsx"), "{stderr}");
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
        .arg(project.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
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
        .arg(project.join("first/dist/wp-content"))
        .arg(compiled.join("seed"))
        .env("FIRST_WP_THEMES", "1")
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
    docs_read_as_published(&seen, &url, &url);
}

/// `first export` (docs/decisions/2026-11-13-static-output.md): examples/docs (`output: "static"`),
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
    let dist = project.join("first/dist/static");
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
    // `.first-export` marks the folder as an export, the only kind of folder a later export replaces.
    assert_eq!(
        pages,
        [
            ".first-export",
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
        "wp-content/plugins/first-runtime/first/Render/client/router.js",
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
    docs_read_as_published(&seen, &url, "https://docs.example.test");
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

/// `first export --site` (docs/decisions/2026-11-13-static-output.md): WordPress as the CMS somewhere
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
        .arg(project.join("first/dist/wp-content"))
        .arg("chief=editor")
        .env("FIRST_WP_THEMES", "1")
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
            .arg(format!("{site}/__first/api/v1{path}"))
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
            .env("FIRST_APP_PASSWORD", &editor)
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
    let dist = project.join("first/dist/static");
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
    let page = std::fs::read_to_string(project.join("first/app/page.tsx")).unwrap();
    std::fs::write(
        project.join("first/app/page.tsx"),
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
        "first.config.ts",
        "import { defineConfig } from \"first\";\nexport default defineConfig({ name: \"refused\", output: \"static\" });\n",
    );
    write(
        "first/actions.ts",
        "import { action } from \"first\";\nexport const ping = action({ input: {}, access: \"anyone\", async handler() { return 1; } });\n",
    );
    write(
        "first/components/Ping.tsx",
        "\"use client\";\nimport { useState } from \"first/client\";\nimport { ping } from \"../actions\";\nexport function Ping() { const [n, setN] = useState(0); return <button type=\"button\" onClick={async () => setN(await ping({}))}>{n}</button>; }\n",
    );
    write(
        "first/app/page.tsx",
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
        !project.join("first/dist/static").exists(),
        "a refused export writes nothing"
    );
    // A link to a page the export doesn't contain.
    write(
        "first/app/page.tsx",
        "import { Link } from \"first/app\";\nexport default function Home() { return <main><Link href=\"/elsewhere\">x</Link></main>; }\n",
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
        "first/app/page.tsx",
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
        "first/app/page.tsx",
        "import { redirect } from \"first/app\";\nexport default function Home() { redirect(\"/elsewhere\"); }\n",
    );
    let out = first().arg("export").arg(project).output().unwrap();
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "{stderr}");
    assert!(stderr.contains("/ (app//) redirects to"), "{stderr}");
    // --out never replaces the project, its sources, or a folder that isn't an export.
    for (out_dir, message) in [
        (project.to_path_buf(), "holds the project"),
        (project.join("first"), "is inside the project"),
        (project.join("first/dist"), "is where `first build` writes"),
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
    assert!(project.join("first.config.ts").is_file() && project.join("first/app").is_dir());
    // `output: "server"` is told what export is for.
    write(
        "first.config.ts",
        "import { defineConfig } from \"first\";\nexport default defineConfig({ name: \"refused\" });\n",
    );
    let out = first().arg("export").arg(project).output().unwrap();
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("set `output: \"static\"` in first.config.ts"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
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
/// `url` is where the browser read the site, `canonical` the address the pages name as their own.
fn docs_read_as_published(seen: &serde_json::Value, url: &str, canonical: &str) {
    assert_eq!(seen["errors"], serde_json::json!([]), "{seen}");
    // Home → the docs, by the reader's click; the doc has its title and the published tree.
    assert_eq!(seen["home"], "First docs");
    // The router region is processed as core processes a block theme's: core/router's state.url
    // comes from the server, follows a <Link> click that swapped the region in the same document,
    // and core's loading bar is in the footer with its styles.
    assert_eq!(seen["serverUrl"], format!("{canonical}/"), "{seen}");
    assert_eq!(
        seen["navigation"],
        serde_json::json!({
            "sameDocument": true,
            "url": format!("{url}/docs/introduction"),
            "loadingBar": [["core/router/private", "fixed"]]
        })
    );
    assert_eq!(
        seen["intro"],
        serde_json::json!({ "path": "/docs/introduction", "title": "Introduction · First docs", "h1": "Introduction" })
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
        serde_json::json!({ "path": "/docs/guides/install", "prev": "← Guides", "next": "Deploy →", "open": "Guides", "current": "Install" })
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
    // The only scripts are the router's (the layout's links); code and components need none.
    for script in seen["scripts"].as_array().unwrap() {
        let script = script.as_str().unwrap();
        assert!(
            script.contains("interactivity") || script.contains("router.js") || script.contains("a11y"),
            "{script}"
        );
    }
    // The draft is a 404 and in no tree; the Markdown page is a page.
    assert_eq!(seen["draft"], 404);
    assert_eq!(seen["draftInTree"], false);
    assert_eq!(seen["about"], serde_json::json!(["About · First docs", "First"]));
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

/// Issue #311: every read a `first/app/` page can make runs as the visitor, on WordPress over
/// HTTP. A collection whose read rule shows drafts to staff only, read through each path a page
/// has (tests/php/page_reads.php): a page's and a layout's `db.query`, the `"first:db"` kind API,
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
        .arg(project.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
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
        .arg(project.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
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
    for (route, path) in [("(site)/about", "/about"), ("/", "/"), ("notes", "/notes")] {
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
    assert_eq!(seen["canonical"], url("/notes"));
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
    assert_eq!(seen["menu"], serde_json::json!([url("/about")]));
    assert_eq!(seen["adopted"], true);
    // WordPress's own addresses for a code Page go to the route; a site's own Page is untouched.
    assert_eq!(seen["page_id redirect"], serde_json::json!([301, url("/about")]));
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
    let app = second.join("first/app");
    std::fs::create_dir_all(app.join("company")).unwrap();
    for page in ["about", "colophon"] {
        std::fs::rename(app.join(page), app.join("company").join(page)).unwrap();
    }
    build(&second);
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/route_ids.php"))
        .arg(first.join("first/dist/wp-content"))
        .arg(second.join("first/dist/wp-content"))
        .env("FIRST_WP_THEMES", "1")
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
        ("About", "/about", "/company/about"),
        ("Colophon", "/colophon", "/company/colophon"),
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
    let dir = std::env::temp_dir().join(format!("first-route-ids-{}", std::process::id()));
    let page =
        |id: &str| format!("export const route = {{ id: {id} }};\nexport default function P() {{ return <p/>; }}\n");
    rejects(
        &dir,
        &[
            ("first/app/a/page.tsx", &page("\"site.page\"")),
            ("first/app/b/page.tsx", &page("\"site.page\"")),
        ],
        "route id `site.page` is already app/a/page.tsx's",
        "first/app/b/page.tsx:1:14",
    );
    rejects(
        &dir,
        &[("first/app/a/page.tsx", &page("\"site page\""))],
        "`route` must be `{ id: \"…\" }` with a literal id",
        "first/app/a/page.tsx:1:14",
    );
    rejects(
        &dir,
        &[
            ("first/app/a/page.tsx", &page("\"site.page\"")),
            ("first/app/b/page.md", "---\nid: site.page\ntitle: B\n---\n\nText.\n"),
        ],
        "id `site.page` is already app/a/page.tsx's",
        "first/app/b/page.md:2:",
    );
    let _ = std::fs::remove_dir_all(&dir);
}
