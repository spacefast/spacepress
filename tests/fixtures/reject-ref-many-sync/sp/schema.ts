import { collection, f } from "spacepress";
export const tags = collection({ title: f.text() }, { uid: true });
export const notes = collection({ title: f.text(), tags: f.ref(tags).many() }, { sync: "content/notes/*.json" });
