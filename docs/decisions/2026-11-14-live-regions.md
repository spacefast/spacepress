# Live regions: one more read on the subscription endpoint

## Problem

`<Live>` around part of a server page (rendering.md §4.4) should refresh that
part when something it shows changes. A region's reads are whatever compiled
code it runs, not kind query descriptors, so the subscription endpoint
(`POST /__first/api/v1/_live`, [reactive queries](2026-11-13-reactive-queries.md))
can't answer for it as it is. A second polling path (the region re-fetching its
page on its own timer) was rejected: it is a second polling policy, and every
poll would be a full render for every signed-in visitor.

## Decision

**One more read op, `page`, on the same endpoint, with the same tokens,
counters, budget and polling.** The browser asks for it in the same batch as
every other subscribed read.

- **What the client names.** `{ op: "page", args: { url, region } }`.
  - `url` is a path and query on this site, never a host or scheme.
  - The server resolves it through the `first/app/` router in process: no HTTP
    request to itself, no `route.ts` handler, no WordPress-rendered URL.
  - It refuses anything that isn't a page route containing a `<Live>` region
    with that id. The compiler assigns region ids from the source, so they
    stay the same across renders and builds of the same code.
- **What the render may do.** It is the render a GET of that URL gets, as the
  visitor, except that it never writes:
  - a layout `guard` that refuses the visitor answers the problem the page
    would, never the HTML;
  - `notFound()` and redirects answer a problem;
  - forms aren't handled and no cookie is set;
  - nothing a cacheable render records is written. The page cache's read
    index (`first__app_reads`) is untouched, so a signed-in visitor's render
    is never recorded as, or served from, the shared cache.
- **"Not modified" by counter** follows the module's existing rule and no
  weaker: only when every kind the region's render read has a scope this
  visitor can account for. A kind without one, or a render that recorded no
  reads at all, means the region is rendered and its hash compared.
  - The reads recorded are the whole route's, not the region's alone. A page
    usually reads above its `<Live>` and passes the rows in
    (`const all = await notes.list(); <Live id="notes">{…}</Live>`), so those
    reads happen before the region renders. Counting more kinds than the region
    shows only makes it re-render more often, never less safely.
- **The token binds** the visitor (as today), the normalised URL, the region
  id, and the build. Without the build, a deploy that changes the page's code
  would answer "not modified" by counter for up to five minutes.
- **Content the counters can't see.** A region can show things that are not
  First reads: the clock, request data, WordPress options, core queries,
  menus. Each built-in component that reads such data marks the region as
  having an unseen dependency, and a marked region never takes the counter
  shortcut: it renders and compares every poll. `<Comments>` reads core's
  comment query, so it marks its region; a newly approved comment shows on
  the next poll, not five minutes later. Anything else that changes without a
  First write shows within the five-minute trust window, and the `<Live>` docs
  say so.
- **Determinism.** Two renders of unchanged data hash the same. The hash leaves
  out what varies per render and isn't content: signed download links (as the
  module already does), form nonces, and the flash marker.
- **How the browser applies an answer.** Not `innerHTML`, which would drop the
  state and bindings of the client components and forms inside. The changed
  HTML goes through the Interactivity router's public `navigate(url, { html,
  force, replace })`, which diffs regions and keeps client state. First's
  WordPress floor (7.1) has that option. Core applies only top-level router
  regions, so the swap covers the page's `first/main` region. Client components
  and form inputs inside it keep their state: the router diffs, it doesn't
  rebuild.
- **What an answer carries.** `{ html, kinds }`: the region's HTML and the kinds
  the render read, by the client's schema key (the names change notices
  already use, so this reveals nothing new). The browser subscribes with those
  kinds as the read's dependencies. A notice for one of them, or a write
  through the same client, then asks again at once instead of waiting for the
  poll. A region whose render read nothing has no dependencies and updates on
  the poll only.
- **Cost.** A `page` op that runs is a page render. The module's budget rule
  stays (the first read always runs, later ones answer `pending` once a request
  has spent a second). At most **4** `page` ops render per request; the rest
  answer `pending` too, and the client asks for them again at once, so a page
  with more regions still fills them all. Four covers a page with a few live
  regions, and keeps one request from costing more renders than a visitor's
  own page loads would.

## Costs

- A region whose content depends on something First can't count re-renders on
  every poll that reaches it: one page render per poll per visitor, within the
  polling policy's 2 to 30 second gaps.
- A change outside First's write path, such as another plugin's SQL, shows
  within five minutes, the same bound as every other subscribed read.
- The swap re-diffs the page's main region, not only the `<Live>` element,
  because core ignores nested router regions. Unchanged parts are left as they
  are.
