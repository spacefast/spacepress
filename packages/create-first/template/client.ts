import { createClient } from './first/_generated/client/index.ts';

// Generated types follow your schema. Import this client in an optional TS frontend.
export const client = createClient({ url: '/wp-json/first/v1' });
export async function noteTitles(): Promise<string[]> {
  const notes = await client.notes.list();
  return notes.map((note) => note.title);
}
