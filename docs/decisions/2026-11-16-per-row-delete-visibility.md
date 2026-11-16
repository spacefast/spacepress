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
   inspects a whole table, and password visibility is decided for those rows only, so hidden volume
   elsewhere can't change the answer. When the counts differ, when the referencing column or the
   referenced key may be hidden, or when a read extension that may hide rows is registered
   (`Extensions::constraintReadsSafe()` is false), the delete is refused. Under `cascade` this repeats
   for each visible child, to every depth.
2. **Side effects are ordinary writes by the same viewer.** A cascade is the viewer's delete of each
   child; `setNull` / `setDefault` the viewer's update of it with the real patch; a `ref().many()` or
   term link the viewer's update of the owner without that id. Each takes the path a direct request
   takes: the collection rule with the real patch, field rules, `beforeUpdate` / `beforeDelete` hooks,
   `Extensions::onWrite` and listeners, generated values. Restrict is refused by the pipeline as
   before. All of it is one transaction.
3. **One refusal.** Any 4xx from any side effect, a hidden row, or a side effect that reaches fewer
   rows than reference the deleted one, is `409 reference_violation`, detail
   `Rows you can't read may reference this row`, no pointer, and the whole delete rolls back. Nothing
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

Replaced by ordinary writes and deleted: the per-branch authorization counts for cascade and set null,
the set null / set default generated-value preflight (`requireReferentialUpdateVisibility`), and
`requireDeleteVisibility`'s whole-table check.

## Tests

`tests/php/db_test.php` (the owner-scoped block, the hidden-child cases and the PR #516 review
cases: hook-written and default references, many-ref links, hidden volume, read extensions),
`tests/php/taxonomy_test.php` (a term on an item the viewer can't read),
`tests/wp/tables.test.ts` (both REST surfaces) and `tests/sync.rs`
(`a_pointerless_reference_refusal_is_not_reported_as_a_missing_target`).
