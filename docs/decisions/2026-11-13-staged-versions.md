# Staged versions are one WordPress revision per item

Date: 2026-11-13. Status: accepted. Guide: [staged.md](../staged.md).

## Problem

EmDash saves a change to a published item as a draft revision while the live version stays
public, and compares, discards or publishes it. First's post kinds had WordPress revisions and
autosaves, but nothing that held a change beside the live item for more than one editor, and
nothing a reader could not see.

## Decision

- **Storage.** A staged version is one `revision` post per item, named `<id>-autosave-staged-v1`.
  The name is in core's autosave family, so `wp_get_post_revisions()` callers that skip autosaves,
  revision pruning and `wp_save_post_revision`'s change check all pass over it. It is not core's
  own autosave slot (`<id>-autosave-v1`): the editors keep one of those per user and delete it when
  they find it older than the post, and a staged version is shared and outlives any edit session.
  It has its own internal post status, `first-staged` (added 2026-11-14): every revision query of
  core's asks for `inherit`, and with the name alone the staged revision was listed by the
  `/autosaves` route (the block editor offered it to its author as their newer autosave), shown on
  wp-admin's revision screen with Restore, and could make a wp-admin save run core's revision
  upgrade (`_wp_get_post_revision_version()` reads no version from the name).
  Its fields live on the revision under the post's own meta keys, written the way every First
  revision is (`acf_copy_metadata`, `_first_system`). There is no new table.
- **What is staged.** `_first_staged` on the revision names the staged fields. A promote is an
  update with exactly those fields, so a live edit to another field made meanwhile is kept.
- **Promote is an update.** `Db::update` as the promoter: every rule, hook, unique check, purge,
  notice and webhook of an update, in one transaction with the staged version's end. The staged
  revision is renamed to an ordinary revision, so it stays in the history, as discard does.
- **Concurrency.** Every write of a staged version first takes the item's row lock and compares it
  with the request's snapshot (as translation groups do, `Locale\Lock`): a request that read an
  older state gets a 409 to retry. So there is never a second staged revision and never a promote
  on top of a stage it did not see.
- **Scheduling.** A scheduled promote is core's `publish_future_post` event with the staged
  revision's id. It runs as the user who scheduled it, under the rules as they are then. No new
  cron, tick or worker.
- **Secrecy.** Every route and ability needs the item's update rule and answers the missing item's
  404 otherwise. Core counts revisions in every post's `version-history` link, for every reader;
  First subtracts the staged one there.
- **Preview.** A signed token (HMAC with the site's `AUTH` salt, the item, the revision and an
  expiry) reads the staged version through an anonymous visitor's field masks, or renders the
  item's own theme page with it, `no-store` and `noindex`.
- **Kinds.** Every `collection()` stages; `staged: false` turns it off. `table()` kinds have no
  editorial lifecycle and no staged versions.

## Not done here

`_rev` tokens and edit locks (`_edit_lock`) are the next change; wp-admin's staged-changes screens
the one after. Scoping a credential to some abilities is not First's: the abilities are only
declared separately.
