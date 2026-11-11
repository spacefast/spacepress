// The app's kinds handed on under another name: "first:db" is imported where it's used, never
// re-exported (here a local export of the imported binding).
import { notes } from "first:db";
export { notes as allNotes };
