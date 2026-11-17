import { wp } from "typedpress";
export const articles = wp.posts.extend({}, { url: "/blog/:slug" });
