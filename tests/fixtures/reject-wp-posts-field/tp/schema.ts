import { wp, text } from "typedpress";
export const posts = wp.posts.extend({ excerpt: text() }, { url: "/blog/:slug" });
