// `wp.posts.extend()` and `wp.posts.clone()`: posts' own fields are typed, the app's fields are
// added, `url` is required on WordPress's posts, and posts' own field names can't be redeclared.
import { wp, integer, media, text, type InferSelectModel, type InferInsertModel } from "spacepress";

export const posts = wp.posts.extend({ cover: media({ accept: "image" }).optional(), minutes: integer().optional() }, { url: "/blog/:slug", sync: "content/posts/*.md" });
export const notes = wp.posts.clone({ mood: text().optional() }, { url: "/notes/:slug", access: { create: "author" } });

type Post = InferSelectModel<typeof posts>;
const title: string = ({} as Post).title;
const excerpt: string | null = ({} as Post).excerpt;
const minutes: number | null = ({} as Post).minutes;
const uid: string = ({} as Post).uid;
const status: "draft" | "published" | "scheduled" = ({} as Post).status;
export const insert: InferInsertModel<typeof posts> = { title: "Hello" };
type Note = InferSelectModel<typeof notes>;
const mood: string | null = ({} as Note).mood;
void [title, excerpt, minutes, uid, status, mood];

// @ts-expect-error WordPress's posts need a url
wp.posts.extend({}, {});
// @ts-expect-error posts already have an excerpt
wp.posts.extend({ excerpt: text() }, { url: "/blog/:slug" });
// @ts-expect-error not an option of a post kind
wp.posts.clone({}, { hierarchical: true });
