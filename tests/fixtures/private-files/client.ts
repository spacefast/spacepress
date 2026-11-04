// The generated client for a collection whose type name would collide with the built-in PrivateFile,
// plus the files and media surfaces (phase 2 §7.2). Compiled with tsc by tests/compiler.rs.
import { createClient, type PrivateFile, type PrivateFileRow } from "./zero/client/index.ts";

async function check() {
  const zero = createClient();
  const row: PrivateFileRow = await zero.privateFiles.get(1);
  const label: string = row.label;
  const unpopulatedDeck: number | null = (await zero.privateFiles.get(1)).deck;
  const unpopulatedDecks: (number | null)[] = (await zero.privateFiles.list()).map(row => row.deck);
  const uploaded: PrivateFile = await zero.files.decks.upload(new Blob([]));
  const url: string = (await zero.files.decks.get(uploaded.id)).url;
  const populated = await zero.privateFiles.get(1, { with: { deck: true } });
  const deck: PrivateFile | number | null = populated.deck;
  // @ts-expect-error no such bucket
  zero.files.slides;
  const media = await zero.media.update(1, { focal: { x: 0.5, y: 0.5 } });
  const focal: { x: number; y: number } | null = media.focal;
  return [label, unpopulatedDeck, unpopulatedDecks, url, deck, focal, media.sizes];
}
void check;
