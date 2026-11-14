import { notes } from "first:db";
import { Comments } from "first/app";

// The same item and its thread at an address that isn't its permalink: a comment approved on it
// must purge this page too.
export default async function Featured() {
  const note = await notes.get({ slug: "open-note" });
  return note ? <article><h1>Featured: {note.title}</h1><Comments for={note} /></article> : <p>Nothing featured</p>;
}
