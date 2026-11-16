# Staged versions

A staged version is a change to an item that is saved beside the live item. Visitors, the API,
core REST, Markdown twins, feeds, search and caches keep returning the live item until someone
promotes the staged version. Until then it can be read, compared with the live item, previewed
through a signed link, scheduled, or discarded.

Every `collection()` has staged versions. `table()` kinds do not: a table row has no editorial
lifecycle, so a change to it is an update. Turn the feature off for one collection with
`staged: false`.

```ts
export const posts = collection({ title: text(), body: richText() }, { url: "/blog/:slug" });
export const logs = collection({ title: text() }, { staged: false });
```

## What a staged version is

- **One per item, shared.** Everyone who may update the item reads and writes the same staged
  version. Each `stage` call adds its fields to it; a field staged again takes the new value.
- **Only the staged fields.** The staged version holds the fields that were staged. Promoting it
  changes those fields and no others, so a live edit to another field made in the meantime stays.
- **A WordPress revision.** It is stored as one revision of the post, named
  `<id>-autosave-staged-v1`, with its own internal status `typedpress-staged` where core's revisions
  have `inherit`. Core reads revisions by that status, so its revision lists and count, the
  `/autosaves` route the block editor takes the user's autosave from, wp-admin's revision screen
  and its Restore, revision pruning, change detection and wp-admin's revision upgrade all pass
  over it. It is separate from core's own per-user autosave slot, which the editors overwrite and
  delete. A promote or discard gives it core's status and an ordinary revision's name. Staged
  revisions saved before the status existed get it when the runtime updates. Its fields are stored on the revision
  under the same meta keys the post uses, as on every other revision of a First post.
  `_tp_staged` on the revision records the staged fields and a scheduled promote.

## Operations

All of these need the item's `update` rule. A caller it doesn't cover gets the `404` a missing item
gets, whether or not anything is staged.

| Operation | API (`/__tp/api/v1`) | Client | Ability `<app>/<kind>-…` | `wp typedpress staged …` |
|---|---|---|---|---|
| Stage | `PATCH /<kind>/<id>/staged` with the fields | `first.posts.stage(id, patch)` | `stage` | `stage <kind> <id> <json>` |
| Read | `GET /<kind>/<id>/staged` | `first.posts.staged(id)` | `staged-get` | `show <kind> <id>` |
| Compare | `GET /<kind>/<id>/staged/compare` | `first.posts.compare(id)` | `staged-compare` | `compare <kind> <id>` |
| Promote | `POST /<kind>/<id>/staged/promote` | `first.posts.promote(id)` | `staged-promote` | `promote <kind> <id>` |
| Schedule a promote | the same route with `{ "at": "<ISO time>" }`; `{ "at": null }` cancels | `first.posts.promote(id, { at })` | `staged-promote` with `at` | `promote <kind> <id> --at=<ISO time>` or `--cancel` |
| Discard | `DELETE /<kind>/<id>/staged` | `first.posts.discard(id)` | `staged-discard` | `discard <kind> <id>` |
| Preview link | `POST /<kind>/<id>/staged/preview` with optional `{ "ttl": seconds }` | `first.posts.previewLink(id)` | `staged-preview` | |
| List every staged version | | | | `list [<kind>]` |

`wp typedpress staged` is the trusted CLI: it applies no access rule and no field mask.

A staged version reads as:

```json
{
  "id": 412,
  "row": { "id": 7, "title": "Staged title", "slug": "hello", "status": "published" },
  "fields": ["title"],
  "by": { "id": 3, "name": "Ed" },
  "at": "2026-11-13T10:00:00.000Z",
  "promoteAt": null
}
```

`row` is the item as it would be once promoted. `id` is the revision that holds it.

### Stage

`stage` checks the patch as an update would: the update rule given the patch, field write rules,
types, `min`/`max`/`pattern`/`validate`, media and references. It runs no hook, queues no webhook
and purges no URL, because nothing visible changed. `status`, `publishedAt` and the other system
fields can't be staged: they change with an update of the item.

Unique checks run when the staged version is promoted, not when it is staged: until then the value
is not in use.

### Compare

```json
{ "id": 412, "changes": [{ "field": "title", "live": "Live title", "staged": "Staged title" }], "by": {}, "at": "…", "promoteAt": null }
```

`changes` lists the staged fields whose value differs from the live item, in schema order. Both
sides go through the reader's field masks. A field hidden from the reader on either side is left
out, whether it changed or not.

### Promote

A promote is an update of the item by the caller, with the staged fields as the patch. So the
update rule, field write rules, validation, `beforeUpdate` and `afterUpdate`, unique checks, the
revision, URL purges, change notices, webhooks and core's `rest_insert_{type}` and
`rest_after_insert_{type}` hooks all run exactly as for `PATCH /<kind>/<id>`. The
update and the end of the staged version are one transaction: a promote that is refused changes
nothing and keeps the staged version.

The promoter needs to be allowed to write every staged field. An editor can't promote a staged
version that holds a field only admins may set.

After a promote the staged revision stays in the item's revisions, next to the revision the update
wrote.

### Schedule a promote

