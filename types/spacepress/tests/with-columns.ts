// `with` on media and file columns (docs/config-api.md, "Database API"): the row in the id's place.
import { collection, file, files, media, text, type FileRow, type MediaRow, type QueryRow, type WithConfig } from "spacepress";

const decks = files({ accept: ["application/pdf"], maxBytes: 5_000_000 });
const talks = collection({
  title: text(),
  cover: media({ accept: "image" }).optional(),
  slides: media().many().default([]),
  deck: file(decks).optional(),
});
type S = { talks: typeof talks };
// No relations between kinds: only the media and file columns can be loaded.
type R = {};

export const withAll: WithConfig<S, R, "talks"> = { cover: true, slides: true, deck: true };
// @ts-expect-error a plain column is not loaded by `with`
export const withTitle: WithConfig<S, R, "talks"> = { title: true };

declare const row: QueryRow<S, R, "talks", {}, { cover: true; slides: true; deck: true }>;
export const cover: MediaRow | null = row.cover;
export const card: string | undefined = row.cover?.sizes.card?.url;
export const slides: MediaRow[] = row.slides;
// The id stays an id for a visitor the bucket's read rule refuses.
export const deck: FileRow | number | null = row.deck;
// @ts-expect-error so a file's url is read only once the row is known to be loaded
export const url: string = row.deck.url;
export const title: string = row.title;

declare const plain: QueryRow<S, R, "talks", {}, {}>;
export const coverId: number | null = plain.cover;
