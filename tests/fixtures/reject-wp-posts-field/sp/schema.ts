import { extend, f } from "spacepress";
export const posts = extend("posts", { fields: { excerpt: f.text() } });
