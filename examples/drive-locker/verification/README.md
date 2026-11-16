# Verification record

> **2026-11-16:** this record is from the `ef0a42e3` baseline, before HTTP drive
> creation worked. The 403 on `serialKey` it describes is gone: `serialKey`
> became a compound unique index on `ownerId` and `serial`.
> `node examples/drive-locker/verify.mjs` (no `--probe-main` mode any more)
> covers drive CRUD over HTTP. The 409s on deleting drives and places remain on
> main ([#533](https://github.com/spacefast/zero/issues/533)). The rest of this
> record is kept as it was run.

Source baseline: `ef0a42e3883eb146ad6318ff32cbc54cdb2e31d1`.
Environment: local WordPress Studio at `http://localhost:8796`, with the Vite
frontend at `http://127.0.0.1:5196/`. No staging or production deployment exists.

This record was captured before the rename from First to TypedPress. Commands and
output below are verbatim from that run: `first` is today's `typedpress`,
`first/` and `.first/` are `tp/` and `.tp/`, and `/wp-json/first/v1` is
`/__tp/api/v1`.

## Native compilation and frontend build

```text
$ ./target/release/first check examples/drive-locker --frozen --json
{"schema":"first-diagnostics","version":1,"compilerVersion":"0.3.0","ok":true,"offsetEncoding":"utf-8","positionEncoding":"utf-16","diagnostics":[],"groups":[]}

$ ./target/release/first build examples/drive-locker --frozen
built 0 collections, 4 tables, 1 user projections, 0 globals, 8 hooks, 5 actions -> first/dist/wp-content

$ tsc -p examples/drive-locker
exit 0

$ npm --prefix examples/drive-locker/web run build
tsc --noEmit
vite build
exit 0

$ node examples/drive-locker/prepare-publish.mjs
Prepared .first/publish with config, lib, migrations and built public assets only.
```

The compiler counts come from the emitted build summary: collections and
tables count their respective config registries, user projections count `users`,
hooks count both registered hook functions for each of the four tables, and
actions count the `actions` registry. Compiler errors are
`check.json.diagnostics.filter(d => d.severity === 'error').length = 0`.

`first build` emitted the committed client, schema registration, SQL migration,
snapshot and pinned WordPress plugin lock. The build directory and SPA bundle
are ignored. They contain no source changes to shared compiler/runtime code.

## Real HTTP and jobs

Command:

```sh
node examples/drive-locker/verify.mjs --probe-main
```

The [complete transcript](local-http.txt) records the returned responses. It
includes successful calls to `whereIs`, `capacityReport`, `warrantyExpiring`,
`logHealth` and `retire`, plus create/read/update/delete calls for contents.
It also verifies that a separate subscriber account cannot read, update,
relate to, log health for or retire another owner's drive.

The fixture's place capacity is `1000 GB total - 240 GB used = 760 GB free`.
The filter is the signed-in owner and that fixture's `placeId`; rows belonging
to the other account are excluded. Health wear values of 10%, 13% and 23% on
successive dates produce rises of 0, 3 and 10 percentage points, and verdicts
`ok`, `watch` and `replace` respectively. The last verdict queues Action
Scheduler; the subsequent HTTP drive read has a non-null
`replacementNeededAt`.

The initial HTTP drive create and valid edit return 403. HTTP deletion of
drives and places returns 409. The runner explicitly labels its trusted CLI
fixture and cleanup. These are independent action and job proofs, not proof
that drive CRUD works. The normal verifier without `--probe-main` fails on
that creation refusal.

The actual MCP initialize request returns HTTP 200 with server name
`Drive-locker` and instructions `First app drive-locker`. The
[ability names](abilities.json) were emitted by:

```sh
./target/release/first abilities --site examples/drive-locker
```

## Browser

An isolated Chromium process exercised the actual Vite SPA and local identity
server without reusing the user's browser. Sign-in followed the app's button,
password login, consent, authorization callback and token exchange, then
returned to the clean frontend URL with the signed-in inventory visible.

The complete screen checks below ran before the rebase, with the
`de46201a530e2bf1751abb54bf70cfda2a2caf2b` runtime. After refreshing Studio to
`ef0a42e3883eb146ad6318ff32cbc54cdb2e31d1`, sign-in and the 390-pixel Search
layout were repeated successfully. Their raw output is in
[`browser-latest.txt`](browser-latest.txt). All HTTP and scheduler checks above
were repeated on that refreshed runtime.

The Search, Places, place creation, add-drive and capacity screens were checked
at 390 and 320 CSS pixels wide. Drive detail was checked with a separately
labelled trusted CLI fixture because HTTP drive creation is blocked on main.
The wear and temperature SVGs and the inline reading form rendered from real
stored readings. The add-drive form displayed the actual server error.
The inline form saved a `watch` reading, and retirement updated the parent
Search card. Moving a drive displayed the same unique-field refusal as creation.

For each measured screen, `document.documentElement.scrollWidth` equalled the
viewport width. Visible buttons, inputs, selects, textareas, summaries and the
brand link measured at least 44 CSS pixels in width and height. Dark mode was
checked at 390 pixels. The browser reported no page errors. Safe-area CSS and
keyboard focus styles are in `web/src/style.css`.
