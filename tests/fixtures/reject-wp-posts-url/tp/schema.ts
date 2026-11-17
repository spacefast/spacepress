import { wp, text } from "typedpress";
export const posts = wp.posts.extend({ byline: text().optional() });
