---
uid: zr_20000000000000000001
title: Finalize SpacePress rename checklist
notes: Confirm every package manifest, CLI alias, and example compiles cleanly before cutting v0.3.
url: "https://spacepress.dev/docs"
priority: high
visibility: team
assigneeId: 1
checklist:
  - { label: "Run scripts/check-examples.sh across every example", done: true }
  - { label: "Verify sp/_generated/ stays clean on rebuild", done: true }
  - { label: "Tag v0.3 release artifacts", done: false }
bucketIds: [zr_10000000000000000003, zr_10000000000000000011, zr_10000000000000000021]
---

Check off the final rename verification items. Completing this task automatically unblocks the release notes task waiting on it.
