# Existing storage fixture

`sp/_generated/migrations/` is the unmodified output of main at
`a2ec286d43ad3f93aec7935bc9c7f015dcb6d33d`, built with these same fields,
relations, access and revisions using the old authoring:
`collection("stockItems", fields, { editor: false, revisions: true, access })`,
`collection("stockLinks", fields, { editor: false, access })`, and
`defineConfig({ name: "upgradeprobe", schema, relations })`.
The config here uses explicit table registration and physical storage bindings.
`pantry_example_builds_and_its_hooks_run_in_php` owns preservation/refusal coverage;
it builds against this ledger without changing the snapshot or adding SQL.
