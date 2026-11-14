import { collection, ref, text } from "first";
export const tags = collection({ title: text() }, { uid: true });
export const notes = collection({ title: text(), tags: ref(tags).many() }, { sync: "content/notes/*.json" });
