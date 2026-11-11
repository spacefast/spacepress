# Reading list

A reading log that uses each part of a First app once: a WordPress collection, a SQL table, per-user access rules, hooks, an action, a background job, a public route and two npm packages. The docs site's landing page shows it with every file `first build` writes for it.

## Run it

From the repository root:

```sh
cargo build --locked --release
npm ci --prefix examples/reading-list --ignore-scripts --no-audit --no-fund
./target/release/first build examples/reading-list
./target/release/first dev examples/reading-list --no-watch --port 8911
```

Sign in at `http://localhost:8911/wp-admin/` with `admin` / `first-test-admin` (local development only).

## Try each part

Create an application password for `admin`, then call the API with it:

```sh
PW=$(./target/release/first wp --site examples/reading-list user application-password create admin docs --porcelain)
API=http://localhost:8911/wp-json/first/v1
curl -u "admin:$PW" -H 'content-type: application/json' -X POST $API/books -d '{"title":"The Left Hand of Darkness"}'
curl -u "admin:$PW" -H 'content-type: application/json' -X POST $API/actions/logRead -d '{"bookId":5,"minutes":25}'
./target/release/first wp --site examples/reading-list action-scheduler run
curl http://localhost:8911/shelf.html
```

Use the `id` the first call returns as `bookId`. What each call shows, as run against `first dev` on 2026-11-09:

| Call | Result |
| --- | --- |
| `POST /books` | 201. The book is a WordPress post with a slug made from the title |
| `GET /books` without signing in | The book. `read: "anyone"` |
| `POST /actions/logRead` with 25 minutes | The new read, with `ownerId` set to the signed-in user |
| `POST /actions/logRead` with 0 minutes | 422 `minutes must be positive`, from `beforeCreate` |
| `POST /reads` with `"ownerId": 99` | 403 `You can't set ownerId` |
| `GET /reads` without signing in | 401 |
| `action-scheduler run`, then `GET /books` | `minutesRead` is the book's total, written by the `tally` job |
| `GET /shelf.html` | `<ul><li>The Left Hand of Darkness: 25 minutes</li></ul>`, formatted by `escape-html` and `ms` running as PHP |
