// `extend("posts" | "pages" | "users", options?)`: built-in kinds' own fields are typed,
// the app's extra fields are added, and built-in field names can't be redeclared.
import { extend, f, type InferSelectModel, type InferInsertModel } from "spacepress";

export const posts = extend("posts", {
  fields: { cover: f.media({ accept: "image" }).optional(), minutes: f.integer().optional() },
  sync: "content/posts/*.md",
});
export const pages = extend("pages", {
  fields: { subtitle: f.text().optional() },
});
export const users = extend("users", {
  fields: { bio: f.text().optional() },
  access: { read: "self", update: "self" },
});

type Post = InferSelectModel<typeof posts>;
const title: string = ({} as Post).title;
const excerpt: string | null = ({} as Post).excerpt;
const minutes: number | null = ({} as Post).minutes;
const uid: string = ({} as Post).uid;
const status: "draft" | "published" | "scheduled" = ({} as Post).status;
export const insert: InferInsertModel<typeof posts> = { title: "Hello" };
type Page = InferSelectModel<typeof pages>;
const subtitle: string | null = ({} as Page).subtitle;
type UserRow = InferSelectModel<typeof users>;
const bio: string | null = ({} as UserRow).bio;
void [title, excerpt, minutes, uid, status, subtitle, bio];

// @ts-expect-error only "posts" | "pages" | "users" can be extended
extend("comments");
// @ts-expect-error posts already have an excerpt
extend("posts", { fields: { excerpt: f.text() } });
// @ts-expect-error not an option of extend("posts")
extend("posts", { hierarchical: true });
