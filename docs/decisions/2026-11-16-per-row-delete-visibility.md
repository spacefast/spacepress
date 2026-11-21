# A delete checks the rows that reference it, not whole tables

Date: 2026-11-16. Status: accepted by the release coordinator as the recommended option; the owner can reverse it.

## Context

PR #72 made write failures unable to reveal rows the viewer can't read. For deletes it required
the viewer to read every row of every table that references the deleted row's table, including
tables with no row pointing at it. An owner-scoped app filters every table with
`read: ({ user }) => ({ ownerId: user.id })`, so no viewer can ever read a whole referencing table,
and every HTTP delete of a referenced kind answered `409 reference_violation`, whatever the data.
examples/pet-food, stuff-drawer, subscriptions and drive-locker could not delete a pet, an empty
bin, a subscription or a place.

## Decision

A viewer's delete looks only at the rows that reference this row, and what it does to them is that
viewer's own writes:

1. **Visibility, before anything is written.** It counts, trusted and as the viewer, the rows whose
   referencing column holds this row's key (for a `ref().many()`, including a taxonomy's terms, the
   owners of links to it), in SQL, WordPress's trash included, without loading them. It never
   inspects a whole table. WordPress's password visibility for these rows is decided in SQL only and
   fails closed: a protected post the viewer's password proof doesn't open counts as hidden, even for
   an editor who could open it in wp-admin, and no post is loaded, so hidden volume can't change the
   answer. A post-password cookie is checked only against the passwords of the posts that reference
   the row, not every protected post of the kind. When the counts differ, when the referencing column
   or the referenced key of any relationship to this kind may be hidden (checked before a relationship
   is skipped for a null key, so the answer can't tell whether a hidden key is null), or when a read
   extension that may hide rows is registered (`Extensions::constraintReadsSafe()` is false), the
   delete is refused. Under `cascade` this repeats
   for each visible child, to every depth.
2. **Side effects are ordinary writes by the same viewer.** A cascade is the viewer's delete of each
   child; `setNull` / `setDefault` the viewer's update of it with the real patch; a `ref().many()` or
   term link the viewer's update of the owner without that id. Each takes the path a direct request
   takes: the collection rule with the real patch, field rules, `beforeUpdate` / `beforeDelete` hooks,
   `Extensions::onWrite` and listeners, generated values. Restrict is refused by the pipeline as
   before. Nothing trusted runs for a viewer's delete: after the viewer's writes, the rows that
   reference the deleted row are counted again in the same transaction, and any left (a hook created
   or kept one) refuses. All of it is one transaction.
3. **One refusal.** Any error from any side effect (an `HttpError` of any status, an app hook's
   JavaScript `Error`, anything else), a hidden row, or a side effect that reaches fewer rows than
   reference the deleted one, is `409 reference_violation`, detail
   `Rows you can't read may reference this row`, no pointer, and the whole delete rolls back. A side
   effect's own message is never passed on; it goes to the error log. Nothing
   is hard-deleted that a direct request wouldn't delete; WordPress's trash stays an unpublish
   ([2026-11-14-trash-is-unpublish.md](2026-11-14-trash-is-unpublish.md)).
4. Trusted writes (hooks, CLI, jobs) are not checked, as before.

## Costs

- A viewer allowed to delete a row learns whether some row they can't read references it: one bit,
  only for rows they may delete, never how many, which or their values.
- A side effect answers exactly as the viewer's own direct write of that row would. When an app's hook,
  generator or extension makes that direct write's outcome depend on a value the viewer can't read,
  the delete's outcome depends on it the same way (success, or the one refusal); the delete adds no
  disclosure the direct write doesn't already have. The earlier preflight that refused every such
  branch outright is gone, with the special-case checks below.
- `beforeDelete` hooks run before the checks; a refusal rolls their database writes back with the
  transaction, but not external effects such as mail or HTTP.
- The check costs two counts per referencing column, plus a read of each visible referencing row.

- An editor can't delete a row that a password-protected post they could open references; they
  remove the reference first.

Replaced by ordinary writes and deleted: the per-branch authorization counts for cascade and set null,
the set null / set default generated-value preflight (`requireReferentialUpdateVisibility`),
`requireDeleteVisibility`'s whole-table check, and, for a viewer's delete, the trusted referential
actions.

## Tests

`tests/php/db_test.php` (the owner-scoped block, the hidden-child cases, a hidden nullable
referenced key, and the PR #516 review cases: hook-written and default references, many-ref links,
hidden volume, read extensions), `tests/php/taxonomy_test.php` (a term on an item the viewer can't
read, a post-password cookie scoped to the posts carrying the term),
`tests/wp/tables.test.ts` (both REST surfaces) and `tests/sync.rs`
(`a_pointerless_reference_refusal_is_not_reported_as_a_missing_target`).
