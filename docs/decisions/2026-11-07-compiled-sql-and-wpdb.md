# Compiled SQL and `$wpdb`

Status: in progress. Findings land here before code changes.

## Question

Zero's compiled SQL (`Sql::select`, the stores, `Migrator`) runs on `$wpdb->dbh` directly: mysqli
prepared statements on MySQL/MariaDB, literal interpolation through the SQLite plugin's own lexer on
SQLite. Can it go through WordPress's database API instead, and what does that gain or cost?

Options:

- (a) the compiler escapes `%` as `%%` and emits `$wpdb->prepare()` placeholders;
- (b) keep native prepared statements, but route them through `$wpdb` so drop-ins and logging see them;
- (c) keep the current path.

## Findings so far

- SQLite Database Integration 3.1.3 (2026-11-03, latest) and `trunk` (c3dde4f, 2026-11-06) still
  refuse `PDO::prepare()` (`driver does not support prepared statements`) and still lack
  `JSON_CONTAINS`, `JSON_OBJECTAGG` and `SUBSTRING_INDEX`. JSON functions are in open PRs #582, #589,
  #590 only.
