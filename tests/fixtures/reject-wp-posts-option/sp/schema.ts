import { wp } from "spacepress";
export const notes = wp.posts.clone({}, { hierarchical: true });
