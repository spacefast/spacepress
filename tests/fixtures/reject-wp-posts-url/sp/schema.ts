import { extend, f } from "spacepress";
export const posts = extend("posts", { fields: { byline: f.text().optional() }, url: "/blog/:slug" });
