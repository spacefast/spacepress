// The app's kinds handed on under another name: "spacepress:db" is imported where it's used, never
// re-exported (here a local export of the imported binding).
import { notes } from "spacepress:db";
export { notes as allNotes };
