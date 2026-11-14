import { ref, table, text } from "first";
export const tags = table({ name: text() });
export const notes = table({ tags: ref(tags).many(), extra: ref(tags).many().reverse("name") });
