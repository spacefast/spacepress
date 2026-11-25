---
uid: zr_20000000000000000001
title: Finalize SpacePress rename checklist
notes: Confirm every package manifest, CLI alias, and example compiles cleanly before cutting v0.3.
url: "https://spacepress.dev/docs"
priority: high
bucketIds: [zr_10000000000000000003, zr_10000000000000000011, zr_10000000000000000021]
---

Check off the final rename verification items:

- Run `scripts/check-examples.sh` across every example app.
- Verify `sp/_generated/` artifacts match cleanly on rebuild.
- Complete this task to automatically unblock the release notes task waiting on it.
