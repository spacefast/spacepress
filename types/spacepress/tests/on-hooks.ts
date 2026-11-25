// `.on()` hooks (spec §2.8): each handler is typed by its own kind, also when two kinds sit side by
// side and one refers to the other. Compiles only.
import { collection, table, text, integer, ref } from "spacepress";

export const authors = collection({ name: text() }).on({
  beforeCreate(data) {
    data.name = data.name.trim();
  },
  afterPublish(row) {
    const name: string = row.name;
    void name;
  },
});

export const notes = table({ body: text(), stars: integer().default(0), author: ref(authors).optional() })
  .on({
    beforeCreate(data) {
      const body: string = data.body;
      void body;
      // @ts-expect-error a note has no `name`: the handler sees notes, not authors
      void data.name;
    },
    afterUpdate(row, previous) {
      const stars: number = row.stars + previous.stars;
      void stars;
    },
  })
  .on({
    afterCreate(row) {
      // @ts-expect-error `stars` is a number
      const s: string = row.stars;
      void s;
    },
  });

// @ts-expect-error there is no hook called afterSave
authors.on({ afterSave() {} });
