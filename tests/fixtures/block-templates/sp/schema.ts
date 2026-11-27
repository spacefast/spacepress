import { collection, f } from "spacepress";

export const notes = collection({ title: f.text() }, { title: "title" });
