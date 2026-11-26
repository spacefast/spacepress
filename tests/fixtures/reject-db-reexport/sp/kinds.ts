// The app's kinds handed on under another name: "spacepress/server/db" is imported where it's used, never
// re-exported (here a local export of the imported binding).
import { notes } from "spacepress/server/db";
export { notes as allNotes };
