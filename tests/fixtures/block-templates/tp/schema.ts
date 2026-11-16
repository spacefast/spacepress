import { collection, text } from "typedpress";

export const notes = collection({ title: text() }, { title: "title" });
