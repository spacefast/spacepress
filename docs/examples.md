# The examples

Each example builds for both targets. Its committed `zero/client/` and
`zero/migrations/` are what `zero build` produces, so a fresh build changes
nothing.

| Example | What it shows |
| --- | --- |
| `examples/pantry/` | Plain tables, hooks and actions, plus a background job (`notifyLowStock`) |
| `examples/blog/` | The CMS tour: every phase-2 feature, with a browser page |
| `examples/site/` | The publication that `tests/system` drives end to end |
| `examples/wp-plugins/` | Extra pinned WordPress plugins (see [plugin dependencies](wp-plugins.md)) |

## The blog

`examples/blog` has authors, posts and moderated comments, and on top of
that:

- **Field access:** an author's email is for editors only, and the SEO group
  only shows up for published posts.
- **Sync:** posts sync with `content/posts/*.md`, and two sample posts are
  committed.
- **Members:** readers sign in as `members`, with a password on standalone or
  through the zero-identity screens on WordPress.
- **Media:** every image gets a 600×400 `card` crop, and slide decks are
  private files (`posts.deck`).
- **Jobs and webhooks:** a reader's comment queues `notifyEditors`, and every
  post change goes out as a signed webhook to `BLOG_HOOK_URL`.
- **Translations:** posts are in English and German.

Run it on standalone. Build for the target you'll serve, turn the generated
client into browser JS, then serve:

```sh
./target/release/zero build examples/blog --target standalone
node examples/blog/build-client.mjs
./target/release/zero dev examples/blog       # http://127.0.0.1:8787/, with the job worker
echo "a-long-password" | ./target/release/zero users add you@example.com --role editor --password --dir examples/blog
```

The page signs you in, switches between English and German, and takes
comments. Send its posts to the site with
`zero sync examples/blog --site http://127.0.0.1:8787 --token <token>`
(`zero tokens create you@example.com`).

On WordPress, `zero dev examples/blog --wp` boots the artifact in the test
harness. Register the page once as a sign-in client:
`wp zero-identity app add --id=app_blog --redirect=<page URL> --origin=<its origin>`.

## Suites

```sh
cargo test                     # compiler; the pantry and blog examples built and run on standalone
tests/php/run.sh               # the PHP runtime
tests/wp/run.sh                # the runtime on real WordPress (Docker)
tests/system/run.sh            # examples/site on WordPress and standalone, a 0.8 site migration, the blog's sync
```

`tests/system/run.sh` boots three fresh WordPress sites, one at a time:

1. `examples/site`, installed as a site owner would and walked through the
   whole journey, then upgraded, deactivated and reinstalled. The same
   journey also runs on the standalone build.
2. An original Zero 0.8 site, moved over as
   [migrating from Zero 0.8](migrating-from-zero.md) describes.
3. `examples/blog`, whose committed Markdown posts sync in.
