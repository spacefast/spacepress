---
title: SpacePress Admin
description: Native content editing and experimental Gutenberg collaboration.
order: 6
status: published
publishedAt: 2026-11-22T00:00:00.000Z
---

## Content editing

SpacePress Admin uses the WordPress block editor, typed native REST fields, and SpacePress's existing authorization for native content collections. Taxonomy assignments use native REST taxonomy properties. Classic wp-admin continues to use Secure Custom Fields.

If a plugin hides a collection's taxonomy from core REST, SpacePress uses its own form and API to preserve the assignments.

## Enable experimental collaborative editing

SpacePress Admin integrates Gutenberg 24.4.1's experimental collaborative editing on WordPress 7.1. Eligible editors can work on a document's title, blocks, and typed fields in the **Fields** panel together. Gutenberg supplies Yjs, cursors, presence, and HTTP sync. SpacePress handles saves, access checks, hooks, staged versions, and revisions.

1. Add `gutenberg: "24.4.1"` to `plugins` in `typedpress.config.ts`.
2. Build and install the artifact. Activate Gutenberg alongside the other plugins in the manifest.
3. In Gutenberg's **Experiments** settings, enable **Real-time collaboration**.
4. Save a document, then open its SpacePress Admin editor in two separate WordPress user sessions.

## Eligibility and save behavior

Each participant needs an ordinary WordPress session, the `unfiltered_html` capability, and permission to read and update the document. Scoped agent credentials cannot join sessions or read stored sync documents. Only the author can join an auto-draft before its first save. Users with create permission only use ordinary editing.

Collections need static read and update rules, a content column, and the default `wp/v2` REST namespace. WordPress posts extended with `wp.posts.extend()` use ordinary editing because publishing permissions can differ between participants. Password-protected posts use ordinary editing. Field access rules at any depth and reference, media, file, or reference-list fields also disable collaboration.

The server enforces these restrictions on sync endpoints and stored documents. The relay carries opaque Yjs updates, which SpacePress cannot redact or authorize field by field. Hooks run as the user who saves. Participants see each other's WordPress profile name, avatar, and presence. Use ordinary editing if each participant's changes need separate save attribution.

A schema change starts a new sync history and hides the previous documents, which remain stored. Reload open editors after changing the schema. The classic editor retains ordinary edit locks for its Secure Custom Fields meta boxes, so a classic editing session can block a collaborative save. External API and MCP writes do not automatically appear in open collaborative editors.

To test collaboration on a disposable local WordPress site, run `tests/wp/coediting/run.sh`. Run `tests/php/run.sh coediting` to test the server access checks.
