# Import a Zero 0.8 project

Build the [migration executable](../README.md) and keep the source capsule and a database backup.

## Convert the application

```sh
typedpress-migrate --from zero app ./capsule --out ./candidate --fresh --dry-run
typedpress-migrate --from zero app ./capsule --out ./candidate --fresh
typedpress build ./candidate
```

Use `--manifest <finalize.json>` to read a stored finalize payload. If its recorded source tree is available, pass that tree too. Use `--users` to generate a projection for the existing Space Users subjects. For a client app that used generated CSS, pass the original file with `--zero-css <file>`.

A refusal gives the source location and the reason in the JSON report. For the converter's supported features, read the [coverage notes](zero-08-parity.md).

## Copy existing application tables

If the source has SQL tables, replace `--fresh` with `--space <original-space-id>`. The candidate binds imported tables under the destination WordPress prefix. If the destination uses a prefix other than `wp_`, also pass `--target-prefix <prefix>`.

Load the source SQL tables into the destination's database during the migration window. Stop writes to those tables during the copy. Run the table import against the destination WordPress installation before activating the app.

```sh
typedpress-migrate --from zero wordpress tables ./candidate/table-import.json --path=/path/to/wordpress
typedpress-migrate --from zero wordpress tables ./candidate/table-import.json --path=/path/to/wordpress --apply
```

The import preserves rows, indexes and the next auto-increment ID. It requires an unused destination name and refuses source tables with foreign keys. Import those tables with their constraints using your database tools. The generated map names each source and destination table.

## Import WordPress content and users

For a content-only Zero project, run the `config` operation against its capsule. Review the generated collection fields and access rules. Build the resulting project, then activate its plugins on the destination. Copy the source uploads into the destination WordPress uploads directory before running the content import.

Pass the Zero release's trusted `content-model.php` to the content import. Run without `--apply` first to see the records, revisions and references the import can move.

```sh
typedpress-migrate --from zero wordpress content ./content-model.php --space=SPACE --path=/path/to/wordpress
typedpress-migrate --from zero wordpress content ./content-model.php --space=SPACE --path=/path/to/wordpress --apply
```

The optional `users` operation reads the original site's user tables and requires an active TypedPress user projection.

```sh
typedpress-migrate --from zero wordpress users --space=SPACE --path=/path/to/wordpress
typedpress-migrate --from zero wordpress users --space=SPACE --path=/path/to/wordpress --apply
```

## Copy a Spacefast export across prefixes

Run the import on the destination WordPress site with the source tables present in the same database. Keep source writes stopped until verification completes. Use the source prefix, destination prefix and Space ID from the export.

```sh
typedpress-migrate --from zero wordpress spacefast --space=SPACE --source-prefix=SOURCE --target-prefix=TARGET --path=/path/to/wordpress
typedpress-migrate --from zero wordpress spacefast --space=SPACE --source-prefix=SOURCE --target-prefix=TARGET --path=/path/to/wordpress --apply
typedpress-migrate --from zero wordpress spacefast --space=SPACE --source-prefix=SOURCE --target-prefix=TARGET --path=/path/to/wordpress --verify
```

The importer copies records and accounts. Members sign in again on the destination to create a new session. Verify the copied record counts and read permissions before exposing the new app.
