# Import an existing project into SpacePress

Build the importer from the repository root.

```sh
cargo build --locked -p spacepress-migrate
target/debug/spacepress-migrate --help
```

Use the same command to choose a source and generate a candidate. Add `--dry-run` to check the conversion without creating output.

| Source | Command | What it creates |
| --- | --- | --- |
| Astro | `spacepress-migrate --from astro app <project> --out <new-dir>` | A SpacePress project with supported Markdown pages, collections and assets. The report lists files to port by hand. |
| Zero | `spacepress-migrate --from zero app <capsule> --out <new-dir> --fresh` | A SpacePress project with supported schema, handlers, pages and browser code. |
| EmDash, Payload, Sanity or Zero | `spacepress-migrate --from <source> config <input> --out <new-dir>/spacepress.config.ts` | A SpacePress config from declarative source. |

The converter checks the candidate with the SpacePress compiler. Review the JSON report and the generated sources before building or publishing the project. Keep the source project until the destination is verified.

- [Astro conversion and worked example](astro/example/README.md)
- [Zero application and WordPress data import](docs/migrating-from-zero.md)
- [Schema import options](docs/config-migration.md)
