import { wp } from "spacepress";
export const pages = wp.pages.extend({}, { url: "/:path" });
