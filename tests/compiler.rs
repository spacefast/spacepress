//! Runs the real `first` binary. Rejections are checked by message and
//! location; the pantry example is built, served with `php -S`, and driven
//! over HTTP so hooks and actions are proven by their effects in PHP.

// Runs the `first` binary: only with the cli feature (the browser build of the core has none).
#![cfg(feature = "cli")]

use std::io::{BufRead, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

fn first() -> Command {
    Command::new(env!("CARGO_BIN_EXE_first"))
}

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// `first check` on a fixture must fail with `message` at `file:line`.
fn rejects(fixture: &str, message: &str, at: &str) {
    let out = first()
        .args(["check"])
        .arg(root().join("tests/fixtures").join(fixture))
        .output()
        .expect("run first");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert_eq!(out.status.code(), Some(1), "{fixture} should fail, got:\n{stderr}");
    assert!(
        stderr.contains(message),
        "{fixture}: expected {message:?} in:\n{stderr}"
    );
    assert!(
        stderr.contains(&format!("--> {at}")),
        "{fixture}: expected location {at} in:\n{stderr}"
    );
}

#[test]
fn rejects_code_outside_the_subset_with_a_location_and_fix() {
    rejects(
        "reject-class",
        "abstract, ambient or generic classes",
        "first.config.ts:2:1",
    );
    rejects(
        "reject-uninstalled-package",
        "can't import \"dayjs\": package is not installed in node_modules",
        "first.config.ts:1:1",
    );
    rejects(
        "reject-build-time-clock",
        "`Date.now()` isn't available while the config is evaluated",
        "first.config.ts:2:11",
    );
    rejects("reject-infinite-loop", "step budget exceeded", "first.config.ts:2:");
    // App code loads only from first/ (F1210): here a module inside first/ reaches back out.
    rejects(
        "reject-import-fence",
        "first/tags.ts imports \"../lib/prefix\" (lib/prefix.ts), which is outside first/",
        "first/tags.ts:2:1",
    );
    // Export names are unique across the app (F1221): an action named like a kind.
    rejects(
        "reject-duplicate-export",
        "`notes` names two things: at first/a.ts:2 and here",
        "first/b.ts:3:22",
    );
    // "first:db" names only registered kinds, and suggests the closest one.
    rejects(
        "reject-db-unknown",
        "\"first:db\" has no kind named `note`",
        "first/app.ts:2:10",
    );
    // ... in first/wp-hooks/ modules too, which load after every kind has registered.
    rejects(
        "reject-wp-hook-db-unknown",
        "\"first:db\" has no kind named `note`",
        "first/wp-hooks/the_title.ts:2:10",
    );
    // An exported name is unique across the app: an action listed under it is refused too.
    rejects(
        "reject-action-named-like-table",
        "`notes` names two things: at first.config.ts:3 and here",
        "first/schema.ts:2:22",
    );
    // "first:db" is imported where it's used, never re-exported (a barrel, or a plugin handing on
    // the app's kinds): refused at the statement, not a crash.
    rejects(
        "reject-db-reexport",
        "\"first:db\" can't be re-exported",
        "first/kinds.ts:4:1",
    );
    // ... and from a plugin, whose fix is to take the kinds as options.
    rejects(
        "reject-plugin-db-reexport",
        "a plugin takes the app's kinds as options",
        "node_modules/first-plugin-reach/src/index.ts:3:1",
    );
    // A default export has no name to register under.
    rejects(
        "reject-default-export-kind",
        "a kind, action or job can't be a default export",
        "first/notes.ts:3:16",
    );
    // wp-hooks/ beside first.config.ts is from before first/wp-hooks/: refused, never dropped.
    rejects(
        "reject-wp-hooks-root",
        "wp-hooks/ beside first.config.ts is from an earlier layout; its handlers would not register",
        "wp-hooks:1:1",
    );
}

/// The field forms the authoring surface replaced are refused where they're written, naming the
/// replacement (docs/spec/spec.md §2.5, §8).
#[test]
fn replaced_field_forms_name_their_replacement() {
    for (fixture, message, at) in [
        (
            "reject-not-null",
            "`.notNull()` is gone: fields are required by default",
            "first.config.ts:2:37",
        ),
        (
            "reject-id-builder",
            "`id()` is gone: every kind already has an integer `id`",
            "first.config.ts:2:27",
        ),
        (
            "reject-authored-id",
            "`id` is built in: every kind has an integer `id`",
            "first.config.ts:2:27",
        ),
        ("reject-real", "`real()` is now `number()`", "first.config.ts:2:30"),
        (
            "reject-type-annotation",
            "`json().$type<T>()` is now `json<T>()`",
            "first.config.ts:2:36",
        ),
        (
            "reject-function-default",
            "`.default()` takes a literal value, not a function",
            "first.config.ts:2:46",
        ),
        (
            "reject-select-options",
            "select() takes its options as an array",
            "first.config.ts:2:29",
        ),
        (
            "reject-text-enum",
            "`text({ enum })` is now `select([...])`",
            "first.config.ts:2:42",
        ),
        (
            "reject-group-wrapper",
            "group() takes its fields directly, without the `{ fields }` wrapper",
            "first.config.ts:2:28",
        ),
        (
            "reject-many-text",
            "`.many()` isn't valid on a text column",
            "first.config.ts:2:37",
        ),
        (
            "reject-define-relations",
            "`defineRelations()` is gone: a reference is a field",
            "first.config.ts:3:26",
        ),
        (
            "reject-relations-key",
            "`relations` is gone: a reference is a field",
            "first.config.ts:3:66",
        ),
        (
            "reject-references",
            "`.references()` is gone: a reference is a `ref()` field",
            "first.config.ts:3:40",
        ),
        (
            "reject-ref-set-null",
            "`noteId` is required, so deleting what it refers to can't set it to null",
            "first/schema.ts:3:48",
        ),
        (
            "reject-ref-reverse-clash",
            "`noteId` gives \"notes\" a reverse list named `tags`, which \"notes\" already has",
            "first/schema.ts:3:37",
        ),
        (
            "reject-ref-target",
            "ref() takes a kind, not \"notes\"",
            "first/schema.ts:2:37",
        ),
    ] {
        rejects(fixture, message, at);
    }
}

/// JSX outside the subset fails the build at its source, saying what to write instead
/// (docs/decisions/2026-11-08-tsx-to-php.md, "Errors").
#[test]
fn rejects_jsx_outside_the_subset_with_a_location_and_fix() {
    rejects(
        "reject-jsx-unsafe-url",
        "`href` is an unsafe URL",
        "first/components/Link.tsx:2:18",
    );
    rejects(
        "reject-jsx-handler",
        "server components can't handle events (`onClick`)",
        "first/components/Button.tsx:2:18",
    );
    rejects(
        "reject-jsx-inner-html",
        "`dangerouslySetInnerHTML` isn't supported",
        "first/components/Raw.tsx:2:15",
    );
    rejects(
        "reject-jsx-object-child",
        "{ title: string } can't be rendered as a JSX child",
        "first/components/Show.tsx:2:14",
    );
    rejects(
        "reject-jsx-props",
        "these props are { text: number }, but the component expects { text: string }",
        "first/components/Card.tsx:6:10",
    );
    rejects(
        "reject-jsx-head",
        "a component can't render `<title>`",
        "first/components/Head.tsx:2:10",
    );
    rejects(
        "reject-jsx-config",
        "JSX files can't be part of a First config",
        "first/lib/view.tsx:1:1",
    );
    // An action can't return rendered JSX: the config never reaches a component module.
    rejects(
        "reject-jsx-action",
        "JSX files can't be part of a First config",
        "first/components/Badge.tsx:1:1",
    );
    rejects(
        "reject-jsx-textarea",
        "`<textarea>` can't have children",
        "first/components/Area.tsx:2:10",
    );
    rejects(
        "reject-jsx-srcdoc",
        "`srcDoc` isn't supported",
        "first/components/Frame.tsx:2:18",
    );
    // The record's "Contexts text escaping can't make safe": tag and attribute names in any case,
    // raw-text tags, closed and open spreads, computed styles, names, SVG animation.
    rejects(
        "reject-jsx-script-case",
        "a component can't render `<sCript>`",
        "first/components/Search.tsx:2:15",
    );
    rejects(
        "reject-jsx-iframe-child",
        "`<iframe>` takes only literal text",
        "first/components/Frame.tsx:2:19",
    );
    rejects(
        "reject-jsx-raw-close",
        "this text closes `<xmp>` early",
        "first/components/Code.tsx:2:16",
    );
    rejects(
        "reject-jsx-open-spread",
        "can't spread Record<string, string> into attributes",
        "first/components/Link.tsx:2:17",
    );
    rejects(
        "reject-jsx-spread-handler",
        "server components can't handle events (`onClick`)",
        "first/components/Button.tsx:2:22",
    );
    rejects(
        "reject-jsx-style-keys",
        "`style` needs an object with fixed keys",
        "first/components/Box.tsx:2:22",
    );
    rejects(
        "reject-jsx-attribute-name",
        "`a b` isn't a valid attribute name",
        "first/components/Odd.tsx:2:19",
    );
    rejects(
        "reject-jsx-svg-animate",
        "SVG animation of `href`",
        "first/components/Anim.tsx:2:27",
    );
    rejects(
        "reject-jsx-children-object",
        "`children` is typed { title: string }, which JSX can't pass",
        "first/components/Wrap.tsx:1:22",
    );
    rejects(
        "reject-jsx-config-unused",
        "JSX files can't be part of a First config",
        "first/lib/label.tsx:1:1",
    );
    rejects(
        "reject-jsx-style-case",
        "`STYLE` is spelled `style`",
        "first/components/Box.tsx:2:15",
    );
    rejects(
        "reject-jsx-style-case-spread",
        "`STYLE` is spelled `style`",
        "first/components/Box.tsx:2:19",
    );
    rejects(
        "reject-jsx-style-case-custom",
        "`Style` is spelled `style`",
        "first/components/Widget.tsx:2:17",
    );
    rejects(
        "reject-jsx-children-local",
        "this component types `children` as { title: string }, which JSX can't pass",
        "first/components/Page.tsx:6:11",
    );
    // The folders that admit JSX are matched below the project, not anywhere in its path.
    let nested = std::env::temp_dir().join(format!("first-jsx-app-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&nested);
    copy(
        &root().join("tests/fixtures/reject-jsx-config"),
        &nested.join("app/project"),
    );
    let out = first()
        .args(["check"])
        .arg(nested.join("app/project"))
        .output()
        .unwrap();
    let _ = std::fs::remove_dir_all(&nested);
    assert_eq!(out.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&out.stderr).contains("JSX files can't be part of a First config"));
}

#[test]
fn destructured_defaults_may_read_earlier_siblings_only() {
    let out = first()
        .args(["check"])
        .arg(root().join("tests/fixtures/sibling-parameter-defaults"))
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    rejects(
        "reject-later-sibling-default",
        "parameter defaults can't reference the current or a later parameter",
        "first.config.ts:3:",
    );
}

#[test]
fn mail_send_needs_recipients_a_subject_and_a_body() {
    rejects(
        "reject-mail-message",
        "mail.send() needs { to, subject, text or html }",
        "first.config.ts:3:",
    );
    let out = first()
        .args(["check"])
        .arg(root().join("tests/fixtures/mail-import"))
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
}

#[test]
fn rejects_schema_mistakes_against_the_evaluated_config() {
    rejects(
        "reject-hook-typo",
        "there's no hook called `beforeCreat`",
        "first.config.ts:3:",
    );
    // §1.2: modifiers per column kind, pointing at the modifier call.
    rejects(
        "reject-modifier-kind",
        "`.max()` isn't valid on a boolean column",
        "first.config.ts:2:35",
    );
    // §1.3: sub-fields hold plain values.
    rejects(
        "reject-subfield-unique",
        "`.unique()` isn't allowed inside a group, repeater, or blocks field (`code`)",
        "first.config.ts:2:46",
    );
    // §1.4: what an editor (post-backed) collection needs, and the names WordPress can't hold.
    rejects(
        "reject-editor-no-title",
        "editor collection \"notes\" has no title",
        "first.config.ts:2:15",
    );
    // Storage is chosen only by the builder: a collection can't ask for a table.
    rejects(
        "reject-collection-editor-false",
        "collection() has no option `editor`",
        "first.config.ts:2:60",
    );
    rejects(
        "reject-collection-editor-false",
        "help: storage follows the builder: collection() is always WordPress posts; use table() for a SQL table",
        "first.config.ts:2:60",
    );
    // On table() the same option gets its own builder's name and fix.
    rejects(
        "reject-table-editor-false",
        "table() has no option `editor`",
        "first.config.ts:2:55",
    );
    rejects(
        "reject-table-editor-false",
        "help: storage follows the builder: table() is always a SQL table; remove the option",
        "first.config.ts:2:55",
    );
    rejects("reject-reserved-name", "\"media\" is reserved", "first.config.ts:2:15");
    rejects("reject-reserved-files", "\"files\" is reserved", "first.config.ts:2:15");
    rejects(
        "reject-reserved-search",
        "\"search\" is reserved",
        "first.config.ts:2:16",
    );
    rejects(
        "reject-post-type-length",
        "WordPress post types are limited to 20 characters and First prefixes `first_`",
        "first.config.ts:2:18",
    );
    rejects(
        "reject-unique-length",
        "unique text columns are limited to 191 characters on MySQL (`code`); add `.max(191)`",
        "first.config.ts:2:32",
    );
    rejects(
        "reject-drafts-reserved",
        "`status` is reserved: drafts add these",
        "first.config.ts:2:51",
    );
    // §1.5
    rejects(
        "reject-global-required",
        "a global field is required unless it has a default (`title`)",
        "first.config.ts:3:38",
    );
    // Literal defaults follow the strict ISO timestamp codec, inside structured columns too.
    rejects(
        "reject-default-timestamp",
        "`when` defaults to a `at` value that isn't a real ISO 8601 date or timestamp",
        "first.config.ts:4:",
    );
    // Each case owns a separate registry invariant, exercised through the compiler.
    let tmp = tempfile::tempdir().unwrap();
    for (body, message) in [
        (
            "collections: { notes: table({ title: text() }) }",
            "table() belongs in `tables`",
        ),
        (
            "collections: { notes: collection({ title: text() }) }, tables: { notes: table({}) }",
            "share the physical name `notes`",
        ),
        (
            "collections: { stockItems: collection({ title: text() }) }, tables: { stock_items: table({}) }",
            "share the physical name `stock_items`",
        ),
        (
            "tables: { first: shared, second: shared }",
            "a definition can only be registered once",
        ),
        (
            "tables: { notes: table({}, { storageName: 'bad-name' }) }",
            "`storageName` must be an identifier",
        ),
        (
            "tables: { notes: table({}, { storageName: 'media' }) }",
            "\"media\" is reserved",
        ),
        (
            "tables: { media: table({}, { storageName: 'assets' }) }",
            "\"media\" is reserved",
        ),
        (
            "collections: { services: collection({ title: text() }) }",
            "\"services\" is reserved",
        ),
        (
            "tables: { notes: table({}, { storageName: 'existing' }), other: table({}, { storageName: 'existing' }) }",
            "share the physical name `existing`",
        ),
        (
            "collections: { notes: collection({ title: text() }) }, tables: { notes: table({}, { storageName: 'other' }) }",
            "duplicate logical registration `notes`",
        ),
        (
            "globals: { status: global('status', { label: text().default('Ready').optional() }) }",
            "\"status\" is reserved by generated client types",
        ),
        (
            "globals: { user: global('user', { label: text().default('Ready').optional() }) }",
            "\"user\" is reserved by generated client types",
        ),
        (
            "globals: { record: global('record', { label: text().default('Ready').optional() }) }",
            "\"record\" is reserved by generated client types",
        ),
        (
            "globals: { client: global('client', { label: text().default('Ready').optional() }) }",
            "\"client\" is reserved by generated client types",
        ),
        (
            "globals: { extract: global('extract', { label: text().default('Ready').optional() }) }",
            "\"extract\" is reserved by generated client types",
        ),
        ("tables: []", "`tables` must be an object"),
        (
            "tables: { notes: table({}), notes: table({}) }",
            "duplicate registration `tables.notes`",
        ),
        ("tables: {}, tables: {}", "duplicate `tables` registry"),
        (
            "uploads: { backend: 's3', bucket: 'uploads', credentials: { accessKeyId: 'literal', secretAccessKey: 'literal' } }",
            "must be env(",
        ),
        (
            "uploads: { backend: 's3', bucket: 'uploads' }",
            "need runtime credentials",
        ),
        ("uploads: { backend: 'local', bucket: 'uploads' }", "has no option"),
        (
            "collections: { notes: collection({ title: text() }, { revisions: false }) }",
            "collections always have native revisions",
        ),
        (
            "tables: { notes: table({ title: text().optional() }, { comments: true }) }",
            "only collection() kinds take comments",
        ),
        (
            "tables: { notes: table({ title: text().optional() }, { staged: true }) }",
            "only collection() kinds have staged versions",
        ),
        (
            "collections: { notes: collection({ title: text() }, { staged: 1 }) }",
            "`staged` must be true or false",
        ),
        (
            "collections: { notes: collection({ title: text() }), notesStaged: collection({ title: text() }) }",
            "ability kebab collision: notes-staged-get",
        ),
        (
            "collections: { notes: collection({ title: text() }, { comments: 'yes' }) }",
            "`comments` must be true or false",
        ),
    ] {
        std::fs::write(tmp.path().join("first.config.ts"), format!(
            "import {{ collection, table, global, text, defineConfig }} from 'first'; const shared = table({{}}); export default defineConfig({{ {body} }});"
        )).unwrap();
        let checked = first().arg("check").arg(tmp.path()).output().unwrap();
        assert_eq!(checked.status.code(), Some(1));
        assert!(
            String::from_utf8_lossy(&checked.stderr).contains(message),
            "{}",
            String::from_utf8_lossy(&checked.stderr)
        );
        assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 1);
    }
}

#[test]
fn rejects_hooks_that_would_misbehave_in_php() {
    rejects(
        "reject-filter-column",
        "\"a\" has no column or relation `nmae`",
        "first.config.ts:5:",
    );
    rejects(
        "reject-ambiguous-plus",
        "`+` between number and unknown | null is ambiguous",
        "first.config.ts:3:",
    );
    rejects(
        "reject-missing-await",
        "this database call never runs",
        "first.config.ts:5:",
    );
    rejects(
        "reject-module-state",
        "hooks can't change `count`",
        "first.config.ts:4:",
    );
    rejects(
        "reject-maybe-null",
        "can't read `length`: this might be null",
        "first.config.ts:3:",
    );
    rejects(
        "reject-missing-insert-field",
        "missing required field `x`",
        "first.config.ts:5:",
    );
    // §3.5: literal filters use the runtime's operator rules and its exact message.
    rejects(
        "reject-list-operator",
        "`in` isn't supported on list columns; use `has`",
        "first.config.ts:5:",
    );
    // A structured field of a collection is spread over post meta and can't be compared. The fix
    // names table(), where the same filter compiles; storage is never an option of collection().
    rejects(
        "reject-collection-group-filter",
        "use isNull/isNotNull, or keep this data in a table()",
        "first.config.ts:5:95",
    );
    // db.globals is typed from the global's fields, like db.query from a collection's.
    rejects(
        "reject-db-globals-key",
        "`db.globals.setings` doesn't match a global in `globals`",
        "first.config.ts:4:",
    );
    rejects(
        "reject-db-globals-patch",
        "`stats` must be { visits: number } | null | undefined, not number",
        "first.config.ts:4:",
    );
}

/// `db.globals.<key>` in compiled code: never-written defaults, then a typed JSON field round-trips.
#[test]
fn db_globals_read_defaults_and_write_typed_fields() {
    let tmp = std::env::temp_dir().join(format!("first-db-globals-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures/db-globals"), &tmp);
    let built = first().arg("build").arg(&tmp).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    // One site, three trusted CLI actions in a row (the global's first write, its second, a json filter).
    let out = wp_eval_json(
        &tmp.join("first/dist/wp-content"),
        r#"$run = static fn (string $name) => json_decode($app->cli(['action', $name])[1], true);
           echo json_encode([$run('visit'), $run('visit'), $run('emptyMeta')]);"#,
        &serde_json::Value::Null,
    );
    assert_eq!(
        out,
        serde_json::json!([
            { "data": ["Hi", null, 1] },
            { "data": ["Hi", { "visits": 1 }, 2] },
            { "data": ["{}"] },
        ])
    );
    let _ = std::fs::remove_dir_all(tmp);
}

/// A handler's `ctx` and a route's `req` are values: helpers typed with the `"first"` context types
/// take them, return them and read static keys, in compiled PHP as a signed-in user and a guest.
#[test]
fn context_values_pass_through_typed_helpers() {
    let tmp = std::env::temp_dir().join(format!("first-context-helpers-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures/context-helpers"), &tmp);
    let built = first().arg("build").arg(&tmp).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    let out = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("eval")
        .arg(tmp.join("first/dist/wp-content"))
        .arg(
            r#"// first/app/echo/route.ts, matched the way the app router matches it.
               $file = $wp->plugin()->schema->app()["files"]["app/echo/route.ts"];
               $route = ["name" => "echo", "params" => [], "route" => ["handler" => $file["methods"]["POST"], "access" => $file["access"], "signature" => null]];
               // req.url and req.query as the WordPress transport builds them: 0.8's form, with every
               // share-link secret redacted and the share parameter kept out of the query.
               $at = fn (string $host, string $uri) => json_decode($app->serveRoute($route, "POST", "/echo",
                   \First\Wp\RouteRequest::query((string) parse_url($uri, PHP_URL_QUERY)), "", [], null,
                   \First\Wp\RouteRequest::url($host, $uri))[2], true);
               $urls = [
                 $at("Site.Example.:8443", "/echo?a=1&__=secret&b=2"),
                 $at("site.example", "/echo?token=t1&purchaseToken=p1&tokens=kept"),
                 $at("site.example", "/__/secret/echo"),
                 $at("site.example", "/__/collab?x=1"),
                 $at("[::1]:8080", "/echo"),
               ];
               [, $headers, $echo] = $app->serveRoute($route, "POST", "/echo", "", "raw body", [], $wp->user("ada"), "https://site.example/echo");
               echo json_encode([
                 "id" => $wp->userId("ada"),
                 "signedIn" => $wp->call("POST", "/actions/whoami", "{}", "ada")[1],
                 "guest" => $wp->call("POST", "/actions/whoami", "{}")[1],
                 "note" => $wp->call("POST", "/actions/note", ["body" => "x"], "ada")[1],
                 "echo" => json_decode($echo, true),
                 "urls" => array_map(fn ($r) => [$r["url"], $r["share"]], $urls),
               ]);"#,
        )
        .arg("null")
        .arg("ada=editor")
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(out.status.success(), "{text}{}", String::from_utf8_lossy(&out.stderr));
    let got: serde_json::Value = serde_json::from_str(text.lines().next_back().unwrap_or("")).unwrap();
    let ada = format!("ada#{}", got["id"]);
    assert_eq!(
        got,
        serde_json::json!({
            "id": got["id"],
            "signedIn": { "label": ada, "role": "editor", "anonymous": false, "viaIndex": false },
            "guest": { "label": "guest", "role": "guest", "anonymous": true, "viaIndex": true },
            "note": [ada],
            "echo": { "method": "POST", "url": "https://site.example/echo", "share": false, "path": "/echo", "body": "raw body", "role": "editor" },
            "urls": [
                ["https://site.example/echo?a=1&__=[redacted]&b=2", false],
                ["https://site.example/echo?token=[redacted]&purchaseToken=[redacted]&tokens=kept", false],
                ["https://site.example/__/[redacted]/echo", false],
                ["https://site.example/__/collab?x=1", false],
                ["https://[::1]/echo", false],
            ],
        })
    );
    // Only a key no type can bound is refused, with the fix.
    std::fs::write(
        tmp.join("first.config.ts"),
        std::fs::read_to_string(tmp.join("first.config.ts")).unwrap().replace(
            r#"viaIndex: ctx["user"] === null"#,
            "viaIndex: ctx[String(_input)] === null",
        ),
    )
    .unwrap();
    let refused = first().arg("check").arg(&tmp).output().unwrap();
    let stderr = String::from_utf8_lossy(&refused.stderr);
    assert_eq!(refused.status.code(), Some(1), "{stderr}");
    assert!(
        stderr.contains("dynamic keys on an object need a finite key union"),
        "{stderr}"
    );
    assert!(stderr.contains("help: use `keyof` on a finite object"), "{stderr}");
    let _ = std::fs::remove_dir_all(tmp);
}

/// §1.6: access rules are compiled like hooks, but return a boolean or a filter on the collection.
#[test]
fn rejects_access_rules_that_cant_hold() {
    rejects(
        "reject-access-create-filter",
        "create rules return a boolean",
        "first.config.ts:3:31",
    );
    rejects(
        "reject-access-query",
        "access rules can't query; put that in a hook",
        "first.config.ts:3:41",
    );
    rejects(
        "reject-access-filter-column",
        "\"posts\" has no column or relation `ownr`",
        "first.config.ts:3:39",
    );
}

/// A fresh WordPress on SQLite with a built `wp-content` installed, served by `php -S`
/// (`php tests/php/wp.php serve`): the site a client and `first sync` talk to.
struct Server {
    child: Child,
    port: u16,
    /// Credentials by user name: `user:application password`.
    users: serde_json::Value,
    /// The user whose credential goes with every request (writes default to `"editor"` access).
    as_user: Option<String>,
    /// The site directory.
    dir: String,
}

impl Drop for Server {
    fn drop(&mut self) {
        // SIGTERM lets the server remove its site directory.
        let _ = Command::new("kill").arg(self.child.id().to_string()).output();
        let _ = self.child.wait();
    }
}

impl Server {
    fn start(wp_content: &Path, users: &[&str]) -> Server {
        let mut child = Command::new("php")
            .args(["-d", "memory_limit=512M"])
            .arg(root().join("tests/php/wp.php"))
            .arg("serve")
            .arg(wp_content)
            .args(users)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("php");
        let mut line = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .expect("the served site's description");
        let served: serde_json::Value = serde_json::from_str(&line).unwrap_or_else(|_| panic!("serve: {line}"));
        let port: u16 = served["url"]
            .as_str()
            .unwrap()
            .rsplit(':')
            .next()
            .unwrap()
            .parse()
            .unwrap();
        Server {
            child,
            port,
            users: served["users"].clone(),
            as_user: None,
            dir: served["dir"].as_str().unwrap().to_string(),
        }
    }

    fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn credential(&self, name: &str) -> String {
        self.users[name]["appPassword"].as_str().unwrap().to_string()
    }

    /// Returns (status, body) for a request to First's API (/__first/api/v1).
    fn send(&self, method: &str, path: &str, body: Option<&str>) -> (u16, serde_json::Value) {
        let mut s = TcpStream::connect(("127.0.0.1", self.port)).unwrap();
        let body = body.unwrap_or("");
        // One write: php -S rejects requests whose head arrives in pieces.
        let auth = self
            .as_user
            .as_ref()
            .map(|u| format!("Authorization: Basic {}\r\n", base64(self.credential(u).as_bytes())))
            .unwrap_or_default();
        let request = format!(
            "{method} /__first/api/v1{path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n{auth}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        s.write_all(request.as_bytes()).unwrap();
        let mut raw = String::new();
        s.read_to_string(&mut raw).unwrap();
        let status: u16 = raw
            .get(9..12)
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| panic!("bad response to {method} {path}: {raw:?}"));
        let json = raw.split_once("\r\n\r\n").map(|(_, b)| b).unwrap_or("");
        (status, serde_json::from_str(json).unwrap_or(serde_json::Value::Null))
    }
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().fold(0u32, |acc, b| (acc << 8) | *b as u32) << (8 * (3 - chunk.len()));
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Run PHP on a fresh WordPress-on-SQLite site with the built wp-content active (`$app`, `$wp`,
/// `$arg` bound; see tests/php/wp.php `eval`); returns stdout.
fn wp_eval(wp_content: &Path, code: &str, arg: &serde_json::Value) -> std::process::Output {
    Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("eval")
        .arg(wp_content)
        .arg(code)
        .arg(arg.to_string())
        .output()
        .unwrap()
}

/// The last JSON line of a `wp_eval` run (WordPress's early notices go to stderr, not here).
fn wp_eval_json(wp_content: &Path, code: &str, arg: &serde_json::Value) -> serde_json::Value {
    let out = wp_eval(wp_content, code, arg);
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout);
    serde_json::from_str(text.lines().next_back().unwrap_or("")).unwrap_or_else(|_| panic!("{text}"))
}

#[test]
fn pantry_example_builds_and_its_hooks_run_in_php() {
    let tmp = std::env::temp_dir().join(format!("first-pantry-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let project = tmp.join("pantry");
    copy(&root().join("examples/pantry"), &project);
    let _ = std::fs::remove_dir_all(project.join(".first"));
    let _ = std::fs::remove_dir_all(project.join("first/_generated"));

    let out = first().arg("build").arg(&project).output().unwrap();
    assert!(
        out.status.success(),
        "build failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let init = std::fs::read_to_string(project.join("first/_generated/migrations/0001_init.sql")).unwrap();
    assert!(init.contains("CREATE TABLE `{prefix}first_items`"), "{init}");
    // A second build with no changes adds no migration.
    let again = first().arg("build").arg(&project).output().unwrap();
    assert!(again.status.success());
    assert!(!project.join("first/_generated/migrations/0002_update.sql").exists());
    for example in ["pantry", "blog", "site"] {
        let stored: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root().join(format!("examples/{example}/first/_generated/migrations/snapshot.json")))
                .unwrap(),
        )
        .unwrap();
        let persisted = tmp.join(format!("preserved-{example}"));
        copy(&root().join(format!("examples/{example}")), &persisted);
        let result = first().arg("build").arg(&persisted).output().unwrap();
        assert!(
            result.status.success(),
            "{example}: {}",
            String::from_utf8_lossy(&result.stderr)
        );
        let actual: serde_json::Value = serde_json::from_slice(
            &std::fs::read(persisted.join("first/_generated/migrations/snapshot.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            actual, stored,
            "{example}: the authoring change must preserve stored resources"
        );
        let migrations = std::fs::read_dir(persisted.join("first/_generated/migrations"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|e| e == "sql"))
            .count();
        let original = std::fs::read_dir(root().join(format!("examples/{example}/first/_generated/migrations")))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|e| e == "sql"))
            .count();
        assert_eq!(
            migrations, original,
            "{example}: no new SQL for an authoring-only change"
        );
    }
    // Main-built storage, including FK targets and revision storage, survives the authoring cut.
    let upgraded = tmp.join("storage-upgrade");
    let fixture = root().join("tests/fixtures/storage-upgrade");
    copy(&fixture, &upgraded);
    let built = first().arg("build").arg(&upgraded).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    for file in ["snapshot.json", "0001_init.sql"] {
        assert_eq!(
            std::fs::read(upgraded.join("first/_generated/migrations").join(file)).unwrap(),
            std::fs::read(fixture.join("first/_generated/migrations").join(file)).unwrap(),
            "the historical ledger must remain unchanged"
        );
    }
    assert_eq!(
        std::fs::read_dir(upgraded.join("first/_generated/migrations"))
            .unwrap()
            .count(),
        2
    );

    // Neither camel-case names nor canonical names behind aliases may be silently replaced.
    let conflict = tmp.join("name-conflict");
    std::fs::create_dir_all(&conflict).unwrap();
    std::fs::write(conflict.join("first.config.ts"), "import { table, defineConfig } from 'first'; export default defineConfig({ tables: { stockItems: table({}) } });").unwrap();
    let built = first().arg("build").arg(&conflict).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    let ledger = conflict.join("first/_generated/migrations/snapshot.json");
    let canonical: serde_json::Value = serde_json::from_slice(&std::fs::read(&ledger).unwrap()).unwrap();
    for stored_name in ["stockItems", "inventory"] {
        let mut legacy = canonical.clone();
        let tables = legacy["tables"].as_object_mut().unwrap();
        let stored = tables.remove("stock_items").unwrap();
        tables.insert(stored_name.into(), stored);
        let legacy_bytes = serde_json::to_vec(&legacy).unwrap();
        std::fs::write(&ledger, &legacy_bytes).unwrap();
        let refused = first().arg("build").arg(&conflict).output().unwrap();
        assert_eq!(refused.status.code(), Some(1));
        let error = String::from_utf8_lossy(&refused.stderr);
        assert!(error.contains(&format!("stored resource `{stored_name}`")), "{error}");
        assert!(
            error.contains("an authoring change cannot rename persisted storage"),
            "{error}"
        );
        assert_eq!(std::fs::read(&ledger).unwrap(), legacy_bytes);
        assert_eq!(
            std::fs::read_dir(conflict.join("first/_generated/migrations"))
                .unwrap()
                .count(),
            2
        );
        std::fs::write(conflict.join("first.config.ts"), format!("import {{ table, defineConfig }} from 'first'; export default defineConfig({{ tables: {{ stockItems: table({{}}, {{ storageName: \"{stored_name}\" }}) }} }});")).unwrap();
        let preserved = first().arg("build").arg(&conflict).output().unwrap();
        assert!(
            preserved.status.success(),
            "{}",
            String::from_utf8_lossy(&preserved.stderr)
        );
        let actual: serde_json::Value = serde_json::from_slice(&std::fs::read(&ledger).unwrap()).unwrap();
        assert_eq!(actual, legacy);
        assert_eq!(
            std::fs::read_dir(conflict.join("first/_generated/migrations"))
                .unwrap()
                .count(),
            2
        );
        std::fs::write(conflict.join("first.config.ts"), "import { table, defineConfig } from 'first'; export default defineConfig({ tables: { stockItems: table({}) } });").unwrap();
    }
    // Physical-only siblings do not establish who owned the retained resource.
    let mut siblings = canonical.clone();
    siblings["tables"]["stockItems"] = canonical["tables"]["stock_items"].clone();
    let sibling_bytes = serde_json::to_vec(&siblings).unwrap();
    std::fs::write(&ledger, &sibling_bytes).unwrap();
    let refused = first().arg("build").arg(&conflict).output().unwrap();
    assert_eq!(
        refused.status.code(),
        Some(1),
        "{}",
        String::from_utf8_lossy(&refused.stderr)
    );
    let error = String::from_utf8_lossy(&refused.stderr);
    assert!(
        error.contains("stored resource `stockItems` conflicts with canonical physical name `stock_items`"),
        "{error}"
    );
    assert_eq!(std::fs::read(&ledger).unwrap(), sibling_bytes);
    assert_eq!(
        std::fs::read_dir(conflict.join("first/_generated/migrations"))
            .unwrap()
            .count(),
        2
    );

    // Writes default to editor access: the site's editor signs in with an application password.
    let content = project.join("first/dist/wp-content");
    let mut server = Server::start(&content, &["kim=editor"]);
    let (s, denied) = server.send("POST", "/locations", Some(r#"{"name":"Shed"}"#));
    assert_eq!((s, denied["code"].as_str()), (401, Some("unauthenticated")));
    server.as_user = Some("kim".into());

    let (s, loc) = server.send("POST", "/locations", Some(r#"{"name":"Fridge","kind":"fridge"}"#));
    assert_eq!(s, 201, "{loc}");
    let loc_id = loc["data"]["id"].as_i64().unwrap();

    // beforeCreate trims, slugifies, and lowercases tags; afterCreate leaves well-stocked items alone.
    let (s, milk) = server.send(
        "POST",
        "/items",
        Some(&format!(r#"{{"name":"  Oat Milk ","quantity":2,"unit":"l","locationId":{loc_id},"expiresOn":"2000-01-01","tags":["Dairy-Free"]}}"#)),
    );
    assert_eq!(s, 201, "{milk}");
    assert_eq!(milk["data"]["name"], "Oat Milk");
    assert_eq!(milk["data"]["slug"], "oat-milk");
    assert_eq!(milk["data"]["tags"], serde_json::json!(["dairy-free"]));
    let (_, list) = server.send("GET", "/shopping_list", None);
    assert_eq!(list["data"].as_array().unwrap().len(), 0);

    // The consume action runs the update pipeline; afterUpdate restocks at the threshold.
    let milk_id = milk["data"]["id"].as_i64().unwrap();
    let (s, consumed) = server.send("POST", "/actions/consume", Some(&format!(r#"{{"itemId":{milk_id}}}"#)));
    assert_eq!(s, 200, "{consumed}");
    assert_eq!(consumed["data"]["message"], "Oat Milk: 1 l left");
    let (_, list) = server.send("GET", "/shopping_list?with=itemId", None);
    assert_eq!(list["data"][0]["name"], "Oat Milk");
    assert_eq!(list["data"][0]["itemId"]["quantity"], 1);
    assert_eq!(list["data"][0]["notifiedAt"], serde_json::Value::Null);

    // §6.1: restocking enqueued notifyLowStock; Action Scheduler runs it off the request (the queue's
    // semantics live in tests/php/jobs_test.php). `wp first jobs` lists it before and after.
    let jobs = |args: &str| -> serde_json::Value {
        let (_, out) = server.send("GET", "", None);
        assert_eq!(out["data"]["name"], "pantry");
        serde_json::from_str(&String::from_utf8_lossy(
            &Command::new("php")
                .args(["-d", "memory_limit=512M", "-r"])
                .arg(format!(
                    "require $argv[1]; wpLoad($argv[2]); echo \\First\\Wp\\Runtime::plugin()->app()->cli({args})[1];"
                ))
                .arg(root().join("tests/php/wp.php"))
                .arg(server_dir(&server))
                .output()
                .unwrap()
                .stdout,
        ))
        .unwrap()
    };
    let queued = &jobs(r#"['jobs', 'list', '--state', 'pending']"#)["data"];
    assert_eq!(queued.as_array().unwrap().len(), 1, "{queued}");
    assert_eq!(queued[0]["job"], "notifyLowStock");
    assert_eq!(queued[0]["key"], format!("low-{milk_id}"));
    let ran = Command::new("php")
        .args(["-d", "memory_limit=512M", "-r"])
        .arg("require $argv[1]; wpLoad($argv[2]); ActionScheduler_QueueRunner::instance()->run('tests');")
        .arg(root().join("tests/php/wp.php"))
        .arg(server_dir(&server))
        .output()
        .unwrap();
    assert!(ran.status.success(), "{}", String::from_utf8_lossy(&ran.stderr));
    let (_, list) = server.send("GET", "/shopping_list", None);
    assert!(
        list["data"][0]["notifiedAt"].as_str().is_some_and(|t| t.ends_with('Z')),
        "{list}"
    );
    assert_eq!(
        jobs(r#"['jobs', 'list', '--state', 'done']"#)["data"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    // The hook's own validation and the runtime's coercion both surface as problems.
    let (s, blank) = server.send("POST", "/items", Some(r#"{"name":"   "}"#));
    assert_eq!((s, blank["detail"].as_str()), (422, Some("name can't be empty")));
    let (s, bad) = server.send("POST", "/actions/consume", Some(r#"{"itemId":999}"#));
    assert_eq!(
        (s, bad["code"].as_str(), bad["detail"].as_str()),
        (404, Some("not_found"), Some("No item 999"))
    );

    // A relation loaded inside an action, with a date computed in PHP.
    let (s, soon) = server.send("POST", "/actions/expiringSoon", Some("{}"));
    assert_eq!(s, 200, "{soon}");
    assert_eq!(
        soon["data"],
        serde_json::json!([{ "name": "Oat Milk", "expiresOn": "2000-01-01", "where": "Fridge" }])
    );

    drop(server);
    let _ = std::fs::remove_dir_all(&tmp);
}

/// The served site's directory (its SQLite database lives below it), for in-process PHP.
fn server_dir(server: &Server) -> PathBuf {
    PathBuf::from(server.dir.as_str())
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

/// Every action, access rule, and validator in tests/differential/cases.ts runs under
/// Node and as compiled PHP; the results must be identical. This is what "supported" means.
#[test]
fn compiled_php_matches_node_on_every_differential_case() {
    let dir = root().join("tests/differential");
    let node = Command::new("node")
        .arg(dir.join("run-node.mjs"))
        .arg(dir.join("cases.ts"))
        .output();
    let Ok(node) = node else {
        panic!("node is required for differential tests");
    };
    assert!(
        node.status.success(),
        "node failed:\n{}",
        String::from_utf8_lossy(&node.stderr)
    );
    let oracle: serde_json::Value = serde_json::from_slice(&node.stdout).unwrap();
    assert_eq!(oracle["schema"], "first-differential");
    assert_eq!(oracle["version"], 1);
    assert_eq!(oracle["complete"], true, "oracle must finish every case");
    let expected = &oracle["cases"];
    assert!(!expected.as_object().expect("oracle case map").is_empty());
    // The fake ctxs/values Node used, read from the same config (see run-node.mjs).
    let fixtures = Command::new("node")
        .args(["--input-type=module", "-e"])
        .arg(format!(
            "import {{ register }} from 'node:module'; register({:?}); const m = await import({:?}); process.stdout.write(JSON.stringify({{ ctxs: m.ACCESS_CTXS, fctxs: m.FIELD_CTXS ?? [], values: m.VALIDATE_VALUES, vctx: m.VALIDATE_CTX }}));",
            format!("file://{}", dir.join("resolve-first.mjs").display()),
            format!("file://{}", dir.join("cases.ts").display()),
        ))
        .output()
        .unwrap();
    assert!(
        fixtures.status.success(),
        "{}",
        String::from_utf8_lossy(&fixtures.stderr)
    );
    let fixtures: serde_json::Value = serde_json::from_slice(&fixtures.stdout).unwrap();

    let tmp = std::env::temp_dir().join(format!("first-diff-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    // App code loads from first/; the root config re-exports the cases' config.
    std::fs::create_dir_all(tmp.join("first")).unwrap();
    std::fs::copy(dir.join("cases.ts"), tmp.join("first/cases.ts")).unwrap();
    std::fs::copy(dir.join("namespace.mjs"), tmp.join("first/namespace.mjs")).unwrap();
    // Plain JavaScript modules the cases import run through checked dynamic dispatch.
    std::fs::copy(dir.join("stdlib.js"), tmp.join("first/stdlib.js")).unwrap();
    std::fs::write(
        tmp.join("first.config.ts"),
        "export { default } from \"./first/cases.ts\";\n",
    )
    .unwrap();
    let built = first().arg("build").arg(&tmp).output().unwrap();
    assert!(
        built.status.success(),
        "build failed:\n{}",
        String::from_utf8_lossy(&built.stderr)
    );
    // The compiled app plugin (named after the project directory) and the runtime beside it.
    let plugins = tmp.join("first/dist/wp-content/plugins");
    let app = std::fs::read_dir(&plugins)
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .find(|p| p.is_dir() && p.file_name().unwrap().to_string_lossy().starts_with("first-app-"))
        .expect("the app plugin");
    let runtime = plugins.join("first-runtime");

    let functions = std::fs::read_to_string(app.join("first/app/functions.php")).unwrap();
    let body = |name: &str| {
        functions
            .split(&format!("function {name}("))
            .nth(1)
            .expect("differential helper is emitted")
            .split("\nfunction ")
            .next()
            .unwrap()
    };
    assert!(body("nativeParameter").contains("$input->p['n'] ?? \\First\\Js::dataGet($input, 'n')"));
    assert!(
        body("nativeParameter")
            .lines()
            .any(|line| line.contains("->p[") && line.contains("] = "))
    );
    assert!(body("nativeMissing").contains("$input->p["));
    assert!(
        body("reboundParameter").contains("\\First\\Js::dataGet($input, 'n')")
            && !body("reboundParameter").contains("->p[")
    );
    assert!(
        body("nullableParameter").contains("\\First\\Js::dataGet($input, 'n')")
            && !body("nullableParameter").contains("->p[")
    );

    let mut mismatches = Vec::new();
    for (name, want) in expected.as_object().unwrap() {
        let parts: Vec<&str> = name.split(':').collect();
        let out = match parts.as_slice() {
            ["access", _, _, i] => {
                let ctx = &fixtures["ctxs"][i.parse::<usize>().unwrap()];
                php_case(&runtime, &app, name, serde_json::json!({ "ctx": ctx }))
            }
            ["field", _, _, _, i] => {
                let ctx = &fixtures["fctxs"][i.parse::<usize>().unwrap()];
                php_case(&runtime, &app, name, serde_json::json!({ "ctx": ctx }))
            }
            ["validate", c, col, i] => {
                let value = &fixtures["values"][format!("{c}.{col}")][i.parse::<usize>().unwrap()];
                php_case(
                    &runtime,
                    &app,
                    name,
                    serde_json::json!({ "value": value, "ctx": fixtures["vctx"] }),
                )
            }
            // Actions run through the trusted CLI on a site: they may use db(), once() and jobs.
            _ => wp_eval(
                &tmp.join("first/dist/wp-content"),
                "echo $app->cli(['action', $arg])[1];",
                &serde_json::Value::String(name.clone()),
            ),
        };
        assert!(
            out.stderr.is_empty(),
            "{name}: PHP emitted diagnostics: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let got: serde_json::Value = serde_json::from_slice(&out.stdout)
            .unwrap_or_else(|_| serde_json::json!({ "raw": String::from_utf8_lossy(&out.stdout) }));
        assert!(
            out.status.success()
                || (out.status.code() == Some(1) && want.get("error").is_some() && got.get("error").is_some()),
            "{name}: unexpected PHP process exit: {:?}: {got}",
            out.status.code()
        );
        let got = match got.get("error") {
            Some(e) if e.is_object() => serde_json::json!({ "error": e["detail"] }),
            _ => got,
        };
        if &got != want {
            mismatches.push(format!("{name}\n  node: {want}\n  php:  {got}"));
        }
    }
    let _ = std::fs::remove_dir_all(&tmp);
    assert!(
        mismatches.is_empty(),
        "compiled PHP disagrees with Node:\n{}",
        mismatches.join("\n")
    );
}

/// Every case in tests/differential/html/cases.json renders a compiled TSX component under PHP
/// and the same TSX under React 19 (react-dom/static `prerender`); the HTML must be identical
/// (docs/decisions/2026-11-08-tsx-to-php.md, "Parity tests"). Two things are normalized: React's
/// `<!-- -->` text separators, and the `<link rel="preload" as="image">` React hoists for an
/// eager `<img>`, which the page head will own.
#[test]
fn compiled_tsx_renders_the_html_react_renders() {
    let dir = root().join("tests/differential/html");
    assert!(
        dir.join("node_modules/react-dom").is_dir(),
        "run: npm ci --prefix tests/differential/html"
    );
    let tmp = std::env::temp_dir().join(format!("first-tsx-parity-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&dir.join("project"), &tmp);
    let built = first().arg("build").arg(&tmp).output().unwrap();
    assert!(
        built.status.success(),
        "build failed:\n{}",
        String::from_utf8_lossy(&built.stderr)
    );
    let node = Command::new("node")
        .arg(dir.join("render-node.mjs"))
        .arg(&tmp)
        .arg(dir.join("cases.json"))
        .output()
        .expect("node is required for differential tests");
    assert!(
        node.status.success(),
        "node failed:\n{}",
        String::from_utf8_lossy(&node.stderr)
    );
    let plugins = tmp.join("first/dist/wp-content/plugins");
    let app = plugins.join(format!(
        "first-app-{}",
        tmp.file_name().unwrap().to_string_lossy().replace('_', "-")
    ));
    let php = Command::new("php")
        .arg(dir.join("render-php.php"))
        .arg(plugins.join("first-runtime"))
        .arg(&app)
        .arg(dir.join("cases.json"))
        .output()
        .unwrap();
    assert!(
        php.status.success() && php.stderr.is_empty(),
        "php failed:\n{}{}",
        String::from_utf8_lossy(&php.stdout),
        String::from_utf8_lossy(&php.stderr)
    );
    let react: serde_json::Value = serde_json::from_slice(&node.stdout).unwrap();
    let compiled: serde_json::Value = serde_json::from_slice(&php.stdout).unwrap();
    let cases = react.as_object().expect("case map");
    assert!(!cases.is_empty());
    let mut mismatches = Vec::new();
    for (index, want) in cases {
        let want = match want.get("html").and_then(serde_json::Value::as_str) {
            Some(html) => serde_json::json!({ "html": without_image_preloads(&html.replace("<!-- -->", "")) }),
            None => want.clone(),
        };
        // Generator B adds `data-wp-*` attributes and wraps dynamic text in spans that carry only
        // `data-wp-text`; with those set aside, a client component renders React's HTML.
        let got = match compiled[index].get("html").and_then(serde_json::Value::as_str) {
            Some(html) => serde_json::json!({ "html": without_directives(html) }),
            None => compiled[index].clone(),
        };
        let got = &got;
        if *got != want {
            mismatches.push(format!("case {index}\n  react: {want}\n  php:   {got}"));
        }
    }
    // React rewrites `javascript:` URLs; First drops any URL attribute outside its policy.
    let urls = [
        "javascript:alert(1)",
        " JavaScript:x",
        "java\tscript:x",
        "data:text/html,x",
        "//evil.example",
        "/\\evil.example",
        "https://ok.example/?a=1&b=2",
        "mailto:a@b.c",
        "/root",
        "?page=2",
        "posts/1",
        "#top",
        "a/b:c",
    ];
    let file = tmp.join("urls.json");
    let cases = serde_json::json!([{ "component": "components/urls.tsx#Links", "props": { "urls": urls } }]);
    std::fs::write(&file, cases.to_string()).unwrap();
    let out = Command::new("php")
        .arg(dir.join("render-php.php"))
        .arg(plugins.join("first-runtime"))
        .arg(&app)
        .arg(&file)
        .output()
        .unwrap();
    let rendered: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let dropped = [
        "javascript:alert(1)",
        " JavaScript:x",
        "java\tscript:x",
        "data:text/html,x",
        "//evil.example",
        "/\\evil.example",
    ]
    .map(|u| format!("<a>{u}</a>"))
    .concat();
    let kept = [
        ("https://ok.example/?a=1&amp;b=2", "https://ok.example/?a=1&amp;b=2"),
        ("mailto:a@b.c", "mailto:a@b.c"),
        ("/root", "/root"),
        ("?page=2", "?page=2"),
        ("posts/1", "posts/1"),
        ("#top", "#top"),
        ("a/b:c", "a/b:c"),
    ]
    .map(|(href, text)| format!("<a href=\"{href}\">{text}</a>"))
    .concat();
    assert_eq!(rendered["0"]["html"], format!("<p>{dropped}{kept}</p>"));
    // The same policy whatever the name's spelling: letter case, an `xlink:` prefix, a closed
    // spread, and custom elements. (Open spreads and named `on*` attributes are build errors.)
    let extra = serde_json::json!({ "Href": "javascript:alert(1)", "title": "kept" });
    let cases = serde_json::json!([{
        "component": "components/urls.tsx#Variants",
        "props": { "u": "javascript:alert(1)", "extra": extra },
    }]);
    std::fs::write(&file, cases.to_string()).unwrap();
    let out = Command::new("php")
        .arg(dir.join("render-php.php"))
        .arg(plugins.join("first-runtime"))
        .arg(&app)
        .arg(&file)
        .output()
        .unwrap();
    let rendered: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        rendered["0"]["html"],
        "<div><a title=\"kept\">spread</a><my-el title=\"kept\"></my-el><a>upper</a><button>lower</button>\
         <object></object><my-el></my-el><svg><use></use></svg></div>"
    );
    let cases = serde_json::json!([{ "component": "components/urls.tsx#TagCase", "props": {} }]);
    std::fs::write(&file, cases.to_string()).unwrap();
    let out = Command::new("php")
        .arg(dir.join("render-php.php"))
        .arg(plugins.join("first-runtime"))
        .arg(&app)
        .arg(&file)
        .output()
        .unwrap();
    let rendered: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        rendered["0"]["html"],
        "<div>a<br/>b<svg><foreignObject></foreignObject></svg></div>"
    );
    // Extra keys in decoded JSON never reach `style` or a spread's attributes.
    let evil = "url(//evil.example/t)";
    let cases = serde_json::json!([{
        "component": "components/urls.tsx#ExtraKeys",
        "props": {
            "s": { "color": "red", "backgroundImage": evil, "position": "fixed", "inset": "0" },
            "extra": {
                "title": "t",
                "onclick": "alert(1)",
                "href": "javascript:alert(1)",
                "style": { "color": "blue", "position": "fixed" },
            },
        },
    }]);
    std::fs::write(&file, cases.to_string()).unwrap();
    let out = Command::new("php")
        .arg(dir.join("render-php.php"))
        .arg(plugins.join("first-runtime"))
        .arg(&app)
        .arg(&file)
        .output()
        .unwrap();
    let rendered: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(
        rendered["0"]["html"],
        "<div><p style=\"color:red\">style</p><p title=\"t\" style=\"color:blue\">spread</p></div>"
    );
    let _ = std::fs::remove_dir_all(&tmp);
    assert!(
        mismatches.is_empty(),
        "compiled TSX disagrees with React:\n{}",
        mismatches.join("\n")
    );
}

/// Drops `<link rel="preload" as="image" …/>`, which React emits ahead of an eager `<img>`.
/// `\First\Html` keeps its own attribute checks even though the compiler refuses these names and
/// spreads at build time: a value that reaches it another way (an imported JavaScript object)
/// still can't set a URL, an event handler or `srcdoc` (PHP's `$` matches before a final `\n`,
/// so the name pattern must be anchored with `\z`).
#[test]
fn html_runtime_drops_unsafe_attribute_names_from_any_source() {
    let runtime = root().join("runtime/First/bootstrap.php");
    let script = r#"
        require $argv[1];
        $attrs = ["href\n" => "javascript:alert(1)", "style\n" => "position:fixed", "onclick" => "x",
            "ONMOUSEOVER" => "x", "Href" => "javascript:alert(1)", "srcdoc" => "<p>", "a b" => "x",
            "title" => "kept"];
        echo \First\Html::element("a", $attrs, "x")->html(), "\n";
        echo \First\Html::element("my-el", $attrs)->html(), "\n";
        $style = new \First\JsObject(["color" => "red;position:fixed", "background" => "url(//evil)", "width" => "1px",
            "x:y;position" => "fixed", "inset\n" => "0", "--ok" => "1"]);
        echo \First\Html::element("div", ["style" => $style])->html(), "\n";
        // Every spelling of `style` goes through the style filter, and a string is never CSS.
        $css = "position:fixed;inset:0;background:url(//evil)";
        echo \First\Html::element("div", ["Style" => $style])->html(), "\n";
        // A string `style` throws, as React does, so it never reaches the attribute.
        try { \First\Html::element("div", ["STYLE" => $css])->html(); echo "rendered\n"; }
        catch (\First\JsError $e) { echo "refused\n"; }
        echo \First\Html::element("my-el", ["STYLE" => $style])->html(), "\n";
        var_export(\First\Html::styleOf($css, ["position"]) === \First\JsUndefined::Value);
        echo "\n";
        // `styleOf` keeps only the names the compiler saw in the style's type.
        $extra = new \First\JsObject(["color" => "red", "position" => "fixed", "inset" => "0"]);
        echo \First\Html::element("p", ["style" => \First\Html::styleOf($extra, ["color"])])->html(), "\n";
    "#;
    let out = Command::new("php").args(["-r", script]).arg(&runtime).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(
        String::from_utf8_lossy(&out.stdout),
        "<a title=\"kept\">x</a>\n<my-el title=\"kept\"></my-el>\n<div style=\"width:1px;--ok:1\"></div>\n\
         <div style=\"width:1px;--ok:1\"></div>\nrefused\n<my-el style=\"width:1px;--ok:1\"></my-el>\ntrue\n\
         <p style=\"color:red\"></p>\n"
    );
}

/// Server HTML with generator B's additions removed: every `data-wp-*` attribute, and the
/// `<span data-wp-text="…">` wrappers it puts around dynamic text that shares its parent.
fn without_directives(html: &str) -> String {
    let attr = regex::Regex::new(r#" data-wp-[a-z0-9-]+="[^"]*""#).unwrap();
    let span = regex::Regex::new(r#"<span data-wp-text="[^"]*" data-first-text="">([^<]*)</span>"#).unwrap();
    let html = span.replace_all(html, "$1");
    attr.replace_all(&html, "").into_owned()
}

fn without_image_preloads(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(at) = rest.find("<link rel=\"preload\" as=\"image\"") {
        out.push_str(&rest[..at]);
        let end = rest[at..].find("/>").expect("closed link") + at + 2;
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

fn php_case(runtime: &Path, app: &Path, case: &str, args: serde_json::Value) -> std::process::Output {
    Command::new("php")
        .arg(root().join("tests/differential/run-php.php"))
        .arg(runtime)
        .arg(app)
        .arg(case)
        .arg(args.to_string())
        .output()
        .unwrap()
}

/// §7.3: the generated client types localized collections; translation ids follow the primary key.
#[test]
fn localized_generated_client_types() {
    let tmp = std::env::temp_dir().join(format!("first-locales-client-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures/locales-client"), &tmp);
    let out = first().arg("build").arg(&tmp).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    std::fs::write(
        tmp.join("tsconfig.json"),
        serde_json::to_vec(&serde_json::json!({
            "compilerOptions": {
                "strict": true, "noEmit": true, "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
                "paths": { "first": [root().join("types/first/index.d.ts")] }
            },
            "files": ["client.ts", "first/_generated/db.d.ts"]
        }))
        .unwrap(),
    )
    .unwrap();
    let out = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .arg("--project")
        .arg(tmp.join("tsconfig.json"))
        .output()
        .expect("tsc (or TSC) must be installed to check generated clients");
    assert!(
        out.status.success(),
        "generated client contract failed: {}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let _ = std::fs::remove_dir_all(tmp);
}

/// §9.1 golden: the frozen phase-1 blog (tests/fixtures/blog/first.config.ts) compiles to a schema.php
/// equal, as data, to the fixture the runtime and the PHP suites code against. examples/blog, which
/// carries every phase-2 feature, builds the §4.9 plugin with the §7.3 wpml-config.xml golden, passes
/// doctor, and syncs its committed posts into a served site.
#[test]
fn blog_example_matches_the_frozen_schema_and_builds_the_plugin() {
    let tmp = std::env::temp_dir().join(format!("first-blog-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    let frozen = tmp.join("frozen");
    std::fs::create_dir_all(&frozen).unwrap();
    std::fs::copy(
        root().join("tests/fixtures/blog/first.config.ts"),
        frozen.join("first.config.ts"),
    )
    .unwrap();
    let project = tmp.join("blog");
    copy(&root().join("examples/blog"), &project);
    for generated in [".first", "first"] {
        let _ = std::fs::remove_dir_all(project.join(generated));
    }
    let as_json = |php_file: &Path| -> serde_json::Value {
        let out = Command::new("php")
            .args(["-r", "echo json_encode(require $argv[1]);"])
            .arg(php_file)
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        serde_json::from_slice(&out.stdout).unwrap()
    };

    let golden = as_json(&root().join("tests/fixtures/blog/schema.php"));
    let out = first().arg("build").arg(&frozen).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(
        as_json(&frozen.join("first/dist/wp-content/plugins/first-app-blog/first/app/schema.php")),
        golden,
        "schema.php drifted from tests/fixtures/blog/schema.php"
    );

    let out = first().arg("build").arg(&project).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    // §3.5.1: post-backed columns that only postmeta can filter get a one-line hint.
    assert!(
        String::from_utf8_lossy(&out.stderr).contains(
            "hint: \"posts.authorId\" is filtered through postmeta on WordPress; use table() for SQL data if this list grows large"
        ),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let plugin = project.join("first/dist/wp-content/plugins/first-app-blog");
    for rel in [
        "first-app-blog.php",
        "first/app/functions.php",
        "first/app/migrations/0001_init.sql",
    ] {
        assert!(plugin.join(rel).exists(), "plugin is missing {rel}");
    }
    assert!(
        project
            .join("first/dist/wp-content/plugins/first-app-blog.zip")
            .is_file()
    );
    let content = project.join("first/dist/wp-content");
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(content.join("first-manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["runtime"], "0.3");
    assert_eq!(manifest["app"], "blog");
    for slug in ["first-runtime", "first-identity", "first-app-blog"] {
        let archive = std::fs::File::open(content.join("plugins").join(format!("{slug}.zip"))).unwrap();
        let mut archive = zip::ZipArchive::new(archive).unwrap();
        assert!(archive.by_name(&format!("{slug}/{slug}.php")).is_ok());
    }
    assert!(content.join("plugins/first-runtime/first/bootstrap.php").is_file());
    let doctor = first().args(["doctor", "--json"]).arg(&project).output().unwrap();
    assert!(doctor.status.success(), "{}", String::from_utf8_lossy(&doctor.stdout));
    let doctor: serde_json::Value = serde_json::from_slice(&doctor.stdout).unwrap();
    let platform: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("tests/fixtures/platform.json")).unwrap()).unwrap();
    assert_eq!(doctor["data"]["requirements"], platform);

    // §5.8: the example's committed posts against a fresh site: --check reports them (exit 2), a
    // sync creates them, and a second sync changes nothing. (tests/system/blog.test.ts does the same
    // against WordPress on MariaDB with the plugins installed as a site owner would.)
    let server = Server::start(&content, &["ed=editor"]);
    assert_eq!(server.send("GET", "/auth/config", None).0, 200);
    let credential = server.credential("ed");
    let site = server.url();
    let sync = |extra: &[&str]| {
        first()
            .arg("sync")
            .arg(&project)
            .env("FIRST_APP_PASSWORD", &credential)
            .args(["--site", &site, "--no-commit", "--json"])
            .args(extra)
            .output()
            .unwrap()
    };
    let check = sync(&["--check"]);
    assert_eq!(
        check.status.code(),
        Some(2),
        "{}",
        String::from_utf8_lossy(&check.stderr)
    );
    let first = sync(&[]);
    assert_eq!(
        first.status.code(),
        Some(0),
        "{}",
        String::from_utf8_lossy(&first.stdout)
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&first.stdout).unwrap()["data"]["applied"],
        2
    );
    let again = sync(&[]);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&again.stdout).unwrap()["data"]["applied"],
        0
    );
    let (_, posts) = server.send("GET", "/posts?orderBy=id", None);
    assert_eq!(posts["data"][0]["title"], "Hello, First", "{posts}");
    drop(server);

    // §7.3: localized posts ship a wpml-config.xml, so WPML and Polylang know which fields translate.
    assert_eq!(
        std::fs::read_to_string(plugin.join("wpml-config.xml")).unwrap(),
        std::fs::read_to_string(root().join("tests/fixtures/blog.wpml-config.xml")).unwrap(),
        "wpml-config.xml drifted from tests/fixtures/blog.wpml-config.xml"
    );
    // Post-backed collections have no MySQL table; editor:false ones do (no FK to a post type).
    let mysql = std::fs::read_to_string(plugin.join("first/app/migrations/0001_init.sql")).unwrap();
    assert!(mysql.contains("CREATE TABLE `{prefix}first_comments`"), "{mysql}");
    assert!(
        !mysql.contains("first_posts`") && !mysql.contains("FOREIGN KEY"),
        "{mysql}"
    );
    // The typed client: generated types and the descriptor, next to the migrations.
    let types = std::fs::read_to_string(project.join("first/_generated/client/types.ts")).unwrap();
    assert!(
        types.contains("tags: (\"news\" | \"guide\" | \"release\")[];"),
        "{types}"
    );
    assert!(project.join("first/_generated/client/schema.ts").is_file());
    let _ = std::fs::remove_dir_all(&tmp);
}

/// The generated client types private files and media updates, and keeps the built-in `PrivateFile`
/// distinct from a collection whose type name would collide with it (phase-2 §7.2).
#[test]
fn generated_client_types_files_and_avoids_the_private_file_name() {
    let tmp = std::env::temp_dir().join(format!("first-private-files-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures/private-files"), &tmp);
    let out = first().args(["build", "--quiet"]).arg(&tmp).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let out = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .args([
            "--strict",
            "--noEmit",
            "--target",
            "ES2022",
            "--module",
            "ESNext",
            "--moduleResolution",
            "bundler",
            "--allowImportingTsExtensions",
            "--lib",
            "ES2022,DOM",
        ])
        .arg(tmp.join("client.ts"))
        .output()
        .expect("tsc (or TSC) must be installed to check generated clients");
    assert!(
        out.status.success(),
        "generated client failed: {}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let _ = std::fs::remove_dir_all(&tmp);
}

/// Every static phase-2 rejection is target-independent (phase-2 §§4–7).
#[test]
fn rejects_phase2_static_contracts() {
    let cases = [
        ("reject-showif-dynamic", "showIf must be static data"),
        ("reject-sync-symlink", "sync directory must stay inside the project"),
        ("reject-field-access-title", "title is always readable"),
        ("reject-field-access-filter", "field rules here return a boolean"),
        ("reject-field-access-query", "access rules can't query"),
        ("reject-field-access-async", "field rules must be synchronous"),
        ("reject-field-access-helper", "access rules can't query"),
        (
            "reject-field-access-fallthrough",
            "field rules must return a boolean on every path",
        ),
        (
            "reject-field-access-bare-return",
            "field rules must return a boolean on every path",
        ),
        (
            "reject-field-access-helper-fallthrough",
            "access rules return true, false, or a filter",
        ),
        (
            "reject-field-access-catch-fallthrough",
            "field rules must return a boolean on every path",
        ),
        ("reject-field-access-self", "self is only allowed on user projection"),
        (
            "reject-field-access-global",
            "field access applies to collection columns",
        ),
        ("reject-showif-sibling", "showIf names non-sibling"),
        ("reject-showif-operator", "invalid showIf operator"),
        (
            "reject-showif-boolean-null",
            "which is never empty; compare it with true or false",
        ),
        ("reject-showif-empty-in", "invalid showIf operator or operand \"in\""),
        (
            "reject-showif-nested-date",
            "the editor can't compare the value of \"due\"",
        ),
        ("reject-showif-structured", "compare a scalar sibling"),
        ("reject-showif-nested-sibling", "showIf names non-sibling"),
        ("reject-showif-title", "title is always readable"),
        ("reject-sync-auth", "user projections cannot sync"),
        (
            "reject-auth-primary-key",
            "`.primaryKey()` is gone: every kind has an integer `id`",
        ),
        ("reject-sync-directory", "two collections sync into the same directory"),
        ("reject-sync-outside", "sync directory must stay inside the project"),
        ("reject-sync-content", "Markdown sync needs a content designation"),
        ("reject-sync-uid", "uid: false cannot be combined with sync"),
        (
            "reject-sync-primary-key",
            "`.primaryKey()` is gone: every kind has an integer `id`",
        ),
        ("reject-sync-reference", "sync references need uid: true on a"),
        ("reject-job-reference", "`ref()` isn't allowed on an action input"),
        ("reject-job-unique", "`.unique()` isn't allowed on an action input"),
        ("reject-job-retries", "job retries must be a whole number from 0 to 20"),
        ("reject-once-key", "once key must be a string"),
        ("reject-env-placement", "env() is only allowed in webhooks/signature"),
        ("reject-env-coercion", "env() is only allowed in webhooks/signature"),
        (
            "reject-env-serialization",
            "env() is only allowed in webhooks/signature",
        ),
        ("reject-env-condition", "env() is only allowed in webhooks/signature"),
        ("reject-env-binary", "env() is only allowed in webhooks/signature"),
        ("reject-env-predicate", "env() is only allowed in webhooks/signature"),
        ("reject-env-hasown", "env() is only allowed in webhooks/signature"),
        ("reject-signature-access", "signature cannot be combined with access"),
        ("reject-webhook-collection", "webhook event names an unknown collection"),
        ("reject-enqueue-unknown-job", "unknown job `send`"),
        (
            "reject-env-captured",
            "env() values can't be stored inside captured data",
        ),
        ("reject-auth-duplicate", "at most one userProjection()"),
        (
            "reject-auth-email",
            "userProjection() needs `email: email().unique().max(191)`",
        ),
        ("reject-auth-drafts", "userProjection() requires drafts: false"),
        ("reject-auth-revisions", "userProjection() requires revisions: false"),
        (
            "reject-auth-slug",
            "user projections cannot have slug() or localized fields",
        ),
        ("reject-auth-self", "self is only allowed on user projection"),
        ("reject-auth-create-self", "self is only allowed on user projection"),
        (
            "reject-auth-reserved-password",
            "password is reserved on user projections",
        ),
        ("reject-auth-reserved-role", "role is reserved on user projections"),
        (
            "reject-auth-reserved-passwordHash",
            "passwordHash is reserved on user projections",
        ),
        ("reject-agents-kebab", "ability kebab collision: notes-list"),
        ("reject-agents-media", "media has no option `agents`"),
        ("reject-files-cover", "fit: cover requires height"),
        ("reject-files-size-name", "invalid media size name"),
        ("reject-files-size-count", "media supports at most 12 sizes"),
        ("reject-files-bucket", "unknown file bucket"),
        (
            "reject-files-global",
            "file() columns belong to collections, not globals",
        ),
        ("reject-files-owner", "owner is only allowed in files access"),
        ("reject-files-accept", "accept entries must be type/subtype or type/*"),
        (
            "reject-files-media",
            "file bucket name must match its key and cannot be media",
        ),
        ("reject-localized-kind", "translate text, not values"),
        ("reject-localized-missing", ".localized() requires locales"),
        ("reject-localized-default", "locales.default must appear in all"),
        ("reject-localized-tag", "invalid or duplicate locale"),
        ("reject-localized-unique", "unique is not allowed on a localized column"),
        (
            "reject-localized-auth",
            "user projections cannot have slug() or localized fields",
        ),
        (
            "reject-localized-reserved-locale",
            "locale is reserved for localization",
        ),
        (
            "reject-localized-reserved-translations",
            "translations is reserved for localization",
        ),
        (
            "reject-localized-reserved-translationOf",
            "translationOf is reserved for localization",
        ),
        (
            "reject-localized-reserved-translationGroup",
            "translationGroup is reserved for localization",
        ),
    ];
    for (fixture, message) in cases {
        let out = first()
            .arg("check")
            .arg(root().join("tests/fixtures").join(fixture))
            .output()
            .unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{fixture}: {stderr}");
        assert!(
            stderr.contains(message),
            "{fixture}: expected {message:?}, got {stderr}"
        );
        assert!(
            stderr.contains("--> first.config.ts:"),
            "{fixture} has no source location: {stderr}"
        );
        assert!(stderr.contains("help:"), "{fixture} has no fix: {stderr}");
    }
    // Mutations must not make a partial field predicate look exhaustive.
    let tmp = std::env::temp_dir().join(format!("first-phase2-mutations-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    for (body, diagnostic) in [
        (
            "let key: number = 0; for (key in { a: true }) {} return true;",
            "a for-in key is a string",
        ),
        (
            "var key: number; for (var key in { a: true }) {} return true;",
            "loop values are string",
        ),
        (
            "var value: number; for (var value of ['a']) {} return true;",
            "loop values are string",
        ),
        (
            "let key: string | number = 1; if (typeof key === 'number') { for (key in { a: true }) {} return key + 1 > 0; } return false;",
            "is ambiguous",
        ),
        (
            "let key: unknown = 1; if (typeof key === 'number') { const read = () => key; for (key in { a: true }) {} return read() + 1 > 0; } return false;",
            "is ambiguous",
        ),
        (
            "const root: { x: number | string } = { x: 1 }; const alias = root; if (typeof root.x === 'number') { alias.x = 'hi'; return root.x + 1 > 0; } return true;",
            "is ambiguous",
        ),
        (
            "const root: { child: { x: number | string } } = { child: { x: 1 } }; const alias = root.child; if (typeof root.child.x === 'number') { alias.x = 'hi'; return root.child.x + 1 > 0; } return true;",
            "is ambiguous",
        ),
        (
            "const root: { child: { x: number | string } } = { child: { x: 1 } }; const { child } = root; if (typeof root.child.x === 'number') { child.x = 'hi'; return root.child.x + 1 > 0; } return true;",
            "is ambiguous",
        ),
        (
            "const root: { x: number | string } = { x: 1 }; const change = () => { root.x = 'hi'; }; if (typeof root.x === 'number') { change(); return root.x + 1 > 0; } return true;",
            "is ambiguous",
        ),
        (
            "const check = (a: { x: number | string }, b: { x: number | string }) => { if (typeof a.x === 'number') { b.x = 'hi'; return a.x + 1 > 0; } return true; }; const root = { x: 1 }; return check(root, root);",
            "is ambiguous",
        ),
        (
            "[1].map((value: 1) => value); return true;",
            "this parameter is declared as 1, but it receives",
        ),
        (
            "const read = (value: 1) => value; [1, 2].map(read); return true;",
            "this parameter is declared as 1, but it receives",
        ),
        (
            "const read = (value: number, index: number, extra: number) => value; [1].map(read); return true;",
            "this parameter is declared as number, but it receives number[]",
        ),
        (
            "'a'.replace('a', (match: string, offset: 'first') => offset); return true;",
            "this parameter is declared as",
        ),
        (
            "const read = ({ flag }: { flag: boolean } = { flag: 'bad' }) => flag; return read();",
            "this default is",
        ),
        (
            "function first(pair: ['a', 'b']) { return pair[0]; } const pair: ['a', 'b'] = ['a', 'b']; pair.shift(); switch (first(pair)) { case 'a': return true; case null: return false; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const pair: ['a', 'b'] = ['a', 'b']; pair.shift(); switch (pair[0]) { case 'a': return true; case null: return false; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const read = (flag?: boolean) => { switch (flag) { case true: case false: return true; } }; return read();",
            "access rules return true, false, or a filter",
        ),
        (
            "let value: 'a' | 'b' | null = 'a'; const make = () => { if (value === null) throw new Error('missing'); return () => value; }; const read = make(); value = null; if (ctx.user !== null) make(); switch (read()) { case 'a': case 'b': return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const values: ('a' | 'b')[] = []; switch (values[0]) { case 'a': case 'b': return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const values: ['a', 'b'] = ['a', 'b']; values.pop(); switch (values[1]) { case 'b': return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const values: ('a' | 'b')[] = []; const [value] = values; switch (value) { case 'a': case 'b': return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "function accept(value: 'a' | 'b') { switch (value) { case 'a': case 'b': return true; } } const values: ('a' | 'b')[] = []; return accept(values[0]);",
            "function expects",
        ),
        (
            "let value: 'a' | 'b' | null = 'a'; if (value === null) return false; const read = () => value; const invoke = () => read(); value = null; switch (invoke()) { case 'a': case 'b': return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let value: 'a' | 'b' | null = 'a'; const clear = () => { value = null; return true; }; if (value !== null && clear()) { switch (value) { case 'a': case 'b': return true; } } else { return false; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let value: 'a' | 'b' | null = 'a'; if (value === null) return false; let i = 0; while (true) { if (i === 1) { switch (value) { case 'a': case 'b': return true; } break; } value = null; i++; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let value: 'a' | 'b' | null = 'a'; if (value === null) return false; const read = () => value; value = null; switch (read()) { case 'a': case 'b': return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let value: 'a' | 'b' | null = 'a'; if (value === null) return false; value = null; switch (value) { case 'a': case 'b': return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const record: { inner: { count: number } | null } = { inner: { count: 0 } }; if (record.inner !== null) { record.inner = null; record.inner.count = 1; } return true;",
            "object might be null",
        ),
        (
            "const record: { inner: { count: number } | null } = { inner: { count: 0 } }; function clear(value: { inner: { count: number } | null }) { value.inner = null; } if (record.inner !== null) { clear(record); record.inner.count = 1; } return true;",
            "object might be null",
        ),
        (
            "let value: 0 | 1 = 1; const read = () => value; value++; switch (read()) { case 0: case 1: return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let value: 0 | 1 = 1; while (true) { if (value > 1) { switch (value) { case 0: case 1: return true; } break; } value++; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let record: { count: 0 | 1 } = { count: 1 }; function bump(value: { count: 0 | 1 }) { value.count++; } bump(record); switch (record.count) { case 0: case 1: return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "const record: { count: 0 | 1 } = { count: 1 }; function bump(...values: { count: 0 | 1 }[]) { const value = values[1]; if (value) value.count++; } bump({ count: 0 }, record); switch (record.count) { case 0: case 1: return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let value: 0 | 1 = 1; value++; function accept(n: 0 | 1) { switch (n) { case 0: case 1: return true; } } return accept(value);",
            "access rules return true, false, or a filter",
        ),
        (
            "let record: { count: 0 | 1 } = { count: 1 }; record.count++; function accept(n: { count: 0 | 1 }) { switch (n.count) { case 0: case 1: return true; } } return accept(record);",
            "access rules return true, false, or a filter",
        ),
        (
            "let record: { count: 0 | 1 } = { count: 1 }; record.count++; function accept({ count }: { count: 0 | 1 }) { switch (count) { case 0: case 1: return true; } } return accept(record);",
            "access rules return true, false, or a filter",
        ),
        (
            "let value: 0 | 1 = 1; value++; const out = (value ??= 1); switch (out) { case 0: case 1: return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "let value: 0 | 1 = 1; value++; const out = (value ||= 1); switch (out) { case 0: case 1: return true; }",
            "field rules must return a boolean on every path",
        ),
        (
            "function run(value: 0 | 1, write: (() => void) | null = () => { value++; }) { if (write !== null) write(); switch (value) { case 0: case 1: return true; } } return run(1);",
            "access rules return true, false, or a filter",
        ),
        (
            "let record: { count: 0 | 1 } | null = { count: 0 }; if (record !== null) record.count = 2; return true;",
            "can't assign",
        ),
        (
            "let record: { count: number } | null = null; record.count = 1; return true;",
            "object might be null",
        ),
        ("let value: true = true; value &&= false; return true;", "can't assign"),
        ("let value: false = false; value ||= true; return true;", "can't assign"),
        ("let value: null = null; value ??= false; return true;", "can't assign"),
        (
            "const values: true[] = [true]; values.fill(false); return true;",
            "can't insert",
        ),
        (
            "const values: (0 | 1)[] = [1]; values.unshift(2); return true;",
            "can't insert",
        ),
        (
            "const values: (0 | 1)[] = [1]; values.splice(0, 1, 2); return true;",
            "can't insert",
        ),
        (
            "function bump(value: { count: 0 | 1 }) { value.count++; } bump({ count: 2 }); return true;",
            "function expects",
        ),
        ("return 'ab'.startsWith('b', 1);", "with a position isn't supported"),
        (
            "return 'ab'.lastIndexOf('b', Number(undefined)) === 1;",
            "position must be a literal number, null or undefined",
        ),
        ("let value: 0 | 1 = 1; value++; value = 2; return true;", "can't assign"),
        (
            "function accept(value: { count: 0 | 1 }) { return true; } const map: Record<string, { count: 0 | 1 }> = {}; return accept(map['missing']);",
            "function expects",
        ),
    ] {
        std::fs::write(tmp.join("first.config.ts"), format!(
            "import {{ collection, text, defineConfig , table}} from 'first'; const notes = table({{ secret: text().access({{ read: (ctx): boolean => {{ {body} }} }}).optional() }}); export default defineConfig({{ tables: {{ notes }} }});"
        )).unwrap();
        let out = first().arg("check").arg(&tmp).output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{stderr}");
        assert!(stderr.contains(diagnostic), "{stderr}");
    }
    for (invocation, diagnostic) in [
        (
            "[1, 2].reduce((acc, item) => { value++; return acc; }, 0)",
            "field rules must return a boolean on every path",
        ),
        (
            "[1, 2].flatMap(item => { value++; return [item]; })",
            "field rules must return a boolean on every path",
        ),
        (
            "[1, 2].findLast(item => { value++; return false; })",
            "field rules must return a boolean on every path",
        ),
        (
            "[1, 2].findLastIndex(item => { value++; return false; })",
            "field rules must return a boolean on every path",
        ),
        (
            "[2, 1].sort((a, b) => { value += 2; return a - b; })",
            "field rules must return a boolean on every path",
        ),
        (
            "[2, 1].toSorted((a, b) => { value += 2; return a - b; })",
            "field rules must return a boolean on every path",
        ),
        (
            "Array.from({ length: 2 }, () => { value++; return 1; })",
            "field rules must return a boolean on every path",
        ),
        (
            "const items = [1, 2]; Array.from(items, item => { value++; return item; })",
            "field rules must return a boolean on every path",
        ),
        (
            "'aa'.replace(/a/g, () => { value++; return 'b'; })",
            "field rules must return a boolean on every path",
        ),
        (
            "'aa'.replaceAll('a', () => { value++; return 'b'; })",
            "field rules must return a boolean on every path",
        ),
    ] {
        std::fs::write(tmp.join("first.config.ts"), format!(
            "import {{ collection, text, defineConfig , table}} from 'first'; const notes = table({{ secret: text().access({{ read: (): boolean => {{ let value: 0 | 1 = 0; {invocation}; switch (value) {{ case 0: case 1: return true; }} }} }}).optional() }}); export default defineConfig({{ tables: {{ notes }} }});"
        )).unwrap();
        let out = first().arg("check").arg(&tmp).output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{invocation}: {stderr}");
        assert!(stderr.contains(diagnostic), "{invocation}: {stderr}");
    }
    for extraction in [
        "const write = writers.at(0)!; write()",
        "writers.slice()[0]!()",
        "writers.concat(writers)[0]!()",
        "writers.reverse()[0]!()",
        "writers.toReversed()[0]!()",
        "writers.pop()!()",
        "writers.shift()!()",
        "writers.splice(0, 1)[0]!()",
        "const nested = [writers]; nested.flat()[0]!()",
        "Object.values({ write: writers[0]! })[0]!()",
        "Object.entries({ write: writers[0]! })[0]![1]!()",
        "const entries: [string, () => void][] = [['write', writers[0]!]]; Object.fromEntries(entries)['write']!()",
        "Array.from(writers)[0]!()",
        "const objects = [{ write: writers[0]! }]; objects.forEach(({ write }) => write())",
    ] {
        std::fs::write(tmp.join("first.config.ts"), format!(
            "import {{ collection, text, defineConfig , table}} from 'first'; const notes = table({{ secret: text().access({{ read: (): boolean => {{ let value: 0 | 1 = 1; const writers = [() => {{ value++; }}]; {extraction}; switch (value) {{ case 0: case 1: return true; }} }} }}).optional() }}); export default defineConfig({{ tables: {{ notes }} }});"
        )).unwrap();
        let out = first().arg("check").arg(&tmp).output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{extraction}: {stderr}");
        assert!(
            stderr.contains("field rules must return a boolean on every path"),
            "{extraction}: {stderr}"
        );
    }
    let _ = std::fs::remove_dir_all(tmp);
}

/// The v3 config normalizes to one shape, and the new slots run through the existing PHP path.
#[test]
fn phase2_schema_and_closures_match_the_contract() {
    let tmp = std::env::temp_dir().join(format!("first-phase2-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    std::fs::copy(
        root().join("tests/fixtures/phase2-surface/first.config.ts"),
        tmp.join("first.config.ts"),
    )
    .unwrap();
    std::fs::copy(
        root().join("tests/fixtures/phase2-surface/client.ts"),
        tmp.join("client.ts"),
    )
    .unwrap();
    let golden: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root().join("tests/fixtures/phase2.schema.json")).unwrap()).unwrap();
    let out = first()
        .arg("build")
        .arg(&tmp)
        .env("UPLOAD_SECRET", "compile-time-secret-must-not-resolve")
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let out = Command::new("php")
        .args(["-r", "echo json_encode(require $argv[1]);"])
        .arg(tmp.join("first/dist/wp-content/plugins/first-app-phase2/first/app/schema.php"))
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let actual: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(actual, golden, "v3 metadata drifted");
    // A second build with no changes plans no migration.
    let again = first().arg("build").arg(&tmp).output().unwrap();
    assert!(again.status.success(), "{}", String::from_utf8_lossy(&again.stderr));
    assert!(
        !tmp.join("first/_generated/migrations/0002_update.sql").exists(),
        "a rebuild planned a migration"
    );
    // §7.3 drift guard: the generated wpml-config.xml (copy synced metas, translate localized ones).
    let wpml = tmp.join("first/dist/wp-content/plugins/first-app-phase2/wpml-config.xml");
    assert_eq!(
        std::fs::read_to_string(&wpml).expect("localized post types ship wpml-config.xml"),
        std::fs::read_to_string(root().join("tests/fixtures/phase2.wpml-config.xml")).unwrap(),
        "wpml-config.xml drifted"
    );
    let out = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .args([
            "--strict",
            "--noEmit",
            "--target",
            "ES2022",
            "--module",
            "ESNext",
            "--moduleResolution",
            "bundler",
            "--allowImportingTsExtensions",
            "--lib",
            "ES2022,DOM",
        ])
        .arg(tmp.join("client.ts"))
        .output()
        .expect("tsc (or TSC) must be installed to check generated clients");
    assert!(
        out.status.success(),
        "generated client contract failed: {}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    // The compiled closures run on a WordPress site with the plugins active (fields rules, actions,
    // a job handler writing through db()).
    let out = wp_eval(
        &tmp.join("first/dist/wp-content"),
        r#"

        $db = \First\Db::instance();
        $schema = $db->schema();
        $col = $schema->collection('posts')['columns']['seo']['fields']['label'];
        $fn = '\\FirstApp\\' . $col['access']['read']['fn'];
        $private = $fn(\First\Seam::ctx(['data' => ['label' => 'private'], 'user' => null, 'op' => 'read'], ['label' => ['type' => 'text']]));
        $public = $fn(\First\Seam::ctx(['data' => ['label' => 'hello'], 'user' => null, 'op' => 'read'], ['label' => ['type' => 'text']]));
        $authenticated = $fn(\First\Seam::ctx(['data' => ['label' => 'hello'], 'user' => ['id' => 1, 'name' => 'Editor', 'role' => 'editor'], 'op' => 'read'], ['label' => ['type' => 'text']]));
        $fieldThrows = false;
        try {
            $fn(\First\Seam::ctx(['data' => ['label' => 'error'], 'user' => null, 'op' => 'read'], ['label' => ['type' => 'text']]));
        } catch (\First\JsError $error) {
            $fieldThrows = $error->getMessage() === 'denied';
        }
        $action = $schema->action('inbound');
        $fn = '\\FirstApp\\' . $action['handler'];
        $actor = ['user' => ['id' => 1, 'name' => 'Editor', 'role' => 'editor']];
        $actionAllowed = $fn(\First\Seam::toJs(\First\Schema::validateInput($action['input'], []), $action['input']), \First\Seam::ctx($actor));
        $actionThrows = false;
        try {
            $fn(\First\Seam::toJs(\First\Schema::validateInput($action['input'], ['allow' => false]), $action['input']), \First\Seam::ctx($actor));
        } catch (\First\JsError $error) {
            $actionThrows = $error->getMessage() === 'denied';
        }
        $fn = '\\FirstApp\\' . $schema->action('widened')['handler'];
        $widened = $fn(new \First\JsObject());
        // Ordinary array mutation/reduction results belong to the differential
        // owner; this fixture retains their generated-client type proof.
        foreach (['values', 'choice', 'nested', 'reduced', 'reducedNested'] as $key) { unset($widened->p[$key]); }
        $nested = $schema->collection('posts')['columns']['sections']['layouts']['hero']['label'];
        $fn = '\\FirstApp\\' . $nested['access']['update']['fn'];
        $update = $fn(\First\Seam::ctx(['data' => [], 'op' => 'update'] + $actor, []));
        $subscriberUpdate = $fn(\First\Seam::ctx(['data' => [], 'op' => 'update', 'user' => ['id' => 2, 'name' => 'Sub', 'role' => 'subscriber']], []));
        $bucket = $schema->files()['decks'];
        $fn = '\\FirstApp\\' . $bucket['access']['create']['fn'];
        $bucketGuest = $fn(\First\Seam::ctx(['user' => null, 'op' => 'create']));
        $job = $schema->jobs()['sendWelcome'];
        $input = \First\Schema::validateInput($job['input'], ['email' => 'a@example.com', 'payload' => ['message' => 'typed'], 'data' => ['payload' => ['suffix' => 'nested']]]);
        $ctx = ['user' => null, 'attempt' => 2, 'jobId' => 'job-test'];
        $fn = '\\FirstApp\\' . $job['handler'];
        $db->transaction(static fn () => $fn(\First\Seam::toJs($input, $job['input']), \First\Seam::ctx($ctx)));
        echo \First\Js::jsonStringify([$private, $public, $authenticated, $fieldThrows, $actionAllowed, $actionThrows, $widened, [$update, $subscriberUpdate], $bucketGuest, $db->findMany('audit')]);
    "#,
        &serde_json::Value::Null,
    );
    assert!(
        out.status.success(),
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout);
    let result: serde_json::Value =
        serde_json::from_str(text.lines().next_back().unwrap_or("")).unwrap_or_else(|_| panic!("{text}"));
    let nullable_arguments = serde_json::json!({"local": 1, "module": 2, "sibling": 3, "stable": "a", "unchecked": {"tail": [null], "reversed": "b", "captured": "b", "forwarded": "b", "grown": "a", "present": true, "defaulted": true, "moduleDefaulted": true, "moduleProvided": false, "destructuredDefault": true, "destructuredProvided": false, "early": null, "late": "b"}, "ordered": 4, "looped": "b", "earlier": 0});
    assert_eq!(
        result,
        serde_json::json!([false, true, false, true, true, true, {"finite": ["a", "b"], "callbacks": [null], "tuples": ["aa"], "finiteDefaults": ["a", "b"], "defaultTuple": "aa", "numeric": {"value": 2, "count": 2, "item": 1, "keep": 0}, "effects": {"captured": 2, "invoked": 2, "loop": 2, "helper": {"count": 3, "captured": 3, "keep": 0}, "shadow": 1, "early": 0, "byValue": 1, "passed": {"object": {"keep": 0}, "destructured": {"keep": 0}}, "callback": 2, "defaulted": 2, "localDefaulted": 2, "logical": {"nullish": 2, "or": 2, "and": 1, "guarded": 3, "absent": 0, "nested": 4}, "nullableArguments": nullable_arguments}, "formatted": "-1", "inferredNumber": "0"}, [true, false], false, [{"id": 1, "note": "typed:job-test:2:nested"}]])
    );
    let _ = std::fs::remove_dir_all(tmp);
}

/// There is one target: `--target` is no longer a flag and `target` no longer a config option, and
/// a plain `first build` writes the WordPress plugins.
#[test]
fn builds_wordpress_and_knows_no_target_option() {
    let tmp = std::env::temp_dir().join(format!("first-no-target-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures/db-globals"), &tmp);
    let refused = first().args(["build", "--target", "wp"]).arg(&tmp).output().unwrap();
    let stderr = String::from_utf8_lossy(&refused.stderr);
    assert_eq!(refused.status.code(), Some(2), "{stderr}");
    assert!(stderr.contains("unknown option --target for first build"), "{stderr}");
    let config = std::fs::read_to_string(tmp.join("first.config.ts")).unwrap();
    std::fs::write(
        tmp.join("first.config.ts"),
        config.replacen("defineConfig({", "defineConfig({ target: \"wp\",", 1),
    )
    .unwrap();
    let refused = first().arg("check").arg(&tmp).output().unwrap();
    let stderr = String::from_utf8_lossy(&refused.stderr);
    assert_eq!(refused.status.code(), Some(1), "{stderr}");
    assert!(stderr.contains("defineConfig() has no option `target`"), "{stderr}");
    assert!(
        !tmp.join(".first").exists() && !tmp.join("first/_generated").exists() && !tmp.join("first/dist").exists(),
        "a refusal wrote files"
    );
    std::fs::write(tmp.join("first.config.ts"), config).unwrap();
    let built = first().args(["build", "--quiet"]).arg(&tmp).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    assert!(tmp.join("first/dist/wp-content/first-manifest.json").is_file());
    assert!(tmp.join("first/_generated/migrations/0001_init.sql").is_file());
    let _ = std::fs::remove_dir_all(tmp);
}

/// A kind's `url` and `staged` and the config's `frontend` (docs/spec/spec.md §2.7, §5): checked at
/// build time and emitted into schema.php, where the runtime reads them.
#[test]
fn kind_urls_and_the_frontend_mode_reach_the_schema() {
    rejects(
        "reject-kind-url",
        "`:titel` in \"/notes/:titel\" names no field of this kind",
        "first.config.ts:2:59",
    );
    rejects(
        "reject-kind-url-overlap",
        "\"/n/:topic/:id\" can match the same URLs as `notes`'s url",
        "first.config.ts:3:74",
    );
    rejects(
        "reject-table-url",
        "only collection() kinds have URLs",
        "first.config.ts:2:54",
    );
    rejects(
        "reject-frontend",
        "`frontend` \"http://example.com\" uses http://; only localhost may",
        "first.config.ts:2:59",
    );
    let tmp = tempfile::tempdir().unwrap();
    let schema = |config: &str| -> serde_json::Value {
        // A fresh project each time: these schemas are unrelated apps, not one app's history.
        let project = tmp.path().join(format!("app-{}", config.len()));
        std::fs::create_dir_all(&project).unwrap();
        std::fs::write(project.join("first.config.ts"), config).unwrap();
        let built = first().args(["build", "--quiet"]).arg(&project).output().unwrap();
        assert!(
            built.status.success(),
            "{}{}",
            String::from_utf8_lossy(&built.stdout),
            String::from_utf8_lossy(&built.stderr)
        );
        let app = project.join("first/dist/wp-content/plugins/first-app-kindurls");
        let out = Command::new("php")
            .args(["-r", "echo json_encode(require $argv[1]);"])
            .arg(app.join("first/app/schema.php"))
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        serde_json::from_slice(&out.stdout).unwrap()
    };
    let built = schema(
        r#"import { collection, defineConfig, text } from "first";
export const notes = collection({ title: text() }, { url: "/notes/:year/:slug" });
export const plain = collection({ title: text() });
export default defineConfig({ name: "kindurls", collections: { notes, plain }, frontend: "https://www.example.com/" });
"#,
    );
    assert_eq!(built["collections"]["notes"]["url"], "/notes/:year/:slug");
    assert!(built["collections"]["plain"].get("url").is_none(), "{built}");
    assert_eq!(built["frontend"], "https://www.example.com");
    let built = schema(
        r#"import { defineConfig } from "first";
export default defineConfig({ name: "kindurls", frontend: false });
"#,
    );
    assert_eq!(built["frontend"], false);
    let built = schema(
        r#"import { defineConfig } from "first";
export default defineConfig({ name: "kindurls" });
"#,
    );
    assert!(built.get("frontend").is_none(), "{built}");
    // `publicAuthors` reaches the runtime only when set (spec.md §6, the authors switch).
    assert!(built.get("publicAuthors").is_none(), "{built}");
    let built = schema(
        r#"import { defineConfig } from "first";
export default defineConfig({ name: "kindurls", publicAuthors: true });
"#,
    );
    assert_eq!(built["publicAuthors"], true);
    let refused = tmp.path().join("app-public-authors");
    std::fs::create_dir_all(&refused).unwrap();
    std::fs::write(
        refused.join("first.config.ts"),
        "import { defineConfig } from \"first\";\nexport default defineConfig({ name: \"kindurls\", publicAuthors: \"yes\" });\n",
    )
    .unwrap();
    let out = first().args(["build", "--quiet"]).arg(&refused).output().unwrap();
    assert!(!out.status.success());
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("publicAuthors must be true or false"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    // `staged: false` is the one staged setting the schema carries: collections stage unless it is there.
    let built = schema(
        r#"import { collection, defineConfig, text } from "first";
export const notes = collection({ title: text() });
export const fixed = collection({ title: text() }, { staged: false });
export default defineConfig({ name: "kindurls", collections: { notes, fixed } });
"#,
    );
    assert!(built["collections"]["notes"].get("staged").is_none(), "{built}");
    assert_eq!(built["collections"]["fixed"]["staged"], false);
}

/// A project whose ledger is still at `first/migrations/` is refused, never read as a first build:
/// the build stops before it writes, so the numbering cannot restart at 0001 and the plugin cannot
/// ship without its earlier files. Following the fix in the message builds again with nothing new.
/// A version 1 snapshot is refused the same way.
#[test]
fn refuses_the_old_ledger_path_and_older_snapshots_instead_of_renumbering() {
    let tmp = std::env::temp_dir().join(format!("first-legacy-layout-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    copy(&root().join("tests/fixtures/db-globals"), &tmp);
    let built = first().args(["build", "--quiet"]).arg(&tmp).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    let migrations = tmp.join("first/_generated/migrations");
    let snapshot = std::fs::read_to_string(migrations.join("snapshot.json")).unwrap();
    /// Every file under the project with its bytes, so a refusal is proven to write nothing anywhere.
    fn tree(dir: &Path) -> std::collections::BTreeMap<PathBuf, Vec<u8>> {
        let mut out = std::collections::BTreeMap::new();
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                out.extend(tree(&path));
            } else {
                out.insert(path.clone(), std::fs::read(&path).unwrap());
            }
        }
        out
    }
    let refused = |message: &str| {
        let before = tree(&tmp);
        let out = first().args(["build", "--quiet"]).arg(&tmp).output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{stderr}");
        assert!(stderr.contains(message), "expected {message:?} in {stderr}");
        assert!(tree(&tmp) == before, "the refusal changed the project");
    };
    let old = tmp.join("first/migrations");
    std::fs::rename(&migrations, &old).unwrap();
    refused("first/migrations/ moved to first/_generated/migrations/");
    // An old directory left beside the new one is refused too: one ledger, never two.
    std::fs::create_dir_all(&migrations).unwrap();
    refused("first/migrations/ moved to first/_generated/migrations/");
    std::fs::remove_dir(&migrations).unwrap();
    // A pre-flat checkout moved as-is keeps its `wp/` and `sqlite/` subdirectories: still refused
    // at the new path, so following the first message can't restart the numbering.
    std::fs::rename(&old, &migrations).unwrap();
    let init = std::fs::read_to_string(migrations.join("0001_init.sql")).unwrap();
    for nested in ["wp", "sqlite"] {
        std::fs::create_dir_all(migrations.join(nested)).unwrap();
        std::fs::write(migrations.join(nested).join("0001_init.sql"), &init).unwrap();
        refused(&format!(
            "first/_generated/migrations/{nested}/ is from an earlier layout"
        ));
        std::fs::remove_dir_all(migrations.join(nested)).unwrap();
    }
    let mut v1: serde_json::Value = serde_json::from_str(&snapshot).unwrap();
    v1["version"] = serde_json::json!(1);
    std::fs::write(
        migrations.join("snapshot.json"),
        serde_json::to_string_pretty(&v1).unwrap() + "\n",
    )
    .unwrap();
    refused("is a version 1 snapshot");
    // Restored, the project builds again and plans nothing new.
    std::fs::write(migrations.join("snapshot.json"), &snapshot).unwrap();
    let again = first().args(["build", "--quiet"]).arg(&tmp).output().unwrap();
    assert!(again.status.success(), "{}", String::from_utf8_lossy(&again.stderr));
    assert!(!migrations.join("0002_update.sql").exists());
    // A checkout from before `first/_generated/`: the ledger still in `first/migrations/` and nothing
    // generated beside it. Building there would start a second 0001_init.sql, so the build names
    // the move; running exactly the command it prints is enough.
    let old = tmp.join("first/migrations");
    std::fs::rename(&migrations, &old).unwrap();
    std::fs::remove_dir_all(tmp.join("first/_generated")).unwrap();
    std::fs::remove_dir_all(tmp.join("first/dist")).unwrap();
    let fix = "mkdir -p first/_generated && rmdir first/_generated/migrations 2>/dev/null; git mv first/migrations first/_generated/migrations";
    refused("first/migrations/ moved to first/_generated/migrations/");
    refused(fix);
    let git = |args: &[&str]| {
        let out = Command::new("git").args(args).current_dir(&tmp).output().unwrap();
        assert!(
            out.status.success(),
            "git {args:?}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    };
    git(&["init", "-q"]);
    git(&["add", "-A"]);
    let moved = Command::new("sh").args(["-c", fix]).current_dir(&tmp).output().unwrap();
    assert!(moved.status.success(), "{}", String::from_utf8_lossy(&moved.stderr));
    let moved = first().args(["build", "--quiet"]).arg(&tmp).output().unwrap();
    assert!(moved.status.success(), "{}", String::from_utf8_lossy(&moved.stderr));
    assert!(!migrations.join("0002_update.sql").exists());
    // The other committed files from before `first/_generated/`: each is refused, writing nothing,
    // and the printed command is the whole fix. Left in place, a lock would be ignored (and
    // replaced) and an old client would load as app code.
    for (old, new, content) in [
        (
            "first/abilities.json",
            "first/_generated/abilities.json",
            r#"{"version":1,"abilities":[]}"#,
        ),
        (
            "first/wp-plugins.lock.json",
            "first/_generated/wp-plugins.lock.json",
            "",
        ),
        (
            "first/client/index.ts",
            "first/_generated/client/index.ts",
            "import { SCHEMA } from \"./schema.ts\";\nexport const stale = SCHEMA;\n",
        ),
    ] {
        let (old_dir, new_dir) = if old.starts_with("first/client/") {
            ("first/client", "first/_generated/client")
        } else {
            (old, new)
        };
        let path = tmp.join(old);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        // The pin lock is the one the last build wrote, moved back to where it used to live.
        let content = if content.is_empty() {
            std::fs::read_to_string(tmp.join(new)).unwrap()
        } else {
            content.to_string()
        };
        std::fs::write(&path, content).unwrap();
        refused(&format!("{old_dir} moved to {new_dir}"));
        let fix = format!("mkdir -p first/_generated && git mv {old_dir} {new_dir}");
        refused(&fix);
        git(&["add", "-A"]);
        // The old client and lock may already have a regenerated twin; the move replaces it.
        let _ = std::fs::remove_dir_all(tmp.join(new_dir));
        let _ = std::fs::remove_file(tmp.join(new_dir));
        let moved = Command::new("sh")
            .args(["-c", &fix])
            .current_dir(&tmp)
            .output()
            .unwrap();
        assert!(
            moved.status.success(),
            "{fix}: {}",
            String::from_utf8_lossy(&moved.stderr)
        );
        assert!(tmp.join(new).is_file() && !tmp.join(old_dir).exists());
        if old_dir == "first/client" {
            std::fs::remove_dir_all(tmp.join(new_dir)).unwrap();
        }
        let again = first().args(["build", "--quiet"]).arg(&tmp).output().unwrap();
        assert!(
            again.status.success(),
            "{old}: {}",
            String::from_utf8_lossy(&again.stderr)
        );
    }
    // Several left at once: one refusal names every one, and its one command moves them all.
    std::fs::rename(
        tmp.join("first/_generated/abilities.json"),
        tmp.join("first/abilities.json"),
    )
    .unwrap();
    std::fs::rename(
        tmp.join("first/_generated/wp-plugins.lock.json"),
        tmp.join("first/wp-plugins.lock.json"),
    )
    .unwrap();
    refused("2 files are from before first/_generated/:");
    refused("first/abilities.json moved to first/_generated/abilities.json");
    refused("first/wp-plugins.lock.json moved to first/_generated/wp-plugins.lock.json");
    let fix = "mkdir -p first/_generated && git mv first/wp-plugins.lock.json first/_generated/wp-plugins.lock.json && git mv first/abilities.json first/_generated/abilities.json";
    refused(fix);
    git(&["add", "-A"]);
    let moved = Command::new("sh").args(["-c", fix]).current_dir(&tmp).output().unwrap();
    assert!(moved.status.success(), "{}", String::from_utf8_lossy(&moved.stderr));
    let again = first().args(["build", "--quiet"]).arg(&tmp).output().unwrap();
    assert!(again.status.success(), "{}", String::from_utf8_lossy(&again.stderr));
    let _ = std::fs::remove_dir_all(tmp);
}

/// The auth-collection fixture the PHP suites run on is exactly what the compiler emits for it.
/// Storage follows the builder (docs/config-api.md, "Schema changes at deploy"). A kind the ledger
/// holds as a SQL table, declared again with collection(), is refused at its declaration before any
/// migration is written: building it would plan the table's drop. Declared with table() again it
/// builds with no migration. The other way, posts declared as a table() still build, with a warning.
#[test]
fn a_stored_table_declared_with_collection_is_refused_before_anything_is_written() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path();
    std::fs::create_dir_all(project.join("first")).unwrap();
    std::fs::write(
        project.join("first.config.ts"),
        "import { defineConfig } from \"first\";\nexport default defineConfig({ name: \"stored\" });\n",
    )
    .unwrap();
    let schema = |builder: &str| {
        std::fs::write(
            project.join("first/schema.ts"),
            format!(
                "import {{ {builder}, text }} from \"first\";\nexport const memos = {builder}({{ title: text() }});\n"
            ),
        )
        .unwrap();
    };
    let ledger = || {
        let dir = project.join("first/_generated/migrations");
        let mut files: Vec<(String, Vec<u8>)> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| {
                let e = e.unwrap();
                (
                    e.file_name().to_string_lossy().into_owned(),
                    std::fs::read(e.path()).unwrap(),
                )
            })
            .collect();
        files.sort();
        files
    };
    schema("table");
    let built = first().args(["build", "--quiet"]).arg(project).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    let deployed = ledger();

    schema("collection");
    for command in ["check", "build"] {
        let out = first().arg(command).arg(project).output().unwrap();
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "{command}: {stderr}");
        assert!(
            stderr.contains("`memos` is stored as a SQL table, and collection() is always WordPress posts"),
            "{stderr}"
        );
        assert!(stderr.contains("--> first/schema.ts:2:22"), "{stderr}");
        assert!(stderr.contains("help: declare it with table() again"), "{stderr}");
        assert_eq!(ledger(), deployed, "{command} wrote nothing to the ledger");
    }

    schema("table");
    let again = first().args(["build", "--quiet"]).arg(project).output().unwrap();
    assert!(again.status.success(), "{}", String::from_utf8_lossy(&again.stderr));
    assert_eq!(ledger(), deployed, "table() again needs no migration");

    // Posts declared as a table() lose nothing (they stay in wp_posts), so that builds and warns.
    let posts = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(posts.path().join("first")).unwrap();
    std::fs::copy(project.join("first.config.ts"), posts.path().join("first.config.ts")).unwrap();
    let declare = |builder: &str| {
        std::fs::write(
            posts.path().join("first/schema.ts"),
            format!(
                "import {{ {builder}, text }} from \"first\";\nexport const memos = {builder}({{ title: text() }});\n"
            ),
        )
        .unwrap();
        first().args(["build"]).arg(posts.path()).output().unwrap()
    };
    assert!(declare("collection").status.success());
    let warned = declare("table");
    assert!(warned.status.success(), "{}", String::from_utf8_lossy(&warned.stderr));
    assert!(
        String::from_utf8_lossy(&warned.stderr).contains("creates an empty SQL table for \"memos\""),
        "{}",
        String::from_utf8_lossy(&warned.stderr)
    );
}

#[test]
fn auth_fixture_matches_the_compiler() {
    let tmp = std::env::temp_dir().join(format!("first-auth-fixture-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();
    let fixture = root().join("tests/fixtures/auth");
    std::fs::copy(fixture.join("first.config.ts"), tmp.join("first.config.ts")).unwrap();
    let out = first().arg("build").arg(&tmp).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let out = Command::new("php")
        .args(["-r", "echo json_encode(require $argv[1]);"])
        .arg(tmp.join("first/dist/wp-content/plugins/first-app-club/first/app/schema.php"))
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let actual: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    let golden: serde_json::Value =
        serde_json::from_slice(&std::fs::read(fixture.join("schema.json")).unwrap()).unwrap();
    assert_eq!(
        actual, golden,
        "tests/fixtures/auth/schema.json drifted from the compiler"
    );
    // The generated client types the user projection as §6.2 says (tests/fixtures/auth/client.ts).
    std::fs::copy(fixture.join("client.ts"), tmp.join("client.ts")).unwrap();
    let out = Command::new(std::env::var_os("TSC").unwrap_or_else(|| "tsc".into()))
        .args([
            "--strict",
            "--noEmit",
            "--target",
            "ES2022",
            "--module",
            "ESNext",
            "--moduleResolution",
            "bundler",
            "--allowImportingTsExtensions",
        ])
        .arg(tmp.join("client.ts"))
        .output()
        .expect("tsc (or TSC) must be installed to check generated clients");
    assert!(
        out.status.success(),
        "auth client contract failed: {}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let _ = std::fs::remove_dir_all(&tmp);
}

/// A plugin package from a fixture `node_modules`, registered from the app and run as generated
/// PHP: its hook transforms the row before the app's hook sees it, a write the lock doesn't grant
/// is refused at build, and a runtime-built fetch URL outside the locked hosts is refused at run.
#[test]
fn a_plugin_package_runs_under_its_locked_grant() {
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("plugins");
    copy(&root().join("tests/fixtures/plugin-seo"), &project);
    let index = project.join("node_modules/first-plugin-seo/src/index.ts");
    let source = std::fs::read_to_string(&index).unwrap();

    // The owner's lock grants posts.summary only; the same package writing posts.body is refused.
    std::fs::write(
        &index,
        source.replace("data.summary = ", "data.body = \"x\";\n          data.summary = "),
    )
    .unwrap();
    let refused = first().args(["build", "--frozen"]).arg(&project).output().unwrap();
    let stderr = String::from_utf8_lossy(&refused.stderr);
    assert_eq!(refused.status.code(), Some(1), "{stderr}");
    assert!(
        stderr.contains(
            "plugin \"seo\" writes posts.body; first/_generated/plugins.lock.json grants it only posts.summary"
        ),
        "{stderr}"
    );
    assert!(!project.join(".first").exists(), "a refused plugin generates nothing");

    // The same narrowed lock left at its place from before first/_generated/: without --frozen it
    // must not be skipped and replaced by a lock granting posts.body. The build refuses and the
    // owner's file is untouched.
    let lock = project.join("first/_generated/plugins.lock.json");
    let old = project.join("first/plugins.lock.json");
    let granted = std::fs::read(&lock).unwrap();
    std::fs::rename(&lock, &old).unwrap();
    let refused = first().arg("build").arg(&project).output().unwrap();
    let stderr = String::from_utf8_lossy(&refused.stderr);
    assert_eq!(refused.status.code(), Some(1), "{stderr}");
    assert!(
        stderr.contains("first/plugins.lock.json moved to first/_generated/plugins.lock.json"),
        "{stderr}"
    );
    assert_eq!(std::fs::read(&old).unwrap(), granted);
    assert!(!lock.exists(), "a refusal writes no lock");
    std::fs::rename(&old, &lock).unwrap();

    std::fs::write(&index, source).unwrap();
    let out = first().args(["build", "--frozen"]).arg(&project).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let got = wp_eval_json(
        &project.join("first/dist/wp-content"),
        r#"$row = json_decode($app->cli(['insert', 'posts', '{"title":"Hello plugins"}'])[1], true)['data'][0];
           $denied = json_decode($app->cli(['action', 'seo_lookup', '{"url":"https://elsewhere.example/x"}'])[1], true);
           echo json_encode(['summary' => $row['summary'], 'body' => $row['body'], 'denied' => $denied['error']['code'] ?? $denied]);"#,
        &serde_json::Value::Null,
    );
    assert_eq!(
        got,
        serde_json::json!({
            "summary": "HELLO PLUGIN | Site",
            "body": "seen: HELLO PLUGIN | Site",
            "denied": "first_fetch_host_denied",
        })
    );
}

/// One large imported function in the shape of picomatch's `parse.js`: a token loop whose
/// branches push, pop, slice and copy token objects that point at each other through `prev`.
/// The effects solver once re-ran every rule over every fact on each pass, which took minutes
/// here. It now reads only new facts, so its work stays a small multiple of the facts it
/// produces. Debug builds count that work (`FIRST_DEBUG_EFFECTS_WORK`). On this program the
/// old solver made 51M path projections for 1.36M facts (37 per fact) and took 20 s in a
/// release build; the incremental solver makes 3.5M (2.6 per fact).
#[test]
fn effects_solver_work_stays_proportional_to_its_result_on_a_large_function() {
    let mut body = String::from(
        "export function run(input) {
  const state = { index: -1, output: '', tokens: [], prev: null, depth: 0 };
  const bos = { type: 'bos', value: '', output: '' };
  const tokens = [bos];
  let prev = bos;
  let value = '';
  const advance = () => input[++state.index];
  const append = tok => { state.output += tok.output != null ? tok.output : tok.value; };
  const push = tok => {
    if (prev && prev.type === tok.type) { prev.value += tok.value; prev.output = (prev.output || '') + tok.value; return; }
    tok.prev = prev; tokens.push(tok); prev = tok; state.prev = tok;
  };
  const pop = () => { const tok = tokens.pop(); prev = tokens[tokens.length - 1]; return tok; };
  while (state.index < input.length - 1) {
    value = advance();
",
    );
    for i in 0..60 {
        body.push_str(&match i % 6 {
            0 => format!("    if (value === 'a{i}') {{ push({{ type: 't{}', value, output: prev.output + value }}); continue; }}\n", i % 7),
            1 => format!("    if (value === 'b{i}') {{ const t = {{ type: 'p', value, prev: prev.prev }}; t.output = prev.value; push(t); append(t); continue; }}\n"),
            2 => format!("    if (value === 'c{i}' && prev.prev) {{ prev.prev.output = prev.output; prev.value = state.output; state.depth++; continue; }}\n"),
            3 => format!("    if (value === 'd{i}') {{ const last = pop(); if (last) {{ last.output = value; push(last); }} continue; }}\n"),
            4 => format!("    if (value === 'e{i}') {{ const s = tokens.slice(-2); state.tokens = s; prev.output = s.length + ''; continue; }}\n"),
            _ => format!("    if (value === 'f{i}') {{ const o = {{ ...prev, value: prev.value + value }}; append(o); push({{ type: 'f', value: o.value, output: o.output }}); continue; }}\n"),
        });
    }
    body.push_str(
        "    push({ type: 'text', value, output: value });
  }
  return state.output + ':' + tokens.length + ':' + state.depth;
}
",
    );
    let tmp = tempfile::tempdir().unwrap();
    // App modules live under first/ (the import fence).
    std::fs::create_dir_all(tmp.path().join("first")).unwrap();
    std::fs::write(tmp.path().join("first/run.mjs"), body).unwrap();
    std::fs::write(
        tmp.path().join("first.config.ts"),
        r#"import { action, defineConfig, text } from "first";
import { run } from "./first/run.mjs";
export default defineConfig({ name: "p", actions: { a: action({ access: "anyone", input: { s: text() }, async handler(input) { return { v: run(input.s) }; } }) } });
"#,
    )
    .unwrap();
    let work = tmp.path().join("work.txt");
    let out = first()
        .args(["check", "--json"])
        .arg(tmp.path())
        .env("FIRST_DEBUG_EFFECTS_WORK", &work)
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stdout));
    let work = std::fs::read_to_string(&work).expect("debug builds record the solver's work");
    let (projections, facts) = work
        .lines()
        .map(|line| {
            let field = |name: &str| -> u64 {
                line.split(' ')
                    .find_map(|part| part.strip_prefix(name)?.strip_prefix('='))
                    .and_then(|n| n.parse().ok())
                    .unwrap_or_else(|| panic!("{name} in {line:?}"))
            };
            (field("projections"), field("facts"))
        })
        .max_by_key(|(_, facts)| *facts)
        .expect("one solve");
    assert!(facts > 1_000_000, "the program no longer stresses the solver: {work}");
    assert!(
        projections < 5 * facts,
        "the effects solver repeats work: {projections} projections for {facts} facts"
    );
}

/// A request to the facade with any body and headers: (status, content type, body text).
fn api(
    server: &Server,
    method: &str,
    path: &str,
    user: Option<&str>,
    headers: &[(&str, &str)],
    body: &[u8],
) -> (u16, String, String) {
    let mut s = TcpStream::connect(("127.0.0.1", server.port)).unwrap();
    let mut head = format!(
        "{method} /__first/api/v1{path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n",
        body.len()
    );
    if let Some(user) = user {
        head += &format!(
            "Authorization: Basic {}\r\n",
            base64(server.credential(user).as_bytes())
        );
    }
    if !headers
        .iter()
        .any(|(name, _)| name.eq_ignore_ascii_case("content-type"))
    {
        head += "Content-Type: application/json\r\n";
    }
    for (name, value) in headers {
        head += &format!("{name}: {value}\r\n");
    }
    // One write: php -S rejects requests whose head arrives in pieces.
    let mut request = (head + "\r\n").into_bytes();
    request.extend_from_slice(body);
    s.write_all(&request).unwrap();
    let mut raw = Vec::new();
    s.read_to_end(&mut raw).unwrap();
    let raw = String::from_utf8_lossy(&raw).into_owned();
    let (head, text) = raw.split_once("\r\n\r\n").unwrap_or((raw.as_str(), ""));
    let status: u16 = head
        .get(9..12)
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| panic!("bad response to {method} {path}: {raw:?}"));
    let content_type = head
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-type")
                .then(|| value.trim().to_string())
        })
        .unwrap_or_default();
    (status, content_type, text.to_string())
}

/// `first build` writes the app's API as an OpenAPI 3.1 document (spec §7), and the document is
/// true: it validates against the OpenAPI 3.1 schema, and every answer of a real WordPress site to
/// a request the document describes matches the response schema the document gives for that
/// operation and status. The fixture has one of everything the API serves, and every operation in
/// the document is called at least once.
#[test]
fn the_openapi_document_describes_what_the_api_answers() {
    use serde_json::{Value, json};
    let tmp = tempfile::tempdir().unwrap();
    let project = tmp.path().join("openapi");
    copy(&root().join("tests/fixtures/openapi"), &project);
    let out = first().arg("build").arg(&project).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let text = std::fs::read_to_string(project.join("first/_generated/openapi.json")).unwrap();
    let document: Value = serde_json::from_str(&text).unwrap();

    // The document is an OpenAPI 3.1 document (the schema OpenAPI publishes for 3.1), and each
    // schema in it compiles as JSON Schema 2020-12 with every `$ref` resolved.
    const DOCUMENT: &str = "https://first.test/openapi.json";
    let mut schemas = boon::Schemas::new();
    let mut compiler = boon::Compiler::new();
    compiler.set_default_draft(boon::Draft::V2020_12);
    let meta: Value =
        serde_json::from_slice(&std::fs::read(root().join("tests/fixtures/openapi-3.1.schema.json")).unwrap()).unwrap();
    let meta_id = meta["$id"].as_str().unwrap().to_string();
    compiler.add_resource(&meta_id, meta).unwrap();
    // Answers are checked against the document read strictly: an object schema that lists its
    // properties allows no others, so a field the API returns and the document leaves out fails
    // here. (The published document stays open, as a client should tolerate a new field.)
    fn closed(schema: &mut Value, field_map: bool) {
        match schema {
            Value::Object(map) => {
                if !field_map
                    && map.get("properties").is_some_and(Value::is_object)
                    && !map.contains_key("additionalProperties")
                {
                    map.insert("additionalProperties".into(), Value::Bool(false));
                }
                for (key, child) in map.iter_mut() {
                    closed(child, !field_map && key == "properties");
                }
            }
            Value::Array(items) => items.iter_mut().for_each(|item| closed(item, false)),
            _ => {}
        }
    }
    let mut strict = document.clone();
    closed(&mut strict, false);
    compiler.add_resource(DOCUMENT, strict).unwrap();
    let openapi = compiler.compile(&meta_id, &mut schemas).unwrap();
    if let Err(error) = schemas.validate(&document, openapi) {
        panic!("first/_generated/openapi.json is not an OpenAPI 3.1 document:\n{error:#}");
    }
    assert_eq!(document["openapi"], "3.1.0");
    // Every named schema is valid JSON Schema, the ones only requests use included.
    for name in document["components"]["schemas"].as_object().unwrap().keys() {
        compiler
            .compile(&format!("{DOCUMENT}#/components/schemas/{name}"), &mut schemas)
            .unwrap_or_else(|e| panic!("components.schemas.{name}: {e}"));
    }
    let mut ids = std::collections::HashSet::new();
    for item in document["paths"].as_object().unwrap().values() {
        for operation in item.as_object().unwrap().values() {
            let id = operation["operationId"].as_str().unwrap();
            assert!(ids.insert(id.to_string()), "two operations are named {id}");
        }
    }

    // Running twice writes the same bytes: the document is committed, so it must not churn.
    let again = first().arg("build").arg(&project).output().unwrap();
    assert!(again.status.success(), "{}", String::from_utf8_lossy(&again.stderr));
    assert_eq!(
        std::fs::read_to_string(project.join("first/_generated/openapi.json")).unwrap(),
        text
    );

    let pointer = |s: &str| s.replace('~', "~0").replace('/', "~1");
    // Every operation, by `METHOD path`, with the ones a request has matched.
    let mut operations: std::collections::BTreeMap<String, bool> = std::collections::BTreeMap::new();
    for (path, item) in document["paths"].as_object().unwrap() {
        for method in item.as_object().unwrap().keys() {
            operations.insert(format!("{} {path}", method.to_uppercase()), false);
        }
    }
    let templates: Vec<String> = document["paths"].as_object().unwrap().keys().cloned().collect();
    // The path template a request path belongs to: a literal segment wins over a parameter.
    let template_of = |path: &str| -> String {
        let path = path.split('?').next().unwrap();
        let segments: Vec<&str> = path.split('/').collect();
        let mut best: Option<(usize, &String)> = None;
        for template in &templates {
            let parts: Vec<&str> = template.split('/').collect();
            if parts.len() != segments.len() {
                continue;
            }
            let mut literals = 0;
            let matches = parts.iter().zip(&segments).all(|(part, segment)| {
                if part.starts_with('{') {
                    !segment.is_empty()
                } else {
                    literals += 1;
                    part == segment
                }
            });
            if matches && best.is_none_or(|(n, _)| literals > n) {
                best = Some((literals, template));
            }
        }
        best.unwrap_or_else(|| panic!("the document has no path for {path}"))
            .1
            .clone()
    };

    let content = project.join("first/dist/wp-content");
    let mut child = Command::new("php")
        .args(["-d", "memory_limit=512M"])
        .arg(root().join("tests/php/wp.php"))
        .arg("serve")
        .arg(&content)
        .env("FIRST_WP_IDENTITY", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("php");
    let mut line = String::new();
    std::io::BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .expect("the served site's description");
    let served: Value = serde_json::from_str(&line).unwrap_or_else(|_| panic!("serve: {line}"));
    let server = Server {
        child,
        port: served["url"]
            .as_str()
            .unwrap()
            .rsplit(':')
            .next()
            .unwrap()
            .parse()
            .unwrap(),
        users: served["users"].clone(),
        as_user: None,
        dir: served["dir"].as_str().unwrap().to_string(),
    };

    // One request: the answer must be the status expected, in the content type the document gives
    // that status, and match its schema. Returns the decoded JSON body (null for other types).
    let mut check = |method: &str,
                     path: &str,
                     user: Option<&str>,
                     headers: &[(&str, &str)],
                     body: &[u8],
                     expect: u16|
     -> Value {
        let (status, content_type, text) = api(&server, method, path, user, headers, body);
        assert_eq!(status, expect, "{method} {path} as {user:?}: {text}");
        let template = template_of(path);
        let key = format!("{method} {template}");
        let covered = operations
            .get_mut(&key)
            .unwrap_or_else(|| panic!("the document has no operation {key}"));
        *covered |= status < 300;
        let operation = &document["paths"][&template][method.to_lowercase()];
        if status < 300 {
            // What was sent is what the document says the operation takes: each query argument is
            // one of its parameters, and a JSON body matches its request schema.
            let declared: Vec<&str> = operation["parameters"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|p| match p["$ref"].as_str() {
                    Some(reference) => document.pointer(reference.trim_start_matches('#')).unwrap(),
                    None => p,
                })
                .filter(|p| p["in"] == "query")
                .map(|p| p["name"].as_str().unwrap())
                .collect();
            let declared_headers: Vec<String> = operation["parameters"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|p| p["in"] == "header")
                .map(|p| p["name"].as_str().unwrap().to_ascii_lowercase())
                .collect();
            for (name, _) in headers {
                let name = name.to_ascii_lowercase();
                assert!(
                    name == "content-type" || name == "authorization" || declared_headers.contains(&name),
                    "{key} was sent the header `{name}`, which the document does not list: {declared_headers:?}"
                );
            }
            for pair in path
                .split_once('?')
                .map(|(_, q)| q)
                .unwrap_or("")
                .split('&')
                .filter(|p| !p.is_empty())
            {
                let name = pair.split('=').next().unwrap();
                assert!(
                    declared.contains(&name),
                    "{key} was sent `{name}`, which the document does not list: {declared:?}"
                );
            }
            let sent_json = !headers
                .iter()
                .any(|(name, _)| name.eq_ignore_ascii_case("content-type"));
            if sent_json && !body.is_empty() {
                let location = format!(
                    "{DOCUMENT}#/paths/{}/{}/requestBody/content/application~1json/schema",
                    pointer(&template),
                    method.to_lowercase()
                );
                let schema = compiler
                    .compile(&location, &mut schemas)
                    .unwrap_or_else(|e| panic!("{key}: the request schema does not compile: {e}"));
                let sent: Value = serde_json::from_slice(body).unwrap();
                if let Err(error) = schemas.validate(&sent, schema) {
                    panic!(
                        "{method} {path} was accepted with a body the document does not describe:\n{error:#}\n{sent}"
                    );
                }
            }
        }
        let responses = &operation["responses"];
        let (code, described) = match responses.get(status.to_string()) {
            Some(response) => (status.to_string(), response),
            None => ("default".to_string(), &responses["default"]),
        };
        // A response is given inline or as the shared problem response.
        let (base, described) = match described["$ref"].as_str() {
            Some(reference) => (
                reference.to_string(),
                document.pointer(reference.trim_start_matches('#')).unwrap(),
            ),
            None => (
                format!(
                    "#/paths/{}/{}/responses/{code}",
                    pointer(&template),
                    method.to_lowercase()
                ),
                described,
            ),
        };
        let media = content_type.split(';').next().unwrap().trim().to_string();
        let types = described["content"]
            .as_object()
            .unwrap_or_else(|| panic!("{key} {code} has no content"));
        let media_key = if types.contains_key(&media) {
            media.clone()
        } else {
            "*/*".to_string()
        };
        assert!(
            types.contains_key(&media_key),
            "{key} answered {status} as {media}, which the document does not list: {text}"
        );
        if media != "application/json" && media != "application/problem+json" {
            return Value::Null;
        }
        let json: Value = serde_json::from_str(&text).unwrap_or_else(|_| panic!("{key}: not JSON: {text}"));
        let location = format!("{DOCUMENT}{base}/content/{}/schema", pointer(&media_key));
        let schema = compiler
            .compile(&location, &mut schemas)
            .unwrap_or_else(|e| panic!("{key} {code}: the response schema does not compile: {e}"));
        if let Err(error) = schemas.validate(&json, schema) {
            panic!(
                "{method} {path} as {user:?} answered {status} with a body the document does not describe:\n{error:#}\n{text}"
            );
        }
        json
    };
    let json = |value: Value| value.to_string().into_bytes();
    let query = |name: &str, value: &Value| -> String {
        let encoded: String = value
            .to_string()
            .bytes()
            .map(|b| match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => (b as char).to_string(),
                other => format!("%{other:02X}"),
            })
            .collect();
        format!("{name}={encoded}")
    };

    // The document itself, as the site serves it: the built file, with this site as its server.
    let live = check("GET", "/openapi.json", None, &[], b"", 200);
    assert_eq!(live["servers"][0]["url"], format!("{}/__first/api/v1", server.url()));
    assert_eq!(live["paths"], document["paths"]);
    assert_eq!(live["components"], document["components"]);
    let described = check("GET", "/", None, &[], b"", 200);
    assert_eq!(described["data"]["name"], "openapi");

    // Collections: every operation, as the roles its rules name.
    let ada = check(
        "POST",
        "/authors",
        Some("editor"),
        &[],
        &json(json!({ "name": "Ada", "email": "ada@example.test" })),
        201,
    );
    let author = ada["data"]["id"].as_i64().unwrap();
    assert_eq!(ada["data"]["email"], "ada@example.test");
    check("POST", "/authors", None, &[], &json(json!({ "name": "Nobody" })), 401);
    check(
        "POST",
        "/authors",
        Some("subscriber"),
        &[],
        &json(json!({ "name": "Nobody" })),
        403,
    );
    check(
        "POST",
        "/authors",
        Some("editor"),
        &[],
        &json(json!({ "email": "x@example.test" })),
        422,
    );
    check("POST", "/authors", Some("editor"), &[], b"{", 400);
    check(
        "POST",
        "/authors",
        Some("editor"),
        &[],
        &json(json!({ "name": "Twin", "email": "ada@example.test" })),
        409,
    );
    // A field only editors read is absent for everyone else, as the row schema says it may be.
    let listed = check("GET", "/authors", None, &[], b"", 200);
    assert!(listed["data"][0].get("email").is_none(), "{listed}");
    assert_eq!(
        check("GET", "/authors", Some("editor"), &[], b"", 200)["data"][0]["email"],
        "ada@example.test"
    );
    check("GET", &format!("/authors/{author}"), None, &[], b"", 200);
    check(
        "PATCH",
        &format!("/authors/{author}"),
        Some("editor"),
        &[],
        &json(json!({ "name": "Ada L." })),
        200,
    );
    let saved = check(
        "GET",
        &format!("/authors/{author}/revisions"),
        Some("editor"),
        &[],
        b"",
        200,
    );
    let first_save = saved["data"].as_array().unwrap().last().unwrap()["id"]
        .as_i64()
        .unwrap();
    assert_eq!(
        check(
            "GET",
            &format!("/authors/{author}/revisions/{first_save}"),
            Some("editor"),
            &[],
            b"",
            200
        )["data"]["name"],
        "Ada"
    );
    assert_eq!(
        check(
            "POST",
            &format!("/authors/{author}/revisions/{first_save}/restore"),
            Some("editor"),
            &[],
            b"",
            200
        )["data"]["name"],
        "Ada"
    );
    check(
        "PATCH",
        &format!("/authors/{author}"),
        Some("editor"),
        &[],
        &json(json!({ "name": "Ada L." })),
        200,
    );

    let note = check(
        "POST",
        "/notes",
        Some("editor"),
        &[],
        &json(json!({
            "title": "First note", "body": "<p>Tea</p>", "rating": 4.5, "tags": ["home"], "author": author,
            "seo": { "heading": "H" }, "steps": [{ "label": "one" }],
            "sections": [{ "layout": "quote", "text": "q" }, { "layout": "rule" }],
            "extra": { "source": "x" }, "due": "2026-12-01", "remindAt": "2026-12-01T10:00:00Z", "link": "https://example.test/a",
        })),
        201,
    );
    let id = note["data"]["id"].as_i64().unwrap();
    let draft = check(
        "POST",
        "/notes",
        Some("editor"),
        &[],
        &json(json!({ "title": "Draft", "status": "draft" })),
        201,
    );
    let draft_id = draft["data"]["id"].as_i64().unwrap();
    check(
        "POST",
        "/notes",
        Some("editor"),
        &[],
        &json(json!({ "title": "Bad", "rating": 9 })),
        422,
    );
    // A list with every query argument the document names; a draft is an editor's to see.
    let with_author = check(
        "GET",
        "/notes?with=author,cover&orderBy=-id&limit=1&offset=0&search=First&status=published",
        None,
        &[],
        b"",
        200,
    );
    assert_eq!(with_author["data"][0]["author"]["name"], "Ada L.", "{with_author}");
    let filtered = check(
        "GET",
        &format!(
            "/notes?{}",
            query(
                "where",
                &json!({ "rating": { "gte": 4 }, "tags": { "has": "home" }, "OR": [{ "pinned": false }] })
            )
        ),
        None,
        &[],
        b"",
        200,
    );
    assert_eq!(filtered["data"].as_array().unwrap().len(), 1, "{filtered}");
    assert_eq!(
        check("GET", "/notes", None, &[], b"", 200)["data"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let paged = check("GET", "/notes?limit=1", Some("editor"), &[], b"", 200);
    let cursor = paged["cursor"].as_str().expect("a second page").to_string();
    check(
        "GET",
        &format!("/notes?limit=1&cursor={cursor}"),
        Some("editor"),
        &[],
        b"",
        200,
    );
    check("GET", "/notes?limit=0", None, &[], b"", 400);
    check("GET", "/notes?where=%7B", None, &[], b"", 400);
    check("GET", &format!("/notes/{id}?with=author"), None, &[], b"", 200);
    check("GET", "/notes/slug:first-note", None, &[], b"", 200);
    check("GET", &format!("/notes/{id}?format=md"), None, &[], b"", 200);
    check("GET", &format!("/notes/{draft_id}"), None, &[], b"", 404);
    check(
        "PATCH",
        &format!("/notes/{id}"),
        Some("editor"),
        &[],
        &json(json!({ "title": "First note, edited", "pinned": true })),
        200,
    );
    check(
        "PATCH",
        &format!("/notes/{id}"),
        Some("author"),
        &[],
        &json(json!({ "title": "No" })),
        403,
    );
    let revisions = check("GET", &format!("/notes/{id}/revisions"), Some("editor"), &[], b"", 200);
    let revision = revisions["data"].as_array().unwrap().last().unwrap()["id"]
        .as_i64()
        .unwrap();
    assert_eq!(
        check(
            "GET",
            &format!("/notes/{id}/revisions/{revision}"),
            Some("editor"),
            &[],
            b"",
            200
        )["data"]["title"],
        "First note"
    );
    assert_eq!(
        check(
            "POST",
            &format!("/notes/{id}/revisions/{revision}/restore"),
            Some("editor"),
            &[],
            b"",
            200
        )["data"]["title"],
        "First note"
    );
    check("GET", &format!("/notes/{id}/revisions"), Some("author"), &[], b"", 404);
    // A staged version (docs/staged.md) of each collection: stage, read, compare, preview, schedule,
    // promote, discard. The promoted title keeps "First", which the search below looks for.
    for (path, field, value) in [
        (format!("/notes/{id}"), "title", "First note, staged"),
        (format!("/authors/{author}"), "name", "Ann, staged"),
    ] {
        let staged = check(
            "PATCH",
            &format!("{path}/staged"),
            Some("editor"),
            &[],
            &json(json!({ field: value })),
            200,
        );
        assert_eq!(staged["data"]["row"][field], value);
        check("GET", &format!("{path}/staged"), Some("editor"), &[], b"", 200);
        check("GET", &format!("{path}/staged"), Some("author"), &[], b"", 404);
        let compared = check("GET", &format!("{path}/staged/compare"), Some("editor"), &[], b"", 200);
        assert_eq!(compared["data"]["changes"][0]["field"], field);
        let link = check("POST", &format!("{path}/staged/preview"), Some("editor"), &[], b"", 200);
        assert!(link["data"]["token"].is_string());
        let at = json!({ "at": "2099-01-01T00:00:00Z" });
        check(
            "POST",
            &format!("{path}/staged/promote"),
            Some("editor"),
            &[],
            &json(at),
            200,
        );
        let promoted = check("POST", &format!("{path}/staged/promote"), Some("editor"), &[], b"", 200);
        assert_eq!(promoted["data"][field], value);
        let gone = check(
            "PATCH",
            &format!("{path}/staged"),
            Some("editor"),
            &[],
            &json(json!({ field: "Gone" })),
            200,
        );
        let token = gone["data"]["_rev"].as_str().unwrap().to_string();
        check(
            "PATCH",
            &format!("{path}/staged"),
            Some("editor"),
            &[],
            &json(json!({ field: "Gone again" })),
            200,
        );
        // A token from before the last stage: `409 stale_revision`, with what changed.
        let stale = check(
            "DELETE",
            &format!("{path}/staged?_rev={token}"),
            Some("editor"),
            &[],
            b"",
            409,
        );
        assert_eq!(
            (stale["code"].as_str(), stale["changed"]["staged"].as_bool()),
            (Some("stale_revision"), Some(true))
        );
        let current = check("GET", &format!("{path}/staged"), Some("editor"), &[], b"", 200)["data"]["_rev"]
            .as_str()
            .unwrap()
            .to_string();
        check(
            "DELETE",
            &format!("{path}/staged?_rev={current}"),
            Some("editor"),
            &[],
            b"",
            200,
        );
        check("DELETE", &format!("{path}/staged"), Some("editor"), &[], b"", 404);
        // The row's own `_rev`: the update that names it writes, a second one with the same is refused.
        let read = check("GET", &path, Some("editor"), &[], b"", 200)["data"]["_rev"]
            .as_str()
            .unwrap()
            .to_string();
        check(
            "PATCH",
            &path,
            Some("editor"),
            &[],
            &json(json!({ field: value, "_rev": read })),
            200,
        );
        let refused = check(
            "PATCH",
            &path,
            Some("editor"),
            &[],
            &json(json!({ field: value, "_rev": read })),
            409,
        );
        assert_eq!(refused["code"], "stale_revision");
    }
    check(
        "GET",
        &format!("/authors/{author}/revisions/999999"),
        Some("editor"),
        &[],
        b"",
        404,
    );
    check("DELETE", &format!("/notes/{draft_id}"), Some("author"), &[], b"", 403);
    check("DELETE", &format!("/notes/{draft_id}"), Some("editor"), &[], b"", 200);

    // A table anyone may add to. Its delete is switched off, so the document has no such operation.
    let tally = check(
        "POST",
        "/tallies",
        None,
        &[("Idempotency-Key", "tally-1")],
        &json(json!({ "label": "a" })),
        201,
    );
    // The document offers `Idempotency-Key` on this create: a repeat gives the first row, adds none.
    let again = check(
        "POST",
        "/tallies",
        None,
        &[("Idempotency-Key", "tally-1")],
        &json(json!({ "label": "a" })),
        201,
    );
    assert_eq!(again["data"]["id"], tally["data"]["id"], "{again}");
    // A post kind's create is core's insert and takes no key, so the document offers none there.
    assert!(
        !document["paths"]["/notes"]["post"]["parameters"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|p| p["name"] == "Idempotency-Key"),
        "{}",
        document["paths"]["/notes"]["post"]
    );
    let tally_id = tally["data"]["id"].as_i64().unwrap();
    check(
        "GET",
        &format!(
            "/tallies?orderBy=-count&{}",
            query("where", &json!({ "count": { "gte": 0 } }))
        ),
        None,
        &[],
        b"",
        200,
    );
    check("GET", &format!("/tallies/{tally_id}"), None, &[], b"", 200);
    check(
        "PATCH",
        &format!("/tallies/{tally_id}"),
        Some("editor"),
        &[],
        &json(json!({ "count": 3 })),
        200,
    );
    check(
        "PATCH",
        &format!("/tallies/{tally_id}"),
        None,
        &[],
        &json(json!({ "count": 4 })),
        401,
    );
    assert!(document["paths"]["/tallies/{id}"].get("delete").is_none());
    let (status, _, _) = api(
        &server,
        "DELETE",
        &format!("/tallies/{tally_id}"),
        Some("admin"),
        &[],
        b"",
    );
    assert_eq!(status, 405);

    // Users: a member reads and changes their own row only.
    let me = check("GET", "/me", Some("subscriber"), &[], b"", 200);
    let subscriber = me["data"]["id"].as_i64().unwrap();
    assert_eq!(
        (me["data"]["role"].as_str(), me["data"]["plan"].as_str()),
        (Some("subscriber"), Some("free"))
    );
    assert_eq!(check("GET", "/me", None, &[], b"", 200)["data"], Value::Null);
    assert_eq!(check("GET", "/members", None, &[], b"", 200)["data"], json!([]));
    assert_eq!(
        check("GET", "/members", Some("subscriber"), &[], b"", 200)["data"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(
        check("GET", "/members", Some("admin"), &[], b"", 200)["data"]
            .as_array()
            .unwrap()
            .len()
            > 1
    );
    check(
        "GET",
        &format!("/members/{subscriber}"),
        Some("subscriber"),
        &[],
        b"",
        200,
    );
    check(
        "PATCH",
        &format!("/members/{subscriber}"),
        Some("subscriber"),
        &[],
        &json(json!({ "plan": "pro" })),
        200,
    );
    let member = check(
        "POST",
        "/members",
        Some("admin"),
        &[],
        &json(json!({ "email": "new@example.test", "name": "New", "password": "a-long-enough-password-1" })),
        201,
    );
    check(
        "POST",
        "/members",
        None,
        &[],
        &json(json!({ "email": "other@example.test", "name": "Other" })),
        401,
    );
    check(
        "POST",
        "/members",
        Some("editor"),
        &[],
        &json(json!({ "email": "other@example.test", "name": "Other" })),
        403,
    );
    // The users kind also answers at `/users`, the spec's name for it.
    assert_eq!(
        check("GET", "/users", Some("subscriber"), &[], b"", 200)["data"][0]["id"],
        subscriber
    );
    check(
        "GET",
        &format!("/users/{subscriber}"),
        Some("subscriber"),
        &[],
        b"",
        200,
    );
    check(
        "PATCH",
        &format!("/users/{subscriber}"),
        Some("subscriber"),
        &[],
        &json(json!({ "plan": "free" })),
        200,
    );
    let aliased = check(
        "POST",
        "/users",
        Some("admin"),
        &[],
        &json(json!({ "email": "alias@example.test", "name": "Alias", "password": "a-long-enough-password-2" })),
        201,
    );
    check(
        "DELETE",
        &format!("/users/{}", aliased["data"]["id"]),
        Some("admin"),
        &[],
        b"",
        200,
    );
    check(
        "DELETE",
        &format!("/members/{}", member["data"]["id"]),
        Some("admin"),
        &[],
        b"",
        200,
    );

    // Globals and actions.
    assert_eq!(check("GET", "/site", None, &[], b"", 200)["data"]["perPage"], 10);
    check(
        "PATCH",
        "/site",
        Some("editor"),
        &[],
        &json(json!({ "motto": "Hi" })),
        200,
    );
    check("PATCH", "/site", None, &[], &json(json!({ "motto": "No" })), 401);
    check(
        "PATCH",
        "/site",
        Some("editor"),
        &[],
        &json(json!({ "perPage": 500 })),
        422,
    );
    assert_eq!(
        check("POST", "/actions/greet", None, &[], &json(json!({ "who": "Ada" })), 200)["data"]["greeting"],
        "Hello, Ada"
    );
    check("POST", "/actions/greet", None, &[], &json(json!({})), 422);
    // A read-only action answers GET too, with no input, `?input=`, or its arguments in the query.
    assert_eq!(check("GET", "/actions/tallyCount", None, &[], b"", 200)["data"], 3);
    assert_eq!(
        check(
            "GET",
            &format!("/actions/tallyCount?{}", query("input", &json!({}))),
            None,
            &[],
            b"",
            200
        )["data"],
        3
    );
    check("POST", "/actions/tallyCount", None, &[], b"{}", 200);
    check("GET", "/actions/tallyCount?unknown=1", None, &[], b"", 422);
    assert_eq!(
        check(
            "POST",
            "/actions/stamp",
            Some("editor"),
            &[("Idempotency-Key", "stamp-1")],
            &json(json!({ "label": "x" })),
            200
        )["data"],
        json!(["x", 1])
    );
    check("POST", "/actions/stamp", None, &[], &json(json!({ "label": "x" })), 401);
    check(
        "POST",
        "/actions/stamp",
        Some("subscriber"),
        &[],
        &json(json!({ "label": "x" })),
        403,
    );

    // Private files: the owner uploads and reads; the signed link alone downloads.
    let boundary = "----first-openapi";
    let multipart = |name: &str, mime: &str, bytes: &[u8]| -> Vec<u8> {
        let mut body = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: {mime}\r\n\r\n").into_bytes();
        body.extend_from_slice(bytes);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        body
    };
    let form = format!("multipart/form-data; boundary={boundary}");
    let file = check(
        "POST",
        "/files/decks",
        Some("author"),
        &[("Content-Type", &form)],
        &multipart("deck.txt", "text/plain", b"slides"),
        201,
    );
    let file_id = file["data"]["id"].as_i64().unwrap();
    check(
        "POST",
        "/files/decks",
        None,
        &[("Content-Type", &form)],
        &multipart("deck.txt", "text/plain", b"slides"),
        401,
    );
    check("GET", &format!("/files/decks/{file_id}"), Some("author"), &[], b"", 200);
    check(
        "GET",
        &format!("/files/decks/{file_id}"),
        Some("subscriber"),
        &[],
        b"",
        403,
    );
    let signed = file["data"]["url"].as_str().unwrap();
    let download = &signed[signed.find("/files/decks/").unwrap()..];
    check("GET", download, None, &[], b"", 200);
    check(
        "GET",
        &format!("/files/decks/{file_id}/download?exp=1&sig=0"),
        None,
        &[],
        b"",
        403,
    );
    check(
        "DELETE",
        &format!("/files/decks/{file_id}"),
        Some("author"),
        &[],
        b"",
        200,
    );

    // Media: the library's rows, uploads and edits.
    let png = std::fs::read(root().join("tests/fixtures/app-migrate/omitted/assets/logo.png")).unwrap();
    let uploaded = check(
        "POST",
        "/media",
        Some("author"),
        &[("Content-Type", &form)],
        &multipart("logo.png", "image/png", &png),
        201,
    );
    let media = uploaded["data"]["id"].as_i64().unwrap();
    check(
        "POST",
        "/media",
        None,
        &[("Content-Type", &form)],
        &multipart("logo.png", "image/png", &png),
        401,
    );
    assert_eq!(
        check("GET", "/media", None, &[], b"", 200)["data"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    check("GET", &format!("/media/{media}"), None, &[], b"", 200);
    assert_eq!(
        check(
            "PATCH",
            &format!("/media/{media}"),
            Some("editor"),
            &[],
            &json(json!({ "alt": "The logo" })),
            200
        )["data"]["alt"],
        "The logo"
    );
    check(
        "PATCH",
        &format!("/media/{media}"),
        Some("editor"),
        &[],
        &json(json!({ "nope": 1 })),
        422,
    );
    // A media field holds an id, and the media row once `with` asks for it.
    check(
        "PATCH",
        &format!("/notes/{id}"),
        Some("editor"),
        &[],
        &json(json!({ "cover": media })),
        200,
    );
    let covered = check("GET", &format!("/notes/{id}?with=cover"), None, &[], b"", 200);
    assert_eq!(covered["data"]["cover"]["id"], media, "{covered}");
    check("DELETE", &format!("/media/{media}"), Some("editor"), &[], b"", 200);
    check("GET", "/media/999999", None, &[], b"", 404);

    // WordPress's own kinds, in First's field names.
    let hello = check("GET", "/posts?search=Hello", None, &[], b"", 200);
    assert_eq!(hello["data"][0]["slug"], "hello-world", "{hello}");
    let post = check(
        "POST",
        "/posts",
        Some("editor"),
        &[],
        &json(json!({ "title": "Core post", "content": "Body", "status": "draft" })),
        201,
    );
    let post_id = post["data"]["id"].as_i64().unwrap();
    check("POST", "/posts", None, &[], &json(json!({ "title": "No" })), 401);
    check("POST", "/posts", Some("editor"), &[], &json(json!({ "nope": 1 })), 422);
    check("GET", "/posts/slug:hello-world", None, &[], b"", 200);
    check("GET", "/posts/1?format=md", None, &[], b"", 200);
    check("GET", &format!("/posts/{post_id}"), None, &[], b"", 401);
    check(
        "PATCH",
        &format!("/posts/{post_id}"),
        Some("editor"),
        &[],
        &json(json!({ "status": "published", "sticky": true })),
        200,
    );
    check("DELETE", &format!("/posts/{post_id}"), Some("editor"), &[], b"", 200);
    let page = check(
        "POST",
        "/pages",
        Some("editor"),
        &[],
        &json(json!({ "title": "About", "order": 2 })),
        201,
    );
    let page_id = page["data"]["id"].as_i64().unwrap();
    check("GET", "/pages", None, &[], b"", 200);
    check("GET", &format!("/pages/{page_id}"), None, &[], b"", 200);
    check(
        "PATCH",
        &format!("/pages/{page_id}"),
        Some("editor"),
        &[],
        &json(json!({ "title": "About us" })),
        200,
    );
    check("DELETE", &format!("/pages/{page_id}"), Some("editor"), &[], b"", 200);
    for kind in ["categories", "tags"] {
        let term = check(
            "POST",
            &format!("/{kind}"),
            Some("editor"),
            &[],
            &json(json!({ "name": "News" })),
            201,
        );
        let term_id = term["data"]["id"].as_i64().unwrap();
        check("GET", &format!("/{kind}"), None, &[], b"", 200);
        check("GET", &format!("/{kind}/slug:news"), None, &[], b"", 200);
        check("GET", &format!("/{kind}/{term_id}"), None, &[], b"", 200);
        check(
            "PATCH",
            &format!("/{kind}/{term_id}"),
            Some("editor"),
            &[],
            &json(json!({ "description": "The news" })),
            200,
        );
        check("DELETE", &format!("/{kind}/{term_id}"), Some("editor"), &[], b"", 200);
        check("GET", &format!("/{kind}/999999"), None, &[], b"", 404);
    }
    // Comments are closed on the post until someone opens them: core's refusal is a problem too.
    // On a kind with `comments: true` (the fixture's notes) the create answers with the new comment.
    let created = check(
        "POST",
        "/comments",
        Some("editor"),
        &[],
        &json(json!({ "on": id, "content": "First!" })),
        201,
    );
    assert_eq!(created["data"]["on"], id, "{created}");
    check(
        "POST",
        "/comments",
        Some("editor"),
        &[],
        &json(json!({ "on": 1, "content": "Nice" })),
        403,
    );
    let comments = check("GET", "/comments", None, &[], b"", 200);
    let comment = comments["data"][0]["id"].as_i64().unwrap();
    check("GET", &format!("/comments/{comment}"), None, &[], b"", 200);
    check(
        "PATCH",
        &format!("/comments/{comment}"),
        Some("editor"),
        &[],
        &json(json!({ "content": "Edited" })),
        200,
    );
    check("DELETE", &format!("/comments/{comment}"), Some("editor"), &[], b"", 200);
    check("GET", "/menus", None, &[], b"", 200);
    check("GET", "/menus/nowhere", None, &[], b"", 404);
    assert_eq!(
        check("GET", "/settings", None, &[], b"", 200)["data"]["timezone"],
        "UTC"
    );
    assert_eq!(
        check(
            "PATCH",
            "/settings",
            Some("admin"),
            &[],
            &json(json!({ "tagline": "Notes" })),
            200
        )["data"]["tagline"],
        "Notes"
    );
    check(
        "PATCH",
        "/settings",
        Some("editor"),
        &[],
        &json(json!({ "tagline": "No" })),
        403,
    );

    // Sign-in: First Identity is installed here, so a guest gets tokens and can sign out with them.
    assert_eq!(
        check("GET", "/auth/config", None, &[], b"", 200)["data"]["guests"],
        true
    );
    let guest = check("POST", "/auth/guest", None, &[], b"", 201);
    let bearer = format!("Bearer {}", guest["data"]["accessToken"].as_str().unwrap());
    assert_eq!(
        check("GET", "/me", None, &[("Authorization", &bearer)], b"", 200)["data"]["role"],
        "guest"
    );
    check("DELETE", "/auth/session", None, &[("Authorization", &bearer)], b"", 200);
    check("DELETE", "/auth/session", None, &[], b"", 401);

    // Services and sync.
    let found = check("GET", "/services/search?collection=notes&q=First", None, &[], b"", 200);
    assert_eq!(found["data"]["results"][0]["id"], id, "{found}");
    check("GET", "/services/search?collection=notes&q=F", None, &[], b"", 422);
    check("GET", "/services/search?collection=nope&q=First", None, &[], b"", 404);
    // The site-wide search, and `search` on a table, answer as the document says.
    let site_wide = check(
        "GET",
        "/search?q=first&kinds=notes,tallies&limit=5",
        None,
        &[],
        b"",
        200,
    );
    assert_eq!(site_wide["data"]["results"][0]["kind"], "notes", "{site_wide}");
    check("GET", "/search?q=%3F%3F", None, &[], b"", 400);
    check("GET", "/tallies?search=a", None, &[], b"", 200);
    let records = check("GET", "/sync/authors?first=10", Some("editor"), &[], b"", 200);
    let record = &records["data"]["records"][0];
    check("GET", "/sync/authors", None, &[], b"", 401);
    check(
        "POST",
        "/sync/authors",
        Some("editor"),
        &[],
        &json(json!({ "record": record["record"], "expect": record["digest"] })),
        200,
    );
    check(
        "POST",
        "/sync/authors",
        Some("editor"),
        &[],
        &json(json!({ "record": {} })),
        422,
    );
    // A record the site has not seen creates a row: 201, with the stored digest. The site fills the
    // defaults the file left out, so it answers with the record as stored.
    let fresh = check(
        "POST",
        "/sync/authors",
        Some("editor"),
        &[],
        &json(
            json!({ "record": { "uid": "zr_0123456789abcdef0123", "fields": { "name": "Synced" }, "body": null }, "expect": "absent" }),
        ),
        201,
    );
    assert_eq!(
        (
            fresh["data"]["status"].as_str(),
            fresh["data"]["record"]["fields"]["name"].as_str()
        ),
        (Some("normalized"), Some("Synced")),
        "{fresh}"
    );
    check(
        "POST",
        "/sync/authors/convert",
        Some("editor"),
        &[],
        &json(json!({ "text": "# Hi", "direction": "toBlocks" })),
        200,
    );
    check(
        "POST",
        "/sync/authors/merge",
        Some("editor"),
        &[],
        &json(json!({ "base": "a\n", "ours": "a\nb\n", "theirs": "a\n" })),
        200,
    );
    check(
        "POST",
        "/sync/authors/trash",
        Some("subscriber"),
        &[],
        &json(json!({ "uid": record["record"]["uid"], "expect": record["digest"] })),
        403,
    );
    check("DELETE", &format!("/authors/{author}"), Some("editor"), &[], b"", 403);
    let current = check("GET", "/sync/authors", Some("editor"), &[], b"", 200);
    check(
        "POST",
        "/sync/authors/trash",
        Some("admin"),
        &[],
        &json(json!({ "uid": record["record"]["uid"], "expect": current["data"]["records"][0]["digest"] })),
        200,
    );
    let second = check(
        "POST",
        "/authors",
        Some("editor"),
        &[],
        &json(json!({ "name": "Grace" })),
        201,
    );
    check(
        "DELETE",
        &format!("/authors/{}", second["data"]["id"]),
        Some("admin"),
        &[],
        b"",
        200,
    );
    check("DELETE", &format!("/notes/{id}"), Some("editor"), &[], b"", 200);

    // A path outside the document is a problem document as well.
    let (status, content_type, _) = api(&server, "GET", "/nope", None, &[], b"");
    assert_eq!((status, content_type.as_str()), (404, "application/problem+json"));

    // A theme menu location needs a theme that registers one; the harness's block theme has none,
    // so `GET /menus/{location}` is asserted above only as the 404 for a location that isn't there.
    let uncalled: Vec<&String> = operations
        .iter()
        .filter(|(key, called)| !**called && key.as_str() != "GET /menus/{location}")
        .map(|(key, _)| key)
        .collect();
    assert!(
        uncalled.is_empty(),
        "no request to these operations of the document succeeded, so their success schemas never ran: {uncalled:?}"
    );
}
