import { wp } from "spacepress";
export const articles = wp.posts.extend({}, { url: "/blog/:slug" });
