// Shapes the schema tool has to describe as the author wrote them: a kind with a URL and a page
// that serves it, a slug derived from another field, a list of selects, a rule that is a function
// and one that is a boolean.
import { collection, f } from "spacepress";

export const cookingEvents = collection({
  title: f.text().max(120),
  slug: f.slug({ source: "title" }),
  tags: f.select(["vegan", "quick", "baking"]).many().optional(),
}, {
  title: "title",
  access: { read: true, create: "editor", update: (ctx) => ctx.user?.role === "admin", delete: false },
});
