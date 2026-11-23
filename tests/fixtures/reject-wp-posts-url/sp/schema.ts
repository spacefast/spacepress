import { wp, text } from "spacepress";
export const posts = wp.posts.extend({ byline: text().optional() });
