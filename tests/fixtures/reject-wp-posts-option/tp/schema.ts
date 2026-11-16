import { wp } from "typedpress";
export const notes = wp.posts.clone({}, { hierarchical: true });
