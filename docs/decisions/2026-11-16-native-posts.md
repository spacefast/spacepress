# WordPress's posts in an app: `wp.posts.extend()` and `wp.posts.clone()`

Date: 2026-11-16. Issue #497.

## What the owner asked for

"Native posts should be able to be used, and you should be able to duplicate posts to create other
posts like things. You should be able to attach your text and image and stuff." The address is
settable ("This should be settable"), and the website's blog is "native WordPress, but Next Admin
should be able to manage it." One way to do each thing.

## The API

Two verbs on one value, `wp.posts` from `"typedpress"`:

- `export const posts = wp.posts.extend(fields, { url, ... })`: WordPress's own `post` type with
  the app's fields as post meta (`tp_<field>`). `url` is required. Exported as `posts` only.
- `export const notes = wp.posts.clone(fields, options)`: another kind with posts' own fields and
  behaviour (comments, drafts, revisions, excerpt), stored as its own post type `tp_<name>`.

`fields()` (spreading posts' fields into `collection()`) was the earlier proposal. It was not built:
a spread copies fields but not comments, drafts or revisions, so it would have been a second,
weaker way to make a post-like kind. `clone` is the one way.

Not built here, each refused at build time with "isn't supported yet": `wp.pages`, `wp.media`,
`wp.users`, `wp.comments`, `wp.categories`, `wp.tags`, `wp.menus`, `wp.settings`, and `.off()`.

## On WordPress's hooks

| Job | Core mechanism used |
|---|---|
| Fields | `register_post_meta` (with `auth_callback` false: TypedPress's codec writes them), SCF's field group on `post_type == post` |
| The REST route and editor saves | `register_post_type_args` sets `rest_controller_class` on core's `post`; the controller is TypedPress's `PostsController`, a subclass of core's |
| The address | core's `post_link` filter, plus the kind's rewrite rule; core's own addresses for a post (`/%postname%/`, `?p=`) answer 301 to it from `template_redirect` |
| Who writes | core's `map_meta_cap` answers first; the app's rule can only turn an allowed capability into `do_not_allow`. TypedPress's own write path (the API, actions) checks `edit_posts`, `publish_posts`, `edit_post`, `delete_post` with `user_can` before the rule; so do sync's push and trash (`edit_post`, `delete_post`) and every staged-version route (`edit_post`) |
| Who reads | a published, unprotected post: the app's rule. Anything else (a draft, a private or scheduled post) only for whom core lets read it: its author with `edit_posts`, or `edit_others_posts` + `read_private_posts`. The store adds that as a SQL guard on every read (the API, pages, sync, core's REST route), so a function rule like `read: () => true` can't open them |
| Slugs | WordPress's: a taken slug becomes `hello-2` through `wp_unique_post_slug`, as in the block editor; no unique check of TypedPress's |
| Comments | core's comments, `comments_open` and the comment policy TypedPress already enforces for collections |
| Revisions | core's revisions (no table of TypedPress's; #498 removes the old SQL table history separately) |
| Sitemap | core's posts provider drops `post` (`wp_sitemaps_post_types`); TypedPress's sitemap lists the kind by its `url` |

## Moving the website's blog

`www/tp/schema.ts` changes `posts` from `collection()` to `wp.posts.extend()`. On the next deploy,
`NativePosts::adopt` (run with the migrations, under the deploy lock) changes each `tp_posts` item's
`post_type` to `post` in place. Ids, post meta, uids, revisions, comments and Markdown sync bases are
kept, because none of them is keyed by the post type; a field stored as `tp_excerpt` becomes the
post's `post_excerpt`, on its revisions too; comments open, since posts take comments; a slug a core
post already has is made unique by WordPress, the old one kept as `_wp_old_slug`. Nothing is deleted.

It runs once per app and site (option `tp_<app>_adopted_posts`), in one transaction, and only when
this app deployed on the site before (its `tp_<app>_schema` option holds an earlier build's hash), so
a fresh app never takes `tp_posts` rows another app left behind. Verified on a copy of the site: the
post kept its id, both revisions and its comment.

## Rendering

The blog's pages keep rendering through `tp/app/blog/`. Theme templates for app pages are #520
(`tp/page` block, templates registered with `register_block_template()`); a post's page is an app
page like any other, so it gets them when #520 lands. This change adds no template mechanism of its
own.
