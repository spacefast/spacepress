import { wp } from "typedpress";
export const pages = wp.pages.extend({}, { url: "/:path" });
