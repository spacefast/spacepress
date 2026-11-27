import { wp } from "spacepress/server/wp";
export const bad = wp.filter("the_content", (_ctx, content: string) => content.length);
