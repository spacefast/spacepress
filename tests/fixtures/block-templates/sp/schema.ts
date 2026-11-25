import { collection, text } from "spacepress";

export const notes = collection({ title: text() }, { title: "title" });
