#!/usr/bin/env bash
# Compiled synced Markdown -> first-publish seed -> republish -> CLI sync on real WordPress/MariaDB.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
target="${CARGO_TARGET_DIR:-$repo/target}"
[[ $target == /* ]] || target="$repo/$target"
export ZERO_WP_PROJECT="${ZERO_WP_PROJECT:-zero-wp-seed}"
export ZERO_WP_PORT="${ZERO_WP_PORT:-8897}"
app="$(mktemp -d)"
cleanup() { "$here/harness.sh" down; rm -rf "$app"; }
trap cleanup EXIT
mkdir -p "$app/project/content/posts" "$app/project/content/locked" "$app/content/plugins"
cat > "$app/project/zero.config.ts" <<'TS'
import { defineConfig, collection, table, id, text, richText, slug } from 'zero';
const posts = collection({ id: id(), title: text().notNull(), body: richText(), slug: slug({ source: 'title' }) }, {
  title: 'title', content: 'body', drafts: true, sync: 'content/posts/*.md',
  access: { read: 'anyone', create: 'editor', update: 'editor', delete: 'editor' },
});
const locked = table({ id: id(), title: text().notNull(), body: richText() }, {
  content: 'body', sync: 'content/locked/*.md', access: { read: false, create: false, update: false, delete: false },
});
export default defineConfig({ collections: { posts }, tables: { locked } });
TS
cat > "$app/project/content/posts/hello.md" <<'MD'
---
title: Hello
slug: hello
status: published
publishedAt: 2026-11-05T12:00:00.000Z
---
A **seed**.
MD
cat > "$app/project/content/locked/locked.md" <<'MD'
---
title: Locked
---
Original locked body.
MD
"$target/debug/zero" sources "$app/project" --out "$app/source-1"
"$target/debug/zero" compile-sources "$app/source-1" "$app/compiled-1" "$app/source-1"
# Native build acquires the harness's pinned platform dependencies; execute the hosted plugins.
"$target/debug/zero" build "$app/project" --quiet >/dev/null
rsync -a "$app/project/.zero/wp-content/" "$app/content/"
rsync -a "$app/compiled-1/plugins/" "$app/content/plugins/"
"$here/harness.sh" up --wp-content "$app/content" > "$app/harness.json"
"$here/harness.sh" wp zero migrate > /dev/null
# Recompile the same version through the publish pipeline, retaining the host-owned baseline.
"$target/debug/zero" sources "$app/project" --out "$app/source-2"
"$target/debug/zero" compile-sources "$app/source-2" "$app/compiled-2" "$app/source-2" "$app/compiled-1"
python3 "$here/seed-proof.py" "$app" "$target/debug/zero" "$here/harness.sh"
