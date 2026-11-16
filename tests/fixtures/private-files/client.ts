// The generated client for a collection whose type name would collide with the built-in PrivateFile,
// plus the files and media surfaces (phase 2 §7.2). Compiled with tsc by tests/compiler.rs.
import { createClient, type PrivateFile, type PrivateFileRow } from "./tp/_generated/client/index.ts";

async function check() {
  const first = createClient();
  const row: PrivateFileRow = await first.privateFiles.get(1);
  const label: string = row.label;
  const display: string = (await first.roleRows.get(1)).display;
  const roleName: string = (await first.roles.get(1)).roleName;
  const recordLabel: string = (await first.records.get(1)).label;
  const orderAmount: string = (await first.recordRowOrders.get(1)).amount;
  const preferenceCount: string | null = (await first.globals.prefsPatch.get()).count;
  const preferenceValue: string | null = (await first.globals.prefsOutput.get()).value;
  const updatedPreference: string = await first.actions.updatePrefs();
  const unpopulatedDeck: number | null = (await first.privateFiles.get(1)).deck;
  const unpopulatedDecks: (number | null)[] = (await first.privateFiles.list()).map(row => row.deck);
  const uploaded: PrivateFile = await first.files.decks.upload(new Blob([]));
  const url: string = (await first.files.decks.get(uploaded.id)).url;
  const populated = await first.privateFiles.get(1, { with: { deck: true } });
  const deck: PrivateFile | number | null = populated.deck;
  // @ts-expect-error no such bucket
  first.files.slides;
  const media = await first.media.update(1, { focal: { x: 0.5, y: 0.5 } });
  const focal: { x: number; y: number } | null = media.focal;
  return [label, display, roleName, recordLabel, orderAmount, preferenceCount, preferenceValue, updatedPreference, unpopulatedDeck, unpopulatedDecks, url, deck, focal, media.sizes];
}
void check;
