# WordPress's trash is an unpublish, not a delete

Date: 2026-11-14. Status: accepted.

## Context

A First kind backed by posts is edited in wp-admin, where "Trash" moves an item to WordPress's
trash and "Undo" or "Restore" brings it back. Before this decision:
- a trash of a published item sent no change notice and purged nothing First records;
- an untrash announced a `create`, although the row was never deleted;
- a permanent delete from the trash ran no delete lifecycle at all: the row read as missing because
  reads leave the trash out, so `onDelete: cascade` rows were left behind.

## Decision

- A trash of a published item is the item leaving the published set, as an unpublish is: the
  update hooks (`afterUpdate`, with the published row before and the unpublished row after), one
  `update` notice with its id, and its pages purged. No `beforeDelete`, no `afterDelete`, no
  referential actions, and listeners are never told the row is deleted.
- An untrash is the status change it lands in: back to published is a publish (`afterPublish`,
  notice, purge); back to draft, WordPress's default, is nothing to visitors.
- A trash of a draft, pending or private item is nothing to visitors.
- A permanent delete from the trash (wp-admin's delete, Empty Trash, `wp_scheduled_delete`) runs the
  delete lifecycle on the trashed row, once.
- When WordPress empties the trash on its schedule, nobody is signed in: `ctx.user` is null. A
  delete refused there (`onDelete: restrict`, a throwing `beforeDelete`) is skipped and logged, and
  the run goes on; the item stays in the trash, where deleting it by hand shows the reason. In
  wp-admin, core REST and WP-CLI a refusal stops with its message, as before.

## Costs

- An app that wanted "trashed" to mean "deleted" for its own bookkeeping now sees an update.
  `afterUnpublish` (a planned hook) is where that will attach.
- A refused item in a scheduled empty is retried and logged daily until its references are gone.
- Content sync's own trash (`Sync\Trash::trash`) still runs the delete lifecycle; that is open
  (its own issue).
