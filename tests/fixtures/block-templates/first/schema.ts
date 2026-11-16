import { collection, text } from "first";

export const notes = collection({ title: text() }, { title: "title" });
