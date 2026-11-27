import { wp } from "spacepress/server/wp";
export const bad = wp.filter("the_contnet", (_ctx, content: string) => content);
