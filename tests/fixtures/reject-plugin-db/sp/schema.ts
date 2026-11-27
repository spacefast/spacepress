import { collection, f } from "spacepress";
export const posts = collection({ title: f.text() }, { title: "title" });
