// `.on()` hooks: object-style ctx, typed by its own kind.
import { collection, f, table } from "spacepress";

export const authors = collection({ name: f.text() }).on({
  beforeCreate({ data }) {
    data.name = data.name.trim();
  },
  onPublish({ row }) {
    const name: string = row.name;
    void name;
  },
});

export const notes = table({ body: f.text(), stars: f.integer().default(0), author: f.ref(authors).optional() })
  .on({
    beforeCreate({ data }) {
      const body: string = data.body;
      void body;
      // @ts-expect-error a note has no `name`: the handler sees notes, not authors
      void data.name;
    },
    afterUpdate({ row, previous }) {
      const stars: number = row.stars + previous.stars;
      void stars;
    },
  })
  .on({
    afterCreate({ row }) {
      // @ts-expect-error `stars` is a number
      const s: string = row.stars;
      void s;
    },
  });

// @ts-expect-error there is no hook called afterSave
authors.on({ afterSave() {} });