`{ "at": "2026-12-01T09:00:00Z" }` schedules the promote on WordPress's own `publish_future_post`
cron event, the one core uses for scheduled posts. No other cron, worker or queue is involved. The
caller must be able to promote now.

When the event runs, the promote runs as whoever scheduled it, under the rules as they are then:
the same user, a signed-out caller as a signed-out caller, and only the trusted CLI's own schedule
with the CLI's authority. A schedule that names nobody is refused. If it is refused or fails, nothing changes, the schedule is cleared, and the reason is kept
on the staged version as `error` for its editors. It is not retried. Staging more fields keeps the
schedule.

### Discard

`discard` ends the staged version. The live item is untouched. The revision stays in the item's
revisions and is recorded as discarded and by whom; nothing is deleted.

### Preview links

```json
{ "token": "…", "expiresAt": "…", "api": "https://example.com/__tp/api/v1/posts/7/staged?preview=…", "url": "https://example.com/blog/hello/?tp_preview=…" }
```

- `api` returns the staged version without signing in, through an anonymous visitor's field masks
  and without `by`, `promoteAt` or `error`. Use it from an external frontend or a `tp/app` page.
- `url` is the item's own page rendering the staged title, content and fields an anonymous visitor
  may read; a field hidden from them is blank there, staged or live. It is set for a
  kind with a `url` that the theme renders, and `null` otherwise.

A token is an HMAC over the kind, the item, the staged revision and an expiry, keyed with the
site's `AUTH` salt. It expires after an hour by default (`ttl`, 60 seconds to one day), and stops
working when the staged version is promoted or discarded, or when the site's salts change. A
previewed page is sent `no-store`, `noindex` and `no-referrer`, and is never stored by Batcache.
Markdown twins ignore the token.

## Read before you write: `_rev`

Every row of a collection the API, the client or an ability returns carries `_rev`, an opaque token
of the row as it was read. Send it back with a write to refuse the write if the row changed since:

| Write | Where `_rev` goes | Which token |
|---|---|---|
| `PATCH /<kind>/<id>`, `<kind>-update` | in the body / input, beside the fields | the row's |
| `DELETE /<kind>/<id>`, `<kind>-delete` | `?_rev=` / input | the row's |
| stage, promote, discard (API, abilities, `wp typedpress staged … --rev=`) | body, query or input | the staged version's (`_rev` of a stage, read or compare) |
| `POST /<kind>/<id>/revisions/<rid>/restore` | body | the row's |

A stale token is refused with `409 stale_revision`. The problem carries the row's current `_rev`
and `changed`: `fields`, the fields that differ since your read as you may read them (a field
hidden from you is never named, changed or not), and for a staged token `staged: true` when someone
else changed the staged version. Read again, look at what changed, and decide whether to retry.

With nothing staged, the row's own `_rev` is accepted where a staged one is expected, so a read
starts a stage. The row's `_rev` is the same for every reader and does not change when someone
stages, so it says nothing about whether a staged version exists.

Leaving `_rev` out is an unconditional write, as on WordPress's own routes.

## Edit locks

TypedPress uses WordPress's own edit lock, `_edit_lock`, which the block editor and the classic editor
set while someone has the item open and refresh with their heartbeat (it lapses 150 seconds after
the last one). While another user holds it, these are refused with `409 locked` and the holder
(`holder: { id, name }`):

- the API's update, delete, revision restore, stage, promote, discard and scheduled promote;
- the abilities for the same steps;
- core REST's update, delete and revision restore of the item (`/wp/v2/<post type>/<id>`).

Reading again does not clear it. Send `takeover: true` (`?takeover=1` on a DELETE, `takeover` in an
ability's input) to take the lock first, as the editor's **Take over** button does; the old holder's
editor then shows that someone took over. Both checks apply only to a caller the row's update rule
covers: anyone else gets the missing row's 404 and learns of no lock or token. The trusted CLI and
cron never meet a lock. wp-admin's own edit screen keeps WordPress's lock dialog.

## Who can tell that a staged version exists

Only a caller who passes the item's update rule, or who holds a valid preview token.

For anyone else nothing differs between an item with a staged version and one without: the item's
row, lists, counts, search, `?format=md`, the Markdown twin, the page, feeds, `llms.txt`, the
sitemap, core REST (including the item's `version-history` and `predecessor-version` links, which
core counts for every reader), and the `404` of every staged route and ability, also when the item's
update rule throws on the staged data.

Nor can they tell afterwards: a discarded or promoted staged revision stays in the item's history
for its editors, but core's links leave it out, so a discard leaves them as they were and a promote
moves them as one update does.

## Abilities and credentials

Each step is its own Ability, so a credential can be allowed to stage and not to promote:
`<app>/<kind>-stage`, `-staged-get`, `-staged-compare`, `-staged-promote`, `-staged-discard` and
`-staged-preview`. TypedPress declares them separately and does not scope credentials itself.

They are offered only to a caller whose update rule on the kind covers at least one row (or needs
the write's data to answer): core's abilities list, one ability's description and the MCP tools
list leave them out for anyone else, so a read-only caller never sees them.

## Limits

- Post kinds only. `table()` kinds and globals have no staged versions.
- Relations loaded with `with` are not part of a staged version; stage the referencing field.
- A staged version belongs to one row. On a kind with `locales`, that is one translation.
